import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Put,
  Query,
  type RawBodyRequest,
  Req,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CUSTOMER_ROLES,
  MAX_RETURN_IMAGES,
} from '@marketplace/shared-types';
import {
  adminShipmentListQuerySchema,
  adminShipmentListSchema,
  bookShipmentSchema,
  carrierListSchema,
  escalateReturnSchema,
  MAX_RETURN_IMAGE_BYTES,
  orderSettingsSchema,
  receiveReturnSchema,
  rejectReturnSchema,
  returnListQuerySchema,
  returnListSchema,
  returnSchema,
  sellerReturnDecisionSchema,
  shipBackSchema,
  shipmentSchema,
  shipmentUpdateSchema,
  simulateShipmentSchema,
  staffReturnDecisionSchema,
  webhookAckSchema,
} from '@marketplace/validation';
import type { Request } from 'express';
import { sellerScope } from '../../common/auth/seller-scope';
import {
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
  SkipCsrf,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { AppConfig } from '../../config/app-config';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { Id } from './orders.controller';
import { ReturnsService } from './returns/returns.service';
import { ShipmentsService } from './shipments/shipments.service';

class BookShipmentDto extends createZodDto(bookShipmentSchema) {}
class ShipmentUpdateDto extends createZodDto(shipmentUpdateSchema) {}
class SimulateShipmentDto extends createZodDto(simulateShipmentSchema) {}
class AdminShipmentQueryDto extends createZodDto(adminShipmentListQuerySchema) {}
class ReturnQueryDto extends createZodDto(returnListQuerySchema) {}
class EscalateDto extends createZodDto(escalateReturnSchema) {}
class ShipBackDto extends createZodDto(shipBackSchema) {}
class SellerDecisionDto extends createZodDto(sellerReturnDecisionSchema) {}
class RejectReturnDto extends createZodDto(rejectReturnSchema) {}
class ReceiveDto extends createZodDto(receiveReturnSchema) {}
class StaffDecisionDto extends createZodDto(staffReturnDecisionSchema) {}
class OrderSettingsDto extends createZodDto(orderSettingsSchema) {}

const waybill = (content: {
  file: { contentType: string; sizeBytes: number; originalName: string };
  body: NodeJS.ReadableStream;
}) =>
  new StreamableFile(content.body as never, {
    type: content.file.contentType,
    length: content.file.sizeBytes,
    disposition: `inline; filename="${content.file.originalName}"`,
  });

const returnUpload = {
  schema: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        type: 'string',
        description:
          'JSON: { sellerOrderId, items: [{ orderItemId, quantity }], reason, description, requestedResolution }',
      },
      images: {
        type: 'array',
        items: { type: 'string', format: 'binary' },
        maxItems: MAX_RETURN_IMAGES,
      },
    },
  },
};

const seller = (user: AuthenticatedUser) => ({
  source: 'SELLER' as const,
  user,
  sellerId: sellerScope(user).sellerId,
});
const staff = (user: AuthenticatedUser) => ({ source: 'STAFF' as const, user, sellerId: null });

// ---- Customers ---------------------------------------------------------------------------------

