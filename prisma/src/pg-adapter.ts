import { PrismaPg } from '@prisma/adapter-pg';

/** Connections per process when the URL does not set `connection_limit` (node-postgres default). */
export const DEFAULT_POOL_SIZE = 10;

/**
 * node-postgres does not understand Prisma's `?schema=` and `?connection_limit=` URL
 * parameters, so they are stripped from the connection string and passed to the adapter
 * explicitly (`connection_limit` sizes the pool of each API or worker process).
 * Shared by the API (PrismaService), the worker and the scripts.
 */
export function createPgAdapter(databaseUrl: string): PrismaPg {
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get('schema') ?? undefined;
  const limit = Number(url.searchParams.get('connection_limit') ?? DEFAULT_POOL_SIZE);
  url.searchParams.delete('schema');
  url.searchParams.delete('connection_limit');
  return new PrismaPg(
    {
      connectionString: url.toString(),
      max: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_POOL_SIZE,
    },
    schema ? { schema } : undefined,
  );
}
