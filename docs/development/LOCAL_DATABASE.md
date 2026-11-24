# Local database

PostgreSQL 17 runs in Docker (`docker/docker-compose.yml`, service `postgres`). The schema,
migrations, seed and generated Prisma client live in the **`prisma/`** workspace package
(`@marketplace/database`). Conventions are in
[../database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md).

```
prisma/
├── schema.prisma        the data model (single source of truth)
├── migrations/          SQL migrations, committed to Git, applied in order
├── seed.ts              idempotent reference data (currencies)
├── prisma.config.ts     reads DATABASE_URL from the repository-root .env
└── src/                 package entry: PrismaClient, enums, createPgAdapter (generated/ is not committed)
```

## Connection details

| Setting  | Value (defaults from `.env.example`)                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| Host     | `localhost` (bound to 127.0.0.1)                                                             |
| Port     | `5432` (`POSTGRES_PORT`)                                                                     |
| Database | `marketplace`                                                                                |
| User     | `marketplace`                                                                                |
| Password | `marketplace_dev_password`                                                                   |
| URL      | `postgresql://marketplace:marketplace_dev_password@localhost:5432/marketplace?schema=public` |

Any SQL client (pgAdmin, DBeaver, DataGrip, the VS Code PostgreSQL extension) can connect with these.

## Commands (PowerShell, from the repository root)

| Task                                      | Command                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Start PostgreSQL (and the other services) | `.\scripts\start.ps1 -InfraOnly`                                                                |
| Apply all pending migrations (no prompts) | `pnpm db:deploy`                                                                                |
| Seed reference data (safe to repeat)      | `pnpm db:seed`                                                                                  |
| Show which migrations are applied         | `pnpm db:status`                                                                                |
| Regenerate the Prisma client              | `pnpm db:generate`                                                                              |
| Open Prisma Studio (browse and edit data) | `pnpm db:studio`                                                                                |
| Drop, recreate, migrate and seed          | `.\scripts\reset-db.ps1`                                                                        |
| Back up to `.\backups`                    | `.\scripts\backup-db.ps1`                                                                       |
| Restore a backup                          | `.\scripts\restore-db.ps1 -File .\backups\<file>.dump`                                          |
| Open `psql` inside the container          | `docker compose --env-file .env -f docker/docker-compose.yml exec postgres psql -U marketplace` |

## Changing the schema

1. Edit `prisma/schema.prisma`, following the [conventions](../database/DATABASE_CONVENTIONS.md).
2. Create and apply a migration (you are asked for a name, e.g. `add_sellers`):

   ```powershell
   pnpm db:migrate
   ```

3. If the change needs a `CHECK` constraint, a partial index or a trigger, which Prisma cannot
   express, append the SQL to the new `migration.sql` **before** committing. Then run
   `.\scripts\reset-db.ps1` to prove the full migration history applies cleanly.
4. Update `prisma/seed.ts` if reference data changed. Seeds must use `upsert` so they stay
   idempotent.
5. Commit `schema.prisma` and the new `migrations/<timestamp>_<name>/` folder together.

Rules:

- **Never edit a migration that has been applied anywhere else** (CI, a teammate, production).
  Create a new migration instead.
- CI fails when `schema.prisma` and the migrations disagree (`pnpm db:check`). To run that check
  locally, create the shadow database once, then set `SHADOW_DATABASE_URL` in `.env`:

  ```powershell
  docker compose --env-file .env -f docker/docker-compose.yml exec postgres createdb -U marketplace marketplace_shadow
  pnpm db:check
  ```

## Current tables

| Table          | Purpose                                                                               | Since   |
| -------------- | ------------------------------------------------------------------------------------- | ------- |
| `currencies`   | ISO 4217 currencies the platform transacts in (seeded: `PHP`)                         | Phase 1 |
| `stored_files` | Metadata for every object in file storage (key, verified type, size, SHA-256, status) | Phase 1 |

## Backups

`.\scripts\backup-db.ps1` writes a compressed `pg_dump` (custom format) to `.\backups` and
deletes backups older than 14 days (`-RetentionDays` changes this; `0` keeps everything). To
schedule a daily backup at 13:00 with Windows Task Scheduler:

```powershell
$repo = (Get-Location).Path
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\backup-db.ps1`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 1pm
Register-ScheduledTask -TaskName 'Marketplace DB backup' -Action $action -Trigger $trigger
```

Restoring replaces the local database: `.\scripts\restore-db.ps1 -File .\backups\<file>.dump`.

## Starting over

```powershell
.\scripts\reset-db.ps1            # only the database: drop, migrate, seed
.\scripts\stop.ps1 -RemoveData    # everything: database, files, emails, Redis
.\scripts\setup.ps1
```

`reset-db.ps1` refuses to run unless `DATABASE_URL` points at `localhost`.
