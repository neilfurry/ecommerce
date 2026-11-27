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
import { CommissionRulesService } from './commission-rules.service';
import { PlatformSettingsService } from './platform-settings.service';
import { CheckoutSettingsDto, CommissionRuleInputDto, ShippingRatesDto } from './settings.dtos';

/**
 * Checkout settings (charges, payment methods), shipping rates and the Phase 4 commission
 * endpoints (default and category rates, now versioned rules: see the finance commission API).
 */
@ApiTags('Settings')
@Controller({ path: 'settings', version: '1' })
@RequirePermissions('settings.manage')
export class SettingsController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly commission: CommissionRulesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Every checkout setting, the shipping rate table and commission rates' })
  @ApiOkResponse({ schema: zodToOpenApi(platformSettingsSchema) })
  async all() {
    return {
      ...(await this.settings.all()),
      commissionRules: await this.commission.currentBasicRules(),
    };
  }

  @Put('checkout')
  @ApiOperation({
    summary: 'Other charges, payment methods and the payment window (taxes: tax rules)',
  })
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
  @RequirePermissions('commission.manage')
  @ApiOperation({
    summary:
      'Set the default rate (categoryId null) or a category’s rate (a new rule version from now)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(commissionRuleListSchema) })
  async putCommission(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CommissionRuleInputDto,
    @ReqContext() context: RequestContext,
  ) {
    return { items: await this.commission.putBasic(user, body, context) };
  }

  @Delete('commission-rules/:id')
  @RequirePermissions('commission.manage')
  @ApiOperation({
    summary: 'End a category rate now (the category falls back to its parent’s or the default)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(commissionRuleListSchema) })
  async deleteCommission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @ReqContext() context: RequestContext,
  ) {
    return { items: await this.commission.endBasic(user, id, context) };
  }
}
