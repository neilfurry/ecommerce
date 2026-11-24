# ADR 0003: Database conventions

- Status: Accepted
- Date: 2026-11-24

## Decision

- **PostgreSQL + Prisma 7** with the `prisma-client` generator (output `apps/api/src/generated`,
  not committed) and the `@prisma/adapter-pg` driver adapter. Connection settings live in
  `prisma.config.ts`, which loads the repository-root `.env`.
- **Primary keys:** UUID (`@db.Uuid @default(uuid(7))`, time-ordered for index locality) for all
  business entities. Small reference tables may use natural keys (e.g. `currencies.code`).
- **Names:** models in PascalCase, tables and columns in snake_case via `@@map`/`@map`.
- **Timestamps:** `timestamptz(3)`, written in UTC. Containers run with `TZ=UTC`. Display converts
  to `Asia/Manila` in the UI.
- **Money:** see [ADR 0004](0004-money-and-currency.md).
- **Integrity in the database, not only in code:** foreign keys, unique constraints and `CHECK`
  constraints. Prisma does not model `CHECK`s, so they are appended by hand to the generated
  migration SQL and covered by e2e tests.
- **Indexes:** every foreign key and every column used in list filters or sorting gets an index
  when the model is introduced.
- **Financial records are append-only:** ledger and payment rows are never updated or deleted.
  Corrections are new reversing entries (Phase 8). This is enforced with database privileges and
  triggers when those tables arrive.
- **Snapshots:** order lines copy product name, SKU, price, quantity, discount and tax at purchase
  time (Phase 5).
- **Migrations:** created with `pnpm db:migrate`, applied with `pnpm db:deploy`, committed to Git,
  and never edited after being applied anywhere.
- **Transactions:** multi-row business writes use `prisma.$transaction`.

## Consequences

Each new model is reviewed against this list. Seed data is idempotent (`upsert`) and limited to
reference data. Demo data, when added, is clearly marked development-only.
