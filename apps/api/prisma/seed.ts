/**
 * Development seed data. Idempotent: safe to run any number of times.
 * Run with: pnpm db:seed
 *
 * Only reference data the platform needs to operate is seeded here. Demo sellers,
 * products and customers are added by later phases in clearly marked dev-only blocks.
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client';
import { createPgAdapter } from '../src/infrastructure/prisma/pg-adapter';

loadDotenv({ path: path.resolve(__dirname, '../.env'), quiet: true });
loadDotenv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
