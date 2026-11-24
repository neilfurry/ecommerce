/**
 * Creates the first SUPER_ADMIN in a new environment (including production), because
 * staff accounts can otherwise only be created by an existing admin.
 *
 *   PowerShell:
 *     $env:BOOTSTRAP_ADMIN_EMAIL='you@company.ph'; $env:BOOTSTRAP_ADMIN_PASSWORD='<12+ chars>'
 *     $env:BOOTSTRAP_ADMIN_FIRST_NAME='Neil'; $env:BOOTSTRAP_ADMIN_LAST_NAME='Admin'
 *     pnpm db:bootstrap-admin
 *
 * Refuses to run when any SUPER_ADMIN already exists.
 */
import path from 'node:path';
import { emailAddressSchema, passwordSchema, personNameSchema } from '@marketplace/validation';
import { config as loadDotenv } from 'dotenv';
import { createPgAdapter, PrismaClient } from './src';
import { ensureUser, syncRolesAndPermissions } from './src/seed-identity';

loadDotenv({ path: path.resolve(__dirname, '../.env'), quiet: true });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  const email = emailAddressSchema.parse(process.env.BOOTSTRAP_ADMIN_EMAIL ?? '');
  const password = passwordSchema.parse(process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '');
  const firstName = personNameSchema.parse(process.env.BOOTSTRAP_ADMIN_FIRST_NAME ?? 'Super');
  const lastName = personNameSchema.parse(process.env.BOOTSTRAP_ADMIN_LAST_NAME ?? 'Admin');

  const prisma = new PrismaClient({ adapter: createPgAdapter(databaseUrl) });
  try {
    await syncRolesAndPermissions(prisma);
    const existing = await prisma.userRoleAssignment.count({ where: { roleCode: 'SUPER_ADMIN' } });
    if (existing > 0) {
      throw new Error('A SUPER_ADMIN already exists. Create further staff in the Admin Console.');
    }
    const created = await ensureUser(
      prisma,
      { email, firstName, lastName, roles: ['SUPER_ADMIN'] },
      password,
    );
    if (!created) throw new Error(`${email} is already registered.`);
    // eslint-disable-next-line no-console -- CLI output
    console.log(`Created SUPER_ADMIN ${email}. Sign in at the Admin Console.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
