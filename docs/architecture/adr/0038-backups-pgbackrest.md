# ADR 0038: Encrypted PostgreSQL backups with pgBackRest

- Status: Accepted
- Date: 2026-11-27

## Context

The brief requires automated PostgreSQL backups, a retention policy, encrypted backup storage,
restore testing, migration rollback planning and an object-storage backup strategy. The user
chose pgBackRest to S3.

## Decision

- PostgreSQL archives every WAL segment to a pgBackRest repository in an S3 bucket in a
  different account or region (`archive_timeout` 60 s, so at most about a minute of data is at
  risk). WAL is kept from the first backup on (`archive-wal.sh`).
- The `backup` service takes a full backup weekly and a differential daily; `deploy.sh` takes
  an incremental one before every migration. The repository is encrypted client-side
  (`aes-256-cbc`, passphrase only on the server and in the vault) and compressed (zstd).
  Retention: 4 full backups (28 days of point-in-time recovery) and 7 differentials.
- Every run writes Prometheus metrics (status, last success, duration, size); alerts fire on a
  failed backup, none in 26 hours, or WAL archiving failures.
- Restore (`marketplace-restore`) supports the latest state, a point in time and a specific
  backup. CI destroys the database volume and restores it on every pull request, comparing every
  table's row count, a checksum of payments, journal lines and stock, and a row written after
  the backup (proving WAL replay).
- Uploaded files: the uploads bucket is versioned at the provider; the optional
  `objects-backup` service (rclone) copies it nightly to a backup bucket elsewhere, keeping
  deleted or replaced files for 90 days.
- Migrations are forward-only and must stay compatible with the previous release; a bad
  migration is undone by a new migration or, for data loss, a point-in-time restore to just
  before it.

## Consequences

- Recovery point about one minute; recovery time is the restore duration (measured in CI for
  the test dataset; to be measured on the real dataset during the go-live drill).
