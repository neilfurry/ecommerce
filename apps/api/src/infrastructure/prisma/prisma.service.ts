import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { PrismaClient } from '../../generated/prisma/client';
import { createPgAdapter } from './pg-adapter';

/**
 * The single PrismaClient for the API process (Prisma 7 + node-postgres driver adapter).
 * Connects lazily on first query; disconnects on shutdown.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ adapter: createPgAdapter(config.database.url) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
