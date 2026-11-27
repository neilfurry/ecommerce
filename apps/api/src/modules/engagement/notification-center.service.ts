import { HttpStatus, Injectable } from '@nestjs/common';
import type { NotificationChannel, Prisma } from '@marketplace/database';
import {
  type AuthenticatedUser,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_CODES,
  NOTIFICATION_EVENTS,
  type NotificationEventCode,
} from '@marketplace/shared-types';
import type {
  MarkNotificationsReadRequest,
  NotificationDeliveryList,
  NotificationList,
  NotificationPreferences,
  NotificationTemplateDto,
  NotificationTemplateList,
  PushSubscriptionInput,
  UpdateNotificationPreferencesRequest,
  UpsertNotificationTemplateRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);

/**
 * The in-app inbox, per-user channel preferences and push subscriptions; for staff, the
 * notification templates and the delivery log (ADR 0033). Delivery itself is the worker's.
 */
@Injectable()
export class NotificationCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async inbox(
    user: AuthenticatedUser,
    query: { page: number; pageSize: number; unread?: 'true' | 'false' },
  ): Promise<NotificationList> {
    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      ...(query.unread === 'true' ? { readAt: null } : {}),
    };
    const [rows, totalItems, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      items: rows.map((n) => ({
        id: n.id,
        event: n.event,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
      unread,
    };
  }

  async markRead(user: AuthenticatedUser, input: MarkNotificationsReadRequest) {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
      },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  async preferences(user: AuthenticatedUser): Promise<NotificationPreferences> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId: user.id } });
    return {
      channels: NOTIFICATION_CHANNELS.map((channel) => ({
        channel,
        enabled: channel === 'IN_APP' || (rows.find((r) => r.channel === channel)?.enabled ?? true),
      })),
    };
  }

  async savePreferences(
    user: AuthenticatedUser,
    input: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    for (const { channel, enabled } of input.channels) {
      // The inbox is always on (it is where account and order notices live).
      if (channel === 'IN_APP') continue;
      await this.prisma.notificationPreference.upsert({
        where: { userId_channel: { userId: user.id, channel } },
        create: { userId: user.id, channel, enabled },
        update: { enabled },
      });
    }
    return this.preferences(user);
  }

  async subscribePush(
    user: AuthenticatedUser,
    input: PushSubscriptionInput,
    context: RequestContext,
  ): Promise<{ id: string }> {
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: context.userAgent?.slice(0, 300) ?? null,
      },
      // The same browser signed in as someone else now belongs to them.
      update: {
        userId: user.id,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: context.userAgent?.slice(0, 300) ?? null,
      },
      select: { id: true },
    });
    return row;
  }

  async unsubscribePush(user: AuthenticatedUser, endpoint: string) {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { userId: user.id, endpoint },
    });
    return { removed: count };
  }

  // ---- Staff ------------------------------------------------------------------------------

  private templateDto(t: {
    id: string;
    event: string;
    channel: NotificationChannel;
    subject: string | null;
    body: string;
    enabled: boolean;
    updatedAt: Date;
  }): NotificationTemplateDto {
    const definition = NOTIFICATION_EVENTS[t.event as NotificationEventCode];
    return {
      id: t.id,
      event: t.event,
      channel: t.channel,
      subject: t.subject,
      body: t.body,
      enabled: t.enabled,
      variables: definition ? [...definition.variables] : [],
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async templates(): Promise<NotificationTemplateList> {
    const rows = await this.prisma.notificationTemplate.findMany({
      orderBy: [{ event: 'asc' }, { channel: 'asc' }],
    });
    return {
      items: rows.map((t) => this.templateDto(t)),
      events: NOTIFICATION_EVENT_CODES.map((code) => ({
        code,
        label: NOTIFICATION_EVENTS[code].label,
        audience: NOTIFICATION_EVENTS[code].audience,
        builtInEmail: NOTIFICATION_EVENTS[code].builtInEmail,
        variables: [...NOTIFICATION_EVENTS[code].variables],
      })),
    };
  }

  async saveTemplate(
    staff: AuthenticatedUser,
    event: string,
    channel: NotificationChannel,
    input: UpsertNotificationTemplateRequest,
    context: RequestContext,
  ): Promise<NotificationTemplateDto> {
    const definition = NOTIFICATION_EVENTS[event as NotificationEventCode];
    if (!definition) throw invalid('event', 'Unknown event.');
    if (channel === 'EMAIL' && definition.builtInEmail)
      throw invalid('channel', 'This event uses a built-in transactional email.');
    if ((channel === 'EMAIL' || channel === 'IN_APP' || channel === 'PUSH') && !input.subject)
      throw invalid('subject', 'Enter a subject or title.');
    const unknown = [...`${input.subject ?? ''} ${input.body}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
      .map((m) => m[1]!)
      .filter((v) => !(definition.variables as readonly string[]).includes(v));
    if (unknown.length > 0)
      throw invalid('body', `Unknown variable(s): ${[...new Set(unknown)].join(', ')}`);
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.notificationTemplate.upsert({
        where: { event_channel: { event, channel } },
        create: {
          event,
          channel,
          subject: input.subject ?? null,
          body: input.body,
          enabled: input.enabled ?? true,
          updatedById: staff.id,
        },
        update: {
          subject: input.subject ?? null,
          body: input.body,
          enabled: input.enabled ?? true,
          updatedById: staff.id,
        },
      });
      await this.audit.record(
        {
          action: 'notification_template.saved',
          actorId: staff.id,
          entityType: 'notification_template',
          entityId: saved.id,
          metadata: { event, channel, enabled: saved.enabled },
        },
        context,
        tx,
      );
      return saved;
    });
    return this.templateDto(row);
  }

  async deliveries(query: {
    page: number;
    pageSize: number;
    channel?: NotificationChannel;
    status?: 'SENT' | 'SKIPPED' | 'FAILED';
    event?: string;
  }): Promise<NotificationDeliveryList> {
    const where: Prisma.NotificationDeliveryWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.event ? { notificationEvent: { event: query.event } } : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.findMany({
        where,
        include: { notificationEvent: { select: { event: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notificationDelivery.count({ where }),
    ]);
    return {
      items: rows.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        event: d.notificationEvent.event,
        channel: d.channel,
        status: d.status,
        destination: d.destination,
        provider: d.provider,
        detail: d.detail,
        createdAt: d.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}
