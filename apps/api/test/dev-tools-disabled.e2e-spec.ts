import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { signedInClient, type TestClient } from './auth-helpers';
import { createTestApp } from './test-app';

describe('Developer tools disabled (e2e)', () => {
  let app: NestExpressApplication;
  const previous = process.env.DEV_TOOLS_ENABLED;
  let superAdmin: TestClient;

  beforeAll(async () => {
    process.env.DEV_TOOLS_ENABLED = 'false';
    app = await createTestApp();
    superAdmin = (await signedInClient(app, 'admin', ['SUPER_ADMIN'], 'devtools-off')).client;
  });

  afterAll(async () => {
    process.env.DEV_TOOLS_ENABLED = previous;
    await app.close();
  });

  it.each([
    ['get', '/api/v1/dev/queues'],
    ['post', '/api/v1/dev/jobs/sample'],
    ['get', '/api/v1/dev/files'],
  ] as const)('%s %s answers 404 even for a super admin', async (method, path) => {
    const res = await superAdmin[method](path).send({ message: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 401 to anonymous callers before revealing anything', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/dev/queues')
      .set('X-Client-App', 'admin');
    expect(res.status).toBe(401);
  });

  it('keeps public routes working', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
  });
});
