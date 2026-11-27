import { Injectable, Logger } from '@nestjs/common';
import { emitNotificationInTx, sellerRecipientIdsInTx } from '@marketplace/database';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Order emails after a change has been committed (payment received, shipped, return decided,
 * refund sent...). Best effort: a queue outage is logged and never undoes the change.
 */
@Injectable()
export class OrderNotifier {
  private readonly logger = new Logger(OrderNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async customer(orderId: string, title: string, message: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          orderNumber: true,
          customerId: true,
          customer: { select: { email: true, firstName: true } },
        },
      });
      if (!order) return;
      await emitNotificationInTx(this.prisma, {
        event: 'ORDER_UPDATE',
        userIds: [order.customerId],
        data: { audience: 'customer', orderNumber: order.orderNumber, title, message },
        link: `/account/orders/${orderId}`,
      });
      await this.notifications.kickDispatch();
      await this.notifications.sendOrderUpdate({
        to: order.customer.email,
        firstName: order.customer.firstName,
        orderNumber: order.orderNumber,
        title,
        message,
        link: `${this.config.appUrls.storefront}/account/orders/${orderId}`,
      });
    } catch (error) {
      this.logger.warn(
        `Order ${orderId}: could not queue "${title}" (${(error as Error).message})`,
      );
    }
  }

  async seller(sellerOrderId: string, title: string, message: string): Promise<void> {
    try {
      const so = await this.prisma.sellerOrder.findUnique({
        where: { id: sellerOrderId },
        select: {
          number: true,
          sellerId: true,
          seller: { select: { email: true, businessName: true } },
        },
      });
      if (!so) return;
      await emitNotificationInTx(this.prisma, {
        event: 'ORDER_UPDATE',
        userIds: await sellerRecipientIdsInTx(this.prisma, so.sellerId),
        data: { audience: 'seller', orderNumber: so.number, title, message },
        link: `/orders/${sellerOrderId}`,
      });
      await this.notifications.kickDispatch();
      await this.notifications.sendOrderUpdate({
        to: so.seller.email,
        firstName: so.seller.businessName,
        orderNumber: so.number,
        title,
        message,
        link: `${this.config.appUrls.seller}/orders/${sellerOrderId}`,
      });
    } catch (error) {
      this.logger.warn(
        `Seller order ${sellerOrderId}: could not queue "${title}" (${(error as Error).message})`,
      );
    }
  }

  /** Deliver notification events written by a committed change now (instead of the sweep). */
  kick(): Promise<void> {
    return this.notifications.kickDispatch();
  }

  async sellersOf(orderId: string, title: string, message: string): Promise<void> {
    const rows = await this.prisma.sellerOrder
      .findMany({ where: { orderId, status: { not: 'CANCELLED' } }, select: { id: true } })
      .catch(() => []);
    for (const row of rows) await this.seller(row.id, title, message);
  }
}
