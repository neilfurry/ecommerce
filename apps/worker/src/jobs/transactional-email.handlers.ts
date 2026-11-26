import { Injectable } from '@nestjs/common';
import { EMAIL_JOBS } from '@marketplace/config';
import {
  lowStockJobSchema,
  orderCancelledJobSchema,
  orderUpdateJobSchema,
  orderPlacedJobSchema,
  sellerNewOrderJobSchema,
  passwordResetJobSchema,
  productDecisionJobSchema,
  sellerInvitationJobSchema,
  sellerStatusJobSchema,
  staffInvitationJobSchema,
  verifyEmailJobSchema,
  wholesaleDecisionJobSchema,
} from '@marketplace/validation';
import { type Job, UnrecoverableError } from 'bullmq';
import type { z } from 'zod';
import { MailerService, type SentEmail } from '../mail/mailer.service';
import {
  lowStockTemplate,
  orderCancelledTemplate,
  orderUpdateTemplate,
  orderPlacedTemplate,
  sellerNewOrderTemplate,
  passwordResetTemplate,
  productDecisionTemplate,
  type RenderedEmail,
  sellerInvitationTemplate,
  sellerStatusTemplate,
  staffInvitationTemplate,
  verifyEmailTemplate,
  wholesaleDecisionTemplate,
} from '../mail/templates';
import type { JobHandler } from '../queues/job-handler';

/**
 * Validates the payload, renders the template and sends through SMTP. A bad payload can
 * never succeed, so it is dead-lettered at once; SMTP errors are retried with backoff.
 */
abstract class TemplatedEmailHandler<
  TSchema extends z.ZodType<{ to: string }>,
> implements JobHandler<SentEmail> {
  abstract readonly jobName: string;
  protected abstract readonly schema: TSchema;
  protected abstract render(data: z.infer<TSchema>): RenderedEmail;

  constructor(private readonly mailer: MailerService) {}

  async handle(job: Job): Promise<SentEmail> {
    const parsed = this.schema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError(`Invalid ${this.jobName} job payload`);
    const data = parsed.data as z.infer<TSchema>;
    return this.mailer.send({ to: data.to, ...this.render(data) });
  }
}

@Injectable()
export class VerifyEmailHandler extends TemplatedEmailHandler<typeof verifyEmailJobSchema> {
  readonly jobName = EMAIL_JOBS.VERIFY_ADDRESS;
  protected readonly schema = verifyEmailJobSchema;
  protected render = verifyEmailTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class PasswordResetEmailHandler extends TemplatedEmailHandler<
  typeof passwordResetJobSchema
> {
  readonly jobName = EMAIL_JOBS.PASSWORD_RESET;
  protected readonly schema = passwordResetJobSchema;
  protected render = passwordResetTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class StaffInvitationEmailHandler extends TemplatedEmailHandler<
  typeof staffInvitationJobSchema
> {
  readonly jobName = EMAIL_JOBS.STAFF_INVITATION;
  protected readonly schema = staffInvitationJobSchema;
  protected render = staffInvitationTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class WholesaleDecisionEmailHandler extends TemplatedEmailHandler<
  typeof wholesaleDecisionJobSchema
> {
  readonly jobName = EMAIL_JOBS.WHOLESALE_DECISION;
  protected readonly schema = wholesaleDecisionJobSchema;
  protected render = wholesaleDecisionTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class SellerStatusEmailHandler extends TemplatedEmailHandler<typeof sellerStatusJobSchema> {
  readonly jobName = EMAIL_JOBS.SELLER_STATUS;
  protected readonly schema = sellerStatusJobSchema;
  protected render = sellerStatusTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class SellerInvitationEmailHandler extends TemplatedEmailHandler<
  typeof sellerInvitationJobSchema
> {
  readonly jobName = EMAIL_JOBS.SELLER_INVITATION;
  protected readonly schema = sellerInvitationJobSchema;
  protected render = sellerInvitationTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class ProductDecisionEmailHandler extends TemplatedEmailHandler<
  typeof productDecisionJobSchema
> {
  readonly jobName = EMAIL_JOBS.PRODUCT_DECISION;
  protected readonly schema = productDecisionJobSchema;
  protected render = productDecisionTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class LowStockEmailHandler extends TemplatedEmailHandler<typeof lowStockJobSchema> {
  readonly jobName = EMAIL_JOBS.LOW_STOCK;
  protected readonly schema = lowStockJobSchema;
  protected render = lowStockTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class OrderPlacedEmailHandler extends TemplatedEmailHandler<typeof orderPlacedJobSchema> {
  readonly jobName = EMAIL_JOBS.ORDER_PLACED;
  protected readonly schema = orderPlacedJobSchema;
  protected render = orderPlacedTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class SellerNewOrderEmailHandler extends TemplatedEmailHandler<
  typeof sellerNewOrderJobSchema
> {
  readonly jobName = EMAIL_JOBS.SELLER_NEW_ORDER;
  protected readonly schema = sellerNewOrderJobSchema;
  protected render = sellerNewOrderTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class OrderCancelledEmailHandler extends TemplatedEmailHandler<
  typeof orderCancelledJobSchema
> {
  readonly jobName = EMAIL_JOBS.ORDER_CANCELLED;
  protected readonly schema = orderCancelledJobSchema;
  protected render = orderCancelledTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

@Injectable()
export class OrderUpdateEmailHandler extends TemplatedEmailHandler<typeof orderUpdateJobSchema> {
  readonly jobName = EMAIL_JOBS.ORDER_UPDATE;
  protected readonly schema = orderUpdateJobSchema;
  protected render = orderUpdateTemplate;
  constructor(mailer: MailerService) {
    super(mailer);
  }
}

export const TRANSACTIONAL_EMAIL_HANDLERS = [
  OrderUpdateEmailHandler,
  OrderPlacedEmailHandler,
  SellerNewOrderEmailHandler,
  OrderCancelledEmailHandler,
  ProductDecisionEmailHandler,
  LowStockEmailHandler,
  SellerStatusEmailHandler,
  SellerInvitationEmailHandler,
  VerifyEmailHandler,
  PasswordResetEmailHandler,
  StaffInvitationEmailHandler,
  WholesaleDecisionEmailHandler,
];
