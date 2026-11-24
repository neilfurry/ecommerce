import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { WorkerConfig } from '../config/worker-config';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SentEmail {
  messageId: string;
  accepted: string[];
}

/**
 * SMTP adapter. Locally it delivers to Mailpit (http://localhost:8025); in production it
 * points at the transactional email provider configured through SMTP_* variables.
 */
@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly transport: Transporter;

  constructor(private readonly config: WorkerConfig) {
    const { host, port, secure, user, password } = config.smtp;
    this.transport = createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(email: OutgoingEmail): Promise<SentEmail> {
    const info = await this.transport.sendMail({ from: this.config.smtp.from, ...email });
    const accepted = (info.accepted ?? []) as (string | { address: string })[];
    return {
      messageId: info.messageId,
      accepted: accepted.map((address) =>
        typeof address === 'string' ? address : address.address,
      ),
    };
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
