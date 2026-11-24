import { Global, Module } from '@nestjs/common';
import { ObjectStorage } from './object-storage';
import { S3ObjectStorage } from './s3-object-storage';

/**
 * Binds the provider-neutral ObjectStorage to the S3-compatible implementation.
 * To change provider, bind a different implementation here; no domain code changes.
 */
@Global()
@Module({
  providers: [{ provide: ObjectStorage, useClass: S3ObjectStorage }],
  exports: [ObjectStorage],
})
export class StorageModule {}
