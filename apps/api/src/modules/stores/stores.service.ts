import type { Readable } from 'node:stream';
import { HttpStatus, Injectable } from '@nestjs/common';
import { FilePurpose, Prisma, type StoreStatus } from '@marketplace/database';
import { API_DEFAULT_VERSION } from '@marketplace/config';
import {
  type AuthenticatedUser,
  MAX_STORES_PER_SELLER,
  type PaginatedResponse,
} from '@marketplace/shared-types';
import {
  type CreateStoreRequest,
  type MyStores,
  type PublicStore,
  RESERVED_STORE_SLUGS,
  type SlugAvailability,
  type SocialLinks,
  type StoreDto,
  storeSlugSchema,
  type UpdateStoreRequest,
  type UpdateStoreSettingsRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';

const storeInclude = {
  settings: true,
  seller: { select: { id: true, businessName: true, status: true } },
} satisfies Prisma.StoreInclude;
type StoreRow = Prisma.StoreGetPayload<{ include: typeof storeInclude }>;
export type ImageKind = 'logo' | 'banner';

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Store not found.');
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
const slugTaken = () =>
  new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This store link is already taken.', [
    { path: 'slug', message: 'Already taken; try another' },
  ]);

const DEFAULT_SETTINGS = {
  primaryColor: '#1d4ed8',
  accentColor: null,
  announcement: null,
  shippingPolicy: null,
  returnPolicy: null,
  vacationMode: false,
  vacationMessage: null,
};

