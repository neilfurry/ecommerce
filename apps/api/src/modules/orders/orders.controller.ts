import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { type AuthenticatedUser, CUSTOMER_ROLES } from '@marketplace/shared-types';
import {
  addNoteSchema,
  adminOrderDetailSchema,
  adminOrderListQuerySchema,
  adminOrderListSchema,
  answerCancellationSchema,
  cancelOrderSchema,
  orderDetailSchema,
  orderListQuerySchema,
  orderListSchema,
  reasonSchema,
  requestCancellationSchema,
  sellerOrderCountsSchema,
  sellerOrderDetailSchema,
  sellerOrderListQuerySchema,
  sellerOrderListSchema,
  staffTransitionSchema,
  uuidSchema,
} from '@marketplace/validation';
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
import { OrdersService } from './orders.service';
import { ShipmentsService } from './shipments/shipments.service';

class OrderListQueryDto extends createZodDto(orderListQuerySchema) {}
class SellerOrderListQueryDto extends createZodDto(sellerOrderListQuerySchema) {}
class AdminOrderListQueryDto extends createZodDto(adminOrderListQuerySchema) {}
class CancelOrderDto extends createZodDto(cancelOrderSchema) {}
class ReasonDto extends createZodDto(reasonSchema) {}
class RequestCancellationDto extends createZodDto(requestCancellationSchema) {}
class AnswerCancellationDto extends createZodDto(answerCancellationSchema) {}
class AddNoteDto extends createZodDto(addNoteSchema) {}
class StaffTransitionDto extends createZodDto(staffTransitionSchema) {}
const answerDecisionSchema = z.enum(['approve', 'reject']);
export const Id = () => Param('id', new ZodValidationPipe(uuidSchema));

@ApiTags('Account: orders')
@Controller({ path: 'account', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class CustomerOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly shipments: ShipmentsService,
  ) {}

  @Get('orders')
  @ApiOperation({ summary: 'My orders, newest first' })
  @ApiOkResponse({ schema: zodToOpenApi(orderListSchema) })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: OrderListQueryDto) {
    return this.orders.listMine(user, query);
  }

  @Get('orders/:id')
  @ApiOperation({
    summary: 'One of my orders: each store’s part with its status, tracking, returns and refunds',
  })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.orders.getMine(user, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel the whole order (while waiting for payment, or before any seller starts)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  cancel(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: CancelOrderDto) {
    return this.orders.cancelMine(user, id, body.reason);
  }

  @Post('orders/:id/notes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a message to the order (seen by the sellers and support)' })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  async note(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: AddNoteDto) {
    await this.orders.addNote(user, 'CUSTOMER', { orderId: id }, body);
    return this.orders.getMine(user, id);
  }

  @Post('seller-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel one store’s part before the seller accepts it' })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  cancelPart(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: ReasonDto) {
    return this.orders.cancelMySellerOrder(user, id, body.reason);
  }

  @Post('seller-orders/:id/cancellation-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the seller to cancel an order it is preparing' })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  requestCancellation(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: RequestCancellationDto,
  ) {
    return this.orders.requestCancellation(user, id, body.reason);
  }

  @Post('seller-orders/:id/confirm-received')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a seller-arranged delivery arrived' })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  async confirmReceived(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    await this.shipments.confirmReceived(user.id, id);
    return this.orders.getMine(user, await this.orderIdOf(user, id));
  }

  @Post('seller-orders/:id/notes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Message the seller about their part of the order' })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  async notePart(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: AddNoteDto,
  ) {
    await this.orders.addNote(user, 'CUSTOMER', { sellerOrderId: id }, body);
    return this.orders.getMine(user, await this.orderIdOf(user, id));
  }

  private orderIdOf(user: AuthenticatedUser, sellerOrderId: string) {
    return this.orders.orderIdOfMySellerOrder(user.id, sellerOrderId);
  }
}

