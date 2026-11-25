import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { FilesModule } from '../files/files.module';
import { UploadLimitsModule } from '../files/upload-limits';
import { ProductsModule } from '../products/products.module';
import { StorefrontCatalogService } from './catalog.service';
import { HomeService } from './home.service';
import { ProductCardsService } from './product-cards.service';
import { PostgresSearchProvider } from './search/postgres-search.provider';
import { SearchProvider } from './search/search-provider';
import { StorefrontCatalogController, StorefrontController } from './storefront.controller';

/**
 * Shopper-facing catalog: search (PostgreSQL provider behind SearchProvider), product pages,
 * the home page and its administration.
 */
@Module({
  imports: [ProductsModule, CatalogModule, FilesModule, UploadLimitsModule],
  controllers: [StorefrontCatalogController, StorefrontController],
  providers: [
    PostgresSearchProvider,
    { provide: SearchProvider, useExisting: PostgresSearchProvider },
    ProductCardsService,
    StorefrontCatalogService,
    HomeService,
  ],
  exports: [ProductCardsService, StorefrontCatalogService],
})
export class StorefrontModule {}
