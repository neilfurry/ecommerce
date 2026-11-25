import { UploadLimitsModule } from '../files/upload-limits';
import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  imports: [FilesModule, UploadLimitsModule],
  controllers: [CategoriesController, BrandsController],
  providers: [CategoriesService, BrandsService],
  exports: [CategoriesService, BrandsService],
})
export class CatalogModule {}
