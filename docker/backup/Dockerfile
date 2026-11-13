# Nightly encrypted database backup (requirements OPS-4). Runs as a Railway cron service:
# dump -> encrypt (age, public key only) -> upload to R2 -> prune old backups -> exit.
# pg_dump must be at least the server's major version (Railway Postgres is 18).
FROM postgres:18-alpine
RUN apk add --no-cache aws-cli age jq
COPY docker/backup/backup.sh docker/backup/restore.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]
