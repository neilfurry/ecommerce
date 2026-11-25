/**
 * Development only: generated photos for demo products without any, and two home page banners.
 * They go through the same pipeline as uploads (processImage → WebP in object storage).
 *
 *   pnpm --filter @marketplace/api run seed:media      (setup.ps1 runs it with the demo data)
 */
import { NestFactory } from '@nestjs/core';
import { FilePurpose } from '@marketplace/database';
import sharp from 'sharp';
import { AppModule } from '../app.module';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { FilesService } from '../modules/files/files.service';
import { processImage } from '../modules/files/image-processor';

const PALETTE = ['#1d4ed8', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#15803d'];
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function art(width: number, height: number, lines: string[], color: string, size: number) {
  const text = lines
    .map(
      (line, i) =>
        `<text x="50%" y="${50 + (i - (lines.length - 1) / 2) * size * 0.14}%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${size}" fill="#ffffff">${escape(line)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="82%" cy="20%" r="${Math.min(width, height) * 0.25}" fill="#ffffff" fill-opacity="0.08"/>
    ${text}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function wrap(name: string, max = 16): string[] {
  const lines: string[] = [];
  for (const word of name.split(' ')) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.slice(0, 4);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get(AppConfig);
    if (config.isProduction) throw new Error('Demo media is for development only.');
    const prisma = app.get(PrismaService);
    const files = app.get(FilesService);
    const rules = { maxBytes: 10_000_000, minEdge: 200, maxEdge: 1600, thumbnailEdge: 400 };

    const products = await prisma.product.findMany({
      where: {
        images: { none: {} },
        store: { slug: { in: ['sam-sari-sari', 'isla-tech', 'click-and-type'] } },
      },
    });
    for (const [index, product] of products.entries()) {
      const png = await art(1200, 1200, wrap(product.name), PALETTE[index % PALETTE.length]!, 96);
      const processed = await processImage(png, 'demo.png', rules);
      const main = await files.upload({
        buffer: processed.main,
        originalName: 'photo.webp',
        purpose: FilePurpose.PRODUCT_IMAGE,
      });
      const thumb = await files.upload({
        buffer: processed.thumbnail,
        originalName: 'thumb.webp',
        purpose: FilePurpose.PRODUCT_IMAGE_THUMBNAIL,
      });
      await prisma.productImage.create({
        data: {
          productId: product.id,
          fileId: main.id,
          thumbnailFileId: thumb.id,
          altText: product.name,
          width: processed.width,
          height: processed.height,
        },
      });
    }
    console.log(`Demo photos added to ${products.length} product(s).`);

    const admin = await prisma.user.findUnique({ where: { email: 'admin@marketplace.local' } });
    if (admin && (await prisma.homeBanner.count()) === 0) {
      const banners = [
        {
          title: 'Payday Flash Sale',
          subtitle: 'Limited units at flash prices — while stocks last',
          linkUrl: '/search?sort=best_selling',
          color: '#be123c',
        },
        {
          title: 'Buy in bulk, pay less',
          subtitle: 'Wholesale prices for approved business accounts',
          linkUrl: '/search?wholesale=true',
          color: '#1d4ed8',
        },
      ];
      for (const [position, b] of banners.entries()) {
        const png = await art(1920, 600, [' '], b.color, 10);
        const processed = await processImage(png, 'banner.png', {
          ...rules,
          minEdge: 300,
          maxEdge: 1920,
          thumbnailEdge: 320,
        });
        const file = await files.upload({
          buffer: processed.main,
          originalName: 'banner.webp',
          purpose: FilePurpose.HOME_BANNER,
        });
        await prisma.homeBanner.create({
          data: {
            title: b.title,
            subtitle: b.subtitle,
            linkUrl: b.linkUrl,
            position,
            imageFileId: file.id,
            createdById: admin.id,
          },
        });
      }
      console.log('Demo home page banners added.');
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