/** Stores belong to one seller. Sellers manage their own; staff can view all and suspend. */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  // ---- Public ----------------------------------------------------------------------------

  async slugAvailability(raw: string): Promise<SlugAvailability> {
    const parsed = storeSlugSchema.safeParse(raw);
    if (!parsed.success) {
      return { slug: raw, available: false, reason: parsed.error.issues[0]?.message ?? 'Invalid' };
    }
    const slug = parsed.data;
    if ((RESERVED_STORE_SLUGS as readonly string[]).includes(slug)) {
      return { slug, available: false, reason: 'This name is reserved' };
    }
    const taken = await this.prisma.store.count({ where: { slug } });
    return { slug, available: taken === 0, reason: taken ? 'Already taken' : null };
  }

  /** What shoppers see. Only open stores of verified sellers exist publicly. */
  async publicBySlug(slug: string): Promise<PublicStore> {
    const store = await this.prisma.store.findUnique({ where: { slug }, include: storeInclude });
    if (!store || store.status !== 'ACTIVE' || store.seller.status !== 'VERIFIED') throw notFound();
    const dto = this.toDto(store);
    const { settings } = dto;
    return {
      id: dto.id,
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      logoUrl: dto.logoUrl,
      bannerUrl: dto.bannerUrl,
      email: dto.email,
      phone: dto.phone,
      city: dto.city,
      province: dto.province,
      socialLinks: dto.socialLinks,
      sellerName: store.seller.businessName,
      settings,
    };
  }

  /** Logo and banner are public images. */
  async openImage(
    storeId: string,
    kind: ImageKind,
  ): Promise<{ contentType: string; sizeBytes: number; body: Readable }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    const fileId = kind === 'logo' ? store?.logoFileId : store?.bannerFileId;
    if (!fileId) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No image.');
    const { file, body } = await this.files.openContent(
      fileId,
      kind === 'logo' ? FilePurpose.STORE_LOGO : FilePurpose.STORE_BANNER,
    );
    return { contentType: file.contentType, sizeBytes: file.sizeBytes, body };
  }

  // ---- Seller Center ---------------------------------------------------------------------

  async mine(user: AuthenticatedUser): Promise<MyStores> {
    const scope = sellerScope(user);
    const stores = await this.prisma.store.findMany({
      where: { sellerId: scope.sellerId },
      include: storeInclude,
      orderBy: { createdAt: 'asc' },
    });
    return {
      stores: stores.map((s) => this.toDto(s)),
      canCreate:
        scope.status === 'VERIFIED' &&
        stores.length < MAX_STORES_PER_SELLER &&
        user.permissions.includes('seller.store.manage'),
    };
  }

  async create(
    user: AuthenticatedUser,
    input: CreateStoreRequest,
    context: RequestContext,
  ): Promise<StoreDto> {
    const { sellerId } = sellerScope(user);
    await this.assertSellerVerified(sellerId);
    const availability = await this.slugAvailability(input.slug);
    if (!availability.available) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Choose another store link.', [
        { path: 'slug', message: availability.reason ?? 'Not available' },
      ]);
    }
    try {
      const store = await this.prisma.$transaction(async (tx) => {
        const count = await tx.store.count({ where: { sellerId } });
        if (count >= MAX_STORES_PER_SELLER) {
          throw conflict(`A seller can have at most ${MAX_STORES_PER_SELLER} stores.`);
        }
        const row = await tx.store.create({
          data: {
            sellerId,
            ...this.storeData(input),
            name: input.name.trim(),
            slug: availability.slug,
            settings: { create: {} },
          },
          include: storeInclude,
        });
        await this.audit.record(
          {
            action: 'store.created',
            actorId: user.id,
            entityType: 'store',
            entityId: row.id,
            metadata: { sellerId, slug: row.slug },
          },
          context,
          tx,
        );
        return row;
      });
      return this.toDto(store);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw slugTaken();
      throw error;
    }
  }

  /** Seller members see their own stores; staff with stores.read see any. Others get 404. */
  async get(user: AuthenticatedUser, id: string): Promise<StoreDto> {
    return this.toDto(await this.findVisible(user, id));
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateStoreRequest,
    context: RequestContext,
  ): Promise<StoreDto> {
    const store = await this.findOwnEditable(user, id);
    const data = this.storeData(input);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.store.update({ where: { id: store.id }, data, include: storeInclude });
      await this.audit.record(
        {
          action: 'store.updated',
          actorId: user.id,
          entityType: 'store',
          entityId: store.id,
          metadata: { fields: Object.keys(data) },
        },
        context,
        tx,
      );
      return row;
    });
    return this.toDto(updated);
  }

  async updateSettings(
    user: AuthenticatedUser,
    id: string,
    input: UpdateStoreSettingsRequest,
    context: RequestContext,
  ): Promise<StoreDto> {
    const store = await this.findOwnEditable(user, id);
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    await this.prisma.$transaction(async (tx) => {
      await tx.storeSettings.upsert({
        where: { storeId: store.id },
        create: { storeId: store.id, ...data },
        update: data,
      });
      await this.audit.record(
        {
          action: 'store.settings_updated',
          actorId: user.id,
          entityType: 'store',
          entityId: store.id,
          metadata: { fields: Object.keys(data) },
        },
        context,
        tx,
      );
    });
    return this.get(user, store.id);
  }

  async setImage(
    user: AuthenticatedUser,
    id: string,
    kind: ImageKind,
    upload: { buffer: Buffer; originalName: string },
    context: RequestContext,
  ): Promise<StoreDto> {
    const store = await this.findOwnEditable(user, id);
    const purpose = kind === 'logo' ? FilePurpose.STORE_LOGO : FilePurpose.STORE_BANNER;
    const file = await this.files.upload({ ...upload, purpose });
    const previous = kind === 'logo' ? store.logoFileId : store.bannerFileId;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.store.update({
          where: { id: store.id },
          data: kind === 'logo' ? { logoFileId: file.id } : { bannerFileId: file.id },
        });
        await this.audit.record(
          {
            action: `store.${kind}_updated`,
            actorId: user.id,
            entityType: 'store',
            entityId: store.id,
          },
          context,
          tx,
        );
      });
    } catch (error) {
      await this.files.delete(file.id, purpose).catch(() => undefined);
      throw error;
    }
    if (previous) await this.files.delete(previous, purpose).catch(() => undefined);
    return this.get(user, store.id);
  }

  async removeImage(
    user: AuthenticatedUser,
    id: string,
    kind: ImageKind,
    context: RequestContext,
  ): Promise<StoreDto> {
    const store = await this.findOwnEditable(user, id);
    const previous = kind === 'logo' ? store.logoFileId : store.bannerFileId;
    if (previous) {
      await this.prisma.store.update({
        where: { id: store.id },
        data: kind === 'logo' ? { logoFileId: null } : { bannerFileId: null },
      });
      await this.files
        .delete(previous, kind === 'logo' ? FilePurpose.STORE_LOGO : FilePurpose.STORE_BANNER)
        .catch(() => undefined);
      await this.audit.record(
        {
          action: `store.${kind}_removed`,
          actorId: user.id,
          entityType: 'store',
          entityId: store.id,
        },
        context,
      );
    }
    return this.get(user, store.id);
  }

  /** Sellers open and close their stores; a suspended store stays closed until an admin acts. */
  async setOpen(
    user: AuthenticatedUser,
    id: string,
    open: boolean,
    context: RequestContext,
  ): Promise<StoreDto> {
    const store = await this.findOwnEditable(user, id);
    const status: StoreStatus = open ? 'ACTIVE' : 'INACTIVE';
    if (store.status !== status) {
      await this.prisma.$transaction(async (tx) => {
        await tx.store.update({ where: { id: store.id }, data: { status } });
        await this.audit.record(
          {
            action: open ? 'store.opened' : 'store.closed',
            actorId: user.id,
            entityType: 'store',
            entityId: store.id,
          },
          context,
          tx,
        );
      });
    }
    return this.get(user, store.id);
  }

  // ---- Administration ------------------------------------------------------------------

  async list(query: {
    page: number;
    pageSize: number;
    status?: StoreStatus;
    search?: string;
    sellerId?: string;
  }): Promise<PaginatedResponse<StoreDto>> {
    const where: Prisma.StoreWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search.toLowerCase() } },
              { seller: { businessName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.store.findMany({
        where,
        include: storeInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.store.count({ where }),
    ]);
    return {
      items: rows.map((s) => this.toDto(s)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async suspend(
    id: string,
    reason: string,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<StoreDto> {
    return this.adminStatus(id, 'SUSPENDED', reason, 'store.suspended', actor, context, (s) =>
      s === 'SUSPENDED' ? 'This store is already suspended.' : null,
    );
  }

  async reinstate(
    id: string,
    reason: string,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<StoreDto> {
    return this.adminStatus(
      id,
      'ACTIVE',
      null,
      'store.reinstated',
      actor,
      context,
      (s) => (s !== 'SUSPENDED' ? 'Only suspended stores can be reinstated.' : null),
      reason,
    );
  }

  // ---- Internals -----------------------------------------------------------------------

  private async adminStatus(
    id: string,
    status: StoreStatus,
    note: string | null,
    action: string,
    actor: AuthenticatedUser,
    context: RequestContext,
    refuse: (current: StoreStatus) => string | null,
    auditNote?: string,
  ): Promise<StoreDto> {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw notFound();
    const reason = refuse(store.status);
    if (reason) throw conflict(reason);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.store.updateMany({
        where: { id, status: store.status },
        data: { status, statusNote: note },
      });
      if (changed.count !== 1)
        throw conflict('This store was changed by someone else. Reload and try again.');
      await this.audit.record(
        {
          action,
          actorId: actor.id,
          entityType: 'store',
          entityId: id,
          metadata: { from: store.status, to: status, reason: note ?? auditNote ?? null },
        },
        context,
        tx,
      );
      return tx.store.findUniqueOrThrow({ where: { id }, include: storeInclude });
    });
    return this.toDto(updated);
  }

  private async assertSellerVerified(sellerId: string): Promise<void> {
    const seller = await this.prisma.seller.findUniqueOrThrow({
      where: { id: sellerId },
      select: { status: true },
    });
    if (seller.status !== 'VERIFIED') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        seller.status === 'SUSPENDED'
          ? 'Your seller account is suspended. Stores cannot be changed.'
          : 'Stores can be created and changed once your seller account is verified.',
      );
    }
  }

  private async findVisible(user: AuthenticatedUser, id: string): Promise<StoreRow> {
    const store = await this.prisma.store.findUnique({ where: { id }, include: storeInclude });
    const ownSeller = !!user.sellerId && store?.sellerId === user.sellerId;
    const staff = user.app === 'admin' && user.permissions.includes('stores.read');
    // 404 rather than 403: another seller's store must not even be confirmed to exist.
    if (!store || (!ownSeller && !staff)) throw notFound();
    return store;
  }

  private async findOwnEditable(user: AuthenticatedUser, id: string): Promise<StoreRow> {
    const { sellerId } = sellerScope(user);
    const store = await this.prisma.store.findFirst({
      where: { id, sellerId },
      include: storeInclude,
    });
    if (!store) throw notFound();
    await this.assertSellerVerified(sellerId);
    if (store.status === 'SUSPENDED') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'This store is suspended by the marketplace. Contact support.',
      );
    }
    return store;
  }

  /** Only the fields that were sent (undefined = leave unchanged). */
  private storeData(input: UpdateStoreRequest) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || key === 'slug') continue;
      data[key] = key === 'socialLinks' ? (value as SocialLinks) : value;
    }
    return data as Omit<Prisma.StoreUncheckedCreateInput, 'sellerId' | 'name' | 'slug'> & {
      name?: string;
    };
  }

  private imageUrl(storeId: string, kind: ImageKind, fileId: string | null): string | null {
    // Relative to the site: every frontend proxies /api. The file id busts caches on change.
    return fileId ? `/api/v${API_DEFAULT_VERSION}/stores/${storeId}/${kind}?v=${fileId}` : null;
  }

  private toDto(store: StoreRow): StoreDto {
    const settings = store.settings ?? DEFAULT_SETTINGS;
    return {
      id: store.id,
      sellerId: store.sellerId,
      sellerName: store.seller.businessName,
      name: store.name,
      slug: store.slug,
      description: store.description,
      logoUrl: this.imageUrl(store.id, 'logo', store.logoFileId),
      bannerUrl: this.imageUrl(store.id, 'banner', store.bannerFileId),
      email: store.email,
      phone: store.phone,
      addressLine1: store.addressLine1,
      addressLine2: store.addressLine2,
      barangay: store.barangay,
      city: store.city,
      province: store.province,
      postalCode: store.postalCode,
      socialLinks: (store.socialLinks ?? {}) as SocialLinks,
      status: store.status,
      statusNote: store.statusNote,
      customDomain: store.customDomain,
      settings: {
        primaryColor: settings.primaryColor,
        accentColor: settings.accentColor,
        announcement: settings.announcement,
        shippingPolicy: settings.shippingPolicy,
        returnPolicy: settings.returnPolicy,
        vacationMode: settings.vacationMode,
        vacationMessage: settings.vacationMessage,
      },
      createdAt: store.createdAt.toISOString(),
      updatedAt: store.updatedAt.toISOString(),
    };
  }
}
