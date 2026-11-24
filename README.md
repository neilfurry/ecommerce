# Marketplace

A multi-vendor e-commerce marketplace for the Philippine market: independent sellers run their own
stores, customers buy from many sellers in one checkout (retail and wholesale), and the platform
handles payments, commissions, settlements and payouts.

> **Status:** Phase 1 (Foundation) of 10. See [docs/roadmap.md](docs/roadmap.md) and the
> [Phase 1 report](docs/phases/phase-1-foundation.md).

## What's in the repository

| Path                   | What it is                                                      | Dev URL                        |
| ---------------------- | --------------------------------------------------------------- | ------------------------------ |
| `apps/api`             | NestJS REST API (modular monolith), Prisma, Swagger             | http://localhost:3000/api/docs |
| `apps/worker`          | NestJS background worker (BullMQ consumers)                     | none (no HTTP)                 |
| `apps/storefront`      | Customer storefront (React + Vite)                              | http://localhost:5173          |
| `apps/seller-portal`   | Seller Center (React + Vite)                                    | http://localhost:5174          |
| `apps/admin-portal`    | Admin Console (React + Vite)                                    | http://localhost:5175          |
| `packages/ui`          | Design system: shadcn/ui components, layouts, Tailwind tokens   |                                |
| `packages/api-client`  | Typed API client and TanStack Query hooks                       |                                |
| `packages/validation`  | Zod schemas shared by API and frontends                         |                                |
| `packages/types`       | Shared TypeScript types                                         |                                |
| `packages/config`      | Shared constants (queues, Redis keys, locale, currency)         |                                |
| `docker-compose.yml`   | PostgreSQL 17, Redis 7, MinIO (S3-compatible storage)           | MinIO console: :9001           |
| `scripts/*.ps1`        | Windows PowerShell scripts: setup, dev, test, reset, backup     |                                |
| `e2e/`                 | Playwright browser tests across the three frontends             |                                |
| `docs/`                | Setup guides, architecture, decision records, phase reports     |                                |

## Quick start (Windows 11)

Prerequisites: Node.js 24 LTS, Git, Docker Desktop with WSL 2. Full walkthrough:
[docs/windows-setup.md](docs/windows-setup.md).

```powershell
git clone https://github.com/neilfurry/ecommerce.git
cd ecommerce
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1   # install, start services, migrate, seed
.\scripts\dev.ps1                                                # start API, worker and all three frontends
```

Open http://localhost:5175 (Admin Console): **System health** should show every component **Up**.

## Everyday commands (PowerShell)

| Task                                  | Command                                     |
| ------------------------------------- | ------------------------------------------- |
| Start everything                      | `.\scripts\dev.ps1`                         |
| Start one app                         | `.\scripts\dev.ps1 -Only api` (or `worker`, `storefront`, `seller`, `admin`) |
| Start / stop infrastructure only      | `pnpm infra:up` / `pnpm infra:down`         |
| Create a migration after schema edits | `pnpm db:migrate`                           |
| Apply migrations                      | `pnpm db:deploy`                            |
| Seed reference data                   | `pnpm db:seed`                              |
| Reset local database                  | `.\scripts\reset-db.ps1`                    |
| Back up / restore local database      | `.\scripts\backup-db.ps1` / `.\scripts\restore-db.ps1 -File <path>` |
| Browse the database                   | `pnpm db:studio`                            |
| All tests + typecheck + lint          | `.\scripts\test.ps1`                        |
| Unit tests only                       | `.\scripts\test.ps1 -Suite unit`            |
| Typecheck / lint / format             | `pnpm typecheck` / `pnpm lint` / `pnpm format` |

## Documentation

- [Windows setup](docs/windows-setup.md) and [troubleshooting](docs/troubleshooting.md)
- [Architecture overview](docs/architecture.md)
- [Architecture decision records](docs/adr/)
- [Roadmap](docs/roadmap.md) and [phase reports](docs/phases/)
