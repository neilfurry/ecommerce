import type { ApiErrorCode, ApiFieldError } from '@marketplace/shared-types';
import { apiErrorBodySchema } from '@marketplace/validation';

/** Client-side codes for failures that never produced an API error body. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE';

/**
 * Every failed API call rejects with an ApiError. UI code branches on `code`
 * (never on `message`) and shows `requestId` so users can quote it to support.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | ClientErrorCode,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly fieldErrors: ApiFieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True for 4xx responses: retrying the same request will not help. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    const headerRequestId = response.headers.get('x-request-id') ?? undefined;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const parsed = apiErrorBodySchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, statusCode, requestId, fieldErrors } = parsed.data.error;
      return new ApiError(code, message, statusCode, requestId ?? headerRequestId, fieldErrors);
    }
    return new ApiError(
      response.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
      `The server responded with HTTP ${response.status}.`,
      response.status,
      headerRequestId,
    );
  }
}
