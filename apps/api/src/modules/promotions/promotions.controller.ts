import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser, SELLER_ROLES } from '@marketplace/shared-types';
import {
  couponInputSchema,
  couponListQuerySchema,
  couponListSchema,
  couponSchema,
  flashSaleInputSchema,
  flashSaleItemInputSchema,
  flashSaleListSchema,
  flashSaleSchema,
  promotionStatusInputSchema,
  updateCouponSchema,
  updateFlashSaleSchema,
  uuidSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CouponsService } from './coupons.service';
import { FlashSalesService } from './flash-sales.service';

class CouponInputDto extends createZodDto(couponInputSchema) {}
class UpdateCouponDto extends createZodDto(updateCouponSchema) {}
class CouponListQueryDto extends createZodDto(couponListQuerySchema) {}
class FlashSaleInputDto extends createZodDto(flashSaleInputSchema) {}
class UpdateFlashSaleDto extends createZodDto(updateFlashSaleSchema) {}
class FlashSaleItemInputDto extends createZodDto(flashSaleItemInputSchema) {}
class ItemStatusDto extends createZodDto(z.object({ status: promotionStatusInputSchema })) {}
const Id = (name = 'id') => Param(name, new ZodValidationPipe(uuidSchema));

/** Marketplace coupons and flash sale campaigns (staff). */
@ApiTags('Promotions')
@Controller({ version: '1' })
@RequirePermissions('marketing.manage')
export class PromotionsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly flashSales: FlashSalesService,
  ) {}

  @Get('coupons')
  @ApiOperation({ summary: 'Every coupon (filter by scope, status, code or name)' })
  @ApiOkResponse({ schema: zodToOpenApi(couponListSchema) })
  listCoupons(@Query() query: CouponListQueryDto) {
    return this.coupons.list(query);
  }

  @Post('coupons')
  @ApiOperation({ summary: 'Create a marketplace coupon (paid by the marketplace)' })
  @ApiCreatedResponse({ schema: zodToOpenApi(couponSchema) })
  createCoupon(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CouponInputDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.coupons.createPlatform(user, body, context);
  }

  @Patch('coupons/:id')
  @ApiOperation({ summary: 'Edit a marketplace coupon (name, end, limits, status)' })
  @ApiOkResponse({ schema: zodToOpenApi(couponSchema) })
  updateCoupon(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: UpdateCouponDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.coupons.update(user, id, body, context, false);
  }

  @Get('flash-sales')
  @ApiOperation({ summary: 'Flash sales with every seller’s items' })
  @ApiOkResponse({ schema: zodToOpenApi(flashSaleListSchema) })
  async listFlashSales() {
    return { items: await this.flashSales.list() };
  }

  @Post('flash-sales')
  @ApiOperation({ summary: 'Schedule a flash sale (sellers then add their items)' })
  @ApiCreatedResponse({ schema: zodToOpenApi(flashSaleSchema) })
  createFlashSale(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: FlashSaleInputDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.flashSales.create(user, body, context);
  }

  @Patch('flash-sales/:id')
  @ApiOperation({ summary: 'Edit a flash sale (title, dates, status)' })
  @ApiOkResponse({ schema: zodToOpenApi(flashSaleSchema) })
  updateFlashSale(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: UpdateFlashSaleDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.flashSales.update(user, id, body, context);
  }

  @Patch('flash-sales/items/:itemId')
  @ApiOperation({ summary: 'Switch a seller’s flash sale item off or on' })
  @ApiOkResponse({ schema: zodToOpenApi(flashSaleSchema) })
  setItemStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Id('itemId') itemId: string,
    @Body() body: ItemStatusDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.flashSales.setItemStatus(user, itemId, body.status, context);
  }
}

/** Seller coupons and flash sale participation (Seller Center). */
@ApiTags('Promotions (seller)')
@Controller({ path: 'seller', version: '1' })
export class SellerPromotionsController {
  constructor(
    private readonly coupons: CouponsService,
    private readonly flashSales: FlashSalesService,
  ) {}

  @Get('coupons')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'My coupons' })
  @ApiOkResponse({ schema: zodToOpenApi(couponListSchema) })
  listCoupons(@CurrentUser() user: AuthenticatedUser, @Query() query: CouponListQueryDto) {
    return this.coupons.list(query, user.seller?.id ?? '00000000-0000-0000-0000-000000000000');
  }

  @Post('coupons')
  @RequirePermissions('seller.marketing.manage')
  @ApiOperation({ summary: 'Create a coupon for my products (I pay the discount)' })
  @ApiCreatedResponse({ schema: zodToOpenApi(couponSchema) })
  createCoupon(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CouponInputDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.coupons.createForSeller(user, body, context);
  }

  @Patch('coupons/:id')
  @RequirePermissions('seller.marketing.manage')
  @ApiOperation({ summary: 'Edit one of my coupons' })
  @ApiOkResponse({ schema: zodToOpenApi(couponSchema) })
  updateCoupon(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: UpdateCouponDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.coupons.update(user, id, body, context, true);
  }

  @Get('flash-sales')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'Upcoming and running flash sales, with my items' })
  @ApiOkResponse({ schema: zodToOpenApi(flashSaleListSchema) })
  async flashSalesList(@CurrentUser() user: AuthenticatedUser) {
    return { items: await this.flashSales.forSeller(user) };
  }

  @Post('flash-sales/:id/items')
  @RequirePermissions('seller.marketing.manage')
  @ApiOperation({ summary: 'Offer one of my variants at a flash price (below its regular price)' })
  @ApiCreatedResponse({ schema: zodToOpenApi(flashSaleSchema) })
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: FlashSaleItemInputDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.flashSales.addItem(user, id, body, context);
  }

  @Delete('flash-sales/items/:itemId')
  @RequirePermissions('seller.marketing.manage')
  @ApiOperation({ summary: 'Withdraw my item (switched off instead once units sold)' })
  @ApiOkResponse({ schema: zodToOpenApi(flashSaleSchema) })
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Id('itemId') itemId: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.flashSales.removeItem(user, itemId, context);
  }
}
