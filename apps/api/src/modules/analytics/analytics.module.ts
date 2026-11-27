import { Module } from '@nestjs/common';
import { AdminReportsController, SellerReportsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/** Analytics reports, dashboards' data and exports (Phase 7, ADR 0035). */
@Module({
  controllers: [AdminReportsController, SellerReportsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
