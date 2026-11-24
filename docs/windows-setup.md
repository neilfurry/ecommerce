# Windows 11 development setup

Everything runs on one Windows 11 PC. The databases run in Docker Desktop (WSL 2 backend). The
Node.js apps run directly on Windows for fast hot reload. All commands are for **Windows
PowerShell** unless marked otherwise.

## 1. Install prerequisites

| Tool                  | Version             | How to install                                                        |
| --------------------- | ------------------- | --------------------------------------------------------------------- |
| Git                   | any recent          | `winget install --id Git.Git -e`                                      |
| Node.js               | **24 LTS** (≥ 22.22) | `winget install --id OpenJS.NodeJS.LTS -e`                           |
| pnpm                  | 10.x                | `corepack enable` then `corepack prepare pnpm@10.28.0 --activate`     |
| Docker Desktop        | 4.x, WSL 2 backend  | `winget install --id Docker.DockerDesktop -e`                         |
| Visual Studio Code    | any recent          | `winget install --id Microsoft.VisualStudioCode -e`                   |

After installing, **close and reopen PowerShell** so the new `PATH` is picked up, then check:

```powershell
git --version
node --version      # v24.x (or v22.22+)
pnpm --version      # 10.x
docker --version
```

### Docker Desktop and WSL 2

1. If WSL is not installed yet, run in an **Administrator** PowerShell: `wsl --install`, then
   restart Windows.
2. Start Docker Desktop. Under **Settings → General**, make sure **Use the WSL 2 based engine**
   is ticked.
3. Wait until the status bar says **Engine running**.
4. Optional but recommended: under **Settings → Resources**, give Docker at least 4 GB of memory.

### Recommended VS Code extensions

ESLint, Prettier, Prisma, Tailwind CSS IntelliSense, Playwright Test for VS Code, Docker.

## 2. Get the code and run setup

```powershell
cd $HOME\source          # or wherever you keep projects
git clone https://github.com/neilfurry/ecommerce.git
cd ecommerce
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

`setup.ps1` is safe to re-run. It:

1. checks Node.js, pnpm and Docker;
2. copies `.env.example` to `.env` (only if `.env` does not exist);
3. runs `pnpm install`;
4. starts PostgreSQL, Redis and MinIO with `docker compose up -d --wait`;
5. applies the database migrations (`pnpm db:deploy`) and seeds reference data (`pnpm db:seed`);
6. builds the shared packages.

> **Execution policy.** If Windows refuses to run scripts, either keep using the
> `powershell -ExecutionPolicy Bypass -File ...` form, or allow local scripts for your user once:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## 3. Start developing

```powershell
.\scripts\dev.ps1
```

| App            | URL                              |
| -------------- | -------------------------------- |
| Storefront     | http://localhost:5173            |
| Seller Center  | http://localhost:5174            |
| Admin Console  | http://localhost:5175            |
| API (Swagger)  | http://localhost:3000/api/docs   |
| API health     | http://localhost:3000/api/v1/health |
| MinIO console  | http://localhost:9001 (user/password from `.env`) |

Stop with **Ctrl+C**. The Docker services keep running in the background; stop them with
`pnpm infra:down`. Your data is kept. `docker compose down -v` deletes it.

## 4. Environment configuration

All apps read the single **`.env`** file in the repository root. `.env.example` documents every
variable. The defaults work out of the box for local development.

| Variable                         | Used by        | Purpose                                                 |
| -------------------------------- | -------------- | ------------------------------------------------------- |
| `API_PORT`                       | API            | HTTP port (default 3000)                                |
| `CORS_ORIGINS`                   | API            | Comma-separated browser origins allowed to call the API |
| `TRUST_PROXY`                    | API            | `true`/hop count when behind a reverse proxy            |
| `LOG_LEVEL`                      | API, worker    | `fatal`…`trace`, `silent`                               |
| `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX_REQUESTS` | API | Global per-IP rate limit                      |
| `SWAGGER_ENABLED`                | API            | Serve Swagger UI at `/api/docs`                         |
| `POSTGRES_USER/PASSWORD/DB/PORT` | docker compose | PostgreSQL container settings                           |
| `DATABASE_URL`                   | API, Prisma    | PostgreSQL connection string                            |
| `REDIS_PORT`, `REDIS_URL`        | compose, API, worker | Redis                                             |
| `MINIO_*`                        | docker compose | MinIO container settings and image                      |
| `S3_*`                           | API            | S3-compatible storage connection and bucket             |
| `WORKER_CONCURRENCY`             | worker         | Jobs processed in parallel per queue                    |
| `WORKER_HEARTBEAT_INTERVAL_SECONDS` | worker      | How often the worker reports it is alive                |
| `VITE_API_BASE_URL`              | frontends      | API path/URL as seen by the browser (default `/api`)    |
| `VITE_API_PROXY_TARGET`          | frontends      | Where the Vite dev server proxies `/api`                |

Invalid or missing values stop the API and worker at start-up with a list of every problem.

## 5. Database workflow

| Task                                     | Command                     |
| ---------------------------------------- | --------------------------- |
| Edit `apps/api/prisma/schema.prisma`, then create and apply a migration | `pnpm db:migrate` (prompts for a name) |
| Apply existing migrations (no prompts)   | `pnpm db:deploy`            |
| Seed reference data (idempotent)         | `pnpm db:seed`              |
| Drop, recreate, migrate and seed         | `.\scripts\reset-db.ps1`    |
| Visual database browser                  | `pnpm db:studio`            |

Migrations are committed to Git in `apps/api/prisma/migrations`. Never edit an applied migration;
create a new one instead.

## 6. Running tests

```powershell
.\scripts\test.ps1                  # typecheck, lint, unit, integration, browser tests
.\scripts\test.ps1 -Suite unit      # fast, no Docker needed
.\scripts\test.ps1 -Suite integration
.\scripts\test.ps1 -Suite ui        # Playwright
```

Before the first browser test run, download the browser once:

```powershell
pnpm exec playwright install chromium
```

## 7. Automatic backups

`.\scripts\backup-db.ps1` writes a compressed dump to `.\backups` and deletes dumps older than
14 days (`-RetentionDays` to change). To run it every day at 13:00 with Windows Task Scheduler:

```powershell
$repo = (Get-Location).Path
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\backup-db.ps1`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 1pm
Register-ScheduledTask -TaskName 'Marketplace DB backup' -Action $action -Trigger $trigger
```

Restore with `.\scripts\restore-db.ps1 -File .\backups\<file>.dump`. Production backups (managed
database snapshots plus off-site copies) are covered in Phase 10.

## 8. WSL / Linux shell (optional)

The same `pnpm` commands work unchanged inside WSL (Ubuntu). Use `cp .env.example .env` instead
of `Copy-Item`, and `docker compose up -d --wait` instead of the PowerShell scripts. For the best
file-watching performance inside WSL, clone the repository into the Linux file system
(`~/projects`), not under `/mnt/c`.

Having problems? See [troubleshooting.md](troubleshooting.md).
