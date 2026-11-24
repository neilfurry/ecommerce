import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './test-app';

describe('Developer tools disabled (e2e)', () => {
  let app: NestExpressApplication;
  const previous = process.env.DEV_TOOLS_ENABLED;

  beforeAll(async () => {
    process.env.DEV_TOOLS_ENABLED = 'false';
    app = await createTestApp();
  });

  afterAll(async () => {
    process.env.DEV_TOOLS_ENABLED = previous;
    await app.close();
  });

  it.each([
    ['get', '/api/v1/dev/queues'],
    ['post', '/api/v1/dev/jobs/sample'],
    ['get', '/api/v1/dev/files'],
  ] as const)('%s %s answers 404', async (method, path) => {
    const res = await request(app.getHttpServer())[method](path).send({ message: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('keeps public routes working', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
  });
});
