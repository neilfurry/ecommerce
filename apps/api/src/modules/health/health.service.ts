import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS_KEYS, WORKER_HEARTBEAT_STALE_AFTER_SECONDS } from '@marketplace/config';
import type { HealthComponentName, SystemStatus, WorkerHeartbeat } from '@marketplace/types';
import type { ComponentHealth, HealthResponse } from '@marketplace/validation';
import type { Redis } from 'ioredis';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { StorageService } from '../../infrastructure/storage/storage.service';

/** A check that does not answer within this time is reported as down. */
export const HEALTH_CHECK_TIMEOUT_MS = 3000;

interface CheckDefinition {
  name: HealthComponentName;
  critical: boolean;
  /** Short, non-sensitive message shown to clients when the check fails. */
  failureMessage: string;
  run: () => Promise<void>;
}

class HealthCheckFailure extends Error {}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly storage: StorageService,
  ) {}

  async check(): Promise<HealthResponse> {
    const checks: CheckDefinition[] = [
      {
        name: 'database',
        critical: true,
        failureMessage: 'Database is unreachable.',
        run: async () => {
          await this.prisma.$queryRaw`SELECT 1`;
        },
      },
      {
        name: 'redis',
        critical: true,
        failureMessage: 'Cache and queue store is unreachable.',
        run: async () => {
          const reply = await this.redis.ping();
          if (reply !== 'PONG') throw new HealthCheckFailure(`Unexpected PING reply: ${reply}`);
        },
      },
      {
        name: 'storage',
        critical: true,
        failureMessage: 'Object storage is unreachable or the bucket is missing.',
        run: () => this.storage.assertBucketReachable(),
      },
      {
        name: 'worker',
        // Background jobs being delayed does not stop the API from serving requests.
        critical: false,
        failureMessage: `No background worker heartbeat in the last ${WORKER_HEARTBEAT_STALE_AFTER_SECONDS} seconds.`,
        run: () => this.checkWorkerHeartbeat(),
      },
    ];

    const components = await Promise.all(checks.map((check) => this.runCheck(check)));
    return {
      status: overallStatus(components),
      version: this.config.version,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      components,
    };
  }

  private async runCheck(check: CheckDefinition): Promise<ComponentHealth> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check.run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new HealthCheckFailure(`Timed out after ${HEALTH_CHECK_TIMEOUT_MS} ms`)),
            HEALTH_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return {
        name: check.name,
        status: 'up',
        critical: check.critical,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      this.logger.warn(`Health check "${check.name}" failed: ${(error as Error).message}`);
      return {
        name: check.name,
        status: 'down',
        critical: check.critical,
        latencyMs: null,
        message: check.failureMessage,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkWorkerHeartbeat(): Promise<void> {
    const raw = await this.redis.get(REDIS_KEYS.WORKER_HEARTBEAT);
    if (!raw) throw new HealthCheckFailure('No heartbeat recorded');
    const heartbeat = JSON.parse(raw) as Partial<WorkerHeartbeat>;
    const at = heartbeat.at ? Date.parse(heartbeat.at) : Number.NaN;
    if (Number.isNaN(at)) throw new HealthCheckFailure('Malformed heartbeat');
    const ageSeconds = (Date.now() - at) / 1000;
    if (ageSeconds > WORKER_HEARTBEAT_STALE_AFTER_SECONDS) {
      throw new HealthCheckFailure(`Heartbeat is ${Math.round(ageSeconds)} s old`);
    }
  }
}

export function overallStatus(components: ComponentHealth[]): SystemStatus {
  if (components.some((c) => c.status === 'down' && c.critical)) return 'down';
  if (components.some((c) => c.status === 'down')) return 'degraded';
  return 'ok';
}
