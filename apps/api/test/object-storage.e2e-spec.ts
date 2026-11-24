import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppConfig } from '../src/config/app-config';
import { ObjectNotFoundError } from '../src/infrastructure/storage/object-storage';
import { S3ObjectStorage } from '../src/infrastructure/storage/s3-object-storage';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** Exercises the S3 implementation against the real S3-compatible storage from .env. */
describe('S3ObjectStorage (e2e, real S3-compatible storage)', () => {
  let storage: S3ObjectStorage;
  const prefix = `e2e/${randomUUID()}`;
  const keys: string[] = [];

  beforeAll(async () => {
    storage = new S3ObjectStorage(AppConfig.load());
    await storage.ensureBucket();
  });

  afterAll(async () => {
    await Promise.all(keys.map((key) => storage.deleteObject(key)));
    storage.onModuleDestroy();
  });

  it('is reachable', async () => {
    await expect(storage.assertReachable()).resolves.toBeUndefined();
  });

  it('uploads, reads metadata, downloads and deletes an object', async () => {
    const key = `${prefix}/hello.txt`;
    keys.push(key);
    const body = Buffer.from('Kumusta, marketplace!');
    const { etag } = await storage.putObject({
      key,
      body,
      contentType: 'text/plain',
      metadata: { purpose: 'e2e' },
    });
    expect(etag).toBeTruthy();

    const head = await storage.headObject(key);
    expect(head).toMatchObject({ contentType: 'text/plain', contentLength: body.length });
    expect(head?.metadata).toMatchObject({ purpose: 'e2e' });

    const object = await storage.getObject(key);
    expect((await readAll(object.body)).toString()).toBe('Kumusta, marketplace!');

    await storage.deleteObject(key);
    expect(await storage.headObject(key)).toBeNull();
    await expect(storage.getObject(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('accepts streamed uploads', async () => {
    const key = `${prefix}/stream.bin`;
    keys.push(key);
    const data = Buffer.alloc(64 * 1024, 7);
    await storage.putObject({
      key,
      body: Readable.from([data]),
      contentLength: data.length,
      contentType: 'application/octet-stream',
    });
    expect((await storage.headObject(key))?.contentLength).toBe(data.length);
  });

  it('issues signed download URLs that work without credentials', async () => {
    const key = `${prefix}/signed.txt`;
    keys.push(key);
    await storage.putObject({
      key,
      body: Buffer.from('signed content'),
      contentType: 'text/plain',
    });
    const signed = await storage.getSignedDownloadUrl(key, {
      expiresInSeconds: 60,
      downloadFileName: 'résumé.txt',
    });
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const response = await fetch(signed.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('signed content');
    expect(response.headers.get('content-disposition')).toContain('attachment');
  });

  it('issues signed upload URLs that accept a PUT', async () => {
    const key = `${prefix}/direct-upload.txt`;
    keys.push(key);
    const signed = await storage.getSignedUploadUrl(key, { contentType: 'text/plain' });
    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'uploaded directly',
    });
    expect(response.ok).toBe(true);
    expect((await storage.headObject(key))?.contentLength).toBe('uploaded directly'.length);
  });

  it('treats deleting a missing object as success', async () => {
    await expect(storage.deleteObject(`${prefix}/never-existed`)).resolves.toBeUndefined();
  });
});
