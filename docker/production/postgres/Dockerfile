# PostgreSQL 17 with pgBackRest for encrypted, point-in-time-recoverable backups to S3.
FROM postgres:17-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates gettext-base \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest /metrics \
 && chown -R postgres:postgres /etc/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest /metrics
COPY postgres/pgbackrest.conf.template /etc/pgbackrest/pgbackrest.conf.template
COPY postgres/postgresql.conf /etc/postgresql/postgresql.conf
COPY postgres/10-extensions.sql /docker-entrypoint-initdb.d/10-extensions.sql
COPY postgres/render-pgbackrest.sh /usr/local/bin/render-pgbackrest
COPY postgres/entrypoint.sh /usr/local/bin/marketplace-postgres
COPY postgres/archive-wal.sh /usr/local/bin/archive-wal
COPY backup/backup.sh /usr/local/bin/marketplace-backup
COPY backup/restore.sh /usr/local/bin/marketplace-restore
RUN chmod +x /usr/local/bin/archive-wal /usr/local/bin/render-pgbackrest /usr/local/bin/marketplace-postgres /usr/local/bin/marketplace-backup /usr/local/bin/marketplace-restore
ENTRYPOINT ["marketplace-postgres"]
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
