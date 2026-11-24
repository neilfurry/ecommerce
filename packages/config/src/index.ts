/**
 * Shared, non-secret runtime constants.
 * Secrets and environment-specific values belong in environment variables, not here.
 */

export const APP_NAME = 'Marketplace';

/** Philippine market defaults. */
export const DEFAULT_CURRENCY = 'PHP';
export const DEFAULT_LOCALE = 'en-PH';
export const DEFAULT_TIMEZONE = 'Asia/Manila';

/** HTTP API routing: every endpoint lives under /{API_PREFIX}/v{API_DEFAULT_VERSION}/... */
export const API_PREFIX = 'api';
export const API_DEFAULT_VERSION = '1';

/** Header used to correlate a request across API logs, worker logs and error responses. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Job-scheduler id for the recurring worker heartbeat. */
export const WORKER_HEARTBEAT_SCHEDULER_ID = 'system-heartbeat';

/** Redis key namespace. All application keys start with "marketplace:". */
export const REDIS_KEYS = {
  WORKER_HEARTBEAT: 'marketplace:worker:heartbeat',
  THROTTLE_PREFIX: 'marketplace:throttle:',
  /** Marker for a revoked session, kept for the access-token lifetime. */
  REVOKED_SESSION_PREFIX: 'marketplace:auth:revoked-session:',
  /** Cached roles/permissions/status per user. */
  PRINCIPAL_PREFIX: 'marketplace:auth:principal:',
  /** Incremented whenever role permissions change; part of every principal cache key. */
  PERMISSIONS_VERSION: 'marketplace:auth:permissions-version',
  /** Pending two-step sign-ins (password or SMS code accepted, authenticator code awaited). */
  MFA_CHALLENGE_PREFIX: 'marketplace:auth:mfa-challenge:',
  /** Development SMS provider: newest-first list of sent messages. */
  DEV_SMS_OUTBOX: 'marketplace:dev:sms-outbox',
} as const;

/** The API reports the worker as down if its last heartbeat is older than this. */
export const WORKER_HEARTBEAT_STALE_AFTER_SECONDS = 60;

/** Local development ports for the three frontends. */
export const FRONTEND_DEV_PORTS = {
  storefront: 5173,
  sellerPortal: 5174,
  adminPortal: 5175,
} as const;

export * from './queues';
