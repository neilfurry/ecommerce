import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AppConfig } from '../../config/app-config';
import { FilesModule } from '../files/files.module';
import { DevJobsService } from './dev-jobs.service';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsEnabledGuard } from './dev-tools-enabled.guard';

@Module({
  imports: [
    FilesModule,
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        storage: memoryStorage(),
        // Oversized uploads are rejected while streaming (HTTP 413), before buffering.
        limits: { fileSize: config.storage.uploadMaxBytes, files: 1, fields: 5, parts: 6 },
      }),
    }),
  ],
  controllers: [DevToolsController],
  providers: [DevJobsService, DevToolsEnabledGuard],
})
export class DevToolsModule {}
