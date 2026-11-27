import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorBody, ApiErrorCode, ApiFieldError } from '@marketplace/shared-types';
import type { Request, Response } from 'express';
import { ApiException } from './api.exception';
import { reportError } from '../../infrastructure/observability/error-reporting';
import { unhandledErrors } from '../../infrastructure/observability/metrics';

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Errors raised by Express body parsing carry `type` and `status`. */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(value: unknown): value is BodyParserError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BodyParserError).type === 'string' &&
    typeof (value as BodyParserError).status === 'number'
  );
}

interface NormalisedError {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  fieldErrors?: ApiFieldError[];
}

/**
 * Converts every thrown error into the standard ApiErrorBody envelope.
 * Unknown errors become a generic 500 so internal details never reach the client;
 * the full error is logged with the request id for correlation.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string | number }>();
    const response = http.getResponse<Response>();
    const normalised = this.normalise(exception);
    const requestId = request.id === undefined ? undefined : String(request.id);

    if (normalised.statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId, path: request.originalUrl },
        `Unhandled error on ${request.method} ${request.originalUrl}`,
      );
      unhandledErrors.inc();
      reportError(exception, { requestId, method: request.method, path: request.path });
    }

    const body: ApiErrorBody = {
      error: {
        code: normalised.code,
        message: normalised.message,
        statusCode: normalised.statusCode,
        ...(requestId ? { requestId } : {}),
        ...(normalised.fieldErrors ? { fieldErrors: normalised.fieldErrors } : {}),
      },
    };
    response.status(normalised.statusCode).json(body);
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof ApiException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        fieldErrors: exception.fieldErrors,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: CODE_BY_STATUS[statusCode] ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
        message: statusCode >= 500 ? 'An unexpected error occurred.' : extractMessage(exception),
      };
    }

    if (isBodyParserError(exception)) {
      if (exception.type === 'entity.too.large') {
        return {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large.',
        };
      }
      if (exception.status === 400) {
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'BAD_REQUEST',
          message: 'Request body is not valid JSON.',
        };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    };
  }
}

function extractMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const { message } = response as { message: unknown };
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
  }
  return exception.message;
}
