import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthenticatedUser, CUSTOMER_ROLES } from '@marketplace/shared-types';
import {
  checkoutQuoteSchema,
  checkoutRequestSchema,
  orderDetailSchema,
  placeOrderSchema,
} from '@marketplace/validation';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { CheckoutService } from './checkout.service';

class CheckoutRequestDto extends createZodDto(checkoutRequestSchema) {}
class PlaceOrderDto extends createZodDto(placeOrderSchema) {}
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);

@ApiTags('Checkout')
@Controller({ path: 'checkout', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Price breakdown before ordering: lines, wholesale savings, coupons, shipping per seller, ' +
      'charges, VAT (included) and the grand total, plus any problems that block the order',
  })
  @ApiOkResponse({ schema: zodToOpenApi(checkoutQuoteSchema) })
  quote(@CurrentUser() user: AuthenticatedUser, @Body() body: CheckoutRequestDto) {
    return this.checkout.quote(user, body as never);
  }

  @Post('orders')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'A new random key per checkout attempt; a retry with the same key returns the same order',
  })
  @ApiOperation({
    summary:
      'Place the order: one parent order with a suborder per seller. Every amount is calculated ' +
      'again by the server; expectedGrandTotal only detects changes (409 CHECKOUT_CHANGED)',
  })
  @ApiCreatedResponse({ schema: zodToOpenApi(orderDetailSchema) })
  async place(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PlaceOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = idempotencyKeySchema.safeParse(key);
    if (!parsed.success) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'BAD_REQUEST',
        'Send an Idempotency-Key header (8–100 letters, digits, - or _).',
      );
    }
    const { order, created } = await this.checkout.place(user, body as never, parsed.data);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return order;
  }
}
