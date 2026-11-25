import { Module } from '@nestjs/common';
import { StorefrontModule } from '../storefront/storefront.module';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

@Module({
  imports: [StorefrontModule],
  controllers: [WishlistController],
  providers: [WishlistService],
})
export class WishlistModule {}
