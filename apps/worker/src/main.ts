import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerConfig } from './config/worker-config';
import { flushErrorReporting, initErrorReporting } from './observability/error-reporting';
import { WorkerModule } from './worker.module';

/**
 * The worker has no HTTP server: it is a Nest application context that runs BullMQ
 * processors. SIGINT/SIGTERM trigger a graceful shutdown that lets active jobs finish.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(WorkerConfig);
  initErrorReporting({
    dsn: config.observability.sentryDsn,
    environment: config.observability.sentryEnvironment,
    release: config.version,
    service: 'worker',
  });
  app.enableShutdownHooks();
  app.get(Logger).log('Worker started', 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  void flushErrorReporting().finally(() => process.exit(1));
});
