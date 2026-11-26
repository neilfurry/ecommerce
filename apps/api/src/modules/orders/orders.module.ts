import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SettingsModule } from '../settings/settings.module';
import { CodService } from './cod/cod.service';
import {
  AdminReturnsController,
  AdminShippingController,
  CourierWebhooksController,
  CustomerReturnsController,
  SellerReturnsController,
  SellerShipmentsController,
} from './fulfilment.controller';
import { OrderNotifier } from './order-notifier.service';
import {
  AdminOrdersController,
  CustomerOrdersController,
  SellerOrdersController,
} from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentGatewaysService } from './payments/payment-gateways.service';
import {
  AdminPaymentsController,
  CustomerPaymentsController,
  MockPaymentsController,
  PaymentWebhooksController,
  SellerLedgerController,
} from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { ReconciliationService } from './payments/reconciliation.service';
import { RefundsService } from './refunds/refunds.service';
import { ReturnsService } from './returns/returns.service';
import { ShipmentsService } from './shipments/shipments.service';

/**
 * Orders after checkout (Phase 5): the order state machine, payments and webhooks, bank
 * transfers, cash on delivery, shipments, returns, refunds and seller payables. One module,
 * so these services can use each other without circular module imports.
 */
@Module({
  imports: [FilesModule, InventoryModule, SettingsModule],
  controllers: [
    CustomerOrdersController,
    CustomerPaymentsController,
    CustomerReturnsController,
    MockPaymentsController,
    PaymentWebhooksController,
    CourierWebhooksController,
    SellerOrdersController,
    SellerShipmentsController,
    SellerReturnsController,
    SellerLedgerController,
    AdminOrdersController,
    AdminPaymentsController,
    AdminShippingController,
    AdminReturnsController,
  ],
  providers: [
    OrdersService,
    OrderNotifier,
    PaymentGatewaysService,
    PaymentsService,
    ReconciliationService,
    RefundsService,
    ShipmentsService,
    CodService,
    ReturnsService,
  ],
  exports: [OrdersService, PaymentsService],
})
export class OrdersModule {}
