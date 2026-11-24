# Troubleshooting

## Start-up and configuration

**`Invalid API environment configuration` (or worker) when starting**
The message lists each bad variable. Compare your `.env` with `.env.example`; new variables are
added there when phases introduce them. Secret values are never printed.

**`.env not found. Run .\scripts\setup.ps1 first.`**
Run `Copy-Item .env.example .env` in the repository root.

**`running scripts is disabled on this system`**
Use `powershell -ExecutionPolicy Bypass -File .\scripts\<script>.ps1`, or run once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**`'pnpm' is not recognized`**
Run `corepack enable` (an Administrator PowerShell may be required), then reopen PowerShell.

**Node version errors / `ERR_REQUIRE_ESM` / `require() of ES Module`**
NestJS 12 is ESM-only and is loaded through Node's `require(esm)`, which needs Node 22.12+.
Install Node.js 24 LTS: `winget install --id OpenJS.NodeJS.LTS -e`, then reopen PowerShell.

## Docker

**`Docker Desktop is not running`**
Start Docker Desktop and wait for **Engine running**. If it never starts, run `wsl --update` in
an Administrator PowerShell and restart Windows.

**`Bind for 127.0.0.1:5432 failed: port is already allocated`**
Another PostgreSQL (often a native Windows install) is using the port. Either stop it
(`Stop-Service postgresql*`) or change the port in `.env`: set `POSTGRES_PORT=5433` **and**
update `DATABASE_URL` to `...@localhost:5433/...`. The same applies to Redis (`REDIS_PORT`,
`REDIS_URL`) and MinIO (`MINIO_API_PORT`, `S3_ENDPOINT`).

Find what holds a port: `Get-NetTCPConnection -LocalPort 5432 | Select-Object OwningProcess` and
then `Get-Process -Id <pid>`.

**MinIO image cannot be pulled**
MinIO Inc. stopped publishing community images in October 2025. The default is Chainguard's free
image (`cgr.dev/chainguard/minio`). If that registry is unreachable, set `MINIO_IMAGE` in `.env` to
another S3-compatible image that accepts `server /data --console-address :9001` and run
`pnpm infra:up` again.

**MinIO fails with a permission error on `/data`**
Remove the volume and start again: `docker compose down`, `docker volume rm marketplace_minio-data`,
`pnpm infra:up`.

**Start over with clean data**
`docker compose down -v` (deletes all local data), then `.\scripts\setup.ps1`.

## Database and Prisma

**`Can't reach database server at localhost:5432`**
Run `pnpm infra:up` and check `docker compose ps`: `postgres` should be `healthy`.

**`P3009 migrate found failed migrations` or drift warnings from `pnpm db:migrate`**
On a local database, `.\scripts\reset-db.ps1` rebuilds it from the migrations.

**Prisma cannot download its engine (`binaries.prisma.sh`)**
Prisma downloads a schema engine on first use. Behind a corporate proxy, set `HTTPS_PROXY` before
running pnpm. On a restricted network, ask IT to allow `binaries.prisma.sh`.

**`Cannot find module '../../generated/prisma/client'`**
The Prisma client is generated code and is not committed. Run `pnpm db:generate`. `pnpm dev` and
`pnpm build` do this automatically.

## API and frontends

**System status shows the worker as down (non-critical)**
Start it: `.\scripts\dev.ps1 -Only worker`. Heartbeats appear within a few seconds. The API
reports the worker down when there is no heartbeat for 60 seconds.

**Frontends show "Unable to reach the API"**
The API is not running on port 3000, or `VITE_API_PROXY_TARGET` points elsewhere. Check
http://localhost:3000/api/v1/health/live.

**CORS errors in the browser console**
Only origins in `CORS_ORIGINS` may call the API directly. In development the frontends use the
Vite proxy (`/api`), which avoids CORS entirely.

**`429 Too Many Requests` during development**
Raise `RATE_LIMIT_MAX_REQUESTS` in `.env` and restart the API.

**Port 5173/5174/5175 already in use**
Each Vite server uses a fixed port (`strictPort`). Close the other process or terminal still
running it.

## Tests

**Playwright: `Executable doesn't exist`**
Run `pnpm exec playwright install chromium` once.

**API e2e tests fail on the currency test**
The e2e suite expects migrated and seeded data: `pnpm db:deploy; pnpm db:seed`.

**Hot reload is slow under WSL**
Keep the repository on the Linux file system (`~/projects`), not under `/mnt/c`.
