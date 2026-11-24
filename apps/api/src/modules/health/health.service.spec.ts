import { Logger } from '@nestjs/common';
import { REDIS_KEYS } from '@marketplace/config';
import type { ComponentHealth } from '@marketplace/validation';
import type { Redis } from 'ioredis';
import { AppConfig } from '../../config/app-config';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ObjectStorage } from '../../infrastructure/storage/object-storage';
import { HealthService, overallStatus } from './health.service';

const config = AppConfig.load(
  {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret-value',
    S3_BUCKET: 'bucket-name',
    APP_VERSION: '9.9.9',
    AUTH_JWT_SECRET: 'j'.repeat(32),
    AUTH_OTP_SECRET: 'o'.repeat(32),
  },
  false,
);

function freshHeartbeat(ageSeconds = 1): string {
  return JSON.stringify({
    at: new Date(Date.now() - ageSeconds * 1000).toISOString(),
    version: '0.1.0',
    hostname: 'test',
    pid: 1,
  });
}

function createService(overrides: {
  query?: jest.Mock;
  ping?: jest.Mock;
  get?: jest.Mock;
  head?: jest.Mock;
}) {
  const prisma = { $queryRaw: overrides.query ?? jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
  const redis = {
    ping: overrides.ping ?? jest.fn().mockResolvedValue('PONG'),
    get: overrides.get ?? jest.fn().mockResolvedValue(freshHeartbeat()),
  };
  const storage = {
    assertReachable: overrides.head ?? jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new HealthService(
      config,
      prisma as unknown as PrismaService,
      redis as unknown as Redis,
      storage as unknown as ObjectStorage,
    ),
    redis,
  };
}

const component = (overrides: Partial<ComponentHealth>): ComponentHealth => ({
  name: 'database',
  status: 'up',
  critical: true,
  latencyMs: 1,
  ...overrides,
});

describe('overallStatus', () => {
  it('is ok when everything is up', () => {
    expect(overallStatus([component({}), component({ name: 'worker', critical: false })])).toBe(
      'ok',
    );
  });

  it('is degraded when only a non-critical component is down', () => {
    expect(
      overallStatus([
        component({}),
        component({ name: 'worker', critical: false, status: 'down' }),
      ]),
    ).toBe('degraded');
  });

  it('is down when any critical component is down', () => {
    expect(overallStatus([component({ status: 'down' })])).toBe('down');
  });
});

describe('HealthService', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  it('reports ok with every component up', async () => {
    const { service, redis } = createService({});
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.version).toBe('9.9.9');
    expect(result.components.map((c) => [c.name, c.status])).toEqual([
      ['database', 'up'],
      ['redis', 'up'],
      ['storage', 'up'],
      ['worker', 'up'],
    ]);
    expect(redis.get).toHaveBeenCalledWith(REDIS_KEYS.WORKER_HEARTBEAT);
  });

  it('reports down and hides the raw error when the database fails', async () => {
    const { service } = createService({
      query: jest.fn().mockRejectedValue(new Error('password authentication failed for "admin"')),
    });
    const result = await service.check();
    const database = result.components.find((c) => c.name === 'database');
    expect(result.status).toBe('down');
    expect(database).toMatchObject({ status: 'down', latencyMs: null });
    expect(database?.message).toBe('Database is unreachable.');
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it('reports degraded when the worker heartbeat is missing', async () => {
    const { service } = createService({ get: jest.fn().mockResolvedValue(null) });
    const result = await service.check();
    expect(result.status).toBe('degraded');
    expect(result.components.find((c) => c.name === 'worker')?.status).toBe('down');
  });

  it('reports degraded when the worker heartbeat is stale', async () => {
    const { service } = createService({ get: jest.fn().mockResolvedValue(freshHeartbeat(120)) });
    expect((await service.check()).status).toBe('degraded');
  });

  it('reports down when a critical check hangs past the timeout', async () => {
    jest.useFakeTimers();
    try {
      const { service } = createService({ head: jest.fn(() => new Promise(() => undefined)) });
      const pending = service.check();
      await jest.advanceTimersByTimeAsync(3100);
      const result = await pending;
      expect(result.status).toBe('down');
      expect(result.components.find((c) => c.name === 'storage')?.status).toBe('down');
    } finally {
      jest.useRealTimers();
    }
  });
});
