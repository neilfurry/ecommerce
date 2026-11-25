import { UploadLimitsModule } from '../files/upload-limits';
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PricingController } from '../pricing/pricing.controller';
import { PricingService } from '../pricing/pricing.service';
import { ProductImagesService } from './product-images.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/** Products, variants, photos and pricing (they share the product ownership checks). */
@Module({
  imports: [FilesModule, CatalogModule, NotificationsModule, UploadLimitsModule],
  controllers: [ProductsController, PricingController],
  providers: [ProductsService, ProductImagesService, PricingService],
  exports: [ProductsService, PricingService],
})
export class ProductsModule {}
