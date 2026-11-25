import type { Readable } from 'node:stream';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { FilePurpose } from '@marketplace/database';
import {
  type AuthenticatedUser,
  MAX_PRODUCT_IMAGES,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_EDGE,
  PRODUCT_IMAGE_MIN_EDGE,
  PRODUCT_IMAGE_THUMBNAIL_EDGE,
} from '@marketplace/shared-types';
import type { ProductDetail } from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { type ProcessedImage, processImage } from '../files/image-processor';
import { ProductsService } from './products.service';

export interface ImageUpload {
  buffer: Buffer;
  originalName: string;
}

const imageNotFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Image not found.');

/**
 * Product photos. Each upload is validated (extension, real type, size, dimensions),
 * re-encoded as an optimised WebP with a thumbnail, and stored in object storage. Adding or
 * replacing a photo of an approved product sends it back to review.
 */
@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async add(
    user: AuthenticatedUser,
    productId: string,
    upload: ImageUpload,
    options: { altText?: string | null; variantId?: string | null },
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.products.assertCanEdit(user);
    const product = await this.products.findOwn(sellerId, productId);
    if (product.status === 'ARCHIVED') this.archived();
    if (options.variantId) await this.assertVariant(productId, options.variantId);
    const count = await this.prisma.productImage.count({ where: { productId } });
    if (count >= MAX_PRODUCT_IMAGES) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        `A product can have at most ${MAX_PRODUCT_IMAGES} photos.`,
      );
    }
    const stored = await this.store(await this.process(upload), product.slug);
    try {
      await this.prisma.$transaction(async (tx) => {
        const last = await tx.productImage.aggregate({
          where: { productId },
          _max: { position: true },
        });
        const image = await tx.productImage.create({
          data: {
            productId,
            variantId: options.variantId ?? null,
            fileId: stored.fileId,
            thumbnailFileId: stored.thumbnailFileId,
            altText: options.altText ?? null,
            position: (last._max.position ?? -1) + 1,
            width: stored.width,
            height: stored.height,
          },
        });
        await this.products.contentChanged(tx, product, user.id);
        await this.audit.record(
          {
            action: 'product.image_added',
            actorId: user.id,
            entityType: 'product',
            entityId: productId,
            metadata: { imageId: image.id },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      await this.discard(stored);
      throw error;
    }
    return this.products.get(user, productId);
  }

  async replace(
    user: AuthenticatedUser,
    productId: string,
    imageId: string,
    upload: ImageUpload,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.products.assertCanEdit(user);
    const product = await this.products.findOwn(sellerId, productId);
    if (product.status === 'ARCHIVED') this.archived();
    const image = await this.findImage(productId, imageId);
    const stored = await this.store(await this.process(upload), product.slug);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productImage.update({
          where: { id: imageId },
          data: {
            fileId: stored.fileId,
            thumbnailFileId: stored.thumbnailFileId,
            width: stored.width,
            height: stored.height,
          },
        });
        await this.products.contentChanged(tx, product, user.id);
        await this.audit.record(
          {
            action: 'product.image_replaced',
            actorId: user.id,
            entityType: 'product',
            entityId: productId,
            metadata: { imageId },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      await this.discard(stored);
      throw error;
    }
    await this.discard({ fileId: image.fileId, thumbnailFileId: image.thumbnailFileId });
    return this.products.get(user, productId);
  }

  async update(
    user: AuthenticatedUser,
    productId: string,
    imageId: string,
    input: { altText?: string | null; variantId?: string | null },
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.products.assertCanEdit(user);
    await this.products.findOwn(sellerId, productId);
    await this.findImage(productId, imageId);
    if (input.variantId) await this.assertVariant(productId, input.variantId);
    await this.prisma.productImage.update({
      where: { id: imageId },
      data: {
        ...(input.altText !== undefined ? { altText: input.altText } : {}),
        ...(input.variantId !== undefined ? { variantId: input.variantId } : {}),
      },
    });
    await this.audit.record(
      {
        action: 'product.image_updated',
        actorId: user.id,
        entityType: 'product',
        entityId: productId,
        metadata: { imageId },
      },
      context,
    );
    return this.products.get(user, productId);
  }

  /** The first photo is the main one. `imageIds` must list every photo of the product once. */
  async reorder(
    user: AuthenticatedUser,
    productId: string,
    imageIds: string[],
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.products.assertCanEdit(user);
    await this.products.findOwn(sellerId, productId);
    const images = await this.prisma.productImage.findMany({
      where: { productId },
      select: { id: true },
    });
    const current = new Set(images.map((i) => i.id));
    if (
      imageIds.length !== current.size ||
      new Set(imageIds).size !== imageIds.length ||
      !imageIds.every((id) => current.has(id))
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'List every photo of the product exactly once.',
        [{ path: 'imageIds', message: 'Must contain each photo once' }],
      );
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [position, id] of imageIds.entries()) {
        await tx.productImage.update({ where: { id }, data: { position } });
      }
      await this.audit.record(
        {
          action: 'product.images_reordered',
          actorId: user.id,
          entityType: 'product',
          entityId: productId,
        },
        context,
        tx,
      );
    });
    return this.products.get(user, productId);
  }

  async remove(
    user: AuthenticatedUser,
    productId: string,
    imageId: string,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.products.assertCanEdit(user);
    await this.products.findOwn(sellerId, productId);
    const image = await this.findImage(productId, imageId);
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });
      // Close the gap so positions stay 0..n-1.
      const rest = await tx.productImage.findMany({
        where: { productId },
        orderBy: { position: 'asc' },
      });
      for (const [position, row] of rest.entries()) {
        if (row.position !== position)
          await tx.productImage.update({ where: { id: row.id }, data: { position } });
      }
      await this.audit.record(
        {
          action: 'product.image_removed',
          actorId: user.id,
          entityType: 'product',
          entityId: productId,
          metadata: { imageId },
        },
        context,
        tx,
      );
    });
    await this.discard({ fileId: image.fileId, thumbnailFileId: image.thumbnailFileId });
    return this.products.get(user, productId);
  }

  /** Public: photos are served by id (unguessable UUIDs), large or thumbnail. */
  async open(
    imageId: string,
    size: 'large' | 'thumbnail',
  ): Promise<{ contentType: string; sizeBytes: number; body: Readable }> {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw imageNotFound();
    const { file, body } = await this.files.openContent(
      size === 'large' ? image.fileId : image.thumbnailFileId,
      size === 'large' ? FilePurpose.PRODUCT_IMAGE : FilePurpose.PRODUCT_IMAGE_THUMBNAIL,
    );
    return { contentType: file.contentType, sizeBytes: file.sizeBytes, body };
  }

  private process(upload: ImageUpload): Promise<ProcessedImage> {
    return processImage(upload.buffer, upload.originalName, {
      maxBytes: Math.min(PRODUCT_IMAGE_MAX_BYTES, this.config.storage.uploadMaxBytes),
      minEdge: PRODUCT_IMAGE_MIN_EDGE,
      maxEdge: PRODUCT_IMAGE_MAX_EDGE,
      thumbnailEdge: PRODUCT_IMAGE_THUMBNAIL_EDGE,
    });
  }

  private async store(processed: ProcessedImage, slug: string) {
    const main = await this.files.upload({
      buffer: processed.main,
      originalName: `${slug}.webp`,
      purpose: FilePurpose.PRODUCT_IMAGE,
    });
    try {
      const thumbnail = await this.files.upload({
        buffer: processed.thumbnail,
        originalName: `${slug}-thumbnail.webp`,
        purpose: FilePurpose.PRODUCT_IMAGE_THUMBNAIL,
      });
      return {
        fileId: main.id,
        thumbnailFileId: thumbnail.id,
        width: processed.width,
        height: processed.height,
      };
    } catch (error) {
      await this.files.delete(main.id, FilePurpose.PRODUCT_IMAGE).catch(() => undefined);
      throw error;
    }
  }

  private async discard(files: { fileId: string; thumbnailFileId: string }) {
    await Promise.all([
      this.files.delete(files.fileId, FilePurpose.PRODUCT_IMAGE),
      this.files.delete(files.thumbnailFileId, FilePurpose.PRODUCT_IMAGE_THUMBNAIL),
    ]).catch((error: unknown) =>
      this.logger.warn(`Could not delete image files: ${(error as Error).message}`),
    );
  }

  private async findImage(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!image) throw imageNotFound();
    return image;
  }

  private async assertVariant(productId: string, variantId: string) {
    const exists = await this.prisma.productVariant.count({ where: { id: variantId, productId } });
    if (!exists) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Unknown variant.',
        [{ path: 'variantId', message: 'Choose a variant of this product' }],
      );
    }
  }

  private archived(): never {
    throw new ApiException(
      HttpStatus.CONFLICT,
      'CONFLICT',
      'Restore the product before editing it.',
    );
  }
}