@ApiTags('Account: returns')
@Controller({ path: 'account/returns', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class CustomerReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOkResponse({ schema: zodToOpenApi(returnListSchema) })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ReturnQueryDto) {
    return this.returns.list({ type: 'CUSTOMER', user }, query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('images', MAX_RETURN_IMAGES, { limits: { fileSize: MAX_RETURN_IMAGE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(returnUpload)
  @ApiOperation({
    summary: 'Request a return within the return window (reason, items, up to 5 photos)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body('data') data: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.returns.create(
      user,
      data,
      (files ?? []).map((f) => ({ buffer: f.buffer, originalName: f.originalname })),
    );
  }

  @Get(':id')
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.returns.get({ type: 'CUSTOMER', user }, id);
  }

  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the marketplace to decide (after a rejection or no answer in time)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  escalate(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: EscalateDto) {
    return this.returns.escalate(user, id, body.note);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw the return request' })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  cancel(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.returns.cancel(user, id);
  }

  @Post(':id/ship-back')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'I sent the item back: courier and tracking number' })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  shipBack(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: ShipBackDto) {
    return this.returns.shipBack(user, id, body);
  }
}

// ---- Sellers -----------------------------------------------------------------------------------

@ApiTags('Shipments (seller)')
@Controller({ path: 'seller', version: '1' })
@RequirePermissions('seller.orders.read')
export class SellerShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get('shipping/carriers')
  @ApiOperation({ summary: 'Couriers I can book (enabled by the marketplace and set up)' })
  @ApiOkResponse({ schema: zodToOpenApi(carrierListSchema) })
  carriers() {
    return this.shipments.carriers();
  }

  @Post('orders/:id/shipments')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.orders.manage')
  @ApiOperation({
    summary: 'Book the delivery (mock courier) or record my own courier and tracking number',
  })
  @ApiOkResponse({ schema: zodToOpenApi(shipmentSchema) })
  book(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: BookShipmentDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.shipments.book(seller(user), id, body, context);
  }

  @Post('shipments/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.orders.manage')
  @ApiOperation({ summary: 'Cancel a booking before pickup' })
  @ApiOkResponse({ schema: zodToOpenApi(shipmentSchema) })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.shipments.cancel(seller(user), id, context);
  }

  @Post('shipments/:id/events')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.orders.manage')
  @ApiOperation({
    summary: 'Update a delivery I arranged myself (picked up, delivered, failed, returned...)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(shipmentSchema) })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ShipmentUpdateDto,
  ) {
    return this.shipments.update(seller(user), id, body);
  }

  @Get('shipments/:id/waybill')
  @ApiOperation({ summary: 'The shipping label (PDF)' })
  async waybill(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return waybill(await this.shipments.waybill(id, sellerScope(user).sellerId));
  }
}

@ApiTags('Returns (seller)')
@Controller({ path: 'seller/returns', version: '1' })
@RequirePermissions('seller.orders.read')
export class SellerReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOkResponse({ schema: zodToOpenApi(returnListSchema) })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ReturnQueryDto) {
    return this.returns.list({ type: 'SELLER', user }, query);
  }

  @Get(':id')
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.returns.get({ type: 'SELLER', user }, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.returns.manage')
  @ApiOperation({
    summary: 'Approve: full or partial refund, or replacement; with or without the item back',
  })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: SellerDecisionDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.returns.sellerApprove(user, id, body, context);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.returns.manage')
  @ApiOperation({ summary: 'Reject with a reason (the customer may escalate)' })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  reject(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: RejectReturnDto) {
    return this.returns.sellerReject(user, id, body.response);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.returns.manage')
  @ApiOperation({
    summary: 'The item is back (restock or record as damaged); an approved refund is sent',
  })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  receive(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReceiveDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.returns.receive({ type: 'SELLER', user }, id, body.restock, context);
  }

  @Post(':id/replacement')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.returns.manage')
  @ApiOperation({ summary: 'Send the replacement (my courier and tracking number)' })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  replacement(@CurrentUser() user: AuthenticatedUser, @Id() id: string, @Body() body: ShipBackDto) {
    return this.returns.shipReplacement(user, id, body);
  }
}

// ---- Staff -------------------------------------------------------------------------------------

@ApiTags('Shipping (staff)')
@Controller({ version: '1' })
@RequirePermissions('orders.read')
export class AdminShippingController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly settings: PlatformSettingsService,
    private readonly config: AppConfig,
  ) {}

  @Get('shipping/carriers')
  @ApiOperation({ summary: 'Couriers: enabled, set up (adapter ready), test or live' })
  @ApiOkResponse({ schema: zodToOpenApi(carrierListSchema) })
  carriers() {
    return this.shipments.carriers();
  }

  @Put('settings/orders')
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary: 'Bank accounts and transfer window, COD limits, return window, couriers',
  })
  @ApiOkResponse({ schema: zodToOpenApi(orderSettingsSchema) })
  saveSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: OrderSettingsDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.settings.saveOrders(user, body, context, (c) =>
      this.shipments.carrierAvailable(c as Parameters<ShipmentsService['carrierAvailable']>[0]),
    );
  }

  @Get('shipments')
  @ApiOperation({ summary: 'All shipments (filter by status, courier, tracking or order number)' })
  @ApiOkResponse({ schema: zodToOpenApi(adminShipmentListSchema) })
  list(@Query() query: AdminShipmentQueryDto) {
    return this.shipments.list(query);
  }

  @Get('shipments/:id/waybill')
  @ApiOperation({ summary: 'The shipping label (PDF)' })
  async waybill(@Id() id: string) {
    return waybill(await this.shipments.waybill(id, null));
  }

  @Post('shipments/:id/events')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipping.manage')
  @ApiOperation({ summary: 'Record a status from the courier (e.g. from its portal)' })
  @ApiOkResponse({ schema: zodToOpenApi(shipmentSchema) })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ShipmentUpdateDto,
  ) {
    return this.shipments.update(staff(user), id, body);
  }

  @Post('shipments/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipping.manage')
  @ApiOkResponse({ schema: zodToOpenApi(shipmentSchema) })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.shipments.cancel(staff(user), id, context);
  }

  @Post('shipments/:id/simulate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipping.manage')
  @ApiOperation({
    summary: 'Development: make the mock courier report a status (signed webhook path)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(shipmentSchema) })
  simulate(@Id() id: string, @Body() body: SimulateShipmentDto) {
    if (this.config.isProduction) throw new NotFoundException();
    return this.shipments.simulate(id, body.status, body.codCollected);
  }
}

@ApiTags('Returns and disputes (staff)')
@Controller({ path: 'returns', version: '1' })
@RequirePermissions('orders.read')
export class AdminReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOperation({ summary: 'Returns (ESCALATED: the dispute queue, oldest first)' })
  @ApiOkResponse({ schema: zodToOpenApi(returnListSchema) })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ReturnQueryDto) {
    return this.returns.list({ type: 'STAFF', user }, query);
  }

  @Get(':id')
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.returns.get({ type: 'STAFF', user }, id);
  }

  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('disputes.manage')
  @ApiOperation({
    summary: 'Decide a dispute: refund (full, partial, with shipping), replacement or no refund',
  })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: StaffDecisionDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.returns.staffDecide(user, id, body, context);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('disputes.manage')
  @ApiOperation({
    summary: 'Record that the returned item reached the seller (when the seller does not)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(returnSchema) })
  receive(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReceiveDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.returns.receive({ type: 'STAFF', user }, id, body.restock, context);
  }
}

@ApiTags('Webhooks')
@Controller({ path: 'shipping/webhooks', version: '1' })
@Public()
@SkipCsrf()
export class CourierWebhooksController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post('mock-courier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mock courier tracking updates (signed; development only)' })
  @ApiOkResponse({ schema: zodToOpenApi(webhookAckSchema) })
  mock(@Req() req: RawBodyRequest<Request>) {
    return this.shipments.courierWebhook('MOCK', req.headers, req.rawBody);
  }
}
