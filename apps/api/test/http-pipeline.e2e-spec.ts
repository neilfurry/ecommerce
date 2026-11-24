import type { NestExpressApplication } from '@nestjs/platform-express';
import { REQUEST_ID_HEADER } from '@marketplace/config';
import { apiErrorBodySchema } from '@marketplace/validation';
import request from 'supertest';
import { AppConfig } from '../src/config/app-config';
import { createTestApp } from './test-app';

describe('HTTP pipeline (e2e)', () => {
  let app: NestExpressApplication;
  let allowedOrigin: string;

  beforeAll(async () => {
    app = await createTestApp();
    allowedOrigin = app.get(AppConfig).http.corsOrigins[0] ?? 'http://localhost:5173';
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    const body = apiErrorBodySchema.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  it('reuses a well-formed incoming request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set(REQUEST_ID_HEADER, 'trace-abc_123')
      .expect(200);
    expect(res.headers[REQUEST_ID_HEADER]).toBe('trace-abc_123');
  });

  it('replaces a malformed incoming request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set(REQUEST_ID_HEADER, 'bad id <script>')
      .expect(200);
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects malformed JSON with a 400 envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken": ')
      .expect(400);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('rejects JSON bodies over the size limit with 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }))
      .expect(413);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS with credentials for configured origins only', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', allowedOrigin)
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('publishes the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/health', '/api/v1/health/live']),
    );
  });
});
