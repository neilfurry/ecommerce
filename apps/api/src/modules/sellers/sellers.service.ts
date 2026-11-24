import type { Readable } from 'node:stream';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  FilePurpose,
  type Prisma,
  type SellerEventType,
  type SellerStatus,
} from '@marketplace/database';
import {
  type AuthenticatedUser,
  BUSINESS_TYPE_LABELS,
  type PaginatedResponse,
  REQUIRED_SELLER_DOCUMENTS,
  SELLER_DOCUMENT_LABELS,
  type SellerDocumentType,
} from '@marketplace/shared-types';
import type {
  ReviewSellerRequest,
  SellerDetail,
  SellerDocumentDto,
  SellerSummary,
  UpdateSellerProfile,
} from '@marketplace/validation';
import { SELLER_LEGAL_FIELDS } from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PrincipalService } from '../auth/principal.service';
import { SessionsService } from '../auth/sessions.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';

const detailInclude = {
  owner: {
    select: { id: true, firstName: true, lastName: true, email: true, emailVerifiedAt: true },
  },
  documents: {
    orderBy: { createdAt: 'asc' },
    include: {
      file: { select: { originalName: true, contentType: true, sizeBytes: true, status: true } },
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  events: {
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { firstName: true, lastName: true, id: true } } },
  },
  _count: { select: { stores: true, members: true } },
} satisfies Prisma.SellerInclude;

type SellerWithDetail = Prisma.SellerGetPayload<{ include: typeof detailInclude }>;
type Viewer = 'seller' | 'staff';

/** Profile and documents can change while the seller is preparing (or fixing) its application. */
const EDITABLE: readonly SellerStatus[] = ['PENDING', 'REJECTED'];
/** Contact details and address can be kept current after verification too. */
const CONTACT_EDITABLE: readonly SellerStatus[] = [
  'PENDING',
  'REJECTED',
  'UNDER_REVIEW',
  'VERIFIED',
];

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Seller not found.');
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/**
 * Seller registration, verification and status (Phase 2 brief §3).
 *
 * PENDING --submit--> UNDER_REVIEW --approve--> VERIFIED --suspend--> SUSPENDED --reinstate--> VERIFIED
 *                          |--reject--> REJECTED --submit--> UNDER_REVIEW
 *                          |--request info--> PENDING
 * Any status except CLOSED --close--> CLOSED
 */
