# Backup and recovery

How the marketplace's data is backed up, how to restore it, and how the restore is tested.
Design: [ADR 0038](../architecture/adr/0038-backups-pgbackrest.md). Commands in this document
run **on the Linux production server (bash)**, from `docker/production`, unless marked
otherwise. `DC` below stands for `docker compose --env-file .env.production`.

## 1. What is protected, and how

| Data                                                                           | Where it lives                    | Protection                                                                                                                                                               | Recovery point                          | Kept for                                           |
| ------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------- |
| Database (orders, payments, ledger, users, catalog…)                           | PostgreSQL volume `postgres-data` | pgBackRest: continuous WAL archiving + weekly full + daily differential + one before every migration, encrypted (AES-256-CBC), to an S3 bucket in another account/region | about 1 minute (`archive_timeout` 60 s) | 4 full backups = 28 days of point-in-time recovery |
| Uploaded files (product photos, seller documents, payment proofs, attachments) | S3 uploads bucket                 | Provider-side versioning + nightly `objects-backup` copy to a second bucket elsewhere (profile `storage-backup`)                                                         | 24 hours (versioning: none lost)        | Deleted/replaced files 90 days                     |
| Queues and rate limits                                                         | Redis (AOF, `redis-data`)         | Not backed up: jobs are re-created by the periodic sweeps (outbox, reservations, payments reconciliation, settlements) and rate limits are transient                     | n/a                                     | n/a                                                |
| TLS certificates                                                               | `caddy-data`                      | Re-issued automatically by Let's Encrypt if lost                                                                                                                         | n/a                                     | n/a                                                |
| Monitoring data                                                                | Prometheus, Loki, Grafana volumes | Not backed up (Grafana dashboards are provisioned from the repository)                                                                                                   | n/a                                     | 30 days                                            |
| Configuration and secrets                                                      | `.env.production`                 | Password vault (see below)                                                                                                                                               | at every change                         | always                                             |

**Keep in the vault** (they cannot be regenerated): `BACKUP_ENCRYPTION_PASSPHRASE` (without it
no backup can be restored), `FINANCE_ENCRYPTION_KEY` (seller bank account numbers),
`AUTH_MFA_ENCRYPTION_KEY`, the S3 backup credentials and the whole `.env.production`.

## 2. Schedule and monitoring

The `backup` service (`marketplace-backup schedule`) runs:

- a **full** backup on Sundays and a **differential** on other days at `BACKUP_HOUR_UTC`
  (17:00 UTC = 01:00 Philippine time);
- a first full backup as soon as a new server starts, so it is protected from day one.

`deploy.sh` also takes an **incremental** backup right before running migrations.

Each run writes metrics read by Prometheus; these alerts fire (ALERTS in
`monitoring/prometheus/alerts.yml`):

| Alert                                  | Meaning                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `DatabaseBackupFailed` (critical)      | The last backup of a type failed — look at `DC logs backup`.                      |
| `DatabaseBackupOverdue` (critical)     | No successful backup in 26 hours.                                                 |
| `PostgresWalArchiveFailing` (critical) | WAL cannot be pushed: point-in-time recovery is at risk and WAL piles up on disk. |
| `ObjectStorageBackupOverdue` (warning) | Uploaded files not copied in 26 hours.                                            |

Useful commands:

```bash
DC exec backup marketplace-backup info      # backups in the repository, sizes, WAL range
DC exec backup marketplace-backup full      # a full backup now
DC exec backup marketplace-backup verify    # checks the WAL archive and every file's checksum
DC logs --tail 100 backup
```

## 3. Restoring the database

A restore replaces the database. Decide first **which state** you need:

- **Latest** (disk failure, lost volume, server rebuilt): every committed transaction up to the
  last archived WAL (about a minute before the failure).
- **Point in time** (a bad migration, a mistaken bulk change, deleted data): just before the
  mistake, e.g. `"2026-12-01 09:30:00+08"`.
- **A specific backup set**: rarely needed; `marketplace-backup info` lists the labels.

### 3.1 Procedure

1. **Announce** the maintenance and **stop writers** (the edge can stay up and will show errors
   for API calls):

   ```bash
   DC stop api worker backup
   ```

2. **Keep the damaged data** (do not delete what you may need for analysis), then stop
   PostgreSQL:

   ```bash
   DC stop postgres
   docker run --rm -v marketplace_postgres-data:/from -v /srv/pg-damaged:/to alpine \
     sh -c 'cp -a /from/. /to/'          # optional copy of the old data directory
   docker volume rm marketplace_postgres-data
   ```

3. **Restore** into a new, empty volume (pick one):

   ```bash
   DC run --rm --no-deps --user postgres --entrypoint marketplace-restore backup
   DC run --rm --no-deps --user postgres --entrypoint marketplace-restore backup "2026-12-01 09:30:00+08"
   DC run --rm --no-deps --user postgres --entrypoint marketplace-restore backup --set 20261201-170001F
   ```

