import {
  checkoutSettingsSchema,
  commissionRuleInputSchema,
  shippingRatesSchema,
} from '@marketplace/validation';
import { createZodDto } from '../../common/validation/zod-dto';

export class CheckoutSettingsDto extends createZodDto(checkoutSettingsSchema) {}
export class ShippingRatesDto extends createZodDto(shippingRatesSchema) {}
export class CommissionRuleInputDto extends createZodDto(commissionRuleInputSchema) {}
