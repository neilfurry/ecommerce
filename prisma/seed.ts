/**
 * Seed data. Idempotent: safe to run any number of times.
 * Run with: pnpm db:seed (from the repository root)
 *
 * Always: reference data (currencies) and the role/permission catalog.
 * Development only (SEED_DEMO_USERS=true and NODE_ENV is not production): one demo
 * account per frontend, all with the password in SEED_DEMO_PASSWORD.
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createPgAdapter, PrismaClient } from './src';
import {
  DEMO_USERS,
  ensureDemoSeller,
  ensureUser,
  syncRolesAndPermissions,
} from './src/seed-identity';

loadDotenv({ path: path.resolve(__dirname, '../.env'), quiet: true });

const CURRENCIES = [
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', minorUnits: 2, isActive: true },
] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');

  const prisma = new PrismaClient({ adapter: createPgAdapter(databaseUrl) });
  try {
    for (const currency of CURRENCIES) {
      await prisma.currency.upsert({
        where: { code: currency.code },
        create: currency,
        update: { name: currency.name, symbol: currency.symbol, minorUnits: currency.minorUnits },
      });
    }
    console.log(`Seeded ${CURRENCIES.length} currency record(s).`);

    await syncRolesAndPermissions(prisma);
    console.log('Synchronised roles and permissions.');

    const demoEnabled =
      process.env.NODE_ENV !== 'production' && (process.env.SEED_DEMO_USERS ?? 'false') === 'true';
    if (demoEnabled) {
      const password = process.env.SEED_DEMO_PASSWORD;
      if (!password || password.length < 12) {
        throw new Error(
          'SEED_DEMO_PASSWORD must be set (12+ characters) when SEED_DEMO_USERS=true.',
        );
      }
      let created = 0;
      for (const user of DEMO_USERS) {
        if (await ensureUser(prisma, user, password)) created += 1;
      }
      console.log(
        `Demo accounts: ${created} created, ${DEMO_USERS.length - created} already present.`,
      );
      if (await ensureDemoSeller(prisma)) console.log('Demo seller and store created.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
