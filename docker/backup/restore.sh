#!/bin/sh
# Restores a backup made by backup.sh and checks it (requirements OPS-4).
#
#   restore.sh [STAMP|latest]
#
# Downloads the backup, checks its sha256 against the manifest, decrypts it with the
# PRIVATE age key (mounted at /keys/backup-key.txt, never on the server), restores it into
# RESTORE_DATABASE_URL, and compares every table's row count with the manifest.
#
# Safety: the target must be an empty scratch database named leftovers_restore*, unless
# RESTORE_CONFIRM is set to the exact target database name (see docs/backups.md).
set -eu
set -o pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
KEY_FILE="${BACKUP_KEY_FILE:-/keys/backup-key.txt}"
PREFIX="${BACKUP_PREFIX:-backups/postgres}"
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then ENDPOINT="$BACKUP_S3_ENDPOINT"; else : "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"; ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"; fi
export AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3() { aws --endpoint-url "$ENDPOINT" "$@"; }
fail() { echo "RESTORE FAILED: $*" >&2; exit 1; }

[ -r "$KEY_FILE" ] || fail "private key not found at $KEY_FILE"
TARGET_DB=$(psql "$RESTORE_DATABASE_URL" -At -c "select current_database()")
case "$TARGET_DB" in
  leftovers_restore*) ;;
  *) [ "${RESTORE_CONFIRM:-}" = "$TARGET_DB" ] || fail "refusing to restore into '$TARGET_DB'. Set RESTORE_CONFIRM=$TARGET_DB to really overwrite it." ;;
esac
EXISTING=$(psql "$RESTORE_DATABASE_URL" -At -c "select count(*) from pg_tables where schemaname = 'public'")
if [ "$EXISTING" != "0" ] && [ "${RESTORE_CONFIRM:-}" != "$TARGET_DB" ]; then
  fail "'$TARGET_DB' already has $EXISTING tables; use an empty database."
fi

WANT="${1:-latest}"
if [ "$WANT" = "latest" ]; then
  # Only backups with a manifest are complete.
  WANT=$(s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$PREFIX/" --query 'Contents[].Key' --output json \
    | jq -r --arg prefix "$PREFIX/" '[.[]? | select(endswith("/manifest.json")) | ltrimstr($prefix) | split("/")[0]] | sort | last // empty')
  [ -n "$WANT" ] || fail "no complete backups found under $PREFIX/"
fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
echo "Restoring backup $WANT into $TARGET_DB"
s3 s3 cp --only-show-errors "s3://$BACKUP_BUCKET/$PREFIX/$WANT/manifest.json" "$WORK/manifest.json"
s3 s3 cp --only-show-errors "s3://$BACKUP_BUCKET/$PREFIX/$WANT/leftovers.dump.age" "$WORK/dump.age"
[ "$(sha256sum "$WORK/dump.age" | cut -d' ' -f1)" = "$(jq -r .sha256 "$WORK/manifest.json")" ] || fail "checksum mismatch: the backup file is damaged"
age --decrypt --identity "$KEY_FILE" --output "$WORK/dump" "$WORK/dump.age"
pg_restore --no-owner --no-privileges --exit-on-error ${RESTORE_CONFIRM:+--clean --if-exists} --dbname "$RESTORE_DATABASE_URL" "$WORK/dump"

mismatches=0
for table in $(jq -r '.rowCounts | keys[]' "$WORK/manifest.json"); do
  expected=$(jq -r --arg t "$table" '.rowCounts[$t]' "$WORK/manifest.json")
  actual=$(psql "$RESTORE_DATABASE_URL" -At -c "select count(*) from public.\"$table\"")
  if [ "$expected" != "$actual" ]; then
    echo "  MISMATCH $table: backup had $expected rows, restored $actual"
    mismatches=$((mismatches + 1))
  fi
done
TABLES=$(jq '.rowCounts | length' "$WORK/manifest.json")
ROWS=$(jq '[.rowCounts[]] | add' "$WORK/manifest.json")
[ "$mismatches" = "0" ] || fail "$mismatches table(s) didn't match"
echo "RESTORE OK: backup $WANT ($(jq -r .bytes "$WORK/manifest.json") bytes, Postgres $(jq -r .serverVersion "$WORK/manifest.json")): $TABLES tables, $ROWS rows, all row counts match."
