import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  ORDER_JOBS,
  QUEUE_NAMES,
  RESERVATION_SWEEP_INTERVAL_SECONDS,
  RESERVATION_SWEEP_SCHEDULER_ID,
} from '@marketplace/config';
import { releaseExpiredReservations } from '@marketplace/database';
import type { Queue } from 'bullmq';
import { WorkerDatabase } from '../database/database.provider';
import type { JobHandler } from '../queues/job-handler';

/**
 * Gives back stock held by checkout reservations past their expiry. The release is one SQL
 * statement (see releaseExpiredReservations), safe to run from several workers at once.
 * The API also releases expired holds before reserving, so a late sweep never blocks sales.
 */
@Injectable()
export class ReleaseExpiredReservationsHandler implements JobHandler<{ expired: number }> {
  readonly jobName = ORDER_JOBS.RELEASE_EXPIRED_RESERVATIONS;
  private readonly logger = new Logger(ReleaseExpiredReservationsHandler.name);

  constructor(private readonly database: WorkerDatabase) {}

  async handle(): Promise<{ expired: number }> {
    if (!this.database.client) return { expired: 0 };
    let total = 0;
    // Batches of 500 until nothing is due.
    for (;;) {
      const expired = await releaseExpiredReservations(this.database.client, { limit: 500 });
      total += expired;
      if (expired < 500) break;
    }
    if (total > 0) this.logger.log(`Released ${total} expired stock reservation(s)`);
    return { expired: total };
  }
}

/** Registers the sweep with BullMQ's scheduler (idempotent across worker instances). */
@Injectable()
export class ReservationSweepScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.ORDER_PROCESSING) private readonly queue: Queue,
    private readonly database: WorkerDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.database.client) return;
    await this.queue.upsertJobScheduler(
      RESERVATION_SWEEP_SCHEDULER_ID,
      { every: RESERVATION_SWEEP_INTERVAL_SECONDS * 1000 },
      {
        name: ORDER_JOBS.RELEASE_EXPIRED_RESERVATIONS,
        // The next sweep is a minute away; a failed one is not worth retrying.
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }
}
