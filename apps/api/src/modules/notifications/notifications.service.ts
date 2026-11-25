import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EMAIL_JOBS, NOTIFICATION_JOBS, QUEUE_NAMES } from '@marketplace/config';
import type {
  PasswordResetJob,
  SellerInvitationJob,
  ProductDecisionJob,
  LowStockJob,
  SellerStatusJob,
  SmsOtpJob,
  StaffInvitationJob,
  VerifyEmailJob,
  WholesaleDecisionJob,
} from '@marketplace/validation';
import type { Queue } from 'bullmq';

/**
 * Producer side of email and SMS. The worker renders and sends; the API only enqueues,
 * so requests never wait on SMTP or an SMS gateway.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationsQueue: Queue,
  ) {}

  sendVerifyEmail(job: VerifyEmailJob) {
    return this.emailQueue.add(EMAIL_JOBS.VERIFY_ADDRESS, job);
  }

  sendPasswordReset(job: PasswordResetJob) {
    return this.emailQueue.add(EMAIL_JOBS.PASSWORD_RESET, job);
  }

  sendStaffInvitation(job: StaffInvitationJob) {
    return this.emailQueue.add(EMAIL_JOBS.STAFF_INVITATION, job);
  }

  sendWholesaleDecision(job: WholesaleDecisionJob) {
    return this.emailQueue.add(EMAIL_JOBS.WHOLESALE_DECISION, job);
  }

  sendSellerStatus(job: SellerStatusJob) {
    return this.emailQueue.add(EMAIL_JOBS.SELLER_STATUS, job);
  }

  sendSellerInvitation(job: SellerInvitationJob) {
    return this.emailQueue.add(EMAIL_JOBS.SELLER_INVITATION, job);
  }

  sendProductDecision(job: ProductDecisionJob) {
    return this.emailQueue.add(EMAIL_JOBS.PRODUCT_DECISION, job);
  }

  sendLowStock(job: LowStockJob) {
    return this.emailQueue.add(EMAIL_JOBS.LOW_STOCK, job);
  }

  /**
   * One-time codes are useless after a few minutes, so: highest priority, few quick
   * retries, and removal from Redis as soon as the job finishes (the code is in the payload).
   */
  sendSmsOtp(job: SmsOtpJob) {
    return this.notificationsQueue.add(NOTIFICATION_JOBS.SMS_OTP, job, {
      priority: 1,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /** Enqueue after the database commit; a failure is logged, never surfaced to the user. */
  async safely(label: string, enqueue: () => Promise<unknown>): Promise<void> {
    try {
      await enqueue();
    } catch (error) {
      this.logger.error(`Could not enqueue ${label}: ${(error as Error).message}`);
    }
  }
}
