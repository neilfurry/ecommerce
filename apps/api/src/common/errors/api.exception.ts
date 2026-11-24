import { HttpException } from '@nestjs/common';
import type { ApiErrorCode, ApiFieldError } from '@marketplace/types';

/**
 * Throw this from services and pipes to return a specific machine-readable error code.
 * The global exception filter converts it into the standard ApiErrorBody envelope.
 */
export class ApiException extends HttpException {
  constructor(
    statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fieldErrors?: ApiFieldError[],
  ) {
    super(message, statusCode);
  }
}
