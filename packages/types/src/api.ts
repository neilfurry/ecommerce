/**
 * Machine-readable error codes returned in every API error response.
 * Frontends branch on `code`, never on the human-readable `message`.
 */
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
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
