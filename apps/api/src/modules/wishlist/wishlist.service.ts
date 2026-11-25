import { HttpStatus, Injectable } from '@nestjs/common';
import { type AuthenticatedUser, MAX_WISHLIST_ITEMS } from '@marketplace/shared-types';
import type { Wishlist } from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ProductCardsService, shopperVisible } from '../storefront/product-cards.service';

/** Saved products ("wishlist"), one list per customer. */
@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: ProductCardsService,
  ) {}

  async list(user: AuthenticatedUser): Promise<Wishlist> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { productId: true },
    });
    // Products that stopped being sold drop out of the list shown (the rows stay).
    return { items: await this.cards.cards(rows.map((r) => r.productId)) };
  }

  async add(user: AuthenticatedUser, productId: string): Promise<Wishlist> {
    const visible = await this.prisma.product.count({
      where: { id: productId, ...shopperVisible },
    });
    if (!visible) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product not found.');
    const count = await this.prisma.wishlistItem.count({ where: { userId: user.id } });
    if (count >= MAX_WISHLIST_ITEMS) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        `You can save up to ${MAX_WISHLIST_ITEMS} products.`,
      );
    }
    await this.prisma.wishlistItem.upsert({
      where: { userId_productId: { userId: user.id, productId } },
      create: { userId: user.id, productId },
      update: {},
    });
    return this.list(user);
  }

  async remove(user: AuthenticatedUser, productId: string): Promise<Wishlist> {
    await this.prisma.wishlistItem.deleteMany({ where: { userId: user.id, productId } });
    return this.list(user);
  }
}
