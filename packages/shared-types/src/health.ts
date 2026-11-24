/** Overall platform state reported by GET /api/v1/health. */
export const SYSTEM_STATUSES = ['ok', 'degraded', 'down'] as const;
export type SystemStatus = (typeof SYSTEM_STATUSES)[number];

/** State of one dependency (database, cache, storage, worker...). */
export const COMPONENT_STATUSES = ['up', 'down'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/** Value the worker writes to Redis on every heartbeat job (REDIS_KEYS.WORKER_HEARTBEAT). */
export interface WorkerHeartbeat {
  /** ISO-8601 UTC time the heartbeat job ran. */
  at: string;
  version: string;
  hostname: string;
  pid: number;
}

export const HEALTH_COMPONENT_NAMES = ['database', 'redis', 'storage', 'worker'] as const;
export type HealthComponentName = (typeof HEALTH_COMPONENT_NAMES)[number];
