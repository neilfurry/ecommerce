import { PrismaPg } from '@prisma/adapter-pg';

/**
 * node-postgres does not understand Prisma's `?schema=` URL parameter, so it is
 * stripped from the connection string and passed to the adapter explicitly.
 * Shared by the API (PrismaService) and the seed script.
 */
export function createPgAdapter(databaseUrl: string): PrismaPg {
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get('schema') ?? undefined;
  url.searchParams.delete('schema');
  return new PrismaPg({ connectionString: url.toString() }, schema ? { schema } : undefined);
}
