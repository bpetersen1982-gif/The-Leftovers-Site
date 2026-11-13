#!/bin/sh
# Nightly encrypted Postgres backup to R2 (requirements OPS-4).
#
# Writes, under s3://$BACKUP_BUCKET/$BACKUP_PREFIX/<UTC timestamp>/:
#   leftovers.dump.age   pg_dump custom format, encrypted to BACKUP_AGE_RECIPIENT
#   manifest.json        size, sha256, Postgres version, row count per table (for restore checks)
# then deletes backups older than BACKUP_KEEP_DAYS. Exits non-zero on any failure, so
# Railway marks the run failed. On success it records a heartbeat in job_state; the app
# emails Admins if that heartbeat is more than 30 hours old.
#
# The server only ever has the PUBLIC age key: it can write backups but can't read them.
set -eu
set -o pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT (age public key) is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
PREFIX="${BACKUP_PREFIX:-backups/postgres}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-35}"
# R2 in production; BACKUP_S3_ENDPOINT points at the local S3 server for testing.
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  ENDPOINT="$BACKUP_S3_ENDPOINT"
else
  : "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
  ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi
export AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

log() { printf '{"level":"%s","service":"leftovers-backup","msg":"%s"%s}\n' "$1" "$2" "${3:-}"; }
s3() { aws --endpoint-url "$ENDPOINT" "$@"; }

STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
DUMP="$WORK/leftovers.dump.age"
started=$(date +%s)

log info "backup started" ",\"stamp\":\"$STAMP\""
pg_dump --format=custom --compress=6 --no-owner --no-privileges "$DATABASE_URL" | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$DUMP"

# Row counts per table, so a restore can be checked (taken right after the dump).
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "select string_agg(format('select %L as t, count(*) as n from public.%I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname = 'public'" > "$WORK/count.sql"
psql "$DATABASE_URL" -At -F '	' -v ON_ERROR_STOP=1 -f "$WORK/count.sql" | jq -Rn '[inputs | split("\t") | {(.[0]): (.[1] | tonumber)}] | add' > "$WORK/counts.json"
SERVER_VERSION=$(psql "$DATABASE_URL" -At -c "show server_version")
SIZE=$(stat -c %s "$DUMP")
SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
jq -n --arg stamp "$STAMP" --arg sha "$SHA" --arg server "$SERVER_VERSION" --argjson size "$SIZE" --slurpfile counts "$WORK/counts.json" \
  '{stamp: $stamp, file: "leftovers.dump.age", bytes: $size, sha256: $sha, serverVersion: $server, format: "pg_dump custom, age-encrypted", rowCounts: $counts[0]}' > "$WORK/manifest.json"

DEST="s3://$BACKUP_BUCKET/$PREFIX/$STAMP"
s3 s3 cp --only-show-errors "$DUMP" "$DEST/leftovers.dump.age"
# The manifest goes last: its presence marks a complete backup.
s3 s3 cp --only-show-errors --content-type application/json "$WORK/manifest.json" "$DEST/manifest.json"
REMOTE_SIZE=$(s3 s3api head-object --bucket "$BACKUP_BUCKET" --key "$PREFIX/$STAMP/leftovers.dump.age" --query ContentLength --output text)
if [ "$REMOTE_SIZE" != "$SIZE" ]; then
  log error "uploaded size mismatch" ",\"local\":$SIZE,\"remote\":\"$REMOTE_SIZE\""
  exit 1
fi

# Retention: timestamps sort as text, so anything below the cutoff is older.
CUTOFF=$(date -u -d "@$(( $(date +%s) - KEEP_DAYS * 86400 ))" +%Y-%m-%dT%H%M%SZ)
s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$PREFIX/" --query 'Contents[].Key' --output json \
  | jq -r --arg prefix "$PREFIX/" --arg cutoff "$CUTOFF" '.[]? | select((ltrimstr($prefix) | split("/")[0]) < $cutoff)' > "$WORK/expired.txt"
pruned=0
while IFS= read -r key; do
  [ -n "$key" ] || continue
  s3 s3api delete-object --bucket "$BACKUP_BUCKET" --key "$key" > /dev/null
  pruned=$((pruned + 1))
done < "$WORK/expired.txt"

# Heartbeat for the app: it emails Admins if this goes stale (no backup in 30 hours).
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "insert into job_state (name, \"lastRunAt\") values ('postgres-backup', now()) on conflict (name) do update set \"lastRunAt\" = excluded.\"lastRunAt\""

log info "backup finished" ",\"stamp\":\"$STAMP\",\"bytes\":$SIZE,\"seconds\":$(( $(date +%s) - started )),\"objectsPruned\":$pruned"