@ApiTags('Orders (seller)')
@Controller({ path: 'seller/orders', version: '1' })
@RequirePermissions('seller.orders.read')
export class SellerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'My seller orders (filter by dashboard tab, status, number, tracking, customer)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderListSchema) })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: SellerOrderListQueryDto) {
    return this.orders.listForSeller(user, query);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'How many orders each dashboard tab holds, open returns and cancellation requests',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderCountsSchema) })
  counts(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.sellerCounts(user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One of my seller orders: items, shipping, customer, payables and what I can do next',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.orders.getSellerOrder(user, id, this.orders.sellerViewer(user));
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.orders.manage')
  @ApiOperation({ summary: 'Accept a new order and start preparing it' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  accept(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.orders.accept(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.orders.manage')
  @ApiOperation({ summary: 'Cancel before pickup (paid money is refunded to the customer)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReasonDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.orders.sellerCancel(user, id, body.reason, context);
  }

  @Post(':id/cancellation-request/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.orders.manage')
  @ApiOperation({ summary: 'Approve the customer’s cancellation request' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  approveCancellation(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: AnswerCancellationDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.orders.answerCancellation(user, true, id, true, body.response, context);
  }

  @Post(':id/cancellation-request/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.orders.manage')
  @ApiOperation({ summary: 'Decline the customer’s cancellation request (with a reason)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  rejectCancellation(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: AnswerCancellationDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.orders.answerCancellation(user, true, id, false, body.response, context);
  }

  @Post(':id/notes')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.orders.manage')
  @ApiOperation({
    summary: 'Add a note (for the customer, or for the seller team and support only)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  async note(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: AddNoteDto) {
    await this.orders.addNote(user, 'SELLER', { sellerOrderId: id }, body);
    return this.orders.getSellerOrder(user, id, this.orders.sellerViewer(user));
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
  @ApiOperation({ summary: 'An order with every seller order, payments, notes and the commission' })
  @ApiOkResponse({ schema: zodToOpenApi(adminOrderDetailSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.orders.getAny(user, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.manage')
  @ApiOperation({ summary: 'Cancel the whole order (nothing shipped yet); paid money is refunded' })
  @ApiOkResponse({ schema: zodToOpenApi(adminOrderDetailSchema) })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReasonDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.orders.staffCancelOrder(user, id, body.reason, context);
  }

  @Post('orders/:id/notes')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.manage')
  @ApiOperation({ summary: 'Add a note to the order (choose who sees it)' })
  @ApiOkResponse({ schema: zodToOpenApi(adminOrderDetailSchema) })
  async note(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: AddNoteDto) {
    await this.orders.addNote(user, 'STAFF', { orderId: id }, body);
    return this.orders.getAny(user, id);
  }

  @Get('seller-orders')
  @ApiOperation({ summary: 'Every seller order (filter by seller, tab, status, number)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderListSchema) })
  listSellerOrders(@Query() query: SellerOrderListQueryDto) {
    return this.orders.listForSeller(null, query);
  }

  @Get('seller-orders/:id')
  @ApiOperation({ summary: 'Any seller order' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  getSellerOrder(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.orders.getSellerOrder(null, id, this.orders.staffViewer(user));
  }

  @Post('seller-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.manage')
  @ApiOperation({ summary: 'Cancel a seller order before pickup (paid money is refunded)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  cancelSellerOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReasonDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.orders.staffCancelSellerOrder(user, id, body.reason, context);
  }

  @Post('seller-orders/:id/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.manage')
  @ApiOperation({
    summary: 'Accept for the seller, or complete a delivered order early (with a note)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: StaffTransitionDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.orders.staffTransition(user, id, body.to, body.note, context);
  }

  @Post('seller-orders/:id/cancellation-request/:decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.manage')
  @ApiOperation({
    summary: 'Answer a customer’s cancellation request for the seller (approve or reject)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  answerCancellation(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Param('decision', new ZodValidationPipe(answerDecisionSchema)) decision: 'approve' | 'reject',
    @Body() body: AnswerCancellationDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.orders.answerCancellation(
      user,
      false,
      id,
      decision === 'approve',
      body.response,
      context,
    );
  }

  @Post('seller-orders/:id/notes')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.manage')
  @ApiOperation({ summary: 'Add a note to a seller order (choose who sees it)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerOrderDetailSchema) })
  async noteSellerOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: AddNoteDto,
  ) {
    await this.orders.addNote(user, 'STAFF', { sellerOrderId: id }, body);
    return this.orders.getSellerOrder(null, id, this.orders.staffViewer(user));
  }
}
