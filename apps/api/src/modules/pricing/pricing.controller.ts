import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import { priceQuoteSchema } from '@marketplace/validation';
import { CurrentUser, Public, SkipCsrf } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { PriceQuoteRequestDto } from '../products/products.dtos';
import { PricingService } from './pricing.service';

@ApiTags('Pricing')
@Controller({ path: 'pricing', version: '1' })
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post('quote')
  @Public()
  // Read-only calculation: nothing changes, so no CSRF token is needed.
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Prices for variant ids and quantities, for the signed-in customer or a guest. Prices sent by clients are never accepted',
  })
  @ApiBody({ schema: PriceQuoteRequestDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(priceQuoteSchema) })
  quote(@Body() body: PriceQuoteRequestDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    return this.pricing.quote(user, body);
  }
}
