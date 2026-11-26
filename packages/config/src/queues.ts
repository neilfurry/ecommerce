/**
 * BullMQ queue registry shared by producers (API) and consumers (worker).
 * Each business domain owns one queue. Retry policies live here so every producer
 * enqueues with the same behaviour. See docs/architecture/SYSTEM_ARCHITECTURE.md#background-jobs.
 */

/** Redis key prefix for all BullMQ data, shared by producers (API) and consumers (worker). */
export const BULLMQ_PREFIX = 'marketplace:bull';

export const QUEUE_NAMES = {
  SYSTEM: 'system',
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  IMAGE_PROCESSING: 'image-processing',
  REPORTS: 'reports',
  PAYMENT_EVENTS: 'payment-events',
  ORDER_PROCESSING: 'order-processing',
  /** Jobs that exhausted their retries. Never processed automatically; inspected by admins. */
  DEAD_LETTER: 'dead-letter',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Queues that have a worker processing them (everything except the dead-letter queue). */
export type ProcessedQueueName = Exclude<QueueName, typeof QUEUE_NAMES.DEAD_LETTER>;

export interface QueueDefinition {
  name: QueueName;
  description: string;
  /** Total attempts including the first one. */
  attempts: number;
  /** First retry delay; doubles on each further attempt (exponential backoff). */
  backoffDelayMs: number;
  /** Parallel jobs per worker process. */
  concurrency: number;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

export const QUEUE_DEFINITIONS: Record<QueueName, QueueDefinition> = {
  system: {
    name: 'system',
    description: 'Platform housekeeping: worker heartbeat and development diagnostics.',
    attempts: 3,
    backoffDelayMs: 1_000,
    concurrency: 5,
  },
  email: {
    name: 'email',
    description: 'Transactional email (order confirmations, password resets...).',
    attempts: 5,
    backoffDelayMs: 30_000,
    concurrency: 10,
  },
  notifications: {
    name: 'notifications',
    description: 'In-app, SMS and push notifications.',
    attempts: 5,
    backoffDelayMs: 10_000,
    concurrency: 10,
  },
  'image-processing': {
    name: 'image-processing',
    description: 'Product image resizing, optimisation and variants.',
    attempts: 3,
    backoffDelayMs: 15_000,
    concurrency: 2,
  },
  reports: {
    name: 'reports',
    description: 'Report and export generation.',
    attempts: 3,
    backoffDelayMs: 60_000,
    concurrency: 1,
  },
  'payment-events': {
    name: 'payment-events',
    description: 'Payment-provider webhook processing. Handlers must be idempotent.',
    attempts: 10,
    backoffDelayMs: 5_000,
    concurrency: 5,
  },
  'order-processing': {
    name: 'order-processing',
    description: 'Order state transitions, stock release and settlement triggers.',
    attempts: 8,
    backoffDelayMs: 5_000,
    concurrency: 5,
  },
  'dead-letter': {
    name: 'dead-letter',
    description: 'Jobs that failed permanently, kept for inspection, retry or discard.',
    attempts: 1,
    backoffDelayMs: 0,
    concurrency: 1,
  },
};

/** How long finished jobs stay in Redis. Failed jobs are also copied to the dead-letter queue. */
export const JOB_RETENTION = {
  completed: { age: DAY, count: 1_000 },
  failed: { age: 7 * DAY },
} as const;

/**
 * Default BullMQ job options for a queue (plain object, compatible with BullMQ's JobsOptions).
 */
export function defaultJobOptions(queue: QueueName) {
  const definition = QUEUE_DEFINITIONS[queue];
  if (queue === QUEUE_NAMES.DEAD_LETTER) {
    // Dead letters are kept until an admin retries or discards them.
    return { attempts: 1, removeOnComplete: false, removeOnFail: false } as const;
  }
  return {
    attempts: definition.attempts,
    backoff: { type: 'exponential' as const, delay: definition.backoffDelayMs },
    removeOnComplete: JOB_RETENTION.completed,
    removeOnFail: JOB_RETENTION.failed,
  };
}

/** Job names, namespaced by queue: "<queue>.<action>". */
export const SYSTEM_JOBS = {
  HEARTBEAT: 'system.heartbeat',
  /** Development-only diagnostic job; can simulate failures to exercise retries. */
  DEV_SAMPLE: 'system.dev-sample',
} as const;

export const EMAIL_JOBS = {
  /** Development-only: sends a test email (delivered to Mailpit locally). */
  DEV_TEST: 'email.dev-test',
  VERIFY_ADDRESS: 'email.verify-address',
  PASSWORD_RESET: 'email.password-reset',
  STAFF_INVITATION: 'email.staff-invitation',
  WHOLESALE_DECISION: 'email.wholesale-decision',
  SELLER_STATUS: 'email.seller-status',
  SELLER_INVITATION: 'email.seller-invitation',
  PRODUCT_DECISION: 'email.product-decision',
  LOW_STOCK: 'email.low-stock',
  ORDER_PLACED: 'email.order-placed',
  SELLER_NEW_ORDER: 'email.seller-new-order',
  ORDER_CANCELLED: 'email.order-cancelled',
  ORDER_UPDATE: 'email.order-update',
} as const;

export const NOTIFICATION_JOBS = {
  /** One-time sign-in / sign-up code by SMS. Time-critical; never retried for long. */
  SMS_OTP: 'notifications.sms-otp',
} as const;

export const ORDER_JOBS = {
  /** Periodic: gives back stock held by checkout reservations that expired. */
  RELEASE_EXPIRED_RESERVATIONS: 'order-processing.release-expired-reservations',
  /** Periodic: cancels orders waiting for an online payment past their deadline. */
  EXPIRE_UNPAID_ORDERS: 'order-processing.expire-unpaid-orders',
  /** Periodic: delivered seller orders past the return window become COMPLETED. */
  COMPLETE_DELIVERED: 'order-processing.complete-delivered',
  /** Periodic: return requests the seller did not answer in time go to the marketplace. */
  ESCALATE_OVERDUE_RETURNS: 'order-processing.escalate-overdue-returns',
} as const;

export const PAYMENT_JOBS = {
  /** Periodic: asks the provider about open online payments (missed or delayed webhooks). */
  RECONCILE_OPEN_PAYMENTS: 'payment-events.reconcile-open-payments',
} as const;

export const FULFILMENT_SWEEP_SCHEDULER_ID = 'order-processing:fulfilment-sweep';
export const FULFILMENT_SWEEP_INTERVAL_SECONDS = 3600;
export const RETURN_ESCALATION_SCHEDULER_ID = 'order-processing:return-escalation';
export const PAYMENT_RECONCILIATION_SCHEDULER_ID = 'payment-events:reconcile-open-payments';
export const PAYMENT_RECONCILIATION_INTERVAL_SECONDS = 300;

export const DEAD_LETTER_JOBS = {
  ENTRY: 'dead-letter.entry',
} as const;
