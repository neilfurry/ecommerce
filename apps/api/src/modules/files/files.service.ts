import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { FilePurpose, FileStatus, type StoredFile } from '@marketplace/database';
import type { PaginatedResponse } from '@marketplace/shared-types';
import type { SignedUrlResponse, StoredFileDto } from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ObjectStorage } from '../../infrastructure/storage/object-storage';
import { detectFileType } from './detect-file-type';

/** Content types accepted per purpose. Each upload feature declares its own list. */
export const ALLOWED_CONTENT_TYPES: Record<FilePurpose, readonly string[]> = {
  [FilePurpose.DEV_TEST]: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
  ],
  // Scans and photos of permits, certificates and IDs.
  [FilePurpose.SELLER_DOCUMENT]: ['application/pdf', 'image/jpeg', 'image/png'],
  [FilePurpose.STORE_LOGO]: ['image/png', 'image/jpeg', 'image/webp'],
  [FilePurpose.STORE_BANNER]: ['image/png', 'image/jpeg', 'image/webp'],
  // Always our own re-encoded WebP output (see image-processor.ts).
  [FilePurpose.PRODUCT_IMAGE]: ['image/webp'],
  [FilePurpose.PRODUCT_IMAGE_THUMBNAIL]: ['image/webp'],
  [FilePurpose.CATEGORY_IMAGE]: ['image/webp'],
};

export interface UploadFileInput {
  buffer: Buffer;
  originalName: string;
  purpose: FilePurpose;
}

/** Keeps the display name only: no directories, control characters or excessive length. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  const cleaned = base.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return (cleaned || 'file').slice(0, 255);
}

export function toStoredFileDto(file: StoredFile): StoredFileDto {
  return {
    id: file.id,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: Number(file.sizeBytes),
    checksumSha256: file.checksumSha256,
    purpose: file.purpose,
    status: file.status,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

/**
 * Stores files in object storage and their metadata in PostgreSQL, keeping both in step.
 * Every upload feature (product images, seller documents...) goes through this service.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly config: AppConfig,
  ) {}

  async upload({ buffer, originalName, purpose }: UploadFileInput): Promise<StoredFileDto> {
    if (buffer.length === 0) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', 'The file is empty.');
    }
    if (buffer.length > this.config.storage.uploadMaxBytes) {
      throw new ApiException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'PAYLOAD_TOO_LARGE',
        `Files may be at most ${Math.floor(this.config.storage.uploadMaxBytes / 1024 / 1024)} MB.`,
      );
    }
    const allowed = ALLOWED_CONTENT_TYPES[purpose] ?? [];
    const detected = detectFileType(buffer);
    if (!detected || !allowed.includes(detected.mime)) {
      throw new ApiException(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'UNSUPPORTED_MEDIA_TYPE',
        `Unsupported file type. Allowed: ${allowed.join(', ')}.`,
      );
    }

    const displayName = sanitizeFileName(originalName);
    const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
    const now = new Date();
    const objectKey = [
      purpose.toLowerCase().replace(/_/g, '-'),
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${detected.extension}`,
    ].join('/');

    await this.storage.putObject({
      key: objectKey,
      body: buffer,
      contentType: detected.mime,
      metadata: { sha256: checksumSha256 },
    });

    try {
      const file = await this.prisma.storedFile.create({
        data: {
          bucket: this.storage.bucket,
          objectKey,
          originalName: displayName,
          contentType: detected.mime,
          sizeBytes: BigInt(buffer.length),
          checksumSha256,
          purpose,
        },
      });
      return toStoredFileDto(file);
    } catch (error) {
      // Do not leave an orphaned object when the metadata cannot be saved.
      await this.storage
        .deleteObject(objectKey)
        .catch((cleanupError: unknown) =>
          this.logger.error(`Orphaned object ${objectKey}: ${(cleanupError as Error).message}`),
        );
      throw error;
    }
  }

  async list(
    purpose: FilePurpose,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<StoredFileDto>> {
    const where = { purpose, status: FileStatus.AVAILABLE };
    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.storedFile.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.storedFile.count({ where }),
    ]);
    return {
      items: items.map(toStoredFileDto),
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  async get(id: string, purpose: FilePurpose): Promise<StoredFileDto> {
    return toStoredFileDto(await this.findAvailable(id, purpose));
  }

  async getDownloadUrl(id: string, purpose: FilePurpose): Promise<SignedUrlResponse> {
    const file = await this.findAvailable(id, purpose);
    const signed = await this.storage.getSignedDownloadUrl(file.objectKey, {
      downloadFileName: file.originalName,
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  async openContent(
    id: string,
    purpose: FilePurpose,
  ): Promise<{ file: StoredFileDto; body: Readable }> {
    const file = await this.findAvailable(id, purpose);
    const object = await this.storage.getObject(file.objectKey);
    return { file: toStoredFileDto(file), body: object.body };
  }

  /**
   * Marks the file deleted first (so it disappears immediately and consistently), then
   * removes the object. A failed object removal is logged for the cleanup job to retry.
   */
  async delete(id: string, purpose: FilePurpose): Promise<void> {
    const file = await this.findAvailable(id, purpose);
    await this.prisma.storedFile.update({
      where: { id: file.id },
      data: { status: FileStatus.DELETED, deletedAt: new Date() },
    });
    await this.storage
      .deleteObject(file.objectKey)
      .catch((error: unknown) =>
        this.logger.error(`Could not delete object ${file.objectKey}: ${(error as Error).message}`),
      );
  }

  private async findAvailable(id: string, purpose: FilePurpose): Promise<StoredFile> {
    const file = await this.prisma.storedFile.findFirst({
      where: { id, purpose, status: FileStatus.AVAILABLE },
    });
    if (!file) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'File not found.');
    return file;
  }
}
