import type { Readable } from 'node:stream';
import { HttpStatus, Injectable } from '@nestjs/common';
import { FilePurpose, Prisma } from '@marketplace/database';
import { API_DEFAULT_VERSION } from '@marketplace/config';
import { type AuthenticatedUser, MAX_CATEGORY_DEPTH } from '@marketplace/shared-types';
import {
  type CategoryAttributeDto,
  type CategoryAttributes,
  type CategoryDto,
  type CategoryList,
  type CreateCategoryRequest,
  type PutCategoryAttributesRequest,
  slugify,
  type UpdateCategoryRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { processImage } from '../files/image-processor';
import { AppConfig } from '../../config/app-config';

const include = {
  attributes: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
  _count: { select: { children: true, products: true } },
} satisfies Prisma.CategoryInclude;
type CategoryRow = Prisma.CategoryGetPayload<{ include: typeof include }>;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Category not found.');
const slugTaken = () =>
  new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This category link is already used.', [
    { path: 'slug', message: 'Already used; choose another' },
  ]);

export function toAttributeDto(a: CategoryRow['attributes'][number]): CategoryAttributeDto {
  return {
    id: a.id,
    categoryId: a.categoryId,
    code: a.code,
    name: a.name,
    type: a.type,
    options: Array.isArray(a.options) ? (a.options as string[]) : [],
    unit: a.unit,
    isRequired: a.isRequired,
    sortOrder: a.sortOrder,
  };
}

