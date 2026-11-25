import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createPgAdapter, PrismaClient } from '@marketplace/database';
import { WorkerConfig } from '../config/worker-config';

/**
 * Database access for jobs that need it. Optional outside production: without DATABASE_URL
 * those jobs log and skip. Connects lazily on the first query.
 */
@Injectable()
export class WorkerDatabase implements OnModuleDestroy {
  private readonly logger = new Logger(WorkerDatabase.name);
  readonly client: PrismaClient | null;

  constructor(config: WorkerConfig) {
    this.client = config.databaseUrl
      ? new PrismaClient({ adapter: createPgAdapter(config.databaseUrl) })
      : null;
    if (!this.client) this.logger.warn('DATABASE_URL is not set: database jobs are skipped');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
