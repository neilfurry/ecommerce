/**
 * Machine-readable error codes returned in every API error response.
 * Frontends branch on `code`, never on the human-readable `message`.
 */
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  /** The access token expired: refresh the session and retry once. */
  'TOKEN_EXPIRED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_SUSPENDED',
  'EMAIL_NOT_VERIFIED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_TOO_MANY_ATTEMPTS',
  'CSRF_FAILED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  /** A stock change or reservation would make available stock negative. */
  'INSUFFICIENT_STOCK',
  /** The action needs a verified (and not suspended) seller. */
  'SELLER_NOT_VERIFIED',
  /** Something must be completed first; field errors list what. */
  'NOT_READY',
  /** A stock reservation expired or was released. */
  'RESERVATION_NOT_ACTIVE',
  /** Prices, stock or coupons changed since the checkout quote; the body carries the new quote. */
  'CHECKOUT_CHANGED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** A single field-level validation problem. `path` is dot-separated, e.g. "items.0.quantity". */
export interface ApiFieldError {
  path: string;
  message: string;
}

/** Shape of every non-2xx JSON response from the API. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    statusCode: number;
    requestId?: string;
    fieldErrors?: ApiFieldError[];
  };
}

/** Standard envelope for paginated list endpoints. */
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
