import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CheckoutPricingService } from './checkout-pricing.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [ProductsModule, InventoryModule, SettingsModule, ShippingModule, OrdersModule],
  controllers: [CheckoutController],
  providers: [CheckoutPricingService, CheckoutService],
})
export class CheckoutModule {}
