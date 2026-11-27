import { HttpStatus, Injectable } from '@nestjs/common';
import {
  emitNotificationInTx,
  FilePurpose,
  type Prisma,
  sellerRecipientIdsInTx,
} from '@marketplace/database';
import {
  type AuthenticatedUser,
  hasPermission,
  MAX_SUPPORT_ATTACHMENTS,
  type PaginatedResponse,
  SUPPORT_TICKET_STATUS_LABELS,
  type SupportTicketStatus,
} from '@marketplace/shared-types';
import {
  createTicketSchema,
  type TicketActionRequest,
  type TicketDetail,
  type TicketMessageInput,
  type TicketSummary,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { randomCode } from '../engagement/loyalty.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';

type Tx = Prisma.TransactionClient;
export const MAX_SUPPORT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Who is looking at tickets, and what they may do (ADR 0034). */
export type SupportViewer =
  | { kind: 'CUSTOMER'; user: AuthenticatedUser }
  | { kind: 'SELLER'; user: AuthenticatedUser; sellerId: string }
  | { kind: 'STAFF'; user: AuthenticatedUser; canManage: boolean };

export interface Upload {
  buffer: Buffer;
  originalName: string;
}

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ticket not found.');
const forbidden = (message: string) => new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);

const include = {
  customer: { select: { id: true, firstName: true, lastName: true } },
  seller: { select: { stores: { select: { id: true, name: true }, take: 1 } } },
  order: { select: { orderNumber: true } },
  sellerOrder: { select: { number: true, store: { select: { id: true, name: true } } } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SupportTicketInclude;
type TicketRow = Prisma.SupportTicketGetPayload<{ include: typeof include }>;

const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const CLOSED: SupportTicketStatus[] = ['CLOSED'];

/**
 * Customer support (ADR 0034). Order tickets go to that order's seller; support staff can
 * read every ticket (support.read), and join, take over, assign and answer (support.manage).
 * General inquiries go straight to marketplace support. Messages are append-only; internal
 * notes are for the seller team and staff only. Access is checked on every read and write.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The tickets a viewer may see. */
  private scope(viewer: SupportViewer): Prisma.SupportTicketWhereInput {
    if (viewer.kind === 'CUSTOMER') return { customerId: viewer.user.id };
    if (viewer.kind === 'SELLER') return { sellerId: viewer.sellerId };
    return {};
  }

  private summary(t: TicketRow): TicketSummary {
    return {
      id: t.id,
      number: t.number,
      subject: t.subject,
      category: t.category,
      status: t.status,
      priority: t.priority,
      customer: { id: t.customer.id, name: name(t.customer) },
      store: t.sellerOrder?.store ?? t.seller?.stores[0] ?? null,
      orderNumber: t.order?.orderNumber ?? null,
      sellerOrderNumber: t.sellerOrder?.number ?? null,
      assignedTo: t.assignedTo ? { id: t.assignedTo.id, name: name(t.assignedTo) } : null,
      supportJoined: t.supportJoinedAt !== null,
      lastMessageAt: t.lastMessageAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
    };
  }

  async list(
    viewer: SupportViewer,
    query: {
      page: number;
      pageSize: number;
      status?: SupportTicketStatus;
      open?: 'true' | 'false';
      category?: TicketRow['category'];
      sellerId?: string;
      assigned?: 'me' | 'none';
      search?: string;
    },
  ): Promise<PaginatedResponse<TicketSummary>> {
    const where: Prisma.SupportTicketWhereInput = {
      ...this.scope(viewer),
      ...(query.status ? { status: query.status } : {}),
      ...(query.open === 'true' ? { status: { notIn: ['RESOLVED', 'CLOSED'] } } : {}),
      ...(query.open === 'false' ? { status: { in: ['RESOLVED', 'CLOSED'] } } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(viewer.kind === 'STAFF' && query.sellerId ? { sellerId: query.sellerId } : {}),
      ...(viewer.kind === 'STAFF' && query.assigned === 'me'
        ? { assignedToId: viewer.user.id }
        : {}),
      ...(viewer.kind === 'STAFF' && query.assigned === 'none' ? { assignedToId: null } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search.toUpperCase() } },
              { subject: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        include,
        orderBy: { lastMessageAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return {
      items: rows.map((t) => this.summary(t)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  private async load(viewer: SupportViewer, id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, ...this.scope(viewer) },
      include,
    });
    if (!ticket) throw notFound();
    return ticket;
  }

  private can(viewer: SupportViewer, t: TicketRow): TicketDetail['can'] {
    const closed = CLOSED.includes(t.status);
    const resolved = t.status === 'RESOLVED';
    const staffManage = viewer.kind === 'STAFF' && viewer.canManage;
    const participant = viewer.kind !== 'STAFF' || staffManage;
    return {
      reply: participant && !closed,
      internalNote: (viewer.kind === 'SELLER' || staffManage) && !closed,
      resolve: participant && !closed && !resolved,
      close: (viewer.kind === 'CUSTOMER' || staffManage) && !closed,
      reopen: (viewer.kind === 'CUSTOMER' || staffManage) && (closed || resolved),
      join: staffManage && t.sellerId !== null && t.supportJoinedAt === null,
      takeOver: staffManage && t.sellerId !== null && t.assignedToId === null,
      assign: staffManage,
    };
  }

  async get(viewer: SupportViewer, id: string): Promise<TicketDetail> {
    const ticket = await this.load(viewer, id);
    const messages = await this.prisma.supportMessage.findMany({
      where: { ticketId: id, ...(viewer.kind === 'CUSTOMER' ? { internal: false } : {}) },
      include: {
        author: { select: { firstName: true, lastName: true } },
        attachments: {
          include: {
            file: { select: { originalName: true, contentType: true, sizeBytes: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...this.summary(ticket),
      messages: messages.map((m) => ({
        id: m.id,
        authorRole: m.authorRole,
        authorName:
          m.authorRole === 'SUPPORT'
            ? viewer.kind === 'STAFF' && m.author
              ? name(m.author)
              : 'Marketplace support'
            : m.authorRole === 'SELLER'
              ? (ticket.sellerOrder?.store.name ?? ticket.seller?.stores[0]?.name ?? 'Seller')
              : m.authorRole === 'SYSTEM'
                ? 'System'
                : name(ticket.customer),
        body: m.body,
        internal: m.internal,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          name: a.file.originalName,
          contentType: a.file.contentType,
          sizeBytes: Number(a.file.sizeBytes),
        })),
        createdAt: m.createdAt.toISOString(),
      })),
      can: this.can(viewer, ticket),
    };
  }

  private async store(uploads: Upload[]): Promise<string[]> {
    if (uploads.length > MAX_SUPPORT_ATTACHMENTS)
      throw invalid('attachments', `At most ${MAX_SUPPORT_ATTACHMENTS} files per message.`);
    const ids: string[] = [];
    try {
      for (const upload of uploads) {
        if (upload.buffer.length > MAX_SUPPORT_ATTACHMENT_BYTES)
          throw invalid('attachments', 'Each file can be at most 5 MB.');
        // The content type is detected from the bytes (images and PDF only).
        const file = await this.files.upload({
          buffer: upload.buffer,
          originalName: upload.originalName.slice(-120),
          purpose: FilePurpose.SUPPORT_ATTACHMENT,
        });
        ids.push(file.id);
      }
    } catch (error) {
      for (const id of ids)
        await this.files.delete(id, FilePurpose.SUPPORT_ATTACHMENT).catch(() => undefined);
      throw error;
    }
    return ids;
  }

  private async notify(
    tx: Tx,
    ticket: {
      id: string;
      number: string;
      subject: string;
      customerId: string;
      sellerId: string | null;
    },
    to: 'customer' | 'seller',
    summary: string,
  ) {
    const userIds =
      to === 'customer'
        ? [ticket.customerId]
        : ticket.sellerId
          ? await sellerRecipientIdsInTx(tx, ticket.sellerId)
          : [];
    await emitNotificationInTx(tx, {
      event: 'SUPPORT_TICKET_UPDATED',
      userIds,
      data: {
        audience: to,
        ticketNumber: ticket.number,
        subject: ticket.subject,
        summary,
      },
      link: to === 'customer' ? `/account/support/${ticket.id}` : `/support/${ticket.id}`,
    });
  }

  /** A customer opens a ticket: about one store's part of an order (to that seller) or general. */
  async create(user: AuthenticatedUser, data: string, uploads: Upload[]): Promise<TicketDetail> {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'BAD_REQUEST',
        'The "data" field must be JSON.',
      );
    }
    const parsed = createTicketSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Check the ticket details.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const input = parsed.data;
    const so = input.sellerOrderId
      ? await this.prisma.sellerOrder.findFirst({
          where: { id: input.sellerOrderId, order: { customerId: user.id } },
          select: { id: true, orderId: true, sellerId: true },
        })
      : null;
    if (input.sellerOrderId && !so) throw invalid('sellerOrderId', 'Choose one of your orders.');
    const fileIds = await this.store(uploads);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const ticket = await tx.supportTicket.create({
          data: {
            number: randomCode(10, 'TK'),
            customerId: user.id,
            sellerId: so?.sellerId ?? null,
            orderId: so?.orderId ?? null,
            sellerOrderId: so?.id ?? null,
            subject: input.subject,
            category: input.category,
            status: so ? 'AWAITING_SELLER' : 'AWAITING_SUPPORT',
          },
        });
        const message = await tx.supportMessage.create({
          data: {
            ticketId: ticket.id,
            authorId: user.id,
            authorRole: 'CUSTOMER',
            body: input.body,
          },
        });
        if (fileIds.length > 0) {
          await tx.supportAttachment.createMany({
            data: fileIds.map((fileId) => ({ ticketId: ticket.id, messageId: message.id, fileId })),
          });
        }
        if (so) await this.notify(tx, ticket, 'seller', `New ticket: ${input.subject}`);
        return ticket.id;
      });
      await this.notifications.kickDispatch();
      return this.get({ kind: 'CUSTOMER', user }, id);
    } catch (error) {
      for (const fileId of fileIds)
        await this.files.delete(fileId, FilePurpose.SUPPORT_ATTACHMENT).catch(() => undefined);
      throw error;
    }
  }

  async reply(
    viewer: SupportViewer,
    id: string,
    input: TicketMessageInput,
    uploads: Upload[],
  ): Promise<TicketDetail> {
    const ticket = await this.load(viewer, id);
    const can = this.can(viewer, ticket);
    if (!can.reply) {
      throw CLOSED.includes(ticket.status)
        ? conflict('This ticket is closed.')
        : forbidden('You can read this ticket but not answer it.');
    }
    const internal = input.internal ?? false;
    if (internal && !can.internalNote) throw forbidden('Customers cannot add internal notes.');
    const fileIds = await this.store(uploads);
    const role =
      viewer.kind === 'CUSTOMER' ? 'CUSTOMER' : viewer.kind === 'SELLER' ? 'SELLER' : 'SUPPORT';
    // Who has to act next. Internal notes change nothing for the customer.
    let status: SupportTicketStatus = ticket.status;
    if (!internal) {
      if (role === 'CUSTOMER')
        status = ticket.sellerId && !ticket.assignedToId ? 'AWAITING_SELLER' : 'AWAITING_SUPPORT';
      else status = 'AWAITING_CUSTOMER';
    }
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const message = await tx.supportMessage.create({
          data: {
            ticketId: id,
            authorId: viewer.user.id,
            authorRole: role,
            body: input.body,
            internal,
          },
        });
        if (fileIds.length > 0) {
          await tx.supportAttachment.createMany({
            data: fileIds.map((fileId) => ({ ticketId: id, messageId: message.id, fileId })),
          });
        }
        await tx.supportTicket.update({
          where: { id },
          data: {
            status,
            lastMessageAt: now,
            ...(status !== 'RESOLVED' ? { resolvedAt: null } : {}),
            ...(role === 'SUPPORT' && !ticket.supportJoinedAt ? { supportJoinedAt: now } : {}),
          },
        });
        if (!internal) {
          if (role === 'CUSTOMER') {
            if (ticket.sellerId && !ticket.assignedToId)
              await this.notify(tx, ticket, 'seller', 'The customer replied.');
          } else {
            await this.notify(
              tx,
              ticket,
              'customer',
              role === 'SELLER' ? 'The seller replied.' : 'Marketplace support replied.',
            );
          }
        }
      });
    } catch (error) {
      for (const fileId of fileIds)
        await this.files.delete(fileId, FilePurpose.SUPPORT_ATTACHMENT).catch(() => undefined);
      throw error;
    }
    await this.notifications.kickDispatch();
    return this.get(viewer, id);
  }

  async act(
    viewer: SupportViewer,
    id: string,
    input: TicketActionRequest,
    context: RequestContext,
  ): Promise<TicketDetail> {
    const ticket = await this.load(viewer, id);
    const can = this.can(viewer, ticket);
    const now = new Date();
    const deny = () => forbidden('You cannot do that on this ticket.');
    let data: Prisma.SupportTicketUpdateInput = {};
    let note: string;
    switch (input.action) {
      case 'RESOLVE':
        if (!can.resolve) throw deny();
        data = { status: 'RESOLVED', resolvedAt: now };
        note = 'Marked as resolved.';
        break;
      case 'CLOSE':
        if (!can.close) throw deny();
        data = { status: 'CLOSED', closedAt: now };
        note = 'Ticket closed.';
        break;
      case 'REOPEN':
        if (!can.reopen) throw deny();
        data = {
          status: ticket.sellerId && !ticket.assignedToId ? 'AWAITING_SELLER' : 'AWAITING_SUPPORT',
          resolvedAt: null,
          closedAt: null,
        };
        note = 'Ticket reopened.';
        break;
      case 'JOIN':
        if (!can.join) throw deny();
        data = { supportJoinedAt: now };
        note = 'Marketplace support joined the conversation.';
        break;
      case 'TAKE_OVER':
        if (!can.takeOver) throw deny();
        data = {
          supportJoinedAt: ticket.supportJoinedAt ?? now,
          assignedTo: { connect: { id: viewer.user.id } },
          ...(['AWAITING_SELLER', 'OPEN'].includes(ticket.status)
            ? { status: 'AWAITING_SUPPORT' as const }
            : {}),
        };
        note = 'Marketplace support took over this ticket.';
        break;
      case 'ASSIGN': {
        if (!can.assign) throw deny();
        if (input.assignedToId) {
          const staffUser = await this.prisma.user.findFirst({
            where: {
              id: input.assignedToId,
              status: 'ACTIVE',
              roles: {
                some: { role: { permissions: { some: { permissionCode: 'support.manage' } } } },
              },
            },
          });
          if (!staffUser) throw invalid('assignedToId', 'Choose a support team member.');
          data = {
            assignedTo: { connect: { id: input.assignedToId } },
            supportJoinedAt: ticket.supportJoinedAt ?? now,
          };
        } else data = { assignedTo: { disconnect: true } };
        note = input.assignedToId ? 'Assigned to a support agent.' : 'Unassigned.';
        break;
      }
      case 'PRIORITY':
        if (!can.assign || !input.priority) throw deny();
        data = { priority: input.priority };
        note = `Priority set to ${input.priority.toLowerCase()}.`;
        break;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id }, data });
      await tx.supportMessage.create({
        data: {
          ticketId: id,
          authorId: viewer.user.id,
          authorRole: 'SYSTEM',
          body: input.note ? `${note} ${input.note}` : note,
          // Assignment and priority are internal; status changes are shown to the customer.
          internal: ['ASSIGN', 'PRIORITY'].includes(input.action),
        },
      });
      if (
        ['RESOLVE', 'CLOSE', 'REOPEN', 'TAKE_OVER'].includes(input.action) &&
        viewer.kind !== 'CUSTOMER'
      ) {
        const status = (data.status as SupportTicketStatus | undefined) ?? ticket.status;
        await this.notify(tx, ticket, 'customer', SUPPORT_TICKET_STATUS_LABELS[status]);
      }
      if (viewer.kind === 'STAFF') {
        await this.audit.record(
          {
            action: `support.${input.action.toLowerCase()}`,
            actorId: viewer.user.id,
            entityType: 'support_ticket',
            entityId: id,
            metadata: {
              assignedToId: input.assignedToId ?? null,
              priority: input.priority ?? null,
            },
          },
          context,
          tx,
        );
      }
    });
    await this.notifications.kickDispatch();
    return this.get(viewer, id);
  }

  /** An attachment the viewer may see (never one on an internal note for customers). */
  async attachment(viewer: SupportViewer, id: string, attachmentId: string) {
    await this.load(viewer, id);
    const attachment = await this.prisma.supportAttachment.findFirst({
      where: {
        id: attachmentId,
        ticketId: id,
        ...(viewer.kind === 'CUSTOMER' ? { message: { internal: false } } : {}),
      },
    });
    if (!attachment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'File not found.');
    return this.files.openContent(attachment.fileId, FilePurpose.SUPPORT_ATTACHMENT);
  }
}

export const viewerOf = {
  customer: (user: AuthenticatedUser): SupportViewer => ({ kind: 'CUSTOMER', user }),
  seller: (user: AuthenticatedUser): SupportViewer => {
    if (!user.seller) throw forbidden('This action is for seller accounts in the Seller Center.');
    return { kind: 'SELLER', user, sellerId: user.seller.id };
  },
  staff: (user: AuthenticatedUser): SupportViewer => ({
    kind: 'STAFF',
    user,
    canManage: hasPermission(user, 'support.manage'),
  }),
};
