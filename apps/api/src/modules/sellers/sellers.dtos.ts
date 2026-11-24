import {
  reviewSellerSchema,
  sellerListQuerySchema,
  sellerReasonSchema,
  updateSellerProfileSchema,
} from '@marketplace/validation';
import { createZodDto } from '../../common/validation/zod-dto';

export class UpdateSellerProfileDto extends createZodDto(updateSellerProfileSchema) {}
export class SellerListQueryDto extends createZodDto(sellerListQuerySchema) {}
export class ReviewSellerDto extends createZodDto(reviewSellerSchema) {}
export class SellerReasonDto extends createZodDto(sellerReasonSchema) {}
