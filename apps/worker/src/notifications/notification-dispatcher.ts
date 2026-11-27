import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  APP_NAME,
  NOTIFICATION_JOBS,
  NOTIFICATION_SWEEP_INTERVAL_SECONDS,
  NOTIFICATION_SWEEP_SCHEDULER_ID,
  QUEUE_NAMES,
} from '@marketplace/config';
import type { Prisma, PrismaClient } from '@marketplace/database';
import { NOTIFICATION_EVENTS, type NotificationChannel } from '@marketplace/shared-types';
import { notificationDispatchJobSchema } from '@marketplace/validation';
import { type Job, type Queue, UnrecoverableError } from 'bullmq';
import { WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../database/database.provider';
import { MailerService } from '../mail/mailer.service';
import { fillTemplate, notificationEmail } from '../mail/templates';
import type { JobHandler } from '../queues/job-handler';
import { maskNumber, SmsProvider } from '../sms/sms-provider';
import { maskEndpoint, PushProvider } from './push-provider';

const MAX_ATTEMPTS = 5;
const CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'];

export const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

type Tx = Prisma.TransactionClient;
type Outcome = {
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  destination?: string;
  provider?: string;
  detail?: string;
};

export interface DispatchResult {
  eventId: string;
  status: 'PROCESSED' | 'PENDING' | 'FAILED' | 'SKIPPED';
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Delivers notification events from the outbox (ADR 0033). For each recipient and channel:
 * in-app (inbox row), email (template in the shared layout; Mailpit locally), SMS (mock
 * provider until real credentials) and push (mock provider). Every outcome is logged in
 * notification_deliveries; a channel already SENT or SKIPPED is never sent twice, failed ones
 * are retried by the next run (at most 5 attempts per event). The event row is locked while it
 * is processed, so the sweep and a kicked job never deliver the same event at once.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly database: WorkerDatabase,
    private readonly mailer: MailerService,
    private readonly sms: SmsProvider,
    private readonly push: PushProvider,
    private readonly config: WorkerConfig,
  ) {}

  private linkFor(audience: string, link: string | null): string | null {
    if (!link) return null;
    if (/^https?:\/\//.test(link)) return link;
    const base =
      audience === 'seller'
        ? this.config.sellerPortalUrl
        : audience === 'staff'
          ? this.config.adminPortalUrl
          : this.config.storefrontUrl;
    return `${base}${link.startsWith('/') ? '' : '/'}${link}`;
  }

  async dispatch(
    eventId: string,
    db: PrismaClient | null = this.database.client,
  ): Promise<DispatchResult> {
    if (!db) return { eventId, status: 'SKIPPED', sent: 0, skipped: 0, failed: 0 };
    return db.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "notification_events"
          WHERE "id" = ${eventId}::uuid AND "status" = 'PENDING' FOR UPDATE SKIP LOCKED`;
        if (!locked) return { eventId, status: 'SKIPPED' as const, sent: 0, skipped: 0, failed: 0 };
        return this.deliverInTx(tx, eventId);
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private async deliverInTx(tx: Tx, eventId: string): Promise<DispatchResult> {
    const event = await tx.notificationEvent.findUniqueOrThrow({ where: { id: eventId } });
    const data: Record<string, unknown> = {
      appName: APP_NAME,
      ...((event.data ?? {}) as Record<string, unknown>),
    };
    const definition = NOTIFICATION_EVENTS[event.event as keyof typeof NOTIFICATION_EVENTS];
    const audience =
      (data.audience as string | undefined) ??
      (definition?.audience === 'seller' ? 'seller' : 'customer');
    const builtInEmail = definition ? definition.builtInEmail : true;
    const templates = await tx.notificationTemplate.findMany({ where: { event: event.event } });
    const users = await tx.user.findMany({
      where: { id: { in: event.userIds } },
      select: {
        id: true,
        email: true,
        mobile: true,
        status: true,
        notificationPrefs: true,
        pushSubscriptions: { select: { id: true, endpoint: true } },
      },
    });
    const done = await tx.notificationDelivery.findMany({
      where: { eventId, status: { in: ['SENT', 'SKIPPED'] } },
      select: { userId: true, channel: true },
    });
    const link = this.linkFor(audience, event.link);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const user of users) {
      for (const channel of CHANNELS) {
        if (done.some((d) => d.userId === user.id && d.channel === channel)) continue;
        const template = templates.find((t) => t.channel === channel);
        const outcome = await this.deliverOne(tx, {
          channel,
          template,
          user,
          data,
          link,
          eventId,
          eventCode: event.event,
          builtInEmail,
        });
        if (outcome === null) continue;
        await tx.notificationDelivery.upsert({
          where: { eventId_userId_channel: { eventId, userId: user.id, channel } },
          create: {
            eventId,
            userId: user.id,
            channel,
            status: outcome.status,
            destination: outcome.destination ?? null,
            provider: outcome.provider ?? null,
            detail: outcome.detail?.slice(0, 500) ?? null,
          },
          update: {
            status: outcome.status,
            destination: outcome.destination ?? null,
            provider: outcome.provider ?? null,
            detail: outcome.detail?.slice(0, 500) ?? null,
            createdAt: new Date(),
          },
        });
        if (outcome.status === 'SENT') sent += 1;
        else if (outcome.status === 'SKIPPED') skipped += 1;
        else failed += 1;
      }
    }
    const attempts = event.attempts + 1;
    const status = failed === 0 ? 'PROCESSED' : attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
    await tx.notificationEvent.update({
      where: { id: eventId },
      data: {
        status,
        attempts,
        processedAt: status === 'PENDING' ? null : new Date(),
        lastError: failed > 0 ? `${failed} delivery(ies) failed` : null,
      },
    });
    return { eventId, status, sent, skipped, failed };
  }

  /** null: nothing to record (the channel does not exist for this event). */
  private async deliverOne(
    tx: Tx,
    input: {
      channel: NotificationChannel;
      template: { subject: string | null; body: string; enabled: boolean } | undefined;
      user: {
        id: string;
        email: string;
        mobile: string | null;
        status: string;
        notificationPrefs: { channel: string; enabled: boolean }[];
        pushSubscriptions: { id: string; endpoint: string }[];
      };
      data: Record<string, unknown>;
      link: string | null;
      eventId: string;
      eventCode: string;
      builtInEmail: boolean;
    },
  ): Promise<Outcome | null> {
    const { channel, template, user, data, link } = input;
    if (channel === 'EMAIL' && input.builtInEmail) return null;
    if (!template) return null;
    if (!template.enabled) return { status: 'SKIPPED', detail: 'Template turned off' };
    if (user.status !== 'ACTIVE') return { status: 'SKIPPED', detail: 'Account not active' };
    if (
      channel !== 'IN_APP' &&
      user.notificationPrefs.some((p) => p.channel === channel && !p.enabled)
    ) {
      return { status: 'SKIPPED', detail: 'Turned off by the user' };
    }
    const subject = fillTemplate(template.subject ?? '', data).trim();
    const body = fillTemplate(template.body, data).trim();
    try {
      switch (channel) {
        case 'IN_APP': {
          await tx.notification.upsert({
            where: { eventId_userId: { eventId: input.eventId, userId: user.id } },
            create: {
              userId: user.id,
              eventId: input.eventId,
              event: input.eventCode,
              title: (subject || APP_NAME).slice(0, 200),
              body: body.slice(0, 1000),
              link: input.link ? this.relative(input.link) : null,
            },
            update: {},
          });
          return { status: 'SENT', provider: 'in-app' };
        }
        case 'EMAIL': {
          const rendered = notificationEmail(subject || APP_NAME, body, link);
          await this.mailer.send({ to: user.email, ...rendered });
          return { status: 'SENT', destination: maskEmail(user.email), provider: 'smtp' };
        }
        case 'SMS': {
          if (!user.mobile) return { status: 'SKIPPED', detail: 'No mobile number' };
          const result = await this.sms.send({ to: user.mobile, body: body.slice(0, 480) });
          return {
            status: 'SENT',
            destination: maskNumber(user.mobile),
            provider: result.provider,
          };
        }
        case 'PUSH': {
          if (user.pushSubscriptions.length === 0)
            return { status: 'SKIPPED', detail: 'No push subscription' };
          for (const s of user.pushSubscriptions) {
            await this.push.send({ endpoint: s.endpoint, title: subject || APP_NAME, body, link });
          }
          await tx.pushSubscription.updateMany({
            where: { id: { in: user.pushSubscriptions.map((s) => s.id) } },
            data: { lastUsedAt: new Date() },
          });
          return {
            status: 'SENT',
            destination: user.pushSubscriptions
              .map((s) => maskEndpoint(s.endpoint))
              .join(', ')
              .slice(0, 120),
            provider: this.push.name,
          };
        }
      }
    } catch (error) {
      this.logger.warn(`${input.eventCode} ${channel} for ${user.id}: ${(error as Error).message}`);
      return { status: 'FAILED', detail: (error as Error).message };
    }
  }

  /** In-app links stay relative to the app that shows them. */
  private relative(link: string) {
    try {
      const url = new URL(link);
      return `${url.pathname}${url.search}`;
    } catch {
      return link;
    }
  }

  /**
   * Pending events, oldest first, in batches until none is left (or maxBatches is reached), so
   * events committed while a run is in progress are delivered by that run instead of waiting
   * for the next sweep, and a burst drains at full speed. Events another run holds are skipped.
   */
  async dispatchPending(limit = 100, maxBatches = 20): Promise<DispatchResult[]> {
    const db = this.database.client;
    if (!db) return [];
    const results: DispatchResult[] = [];
    const seen = new Set<string>();
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await db.notificationEvent.findMany({
        where: { status: 'PENDING', id: { notIn: [...seen] } },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true },
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        seen.add(row.id);
        try {
          results.push(await this.dispatch(row.id, db));
        } catch (error) {
          this.logger.error(`Notification event ${row.id}: ${(error as Error).message}`);
        }
      }
      if (rows.length < limit) {
        // Anything new since this batch was read? One more look, then stop.
        const more = await db.notificationEvent.count({
          where: { status: 'PENDING', id: { notIn: [...seen] } },
        });
        if (more === 0) break;
      }
    }
    return results;
  }
}

@Injectable()
export class NotificationDispatchHandler implements JobHandler<DispatchResult> {
  readonly jobName = NOTIFICATION_JOBS.DISPATCH;
  constructor(private readonly dispatcher: NotificationDispatcher) {}

  async handle(job: Job): Promise<DispatchResult> {
    const parsed = notificationDispatchJobSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid notification dispatch payload');
    return this.dispatcher.dispatch(parsed.data.eventId);
  }
}

@Injectable()
export class NotificationSweepHandler implements JobHandler<{ processed: number }> {
  readonly jobName = NOTIFICATION_JOBS.DISPATCH_PENDING;
  constructor(private readonly dispatcher: NotificationDispatcher) {}

  async handle(): Promise<{ processed: number }> {
    const results = await this.dispatcher.dispatchPending();
    return { processed: results.filter((r) => r.status !== 'SKIPPED').length };
  }
}

@Injectable()
export class NotificationSweepScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly queue: Queue,
    private readonly database: WorkerDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.database.client) return;
    await this.queue.upsertJobScheduler(
      NOTIFICATION_SWEEP_SCHEDULER_ID,
      { every: NOTIFICATION_SWEEP_INTERVAL_SECONDS * 1000 },
      {
        name: NOTIFICATION_JOBS.DISPATCH_PENDING,
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }
}
