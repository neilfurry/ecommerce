# ADR 0002: Dependency versions and pins

- Status: Accepted
- Date: 2026-11-24

## Decision

Use the current major versions of the mandated stack, with these deliberate pins:

| Package                       | Version          | Why pinned                                                                                                          |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| TypeScript                    | `~6.0.3`         | TypeScript 7 (native compiler) is out, but `@nestjs/cli` 12 bundles TS 6.0 and `typescript-eslint` supports `<6.1`. |
| Prisma (+ client, adapter-pg) | `7.10.1` exact   | npm's `latest` tag currently points at an 8.0 release candidate; 7.10.1 is the newest stable.                       |
| Node.js                       | 24 LTS (≥ 22.22) | Required by React Router 8 (`>=22.22`) and by `require(esm)` for NestJS 12.                                         |

Other majors in use: NestJS 12, React 19.3, React Router 8, Vite 8 (Rolldown), Vitest 5,
Tailwind CSS 4, TanStack Query 5, Zod 4, BullMQ 6, ioredis 6, Jest 30, ESLint 10, Playwright 1.65.

## Consequences

- Upgrade TypeScript to 7 when NestJS and typescript-eslint support it.
- Move to Prisma 8 once it is stable, in its own change with a migration check.
