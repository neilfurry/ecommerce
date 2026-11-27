import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, SWAGGER_PATH } from './bootstrap';
import { AppConfig } from './config/app-config';
import {
  flushErrorReporting,
  initErrorReporting,
} from './infrastructure/observability/error-reporting';
import { startMetricsServer } from './infrastructure/observability/metrics';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: true,
    // Payment and courier webhooks verify signatures over the exact bytes received.
    rawBody: true,
  });
  const config = app.get(AppConfig);
  initErrorReporting({
    dsn: config.observability.sentryDsn,
    environment: config.observability.sentryEnvironment,
    release: config.version,
    service: 'api',
  });
  configureApp(app, config);
  await app.listen(config.http.port);

  const logger = app.get(Logger);
  if (config.observability.metricsPort > 0) {
    const metrics = startMetricsServer(config.observability.metricsPort);
    process.once('SIGTERM', () => metrics.close());
    logger.log(`Metrics on internal port ${config.observability.metricsPort}`, 'Bootstrap');
  }
  logger.log(`API listening on http://localhost:${config.http.port}/api/v1`, 'Bootstrap');
  if (config.http.swaggerEnabled) {
    logger.log(`Swagger UI: http://localhost:${config.http.port}/${SWAGGER_PATH}`, 'Bootstrap');
  }
}

bootstrap().catch((error: unknown) => {
  // Logger may not exist yet (e.g. invalid configuration), so fall back to stderr.
  console.error(error instanceof Error ? error.message : error);
  void flushErrorReporting().finally(() => process.exit(1));
});