/** The global category tree. Only marketplace staff change it; everyone can read it. */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** Every category (staff), or only active ones whose ancestors are active (everyone else). */
  async list(options: { activeOnly: boolean }): Promise<CategoryList> {
    const rows = await this.prisma.category.findMany({
      include,
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const visible = (row: CategoryRow): boolean =>
      row.status === 'ACTIVE' && (!row.parentId || visible(byId.get(row.parentId)!));
    const kept = options.activeOnly ? rows.filter(visible) : rows;
    // Parents first, children right after their parent, each level by sort order and name.
    const ordered: CategoryRow[] = [];
    const add = (parentId: string | null) => {
      for (const row of kept.filter((r) => r.parentId === parentId)) {
        ordered.push(row);
        add(row.id);
      }
    };
    add(null);
    return { categories: ordered.map((row) => this.toDto(row, byId)) };
  }

  async get(id: string): Promise<CategoryDto> {
    const rows = await this.prisma.category.findMany({ include });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const row = byId.get(id);
    if (!row) throw notFound();
    return this.toDto(row, byId);
  }

  /** The attributes a product in this category fills in: its own and every ancestor's. */
  async effectiveAttributes(categoryId: string): Promise<CategoryAttributes> {
    const chain = await this.ancestry(categoryId);
    const attributes = chain.flatMap((c) => c.attributes.map(toAttributeDto));
    return { categoryId, attributes };
  }

  /** The category and its ancestors, top level first. */
  async ancestry(categoryId: string) {
    const chain: CategoryRow[] = [];
    let id: string | null = categoryId;
    while (id) {
      const row: CategoryRow | null = await this.prisma.category.findUnique({
        where: { id },
        include,
      });
      if (!row) throw notFound();
      chain.unshift(row);
      id = row.parentId;
    }
    return chain;
  }

  async create(
    user: AuthenticatedUser,
    input: CreateCategoryRequest,
    context: RequestContext,
  ): Promise<CategoryDto> {
    let depth = 0;
    if (input.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: input.parentId } });
      if (!parent) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Invalid parent.',
          [{ path: 'parentId', message: 'Choose an existing category' }],
        );
      }
      if (parent.depth >= MAX_CATEGORY_DEPTH) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          `Categories can be nested at most ${MAX_CATEGORY_DEPTH + 1} levels deep.`,
          [{ path: 'parentId', message: 'This category cannot have subcategories' }],
        );
      }
      depth = parent.depth + 1;
    }
    const slug = input.slug ?? slugify(input.name);
    if (!slug) throw slugTaken();
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: {
            name: input.name.trim(),
            slug,
            parentId: input.parentId ?? null,
            description: input.description ?? null,
            status: input.status ?? 'ACTIVE',
            sortOrder: Number(input.sortOrder ?? 0),
            depth,
          },
        });
        await this.audit.record(
          {
            action: 'category.created',
            actorId: user.id,
            entityType: 'category',
            entityId: created.id,
            metadata: { slug, parentId: input.parentId ?? null },
          },
          context,
          tx,
        );
        return created;
      });
      return this.get(row.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw slugTaken();
      }
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCategoryRequest,
    context: RequestContext,
  ): Promise<CategoryDto> {
    await this.findOrThrow(id);
    const data = Object.fromEntries(
      Object.entries({
        name: input.name?.trim(),
        slug: input.slug,
        description: input.description,
        status: input.status,
        sortOrder: input.sortOrder,
      }).filter(([, v]) => v !== undefined),
    );
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.category.update({ where: { id }, data });
        await this.audit.record(
          {
            action: 'category.updated',
            actorId: user.id,
            entityType: 'category',
            entityId: id,
            metadata: { fields: Object.keys(data) },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw slugTaken();
      }
      throw error;
    }
    return this.get(id);
  }

  /** Only empty categories (no subcategories, no products) can be deleted; others are deactivated. */
  async remove(user: AuthenticatedUser, id: string, context: RequestContext): Promise<void> {
    const row = await this.prisma.category.findUnique({ where: { id }, include });
    if (!row) throw notFound();
    if (row._count.children > 0 || row._count.products > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Only a category without subcategories or products can be deleted. Make it inactive instead.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id } });
      await this.audit.record(
        { action: 'category.deleted', actorId: user.id, entityType: 'category', entityId: id },
        context,
        tx,
      );
    });
    if (row.imageFileId) {
      await this.files.delete(row.imageFileId, FilePurpose.CATEGORY_IMAGE).catch(() => undefined);
    }
  }

  async putAttributes(
    user: AuthenticatedUser,
    id: string,
    input: PutCategoryAttributesRequest,
    context: RequestContext,
  ): Promise<CategoryDto> {
    await this.findOrThrow(id);
    const attributes = input.attributes.map((a) => ({
      code: a.code,
      name: a.name.trim(),
      type: a.type,
      options: a.type === 'SELECT' ? (a.options ?? []) : [],
      unit: a.unit ?? null,
      isRequired: a.isRequired ?? false,
      sortOrder: Number(a.sortOrder ?? 0),
    }));
    // A code must not repeat an ancestor's code, or products would have two values for it.
    const ancestors = (await this.ancestry(id)).slice(0, -1);
    const inherited = new Set(ancestors.flatMap((c) => c.attributes.map((a) => a.code)));
    const clash = attributes.find((a) => inherited.has(a.code));
    if (clash) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        `"${clash.code}" is already an attribute of a parent category.`,
        [{ path: 'attributes', message: `"${clash.code}" is inherited from a parent category` }],
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.categoryAttribute.deleteMany({
        where: { categoryId: id, code: { notIn: attributes.map((a) => a.code) } },
      });
      for (const a of attributes) {
        await tx.categoryAttribute.upsert({
          where: { categoryId_code: { categoryId: id, code: a.code } },
          create: { categoryId: id, ...a },
          update: a,
        });
      }
      await this.audit.record(
        {
          action: 'category.attributes_updated',
          actorId: user.id,
          entityType: 'category',
          entityId: id,
          metadata: { codes: attributes.map((a) => a.code) },
        },
        context,
        tx,
      );
    });
    return this.get(id);
  }

  async setImage(
    user: AuthenticatedUser,
    id: string,
    upload: { buffer: Buffer; originalName: string },
    context: RequestContext,
  ): Promise<CategoryDto> {
    const row = await this.findOrThrow(id);
    const processed = await processImage(upload.buffer, upload.originalName, {
      maxBytes: this.config.storage.uploadMaxBytes,
      minEdge: 100,
      maxEdge: 800,
      thumbnailEdge: 200,
    });
    const file = await this.files.upload({
      buffer: processed.main,
      originalName: `${row.slug}.webp`,
      purpose: FilePurpose.CATEGORY_IMAGE,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { imageFileId: file.id } });
      await this.audit.record(
        {
          action: 'category.image_updated',
          actorId: user.id,
          entityType: 'category',
          entityId: id,
        },
        context,
        tx,
      );
    });
    if (row.imageFileId) {
      await this.files.delete(row.imageFileId, FilePurpose.CATEGORY_IMAGE).catch(() => undefined);
    }
    return this.get(id);
  }

  async removeImage(
    user: AuthenticatedUser,
    id: string,
    context: RequestContext,
  ): Promise<CategoryDto> {
    const row = await this.findOrThrow(id);
    if (row.imageFileId) {
      await this.prisma.category.update({ where: { id }, data: { imageFileId: null } });
      await this.files.delete(row.imageFileId, FilePurpose.CATEGORY_IMAGE).catch(() => undefined);
      await this.audit.record(
        {
          action: 'category.image_removed',
          actorId: user.id,
          entityType: 'category',
          entityId: id,
        },
        context,
      );
    }
    return this.get(id);
  }

  async openImage(id: string): Promise<{ contentType: string; sizeBytes: number; body: Readable }> {
    const row = await this.prisma.category.findUnique({ where: { id } });
    if (!row?.imageFileId) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No image.');
    const { file, body } = await this.files.openContent(
      row.imageFileId,
      FilePurpose.CATEGORY_IMAGE,
    );
    return { contentType: file.contentType, sizeBytes: file.sizeBytes, body };
  }

  private async findOrThrow(id: string) {
    const row = await this.prisma.category.findUnique({ where: { id } });
    if (!row) throw notFound();
    return row;
  }

  private toDto(row: CategoryRow, byId: Map<string, CategoryRow>): CategoryDto {
    const path: string[] = [];
    let cursor: CategoryRow | undefined = row;
    while (cursor) {
      path.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageUrl: row.imageFileId
        ? `/api/v${API_DEFAULT_VERSION}/categories/${row.id}/image?v=${row.imageFileId}`
        : null,
      status: row.status,
      sortOrder: row.sortOrder,
      depth: row.depth,
      path,
      childCount: row._count.children,
      productCount: row._count.products,
      attributes: row.attributes.map(toAttributeDto),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
