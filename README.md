# Marketplace

A multi-vendor e-commerce marketplace for the Philippine market: independent sellers run their own
stores, customers buy from many sellers in one checkout (retail and wholesale), and the platform
handles payments, commissions, settlements and payouts.

> **Status:** Phase 1 (Foundation) of 10. See the [roadmap](docs/roadmap.md) and the
> [Phase 1 report](docs/phases/phase-1-foundation.md). No business modules exist yet.

## Repository layout

```
marketplace/
├── apps/
│   ├── storefront/        Customer storefront (React + Vite)          http://localhost:5173
│   ├── seller-portal/     Seller Center (React + Vite)                http://localhost:5174
│   ├── admin-portal/      Admin Console (React + Vite)                http://localhost:5175
│   ├── api/               REST API (NestJS modular monolith)          http://localhost:3000/api/docs
│   └── worker/            Background jobs (NestJS + BullMQ, no HTTP)
├── packages/
│   ├── ui/                Design system: shadcn/ui components, layouts, form bindings
│   ├── shared-types/      TypeScript types (roles, error codes, health...)
│   ├── validation/        Zod schemas shared by the API and the frontends
│   ├── api-client/        Typed API client + TanStack Query hooks
│   └── config/            Constants: queues and retry policies, Redis keys, locale
├── prisma/                schema.prisma, migrations/, seed.ts, generated client (@marketplace/database)
├── docker/                docker-compose.yml: PostgreSQL, Redis, MinIO, Mailpit
├── scripts/               Windows PowerShell scripts: setup, start, stop, test, reset, backup
├── e2e/                   Playwright browser tests
└── docs/                  architecture/ database/ api/ development/ testing/ phases/
```

## Start the project (Windows 11)

Prerequisites: **Git, Node.js 24 LTS, Docker Desktop (WSL 2)**. Step-by-step install guide:
[docs/development/WINDOWS_SETUP.md](docs/development/WINDOWS_SETUP.md).

```powershell
git clone https://github.com/neilfurry/ecommerce.git
cd ecommerce
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1   # once: install, start services, migrate, seed
.\scripts\start.ps1                                             # every day: services + all five apps
```

Then open:

| What                         | URL                                 |
| ---------------------------- | ----------------------------------- |
| Storefront                   | http://localhost:5173               |
| Seller Center                | http://localhost:5174               |
| Admin Console                | http://localhost:5175               |
| API documentation (Swagger)  | http://localhost:3000/api/docs      |
| API health                   | http://localhost:3000/api/v1/health |
| Mailpit (all dev email)      | http://localhost:8025               |
| MinIO console (file storage) | http://localhost:9001               |

Stop with **Ctrl+C**, then `.\scripts\stop.ps1` to stop the Docker services (data is kept).

**Check that everything works:** in the Admin Console, **System health** shows every component **Up**.
Under **Developer tools**, run the sample job, send a test email (it appears in Mailpit) and upload
a test file.

## Everyday commands (PowerShell)

| Task                                  | Command                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Start everything                      | `.\scripts\start.ps1`                                                       |
| Start one app                         | `.\scripts\start.ps1 -Only api` (`worker`, `storefront`, `seller`, `admin`) |
| Start only the Docker services        | `.\scripts\start.ps1 -InfraOnly`                                            |
| Stop the Docker services              | `.\scripts\stop.ps1` (`-RemoveData` also wipes data)                        |
| Create a migration after schema edits | `pnpm db:migrate`                                                           |
| Apply migrations / seed               | `pnpm db:deploy` / `pnpm db:seed`                                           |
| Reset the local database              | `.\scripts\reset-db.ps1`                                                    |
| Back up / restore the database        | `.\scripts\backup-db.ps1` / `.\scripts\restore-db.ps1 -File <path>`         |
| All checks and tests                  | `.\scripts\test.ps1`                                                        |
| Typecheck / lint / format             | `pnpm typecheck` / `pnpm lint` / `pnpm format`                              |

## Documentation

| Topic        | Document                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Development  | [Windows setup](docs/development/WINDOWS_SETUP.md) · [Local database](docs/development/LOCAL_DATABASE.md) · [Troubleshooting](docs/development/TROUBLESHOOTING.md) |
| Architecture | [System architecture](docs/architecture/SYSTEM_ARCHITECTURE.md) · [Decision records](docs/architecture/adr/)                                                       |
| Database     | [Database conventions](docs/database/DATABASE_CONVENTIONS.md)                                                                                                      |
| API          | [API reference and conventions](docs/api/API_REFERENCE.md)                                                                                                         |
| Testing      | [Testing guide](docs/testing/TESTING_GUIDE.md)                                                                                                                     |
| Delivery     | [Roadmap](docs/roadmap.md) · [Phase reports](docs/phases/)                                                                                                         |
