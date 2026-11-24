import {
  createStoreSchema,
  sellerReasonSchema,
  storeListQuerySchema,
  updateStoreSchema,
  updateStoreSettingsSchema,
} from '@marketplace/validation';
import { createZodDto } from '../../common/validation/zod-dto';

export class CreateStoreDto extends createZodDto(createStoreSchema) {}
export class UpdateStoreDto extends createZodDto(updateStoreSchema) {}
export class UpdateStoreSettingsDto extends createZodDto(updateStoreSettingsSchema) {}
export class StoreListQueryDto extends createZodDto(storeListQuerySchema) {}
export class StoreReasonDto extends createZodDto(sellerReasonSchema) {}
