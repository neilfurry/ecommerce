import {
  brandListQuerySchema,
  createBrandSchema,
  createCategorySchema,
  putCategoryAttributesSchema,
  reviewBrandSchema,
  updateBrandSchema,
  updateCategorySchema,
} from '@marketplace/validation';
import { createZodDto } from '../../common/validation/zod-dto';

export class CreateCategoryDto extends createZodDto(createCategorySchema) {}
export class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
export class PutCategoryAttributesDto extends createZodDto(putCategoryAttributesSchema) {}
export class CreateBrandDto extends createZodDto(createBrandSchema) {}
export class UpdateBrandDto extends createZodDto(updateBrandSchema) {}
export class ReviewBrandDto extends createZodDto(reviewBrandSchema) {}
export class BrandListQueryDto extends createZodDto(brandListQuerySchema) {}
