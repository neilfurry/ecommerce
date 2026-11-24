import { Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@marketplace/config';
import { WorkerConfig } from '../config/worker-config';
import { DevSampleHandler } from '../jobs/dev-sample.handler';
import { DevTestEmailHandler } from '../jobs/dev-test-email.handler';
import { HeartbeatHandler } from '../jobs/heartbeat.handler';
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
  constructor(config: WorkerConfig, deadLetters: DeadLetterService, devTest: DevTestEmailHandler) {
    super(QUEUE_NAMES.EMAIL, [devTest], config, deadLetters);
  }
}

@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationsProcessor extends DomainProcessor {
  constructor(config: WorkerConfig, deadLetters: DeadLetterService) {
    super(QUEUE_NAMES.NOTIFICATIONS, [], config, deadLetters);
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
  constructor(config: WorkerConfig, deadLetters: DeadLetterService) {
    super(QUEUE_NAMES.ORDER_PROCESSING, [], config, deadLetters);
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
