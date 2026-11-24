import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

/**
 * Thin wrapper around an S3-compatible object store (MinIO locally, any S3 provider in
 * production). Domain modules (product images, seller documents) build on this in later phases.
 */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  readonly client: S3Client;
  readonly bucket: string;

  constructor(private readonly config: AppConfig) {
    const { endpoint, region, accessKeyId, secretAccessKey, forcePathStyle, bucket } =
      config.storage;
    this.bucket = bucket;
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 2,
    });
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
  }

  /** Throws if the bucket is missing or unreachable. */
  async assertBucketReachable(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Creates the bucket when missing. Development only; production buckets are provisioned. */
  async ensureBucket(): Promise<void> {
    try {
      await this.assertBucketReachable();
    } catch (error) {
      const status = error instanceof S3ServiceException ? error.$metadata.httpStatusCode : 0;
      if (status !== 404) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket "${this.bucket}"`);
    }
  }
}
