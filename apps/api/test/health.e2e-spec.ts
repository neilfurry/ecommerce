import type { NestExpressApplication } from '@nestjs/platform-express';
import { REDIS_KEYS } from '@marketplace/config';
import type { WorkerHeartbeat } from '@marketplace/shared-types';
import { healthResponseSchema, livenessResponseSchema } from '@marketplace/validation';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.module';
import { createTestApp } from './test-app';

describe('Health endpoints (e2e, real dependencies)', () => {
  let app: NestExpressApplication;
  let redis: Redis;

  const writeHeartbeat = async (ageSeconds: number) => {
    const heartbeat: WorkerHeartbeat = {
      at: new Date(Date.now() - ageSeconds * 1000).toISOString(),
      version: 'e2e',
      hostname: 'e2e',
      pid: process.pid,
    };
    await redis.set(REDIS_KEYS.WORKER_HEARTBEAT, JSON.stringify(heartbeat), 'EX', 300);
  };

  beforeAll(async () => {
    app = await createTestApp();
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await redis.del(REDIS_KEYS.WORKER_HEARTBEAT);
    await app.close();
  });

  it('GET /api/v1/health/live returns ok without touching dependencies', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(livenessResponseSchema.parse(res.body).status).toBe('ok');
  });

  it('GET /api/v1/health reports every component up when the worker is alive', async () => {
    await writeHeartbeat(1);
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.components.map((c) => [c.name, c.status])).toEqual([
      ['database', 'up'],
      ['redis', 'up'],
      ['storage', 'up'],
      ['worker', 'up'],
    ]);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/v1/health is degraded (still 200) when the worker heartbeat is stale', async () => {
    await writeHeartbeat(600);
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.status).toBe('degraded');
    expect(body.components.find((c) => c.name === 'worker')).toMatchObject({
      status: 'down',
      critical: false,
    });
  });
});
