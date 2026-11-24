# ADR 0006: NestJS 12 (ESM-only) inside CommonJS apps

- Status: Accepted
- Date: 2026-11-24

## Context

NestJS 12 publishes its packages as ES modules only. Prisma's generated client, ts-jest-era
tooling and decorator metadata work most smoothly in CommonJS.

## Decision

Follow the official NestJS 12 application template:

- `apps/api` and `apps/worker` stay **CommonJS** (`"module": "nodenext"`, no `"type": "module"`).
  At runtime Node loads Nest through **`require(esm)`** (Node 22.12+, unflagged).
- **Tests:** Jest runs through **SWC** (`@swc/jest`), configured in `jest.nest-preset.cjs`. It
  compiles our TypeScript (with decorator metadata) and transforms Nest's ESM files to CommonJS
  for Jest's module loader, which supports `require(esm)` natively only from Node 24.9.
- **Shared packages** (`types`, `validation`, `config`) compile to CommonJS for Node, and expose a
  `source` export condition that Vite and Jest use to read TypeScript sources directly.

## Consequences

- Works on Node 22.22+ and 24. CI uses Node 24.
- If the apps later move to native ESM (`"type": "module"`), relative imports need `.js`
  extensions and Jest moves to its ESM mode. The SWC preset is then removed.
