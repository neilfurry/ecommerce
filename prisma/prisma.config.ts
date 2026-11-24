import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env automatically. All apps share the repository-root .env.
// Variables already set in the environment win.
loadDotenv({ path: path.resolve(__dirname, '../.env'), quiet: true });

export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
    seed: 'tsx seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Only needed by `pnpm db:check` (migration drift check); an empty, disposable database.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