4. **Start PostgreSQL**; it replays the archived WAL up to the target and opens the database:

   ```bash
   DC up -d postgres
   DC exec postgres psql -U marketplace -d marketplace -c "select pg_is_in_recovery(), now()"
   ```

   `pg_is_in_recovery` turns `f` when replay is complete.

5. **Check** before reopening:

   ```bash
   DC exec postgres psql -U marketplace -d marketplace -c \
     "select max(placed_at) as last_order, count(*) from orders"
   ```

   Then start the application and run the finance reconciliation (Admin Console › Finance ›
   Reconciliation; every check must be green):

   ```bash
   DC up -d
   ```

6. **Take a full backup** of the restored database (a new timeline starts):

   ```bash
   DC exec backup marketplace-backup full
   ```

7. **After a point-in-time restore**, transactions after the target are gone. Reconcile them
   with the providers: PayMongo payments (dashboard or the Admin Console's reconciliation job
   re-checks open payments), payouts already sent, and emails customers received. Record the
   incident.

### 3.2 Restoring onto a different server

Install Docker, copy `docker/production` and the vaulted `.env.production`, pull the same
`IMAGE_TAG`, then follow 3.1 from step 3. The repository is identified by `BACKUP_S3_*` and
`BACKUP_STANZA_PATH`; nothing else from the old server is needed.

### 3.3 Restoring a single table or a few rows

Restore to a **separate, temporary** stack (another server, or another Compose project name on
the same server with its own volumes), then copy the rows across with `pg_dump --table` /
`psql`. Never restore over the production volume for a partial recovery.

## 4. Uploaded files

- Accidental deletion or overwrite: restore the object's previous **version** in the
  provider's console (versioning on the uploads bucket), or copy it back from the backup
  bucket:

  ```bash
  DC --profile storage-backup run --rm objects-backup restore products/2026/12/<file-id>.jpg
  ```

- Losing the whole uploads bucket: create a new bucket, point `S3_BUCKET` at it, then

  ```bash
  DC --profile storage-backup run --rm objects-backup restore-all
  ```

- A copy right now (before risky maintenance): `DC --profile storage-backup run --rm objects-backup once`.

## 5. Migration rollback

Migrations are hand-reviewed SQL (`prisma/migrations`), applied by `deploy.sh` after a backup.

Rules for every release:

1. **Expand, then contract.** A migration must work with both the new and the previous
   application version: add columns/tables first (nullable or with defaults), deploy code that
   uses them, and drop old columns only in a later release.
2. **No data-destroying statements** (`DROP`, type changes that lose data) in the same
   release as the code change that stops using them.
3. Large backfills run in batches outside the migration.

When something goes wrong:

| Situation                                                    | Action                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A migration fails during `deploy.sh`                         | The script stops before rolling out; the application keeps running the old version. PostgreSQL rolls back the failed script; check `DC run --rm migrate pnpm db:status`, fix the migration, mark it with `DC run --rm migrate pnpm --filter @marketplace/database exec prisma migrate resolve --rolled-back <name>` and deploy again. |
| The new release is unhealthy                                 | `deploy.sh` rolls the application back automatically; the (backward compatible) migration stays. `./deploy.sh --rollback` does it by hand.                                                                                                                                                                                            |
| A migration was applied and its schema change must be undone | Write a new forward migration that reverses it, and release it.                                                                                                                                                                                                                                                                       |
| A migration damaged data                                     | Point-in-time restore (§3) to the time just before the migration — the timestamp is in the `deploy.sh` output and in `_prisma_migrations.started_at` — then re-deploy the previous release.                                                                                                                                           |

## 6. Restore testing

- **Every pull request (CI, `production-stack` job)** builds the production images, starts the
  stack, takes a full encrypted backup to an S3-compatible repository, writes a row **after**
  the backup and archives its WAL, destroys the database volume, restores into an empty
  volume, and compares every table's exact row count, a checksum of payments, journal lines and
  stock levels, and the post-backup row; then the application must report healthy and
  `pgbackrest verify` must pass (`docker/production/ci/backup-restore.sh`).
- **Before go-live and every quarter**, the same drill on the production data, onto a separate
  server (§3.2), timing each step. Record the result (date, backup label, restore duration,
  checks) in the operations log. This gives the real recovery time; the CI figure is for a
  small dataset.

## 7. Local development (Windows PowerShell)

Developers keep using `.\scripts\backup-db.ps1` and `.\scripts\restore-db.ps1` (plain `pg_dump`
files in `backups/`) for their local database; see `docs/development/LOCAL_DATABASE.md`. They
are unrelated to production backups.
