import { createServer, type Server } from 'node:http';
import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { QUEUE_NAMES } from '@marketplace/config';
import { Prisma } from '@marketplace/database';
import type { Queue } from 'bullmq';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../database/database.provider';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'worker' });
collectDefaultMetrics({ register: registry });

export const jobDuration = new Histogram({
  name: 'marketplace_job_duration_seconds',
  help: 'Background job run time by queue, job name and result',
  labelNames: ['queue', 'job', 'result'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
  registers: [registry],
});

export const jobFailures = new Counter({
  name: 'marketplace_job_failures_total',
  help: 'Failed job attempts; final="true" when the job was moved to the dead-letter queue',
  labelNames: ['queue', 'job', 'final'] as const,
  registers: [registry],
});

const queueJobs = new Gauge({
  name: 'marketplace_queue_jobs',
  help: 'Jobs per queue and state (waiting, active, delayed, failed)',
  labelNames: ['queue', 'state'] as const,
  registers: [registry],
});

/**
 * Business health read from the database at scrape time (shared across every API and worker
 * instance, unlike in-process counters). Alert rules in docker/production/monitoring use them.
 */
const backlog = new Gauge({
  name: 'marketplace_backlog',
  help: 'Work that should already have been handled, by kind',
  labelNames: ['kind'] as const,
  registers: [registry],
});

const BACKLOG_SQL = `
  SELECT 'payments_failed_15m' AS kind, count(*)::int AS n FROM "payments"
    WHERE "status" = 'FAILED' AND "updated_at" > now() - interval '15 minutes'
  UNION ALL SELECT 'payments_paid_15m', count(*)::int FROM "payments"
    WHERE "status" = 'PAID' AND "paid_at" > now() - interval '15 minutes'
  UNION ALL SELECT 'webhook_events_failed', count(*)::int FROM "webhook_events"
    WHERE "status" = 'FAILED'
  UNION ALL SELECT 'webhook_events_stuck', count(*)::int FROM "webhook_events"
    WHERE "status" = 'RECEIVED' AND "received_at" < now() - interval '10 minutes'
  UNION ALL SELECT 'notifications_pending_5m', count(*)::int FROM "notification_events"
    WHERE "status" = 'PENDING' AND "created_at" < now() - interval '5 minutes'
  UNION ALL SELECT 'reservations_overdue', count(*)::int FROM "stock_reservations"
    WHERE "status" = 'ACTIVE' AND "expires_at" < now() - interval '10 minutes'
  UNION ALL SELECT 'payouts_failed_24h', count(*)::int FROM "payouts"
    WHERE "status" = 'FAILED' AND "updated_at" > now() - interval '24 hours'
  UNION ALL SELECT 'refunds_failed_24h', count(*)::int FROM "refunds"
    WHERE "status" = 'FAILED' AND "updated_at" > now() - interval '24 hours'`;

/** Collects queue and backlog gauges on each scrape and serves /metrics on METRICS_PORT. */
@Injectable()
export class WorkerMetrics implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerMetrics.name);
  private server: Server | null = null;

  constructor(
    private readonly config: WorkerConfig,
    private readonly database: WorkerDatabase,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    if (this.config.observability.metricsPort === 0) return;
    this.server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      this.collect()
        .then(() => registry.metrics())
        .then((body) => res.writeHead(200, { 'Content-Type': registry.contentType }).end(body))
        .catch((error: unknown) => {
          this.logger.warn(`Metrics scrape failed: ${(error as Error).message}`);
          res.writeHead(500).end();
        });
    });
    this.server.listen(this.config.observability.metricsPort);
  }

  onApplicationShutdown(): void {
    this.server?.close();
  }

  async collect(): Promise<void> {
    for (const name of Object.values(QUEUE_NAMES)) {
      const queue = this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      for (const [state, count] of Object.entries(counts)) {
        queueJobs.set({ queue: name, state }, count);
      }
    }
    const db = this.database.client;
    if (db) {
      const rows = await db.$queryRaw<{ kind: string; n: number }[]>(Prisma.raw(BACKLOG_SQL));
      for (const row of rows) backlog.set({ kind: row.kind }, row.n);
    }
  }
}
