# Database backups (requirements OPS-4)

## What runs

- **Railway service `backup`** (cron, `0 8 * * *` UTC = 2–3am in Lincoln) runs
  `docker/backup/backup.sh`: `pg_dump` → encrypted with [age](https://age-encryption.org)
  to a **public key** → uploaded to R2 at
  `leftovers-media-private/backups/postgres/<UTC timestamp>/`
  (`leftovers.dump.age` + `manifest.json` with size, SHA-256, and every table's row count).
  Backups older than 35 days are deleted.
- When a backup finishes it writes a heartbeat (`job_state.postgres-backup`). The web app
  checks it every 10 minutes and **emails all Admins once a day if no backup has finished
  in 30 hours**.
- The server only has the public key, so nothing on Railway or in R2 can read a backup.

## The private key (needed to restore anything)

- It is in `~/.leftovers/backup-key.txt` on Brandon's Mac, and **must also be saved in a
  password manager**. Without it, no backup can be opened.
- Public key (safe to share): `age12cera054u7763757gdajq63etecmgfag7ztqk7mxxnqsc96eq5rq53p6fc`
  (Railway variable `BACKUP_AGE_RECIPIENT` on the `backup` service).
- If the private key is lost: generate a new pair (below), set the new public key on the
  `backup` service, and treat old backups as unreadable.

## Restore drill (run monthly, takes ~2 minutes; last done 2026-11-13: 33 tables, 95 rows, all matched)

Restores the newest backup into a throwaway local database and checks every row count.
Production is never touched. Needs Docker and the Railway CLI, from the repository root:

```sh
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker build -q -f docker/backup/Dockerfile -t leftovers-backup .
docker network create lo-restore
docker run -d --rm --name lo-restore-db --network lo-restore \
  -e POSTGRES_USER=restore -e POSTGRES_PASSWORD=restore_only -e POSTGRES_DB=leftovers_restore_check postgres:18-alpine
railway variables --service web --json | python3 -c "
import sys, json; d = json.load(sys.stdin)
print(f'R2_ACCOUNT_ID={d[\"R2_ACCOUNT_ID\"]}\nAWS_ACCESS_KEY_ID={d[\"R2_ACCESS_KEY_ID\"]}\nAWS_SECRET_ACCESS_KEY={d[\"R2_SECRET_ACCESS_KEY\"]}')
print('BACKUP_BUCKET=leftovers-media-private\nRESTORE_DATABASE_URL=postgresql://restore:restore_only@lo-restore-db:5432/leftovers_restore_check')" > /tmp/lo-restore.env
docker run --rm --network lo-restore --entrypoint restore.sh --env-file /tmp/lo-restore.env \
  -v ~/.leftovers:/keys:ro leftovers-backup latest      # or a timestamp like 2026-11-13T154519Z
rm -f /tmp/lo-restore.env; docker stop lo-restore-db; docker network rm lo-restore
```

It ends with `RESTORE OK: ... all row counts match.` or `RESTORE FAILED: <why>`.

## Restoring production for real (data loss)

1. Pick the backup to restore (the drill above shows the newest; list others with
   `aws s3 ls s3://leftovers-media-private/backups/postgres/ --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`).
2. Run the drill against it first, to be sure it's good.
3. In Railway, add a **new** Postgres database (don't delete the old one), give it a public
   TCP proxy temporarily, and run `restore.sh <stamp>` with `RESTORE_DATABASE_URL` pointing at
   it and `RESTORE_CONFIRM=<its database name>` (the script refuses any database not named
   `leftovers_restore*` without this).
4. Point the `web` service's `LEFTOVERS_DATABASE_URL` at the new database
   (`${{NewPostgres.DATABASE_URL}}`), let it redeploy, check the site, then remove the
   temporary TCP proxy. Keep the old database until you're sure.

Railway's own volume snapshots (Postgres service → Backups tab) are a second safety net
for "undo the last day"; they live in the same Railway project, so they don't replace these.

## New key pair

```sh
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
printf 'FROM alpine:3.22\nRUN apk add --no-cache age\n' | docker build -q -t leftovers-age -
docker run --rm --user "$(id -u):$(id -g)" -v ~/.leftovers:/out leftovers-age age-keygen -o /out/backup-key-new.txt
grep -o 'age1[a-z0-9]*' ~/.leftovers/backup-key-new.txt   # set this as BACKUP_AGE_RECIPIENT
```
