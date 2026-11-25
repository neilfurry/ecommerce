import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  checkoutSettingsSchema,
  commissionRuleListSchema,
  platformSettingsSchema,
  shippingRatesSchema,
  uuidSchema,
} from '@marketplace/validation';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PlatformSettingsService } from './platform-settings.service';
import { CheckoutSettingsDto, CommissionRuleInputDto, ShippingRatesDto } from './settings.dtos';

/** Checkout settings (VAT, charges, payment methods), shipping rates and commission rates. */
@ApiTags('Settings')
@Controller({ path: 'settings', version: '1' })
@RequirePermissions('settings.manage')
export class SettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Every checkout setting, the shipping rate table and commission rates' })
  @ApiOkResponse({ schema: zodToOpenApi(platformSettingsSchema) })
  all() {
    return this.settings.all();
  }

  @Put('checkout')
  @ApiOperation({ summary: 'VAT rate, other charges, payment methods and the payment window' })
  @ApiOkResponse({ schema: zodToOpenApi(checkoutSettingsSchema) })
  saveCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CheckoutSettingsDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.settings.saveCheckout(user, body, context);
  }

  @Put('shipping-rates')
  @ApiOperation({ summary: 'Rate table of the mock shipping provider' })
  @ApiOkResponse({ schema: zodToOpenApi(shippingRatesSchema) })
  saveShippingRates(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ShippingRatesDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.settings.saveShippingRates(user, body, context);
  }

  @Put('commission-rules')
  @ApiOperation({ summary: 'Set the default rate (categoryId null) or a category’s rate' })
  @ApiOkResponse({ schema: zodToOpenApi(commissionRuleListSchema) })
  async putCommission(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CommissionRuleInputDto,
    @ReqContext() context: RequestContext,
  ) {
    return { items: await this.settings.putCommissionRule(user, body, context) };
  }

  @Delete('commission-rules/:id')
  @ApiOperation({
    summary: 'Remove a category rate (the category falls back to its parent’s or the default)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(commissionRuleListSchema) })
  async deleteCommission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @ReqContext() context: RequestContext,
  ) {
    return { items: await this.settings.deleteCommissionRule(user, id, context) };
  }
}
