import { Module } from '@nestjs/common';
import {
  AdminOrdersController,
  CustomerOrdersController,
  SellerOrdersController,
} from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [CustomerOrdersController, SellerOrdersController, AdminOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
