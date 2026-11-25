import { UploadLimitsModule } from '../files/upload-limits';
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricingController } from '../pricing/pricing.controller';
import { PricingService } from '../pricing/pricing.service';
import { CatalogController } from './catalog.controller';
import { ProductImagesService } from './product-images.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PublicCatalogService } from './public-catalog.service';

/** Products, variants, photos and pricing (they share the product ownership checks). */
@Module({
  imports: [FilesModule, CatalogModule, NotificationsModule, UploadLimitsModule],
  controllers: [ProductsController, PricingController, CatalogController],
  providers: [ProductsService, ProductImagesService, PricingService, PublicCatalogService],
  exports: [ProductsService, PricingService],
})
export class ProductsModule {}
