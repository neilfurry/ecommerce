import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AppConfig } from '../../config/app-config';

/**
 * Multipart limits for upload endpoints: oversized files are refused while streaming
 * (HTTP 413) instead of being buffered whole. Import in modules that accept uploads.
 */
export const UploadLimitsModule = MulterModule.registerAsync({
  inject: [AppConfig],
  useFactory: (config: AppConfig) => ({
    storage: memoryStorage(),
    limits: { fileSize: config.storage.uploadMaxBytes, files: 1, fields: 5, parts: 6 },
  }),
});
