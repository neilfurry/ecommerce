import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { REQUEST_ID_HEADER } from '@marketplace/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Paths whose values are replaced with "[REDACTED]" in every log line.
 * Extend this list whenever a new sensitive field is introduced.
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.cardNumber',
  '*.cvv',
  '*.accountNumber',
];

/**
 * Structured JSON logging (pino). Every request gets an id — reused from an incoming
 * X-Request-Id header when it is well-formed — which is echoed back in the response
 * header and in error bodies for support correlation.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' },
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const incoming = req.headers[REQUEST_ID_HEADER];
            const id =
              typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
          autoLogging: {
            // Health probes run every few seconds; logging them only adds noise.
            ignore: (req: IncomingMessage) => req.url?.startsWith('/api/v1/health') ?? false,
          },
          transport:
            config.nodeEnv === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:standard' },
                }
              : undefined,
        },
      }),
    }),
  ],
})
export class LoggingModule {}