@Injectable()
export class SellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly principals: PrincipalService,
    private readonly sessions: SessionsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- The seller's own account ------------------------------------------------------------

  async mine(user: AuthenticatedUser): Promise<SellerDetail> {
    return this.toDetail(await this.load(sellerScope(user).sellerId), 'seller');
  }

  async updateProfile(
    user: AuthenticatedUser,
    input: UpdateSellerProfile,
    context: RequestContext,
  ): Promise<SellerDetail> {
    const { sellerId } = sellerScope(user);
    const seller = await this.load(sellerId);
    if (!CONTACT_EDITABLE.includes(seller.status)) {
      throw conflict('This seller account can no longer be changed.');
    }
    const changedLegal = SELLER_LEGAL_FIELDS.filter(
      (field) => input[field] !== undefined && input[field] !== seller[field],
    );
    if (changedLegal.length > 0 && !EDITABLE.includes(seller.status)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        seller.status === 'UNDER_REVIEW'
          ? 'Business details cannot change while the application is being reviewed.'
          : 'Business details of a verified seller can only be changed by marketplace support.',
        changedLegal.map((path) => ({ path, message: 'Locked' })),
      );
    }
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    await this.prisma.$transaction(async (tx) => {
      await tx.seller.update({ where: { id: sellerId }, data });
      await this.audit.record(
        {
          action: 'seller.profile_updated',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: { fields: Object.keys(data) },
        },
        context,
        tx,
      );
    });
    if (data.businessName) await this.invalidateMembers(sellerId);
    return this.mine(user);
  }

  async uploadDocument(
    user: AuthenticatedUser,
    upload: {
      buffer: Buffer;
      originalName: string;
      type: SellerDocumentType;
      description?: string | null;
    },
    context: RequestContext,
  ): Promise<SellerDocumentDto> {
    const { sellerId } = sellerScope(user);
    const seller = await this.prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
    if (!EDITABLE.includes(seller.status)) {
      throw conflict(
        seller.status === 'UNDER_REVIEW'
          ? 'Documents cannot change while the application is being reviewed.'
          : 'Documents can only be added while preparing the application.',
      );
    }
    const count = await this.prisma.sellerDocument.count({ where: { sellerId } });
    if (count >= 20) throw conflict('A seller can keep at most 20 documents. Remove one first.');

    const file = await this.files.upload({
      buffer: upload.buffer,
      originalName: upload.originalName,
      purpose: FilePurpose.SELLER_DOCUMENT,
    });
    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const row = await tx.sellerDocument.create({
          data: {
            sellerId,
            type: upload.type,
            description: upload.description ?? null,
            fileId: file.id,
            uploadedById: user.id,
          },
          include: {
            file: {
              select: { originalName: true, contentType: true, sizeBytes: true, status: true },
            },
            uploadedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });
        await this.audit.record(
          {
            action: 'seller.document_uploaded',
            actorId: user.id,
            entityType: 'seller',
            entityId: sellerId,
            metadata: { documentId: row.id, type: upload.type, contentType: file.contentType },
          },
          context,
          tx,
        );
        return row;
      });
      return this.toDocument(document);
    } catch (error) {
      await this.files.delete(file.id, FilePurpose.SELLER_DOCUMENT).catch(() => undefined);
      throw error;
    }
  }

  async deleteDocument(
    user: AuthenticatedUser,
    documentId: string,
    context: RequestContext,
  ): Promise<void> {
    const { sellerId } = sellerScope(user);
    const document = await this.prisma.sellerDocument.findFirst({
      where: { id: documentId, sellerId },
      include: { seller: { select: { status: true } } },
    });
    if (!document) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Document not found.');
    if (!EDITABLE.includes(document.seller.status)) {
      throw conflict('Documents cannot be removed after submission.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.sellerDocument.delete({ where: { id: documentId } });
      await this.audit.record(
        {
          action: 'seller.document_deleted',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: { documentId, type: document.type },
        },
        context,
        tx,
      );
    });
    await this.files.delete(document.fileId, FilePurpose.SELLER_DOCUMENT).catch(() => undefined);
  }

  async submit(user: AuthenticatedUser, context: RequestContext): Promise<SellerDetail> {
    const { sellerId } = sellerScope(user);
    const seller = await this.load(sellerId);
    if (!EDITABLE.includes(seller.status)) {
      throw conflict(
        seller.status === 'UNDER_REVIEW'
          ? 'The application is already being reviewed.'
          : 'This application cannot be submitted again.',
      );
    }
    const missing = this.missingForSubmission(seller);
    if (missing.length > 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Complete the application before submitting it.',
        missing.map((message) => ({ path: 'application', message })),
      );
    }
    await this.transition(seller, 'SUBMITTED', 'UNDER_REVIEW', null, user.id, context, {
      submittedAt: new Date(),
      statusNote: null,
    });
    return this.mine(user);
  }

  /** Streams a document to the seller's own members, or to staff with sellers.read. */
  async openDocument(
    user: AuthenticatedUser,
    sellerId: string,
    documentId: string,
    context: RequestContext,
  ): Promise<{ fileName: string; contentType: string; sizeBytes: number; body: Readable }> {
    const document = await this.prisma.sellerDocument.findFirst({
      where: { id: documentId, sellerId },
    });
    if (!document) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Document not found.');
    const { file, body } = await this.files.openContent(
      document.fileId,
      FilePurpose.SELLER_DOCUMENT,
    );
    // Staff access to a seller's private documents is itself recorded.
    if (user.sellerId !== sellerId) {
      await this.audit.record(
        {
          action: 'seller.document_viewed',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: { documentId, type: document.type },
        },
        context,
      );
    }
    return {
      fileName: file.originalName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      body,
    };
  }

  // ---- Administration ------------------------------------------------------------------------

  async list(query: {
    page: number;
    pageSize: number;
    status?: SellerStatus;
    search?: string;
  }): Promise<PaginatedResponse<SellerSummary>> {
    const where: Prisma.SellerWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { businessName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search.toLowerCase() } },
              { owner: { email: { contains: query.search.toLowerCase() } } },
              { registrationNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // Applications waiting for review: oldest first. Everything else: newest first.
    const orderBy: Prisma.SellerOrderByWithRelationInput[] =
      query.status === 'UNDER_REVIEW'
        ? [{ submittedAt: 'asc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.seller.findMany({
        where,
        include: { owner: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.seller.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toSummary(row)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async detail(id: string): Promise<SellerDetail> {
    return this.toDetail(await this.load(id), 'staff');
  }

  async review(
    id: string,
    input: ReviewSellerRequest,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<SellerDetail> {
    const seller = await this.load(id);
    if (seller.status !== 'UNDER_REVIEW') {
      throw conflict('Only applications under review can be decided.');
    }
    const now = new Date();
    const note = input.note?.trim() || null;
    if (input.decision === 'APPROVE') {
      await this.transition(seller, 'APPROVED', 'VERIFIED', note, actor.id, context, {
        reviewedAt: now,
        reviewedById: actor.id,
        verifiedAt: now,
        statusNote: null,
      });
    } else if (input.decision === 'REJECT') {
      await this.transition(seller, 'REJECTED', 'REJECTED', note, actor.id, context, {
        reviewedAt: now,
        reviewedById: actor.id,
        statusNote: note,
      });
    } else {
      await this.transition(seller, 'INFO_REQUESTED', 'PENDING', note, actor.id, context, {
        reviewedAt: now,
        reviewedById: actor.id,
        statusNote: note,
      });
    }
    return this.detail(id);
  }

  async suspend(id: string, reason: string, actor: AuthenticatedUser, context: RequestContext) {
    const seller = await this.load(id);
    if (seller.status !== 'VERIFIED') throw conflict('Only verified sellers can be suspended.');
    await this.transition(seller, 'SUSPENDED', 'SUSPENDED', reason, actor.id, context, {
      suspendedAt: new Date(),
      statusNote: reason,
    });
    return this.detail(id);
  }

  async reinstate(id: string, note: string, actor: AuthenticatedUser, context: RequestContext) {
    const seller = await this.load(id);
    if (seller.status !== 'SUSPENDED') throw conflict('Only suspended sellers can be reinstated.');
    await this.transition(seller, 'REINSTATED', 'VERIFIED', note, actor.id, context, {
      suspendedAt: null,
      statusNote: null,
    });
    return this.detail(id);
  }

  /** Closing is permanent: stores close and every employee is signed out of the Seller Center. */
  async close(id: string, reason: string, actor: AuthenticatedUser, context: RequestContext) {
    const seller = await this.load(id);
    if (seller.status === 'CLOSED') throw conflict('This seller is already closed.');
    await this.transition(seller, 'CLOSED', 'CLOSED', reason, actor.id, context, {
      closedAt: new Date(),
      statusNote: reason,
    });
    await this.prisma.store.updateMany({
      where: { sellerId: id, status: 'ACTIVE' },
      data: { status: 'INACTIVE' },
    });
    const members = await this.prisma.sellerMember.findMany({
      where: { sellerId: id },
      select: { userId: true },
    });
    for (const member of members) {
      await this.sessions.revokeAllForUser(member.userId, 'SELLER_MEMBERSHIP_ENDED');
    }
    return this.detail(id);
  }

  // ---- Internals -----------------------------------------------------------------------------

  private async load(id: string): Promise<SellerWithDetail> {
    const seller = await this.prisma.seller.findUnique({ where: { id }, include: detailInclude });
    if (!seller) throw notFound();
    return seller;
  }

  /**
   * Changes status with a compare-and-set on the previous status (two admins acting at once
   * cannot both succeed), records the event and the audit entry, refreshes every member's
   * cached permissions and emails the owner.
   */
  private async transition(
    seller: SellerWithDetail,
    event: SellerEventType,
    to: SellerStatus,
    note: string | null,
    actorId: string,
    context: RequestContext,
    data: Prisma.SellerUncheckedUpdateManyInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.seller.updateMany({
        where: { id: seller.id, status: seller.status },
        data: { ...data, status: to },
      });
      if (updated.count !== 1)
        throw conflict('This seller was changed by someone else. Reload and try again.');
      await tx.sellerEvent.create({
        data: {
          sellerId: seller.id,
          type: event,
          fromStatus: seller.status,
          toStatus: to,
          note,
          actorId,
        },
      });
      await this.audit.record(
        {
          action: `seller.${event.toLowerCase()}`,
          actorId,
          entityType: 'seller',
          entityId: seller.id,
          metadata: { from: seller.status, to, ...(note ? { note } : {}) },
        },
        context,
        tx,
      );
    });
    await this.invalidateMembers(seller.id);
    await this.notifications.safely('seller status email', () =>
      this.notifications.sendSellerStatus({
        to: seller.owner.email,
        firstName: seller.owner.firstName,
        businessName: seller.businessName,
        event: event as 'SUBMITTED',
        note,
        link: `${this.config.appUrls.seller}/verification`,
      }),
    );
  }

  private async invalidateMembers(sellerId: string): Promise<void> {
    const members = await this.prisma.sellerMember.findMany({
      where: { sellerId },
      select: { userId: true },
    });
    await this.principals.invalidateUsers(members.map((m) => m.userId));
  }

  private missingForSubmission(seller: SellerWithDetail): string[] {
    const missing: string[] = [];
    if (!seller.owner.emailVerifiedAt)
      missing.push('Confirm your email address (check your inbox for the link).');
    if (!seller.addressLine1 || !seller.city || !seller.province || !seller.postalCode) {
      missing.push('Add the business address.');
    }
    if (!seller.registrationNumber) {
      missing.push(`Add the ${BUSINESS_TYPE_LABELS[seller.businessType].registry}.`);
    }
    if (!seller.tin) missing.push('Add the BIR TIN.');
    const uploaded = new Set(seller.documents.map((d) => d.type));
    for (const type of REQUIRED_SELLER_DOCUMENTS) {
      if (!uploaded.has(type)) missing.push(`Upload: ${SELLER_DOCUMENT_LABELS[type]}.`);
    }
    return missing;
  }

  private toSummary(
    seller: Prisma.SellerGetPayload<{
      include: { owner: { select: { id: true; firstName: true; lastName: true; email: true } } };
    }>,
  ): SellerSummary {
    return {
      id: seller.id,
      status: seller.status,
      businessName: seller.businessName,
      businessType: seller.businessType,
      owner: { id: seller.owner.id, name: name(seller.owner), email: seller.owner.email },
      email: seller.email,
      mobile: seller.mobile,
      city: seller.city,
      province: seller.province,
      submittedAt: seller.submittedAt?.toISOString() ?? null,
      createdAt: seller.createdAt.toISOString(),
    };
  }

  private toDocument(document: SellerWithDetail['documents'][number]): SellerDocumentDto {
    return {
      id: document.id,
      type: document.type,
      description: document.description,
      fileName: document.file.originalName,
      contentType: document.file.contentType,
      sizeBytes: Number(document.file.sizeBytes),
      uploadedBy: { id: document.uploadedBy.id, name: name(document.uploadedBy) },
      createdAt: document.createdAt.toISOString(),
    };
  }

  private toDetail(seller: SellerWithDetail, viewer: Viewer): SellerDetail {
    const memberIds = new Set([seller.ownerId]);
    return {
      ...this.toSummary(seller),
      addressLine1: seller.addressLine1,
      addressLine2: seller.addressLine2,
      barangay: seller.barangay,
      postalCode: seller.postalCode,
      registrationNumber: seller.registrationNumber,
      tin: seller.tin,
      vatRegistered: seller.vatRegistered,
      statusNote: seller.statusNote,
      reviewedAt: seller.reviewedAt?.toISOString() ?? null,
      verifiedAt: seller.verifiedAt?.toISOString() ?? null,
      documents: seller.documents
        .filter((d) => d.file.status === 'AVAILABLE')
        .map((d) => this.toDocument(d)),
      events: seller.events.map((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        // Sellers see "Marketplace team" for staff decisions, never staff names.
        actor: !event.actor
          ? null
          : viewer === 'staff' ||
              memberIds.has(event.actor.id) ||
              event.type === 'SUBMITTED' ||
              event.type === 'REGISTERED'
            ? name(event.actor)
            : 'Marketplace team',
        createdAt: event.createdAt.toISOString(),
      })),
      missingForSubmission: EDITABLE.includes(seller.status)
        ? this.missingForSubmission(seller)
        : [],
      legalDetailsEditable: EDITABLE.includes(seller.status),
      storeCount: seller._count.stores,
      memberCount: seller._count.members,
    };
  }
}
