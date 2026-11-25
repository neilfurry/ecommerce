import { Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@marketplace/config';
import { WorkerConfig } from '../config/worker-config';
import { DevSampleHandler } from '../jobs/dev-sample.handler';
import { DevTestEmailHandler } from '../jobs/dev-test-email.handler';
import { HeartbeatHandler } from '../jobs/heartbeat.handler';
import { SmsOtpHandler } from '../jobs/sms-otp.handler';
import { ReleaseExpiredReservationsHandler } from '../jobs/reservation-sweep';
import { ExpireUnpaidOrdersHandler } from '../jobs/unpaid-order-sweep';
import {
  LowStockEmailHandler,
  OrderCancelledEmailHandler,
  OrderPlacedEmailHandler,
  PasswordResetEmailHandler,
  SellerNewOrderEmailHandler,
  ProductDecisionEmailHandler,
  SellerInvitationEmailHandler,
  SellerStatusEmailHandler,
  StaffInvitationEmailHandler,
  VerifyEmailHandler,
  WholesaleDecisionEmailHandler,
} from '../jobs/transactional-email.handlers';
import { DeadLetterService } from './dead-letter.service';
import { DomainProcessor } from './domain.processor';

/*
 * One processor per domain queue. Business phases add handlers to the processor that owns
 * their queue (e.g. Phase 6 adds payment-webhook handlers to PaymentEventsProcessor).
 * Until then, a job enqueued on a queue without a matching handler fails without retries
 * and is dead-lettered, so nothing is silently lost.
 */

@Processor(QUEUE_NAMES.SYSTEM)
export class SystemProcessor extends DomainProcessor {
  constructor(
    config: WorkerConfig,
    deadLetters: DeadLetterService,
    heartbeat: HeartbeatHandler,
    devSample: DevSampleHandler,
  ) {
    super(QUEUE_NAMES.SYSTEM, [heartbeat, devSample], config, deadLetters);
  }
}

@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor extends DomainProcessor {
  constructor(
    config: WorkerConfig,
    deadLetters: DeadLetterService,
    devTest: DevTestEmailHandler,
    verifyEmail: VerifyEmailHandler,
    passwordReset: PasswordResetEmailHandler,
    staffInvitation: StaffInvitationEmailHandler,
    wholesaleDecision: WholesaleDecisionEmailHandler,
    sellerStatus: SellerStatusEmailHandler,
    sellerInvitation: SellerInvitationEmailHandler,
    productDecision: ProductDecisionEmailHandler,
    lowStock: LowStockEmailHandler,
    orderPlaced: OrderPlacedEmailHandler,
    sellerNewOrder: SellerNewOrderEmailHandler,
    orderCancelled: OrderCancelledEmailHandler,
  ) {
    super(
      QUEUE_NAMES.EMAIL,
      [
        devTest,
        verifyEmail,
        passwordReset,
        staffInvitation,
        wholesaleDecision,
        sellerStatus,
        sellerInvitation,
        productDecision,
        lowStock,
        orderPlaced,
        sellerNewOrder,
        orderCancelled,
      ],
      config,
      deadLetters,
    );
  }
}

@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationsProcessor extends DomainProcessor {
  constructor(config: WorkerConfig, deadLetters: DeadLetterService, smsOtp: SmsOtpHandler) {
    super(QUEUE_NAMES.NOTIFICATIONS, [smsOtp], config, deadLetters);
  }
}

@Processor(QUEUE_NAMES.IMAGE_PROCESSING)
export class ImageProcessingProcessor extends DomainProcessor {
  constructor(config: WorkerConfig, deadLetters: DeadLetterService) {
    super(QUEUE_NAMES.IMAGE_PROCESSING, [], config, deadLetters);
  }
}

@Processor(QUEUE_NAMES.REPORTS)
export class ReportsProcessor extends DomainProcessor {
  constructor(config: WorkerConfig, deadLetters: DeadLetterService) {
    super(QUEUE_NAMES.REPORTS, [], config, deadLetters);
  }
}

@Processor(QUEUE_NAMES.PAYMENT_EVENTS)
export class PaymentEventsProcessor extends DomainProcessor {
  constructor(config: WorkerConfig, deadLetters: DeadLetterService) {
    super(QUEUE_NAMES.PAYMENT_EVENTS, [], config, deadLetters);
  }
}

@Processor(QUEUE_NAMES.ORDER_PROCESSING)
export class OrderProcessingProcessor extends DomainProcessor {
  constructor(
    config: WorkerConfig,
    deadLetters: DeadLetterService,
    releaseExpiredReservations: ReleaseExpiredReservationsHandler,
    expireUnpaidOrders: ExpireUnpaidOrdersHandler,
  ) {
    super(
      QUEUE_NAMES.ORDER_PROCESSING,
      [releaseExpiredReservations, expireUnpaidOrders],
      config,
      deadLetters,
    );
  }
}

export const DOMAIN_PROCESSORS = [
  SystemProcessor,
  EmailProcessor,
  NotificationsProcessor,
  ImageProcessingProcessor,
  ReportsProcessor,
  PaymentEventsProcessor,
  OrderProcessingProcessor,
];
