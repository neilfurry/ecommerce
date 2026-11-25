import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser, CUSTOMER_ROLES } from '@marketplace/shared-types';
import {
  adminOrderDetailSchema,
  adminOrderListQuerySchema,
  adminOrderListSchema,
  cancelOrderSchema,
  orderDetailSchema,
  orderListQuerySchema,
  orderListSchema,
  sellerOrderDetailSchema,
  sellerOrderListQuerySchema,
  sellerOrderListSchema,
  uuidSchema,
} from '@marketplace/validation';
import { CurrentUser, RequirePermissions, Roles } from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { OrdersService } from './orders.service';

class OrderListQueryDto extends createZodDto(orderListQuerySchema) {}
class SellerOrderListQueryDto extends createZodDto(sellerOrderListQuerySchema) {}
class AdminOrderListQueryDto extends createZodDto(adminOrderListQuerySchema) {}
class CancelOrderDto extends createZodDto(cancelOrderSchema) {}
const Id = () => Param('id', new ZodValidationPipe(uuidSchema));

@ApiTags('Account: orders')
@Controller({ path: 'account/orders', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class CustomerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'My orders, newest first' })
  @ApiOkResponse({ schema: zodToOpenApi(orderListSchema) })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: OrderListQueryDto) {
    return this.orders.listMine(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my orders with its seller suborders' })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.orders.getMine(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel (while waiting for payment, or cash on delivery before the sellers start)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  cancel(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: CancelOrderDto) {
    return this.orders.cancelMine(user, id, body.reason);
  }
}

@ApiTags('Orders (seller)')
@Controller({ path: 'seller/orders', version: '1' })
@RequirePermissions('seller.orders.read')
export class SellerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'My suborders, newest first' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderListSchema) })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: SellerOrderListQueryDto) {
    return this.orders.listForSeller(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One of my suborders: items, shipping, customer, discounts, commission',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.orders.getSellerOrder(user, id);
  }
}

@ApiTags('Orders (staff)')
@Controller({ version: '1' })
@RequirePermissions('orders.read')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Every order (filter by status, payment method, number or customer)' })
  @ApiOkResponse({ schema: zodToOpenApi(adminOrderListSchema) })
  list(@Query() query: AdminOrderListQueryDto) {
    return this.orders.listAll(query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'An order with every seller suborder and the commission' })
  @ApiOkResponse({ schema: zodToOpenApi(adminOrderDetailSchema) })
  get(@Id() id: string) {
    return this.orders.getAny(id);
  }

  @Get('seller-orders')
  @ApiOperation({ summary: 'Every seller suborder (filter by seller, status, number)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderListSchema) })
  listSellerOrders(@Query() query: SellerOrderListQueryDto) {
    return this.orders.listForSeller(null, query);
  }

  @Get('seller-orders/:id')
  @ApiOperation({ summary: 'Any seller suborder' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  getSellerOrder(@Id() id: string) {
    return this.orders.getSellerOrder(null, id);
  }
}
