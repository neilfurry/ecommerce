import { Injectable } from '@nestjs/common';
import { APP_NAME, EMAIL_JOBS } from '@marketplace/config';
import { devTestEmailRequestSchema } from '@marketplace/validation';
import { type Job, UnrecoverableError } from 'bullmq';
import { WorkerConfig } from '../config/worker-config';
import { MailerService, type SentEmail } from '../mail/mailer.service';
import type { JobHandler } from '../queues/job-handler';

/**
 * DEVELOPMENT ONLY. Sends a test email through the email queue and SMTP adapter, proving
 * the path real transactional emails will take. Locally it lands in Mailpit.
 * SMTP errors are thrown as normal errors, so the email queue's retry policy applies.
 */
@Injectable()
export class DevTestEmailHandler implements JobHandler<SentEmail> {
  readonly jobName = EMAIL_JOBS.DEV_TEST;

  constructor(
    private readonly config: WorkerConfig,
    private readonly mailer: MailerService,
  ) {}

  async handle(job: Job): Promise<SentEmail> {
    if (!this.config.devToolsEnabled) {
      throw new UnrecoverableError('Developer tools are disabled (DEV_TOOLS_ENABLED=false)');
    }
    const parsed = devTestEmailRequestSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid test-email job payload');

    const sentAt = new Date().toISOString();
    return this.mailer.send({
      to: parsed.data.to,
      subject: `${APP_NAME} test email (job ${job.id})`,
      text: `This is a test email from the ${APP_NAME} background worker.\n\nJob: ${job.id}\nSent: ${sentAt}\n`,
      html:
        `<p>This is a test email from the <strong>${APP_NAME}</strong> background worker.</p>` +
        `<p>Job: <code>${job.id}</code><br>Sent: ${sentAt}</p>`,
    });
  }
}
