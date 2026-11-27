import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CouponsService } from './coupons.service';
import { FlashSalesService } from './flash-sales.service';
import {
  PromotionsController,
  SellerPromotionsController,
  StorefrontCampaignsController,
} from './promotions.controller';

@Module({
  controllers: [PromotionsController, SellerPromotionsController, StorefrontCampaignsController],
  providers: [CouponsService, FlashSalesService, CampaignsService],
})
export class PromotionsModule {}
