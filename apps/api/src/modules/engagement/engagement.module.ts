import { Module } from '@nestjs/common';
import { AffiliatesService } from './affiliates.service';
import {
  AccountEngagementController,
  AffiliatesAdminController,
  LoyaltyAdminController,
  NotificationAdminController,
  NotificationCenterController,
  StorefrontEngagementController,
} from './engagement.controller';
import { LoyaltyService } from './loyalty.service';
import { NotificationCenterService } from './notification-center.service';

/** Loyalty points, referrals, affiliates and the notification center (Phase 7). */
@Module({
  controllers: [
    AccountEngagementController,
    StorefrontEngagementController,
    NotificationCenterController,
    LoyaltyAdminController,
    AffiliatesAdminController,
    NotificationAdminController,
  ],
  providers: [LoyaltyService, AffiliatesService, NotificationCenterService],
  exports: [LoyaltyService],
})
export class EngagementModule {}
