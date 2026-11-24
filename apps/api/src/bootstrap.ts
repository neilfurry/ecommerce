import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_DEFAULT_VERSION, API_PREFIX, APP_NAME, REQUEST_ID_HEADER } from '@marketplace/config';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import type { AppConfig } from './config/app-config';

export const JSON_BODY_LIMIT = '1mb';
export const SWAGGER_PATH = `${API_PREFIX}/docs`;

/**
 * Applies every cross-cutting HTTP concern. Shared by main.ts and the e2e tests so tests
 * exercise exactly the production pipeline.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));

  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', config.http.trustProxy);
  express.disable('x-powered-by');

  // Strict security headers for the JSON API; Swagger UI needs inline scripts, so the
  // CSP is relaxed only on the docs path (which is disabled in production by default).
  const apiHelmet = helmet();
  const docsHelmet = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/${SWAGGER_PATH}`)
      ? docsHelmet(req, res, next)
      : apiHelmet(req, res, next),
  );

  app.use(cookieParser());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: false });

  app.enableCors({
    origin: config.http.corsOrigins,
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableShutdownHooks();

  if (config.http.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`${APP_NAME} API`)
        .setDescription(
          'REST API for the multi-vendor marketplace. All monetary amounts are decimal strings.',
        )
        .setVersion(config.version)
        .build(),
    );
    SwaggerModule.setup(SWAGGER_PATH, app, document, {
      jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    });
  }
}
