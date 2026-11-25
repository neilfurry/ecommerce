import { HttpStatus } from '@nestjs/common';
import { PRODUCT_IMAGE_TYPES } from '@marketplace/shared-types';
import sharp from 'sharp';
import { ApiException } from '../../common/errors/api.exception';
import { detectFileType } from './detect-file-type';

export interface ImageRules {
  /** Largest accepted upload in bytes. */
  maxBytes: number;
  /** Shortest accepted side in pixels. */
  minEdge: number;
  /** Longest side of the stored image (smaller images are not enlarged). */
  maxEdge: number;
  /** Longest side of the thumbnail. */
  thumbnailEdge: number;
}

export interface ProcessedImage {
  /** Optimised WebP, metadata (EXIF, GPS) removed. */
  main: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}

/** Decompression-bomb guard: refuse images over 40 megapixels before decoding them. */
const MAX_INPUT_PIXELS = 40_000_000;

const unsupported = (message: string) =>
  new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_MEDIA_TYPE', message);

/**
 * Validates an uploaded photo (size, extension, real content type, dimensions) and produces
 * an optimised WebP and a thumbnail. The output is re-encoded from pixels, so nothing from
 * the original file (metadata, embedded payloads) is kept.
 */
export async function processImage(
  buffer: Buffer,
  originalName: string,
  rules: ImageRules,
): Promise<ProcessedImage> {
  if (buffer.length === 0) {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', 'The file is empty.');
  }
  if (buffer.length > rules.maxBytes) {
    throw new ApiException(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'PAYLOAD_TOO_LARGE',
      `Images may be at most ${Math.floor(rules.maxBytes / 1024 / 1024)} MB.`,
    );
  }
  const allowed = PRODUCT_IMAGE_TYPES as Record<string, readonly string[]>;
  const extension = /\.([A-Za-z0-9]+)$/.exec(originalName)?.[1]?.toLowerCase();
  const knownExtensions = Object.values(allowed).flat();
  if (!extension || !knownExtensions.includes(extension)) {
    throw unsupported('Use a JPEG, PNG or WebP image (.jpg, .jpeg, .png or .webp).');
  }
  const detected = detectFileType(buffer);
  if (!detected || !(detected.mime in allowed)) {
    throw unsupported('The file is not a JPEG, PNG or WebP image.');
  }
  if (!allowed[detected.mime]!.includes(extension)) {
    throw unsupported(
      `The file is a ${detected.extension.toUpperCase()} image but is named .${extension}.`,
    );
  }

  let image: sharp.Sharp;
  let width: number;
  let height: number;
  try {
    // rotate() applies the EXIF orientation before the metadata is discarded.
    image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
    const meta = await image.metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    width = (swap ? meta.height : meta.width) ?? 0;
    height = (swap ? meta.width : meta.height) ?? 0;
  } catch {
    throw unsupported('The image could not be read. It may be damaged or too large.');
  }
  if (Math.min(width, height) < rules.minEdge) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
      `Images must be at least ${rules.minEdge} × ${rules.minEdge} pixels.`,
    );
  }

  try {
    const { data: main, info } = await image
      .clone()
      .resize({
        width: rules.maxEdge,
        height: rules.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await image
      .clone()
      .resize({
        width: rules.thumbnailEdge,
        height: rules.thumbnailEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer();
    return { main, thumbnail, width: info.width, height: info.height };
  } catch {
    throw unsupported('The image could not be processed.');
  }
}
