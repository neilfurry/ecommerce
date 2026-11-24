import { Module } from '@nestjs/common';
import { AccountWholesaleController, AdminWholesaleController } from './wholesale.controller';
import { WholesaleService } from './wholesale.service';

@Module({
  controllers: [AccountWholesaleController, AdminWholesaleController],
  providers: [WholesaleService],
})
export class WholesaleModule {}
