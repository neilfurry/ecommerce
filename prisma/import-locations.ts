/**
 * Imports Philippine locations (regions, provinces, cities/municipalities, barangays) from a
 * PSGC publication. Safe to re-run: names and parents are updated, locations missing from the
 * publication are switched off (never deleted).
 *
 *   pnpm db:import-locations                 # the bundled PSA publication (April 2024)
 *   pnpm db:import-locations -- --file <path> # a newer publication in the same JSON format
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createPgAdapter, importLocations, PrismaClient, readPsgcFile } from './src';

loadDotenv({ path: path.resolve(__dirname, '../.env'), quiet: true });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const fileFlag = process.argv.indexOf('--file');
  const file = fileFlag > 0 ? path.resolve(process.argv[fileFlag + 1] ?? '') : undefined;
  const rows = readPsgcFile(file);
  const prisma = new PrismaClient({ adapter: createPgAdapter(databaseUrl) });
  try {
    const started = Date.now();
    const result = await importLocations(prisma, rows);
    console.log(
      `Imported ${result.total} locations in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
        `${result.deactivated} no longer in the publication were switched off.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
