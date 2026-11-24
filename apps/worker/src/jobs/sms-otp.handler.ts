import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_JOBS } from '@marketplace/config';
import { smsOtpJobSchema } from '@marketplace/validation';
import { type Job, UnrecoverableError } from 'bullmq';
import { otpSmsBody } from '../mail/templates';
import type { JobHandler } from '../queues/job-handler';
import { maskNumber, PermanentSmsError, SmsProvider, type SmsResult } from '../sms/sms-provider';

/**
 * Texts a one-time code. The code is never logged and never returned as the job result
 * (results are kept in Redis); the API removes the job as soon as it finishes.
 */
@Injectable()
export class SmsOtpHandler implements JobHandler<SmsResult & { to: string }> {
  readonly jobName = NOTIFICATION_JOBS.SMS_OTP;
  private readonly logger = new Logger(SmsOtpHandler.name);

  constructor(private readonly sms: SmsProvider) {}

  async handle(job: Job): Promise<SmsResult & { to: string }> {
    const parsed = smsOtpJobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid SMS code job payload');
    const { to, code, expiresInMinutes } = parsed.data;
    try {
      const result = await this.sms.send({ to, body: otpSmsBody(code, expiresInMinutes) });
      this.logger.log(`Sent sign-in code to ${maskNumber(to)} via ${result.provider}`);
      return { ...result, to: maskNumber(to) };
    } catch (error) {
      if (error instanceof PermanentSmsError) throw new UnrecoverableError(error.message);
      throw error;
    }
  }
}
