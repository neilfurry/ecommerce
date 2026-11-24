import { Global, Module } from '@nestjs/common';
import { WorkerConfig } from './worker-config';

@Global()
@Module({
  providers: [{ provide: WorkerConfig, useFactory: () => WorkerConfig.load() }],
  exports: [WorkerConfig],
})
export class WorkerConfigModule {}
