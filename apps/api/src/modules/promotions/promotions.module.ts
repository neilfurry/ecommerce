import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { FlashSalesService } from './flash-sales.service';
import { PromotionsController, SellerPromotionsController } from './promotions.controller';

@Module({
  controllers: [PromotionsController, SellerPromotionsController],
  providers: [CouponsService, FlashSalesService],
})
export class PromotionsModule {}
