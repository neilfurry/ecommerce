import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import {
  type ObjectMetadata,
  ObjectNotFoundError,
  ObjectStorage,
  type PutObjectInput,
  type SignedDownloadOptions,
  type SignedUploadOptions,
  type SignedUrl,
  type StoredObject,
} from './object-storage';

function httpStatus(error: unknown): number | undefined {
  return error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
}

/** Quotes a file name for Content-Disposition, with an RFC 5987 UTF-8 fallback. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@Injectable()
export class S3ObjectStorage extends ObjectStorage implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(S3ObjectStorage.name);
  readonly bucket: string;
  private readonly client: S3Client;
  /** Signs URLs with the endpoint browsers can reach (may differ inside containers). */
  private readonly signingClient: S3Client;

  constructor(private readonly config: AppConfig) {
    super();
    const {
      endpoint,
      publicEndpoint,
      region,
      accessKeyId,
      secretAccessKey,
      forcePathStyle,
      bucket,
    } = config.storage;
    this.bucket = bucket;
    const common = { region, forcePathStyle, credentials: { accessKeyId, secretAccessKey } };
    this.client = new S3Client({ ...common, endpoint, maxAttempts: 2 });
    this.signingClient =
      publicEndpoint && publicEndpoint !== endpoint
        ? new S3Client({ ...common, endpoint: publicEndpoint })
        : this.client;
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.storage.autoCreateBucket) return;
    try {
      await this.ensureBucket();
    } catch (error) {
      // Start-up must not crash because storage is briefly unavailable; /health reports it.
      this.logger.warn(
        `Could not verify bucket "${this.bucket}" at start-up: ${(error as Error).message}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
    if (this.signingClient !== this.client) this.signingClient.destroy();
  }

  async putObject(input: PutObjectInput): Promise<{ etag: string | undefined }> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength:
          input.contentLength ?? (Buffer.isBuffer(input.body) ? input.body.length : undefined),
        ContentDisposition: input.contentDisposition,
        Metadata: input.metadata,
      }),
    );
    return { etag: result.ETag };
  }

  async getObject(key: string): Promise<StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        body: result.Body as Readable,
        contentType: result.ContentType ?? 'application/octet-stream',
        contentLength: result.ContentLength ?? 0,
        etag: result.ETag,
        lastModified: result.LastModified,
        metadata: result.Metadata ?? {},
      };
    } catch (error) {
      if (httpStatus(error) === 404 || (error as Error).name === 'NoSuchKey') {
        throw new ObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        contentType: result.ContentType ?? 'application/octet-stream',
        contentLength: result.ContentLength ?? 0,
        etag: result.ETag,
        lastModified: result.LastModified,
        metadata: result.Metadata ?? {},
      };
    } catch (error) {
      if (httpStatus(error) === 404) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedDownloadUrl(key: string, options: SignedDownloadOptions = {}): Promise<SignedUrl> {
    const expiresIn = options.expiresInSeconds ?? this.config.storage.signedUrlTtlSeconds;
    const url = await getSignedUrl(
      this.signingClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options.downloadFileName
          ? contentDisposition(options.downloadFileName)
          : undefined,
      }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async getSignedUploadUrl(key: string, options: SignedUploadOptions): Promise<SignedUrl> {
    const expiresIn = options.expiresInSeconds ?? this.config.storage.signedUrlTtlSeconds;
    const url = await getSignedUrl(
      this.signingClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: options.contentType }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async assertReachable(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Creates the bucket when missing. Development only; production buckets are provisioned. */
  async ensureBucket(): Promise<void> {
    try {
      await this.assertReachable();
    } catch (error) {
      if (httpStatus(error) !== 404) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket "${this.bucket}"`);
    }
  }
}
