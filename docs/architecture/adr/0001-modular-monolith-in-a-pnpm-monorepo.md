# ADR 0001: Modular monolith with a separate worker, in a pnpm monorepo

- Status: Accepted
- Date: 2026-11-24

## Context

The marketplace has many tightly related domains (orders, payments, commissions, ledger,
settlements) whose writes must be transactionally consistent. The team is small, and the platform
must scale to thousands of sellers and millions of records.

## Decision

- One **NestJS API** organized by business domain (`apps/api/src/modules/<domain>`), sharing one
  PostgreSQL database and using database transactions across domain boundaries where needed.
- One **worker** application (NestJS application context, no HTTP) consuming BullMQ queues. It is
  deployed and scaled independently of the API.
- **Three frontends** (storefront, seller portal, admin portal) as independent Vite apps.
- A **pnpm workspace** holds apps and shared packages (`types`, `validation`, `config`,
  `api-client`, `ui`). No extra build orchestrator: `pnpm --filter` and `pnpm -r` are enough at
  this size.

## Consequences

- Cross-domain consistency uses plain database transactions instead of sagas.
- Horizontal scaling: the API is stateless (sessions in cookies/DB, rate limits in Redis) and the
  worker scales by adding processes.
- Domain boundaries are enforced by convention and review: a module talks to another module only
  through its exported service. If a domain later needs to become a separate service, its module
  boundary is the seam.
