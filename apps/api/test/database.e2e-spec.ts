import type { NestExpressApplication } from '@nestjs/platform-express';
import { DEFAULT_CURRENCY } from '@marketplace/config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './test-app';

/**
 * Requires migrations and seed data: `pnpm db:deploy && pnpm db:seed`.
 */
describe('Database schema and seed (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('has the default currency seeded and active', async () => {
    const currency = await prisma.currency.findUnique({ where: { code: DEFAULT_CURRENCY } });
    expect(currency).toMatchObject({ code: 'PHP', minorUnits: 2, isActive: true });
  });

  it('stores timestamps as timestamptz', async () => {
    const rows = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'currencies' AND column_name = 'created_at'`;
    expect(rows[0]?.data_type).toBe('timestamp with time zone');
  });

  it('enforces the ISO 4217 check constraint at the database level', async () => {
    await expect(
      prisma.currency.create({
        data: { code: 'php', name: 'Bad', symbol: '?', minorUnits: 2 },
      }),
    ).rejects.toThrow();
  });

  it('enforces the minor-units check constraint at the database level', async () => {
    await expect(
      prisma.currency.create({
        data: { code: 'ZZZ', name: 'Bad', symbol: '?', minorUnits: 9 },
      }),
    ).rejects.toThrow();
  });
});
