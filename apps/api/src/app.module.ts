import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { ThrottlingModule } from './infrastructure/throttling/throttling.module';
import { HealthModule } from './modules/health/health.module';

/**
 * Root module. Infrastructure modules are global; business-domain modules live in
 * src/modules/<domain> and are added here as each phase delivers them.
 */
@Module({
  imports: [
    // Infrastructure
    AppConfigModule,
    LoggingModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    QueueModule,
    ThrottlingModule,
    // Domains
    HealthModule,
  ],
})
export class AppModule {}
