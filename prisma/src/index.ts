/**
 * @marketplace/database — the only place that knows how to reach PostgreSQL.
 * Apps import the generated client, enums and Prisma namespace from here.
 */
export * from './generated/prisma/client';
export { createPgAdapter } from './pg-adapter';
export { dummyPasswordHash, hashPassword, passwordNeedsRehash, verifyPassword } from './password';
export { syncRolesAndPermissions } from './seed-identity';
