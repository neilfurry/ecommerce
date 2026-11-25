import {
  createProductSchema,
  customerPriceInputSchema,
  pricePreviewRequestSchema,
  priceQuoteRequestSchema,
  productListQuerySchema,
  productPricingSchema,
  productReasonSchema,
  putPriceTiersSchema,
  reorderProductImagesSchema,
  reviewProductSchema,
  setProductOptionsSchema,
  updateProductImageSchema,
  updateProductSchema,
  updateVariantSchema,
} from '@marketplace/validation';
import { createZodDto } from '../../common/validation/zod-dto';

export class CreateProductDto extends createZodDto(createProductSchema) {}
export class UpdateProductDto extends createZodDto(updateProductSchema) {}
export class SetProductOptionsDto extends createZodDto(setProductOptionsSchema) {}
export class UpdateVariantDto extends createZodDto(updateVariantSchema) {}
export class ProductListQueryDto extends createZodDto(productListQuerySchema) {}
export class ReviewProductDto extends createZodDto(reviewProductSchema) {}
export class ProductReasonDto extends createZodDto(productReasonSchema) {}
export class UpdateProductImageDto extends createZodDto(updateProductImageSchema) {}
export class ReorderProductImagesDto extends createZodDto(reorderProductImagesSchema) {}
export class ProductPricingDto extends createZodDto(productPricingSchema) {}
export class PutPriceTiersDto extends createZodDto(putPriceTiersSchema) {}
export class CustomerPriceInputDto extends createZodDto(customerPriceInputSchema) {}
export class PricePreviewDto extends createZodDto(pricePreviewRequestSchema) {}
export class PriceQuoteRequestDto extends createZodDto(priceQuoteRequestSchema) {}
