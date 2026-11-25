import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser, SELLER_ROLES } from '@marketplace/shared-types';
import {
  inventoryOverviewSchema,
  inventorySummarySchema,
  movementListSchema,
  movementResultSchema,
  reservationListSchema,
  reservationSchema,
  stockLevelListSchema,
  stockLevelSchema,
  transferListSchema,
  transferSchema,
  uuidSchema,
  warehouseListSchema,
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
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { DevToolsEnabledGuard } from '../dev-tools/dev-tools-enabled.guard';
import {
  CreateTransferDto,
  CreateWarehouseDto,
  DevReserveDto,
  InventoryOverviewQueryDto,
  InventoryPageQueryDto,
  MovementListQueryDto,
  RecordMovementDto,
  ReservationListQueryDto,
  SetLowStockThresholdDto,
  StockLevelListQueryDto,
  UpdateWarehouseDto,
} from './inventory.dtos';
import { InventoryService } from './inventory.service';
import { ReservationsService } from './reservations.service';

const Id = () => Param('id', new ZodValidationPipe(uuidSchema));

/** Seller inventory (own seller only) and the staff overview. */
@ApiTags('Inventory')
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly reservations: ReservationsService,
  ) {}

  @Get('overview')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Stock across every seller (staff)' })
  @ApiOkResponse({ schema: zodToOpenApi(inventoryOverviewSchema) })
  overview(@Query() query: InventoryOverviewQueryDto) {
    return this.inventory.overview(query.search, query.page, query.pageSize);
  }

  @Get('summary')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: "Totals for my seller's inventory dashboard" })
  @ApiOkResponse({ schema: zodToOpenApi(inventorySummarySchema) })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.inventory.summary(user);
  }

  // ---- Warehouses ---------------------------------------------------------------------------

  @Get('warehouses')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'My warehouses with stock totals' })
  @ApiOkResponse({ schema: zodToOpenApi(warehouseListSchema) })
  warehouses(@CurrentUser() user: AuthenticatedUser) {
    return this.inventory.warehouses(user);
  }

  @Post('warehouses')
  @RequirePermissions('seller.inventory.manage')
  @ApiOperation({ summary: 'Add a warehouse (the first one becomes the default)' })
  @ApiBody({ schema: CreateWarehouseDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(warehouseListSchema) })
  createWarehouse(
    @Body() body: CreateWarehouseDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.inventory.createWarehouse(user, body, context);
  }

  @Patch('warehouses/:id')
  @RequirePermissions('seller.inventory.manage')
  @ApiOperation({ summary: 'Edit a warehouse, or make it inactive' })
  @ApiBody({ schema: UpdateWarehouseDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(warehouseListSchema) })
  updateWarehouse(
    @Id() id: string,
    @Body() body: UpdateWarehouseDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.inventory.updateWarehouse(user, id, body, context);
  }

  @Post('warehouses/:id/default')
  @RequirePermissions('seller.inventory.manage')
  @ApiOperation({ summary: 'Make this the default warehouse (stock is reserved from it first)' })
  @ApiOkResponse({ schema: zodToOpenApi(warehouseListSchema) })
  makeDefault(
    @Id() id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.inventory.setDefaultWarehouse(user, id, context);
  }

  // ---- Stock --------------------------------------------------------------------------------

  @Get('stock')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'Stock levels (filters: warehouse, product, search, lowStock=true)' })
  @ApiOkResponse({ schema: zodToOpenApi(stockLevelListSchema) })
  stock(@Query() query: StockLevelListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventory.stockLevels(user, query);
  }

  @Put('stock/:id/threshold')
  @RequirePermissions('seller.inventory.manage')
  @ApiOperation({ summary: 'Set the low-stock threshold (null: no notices)' })
  @ApiBody({ schema: SetLowStockThresholdDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(stockLevelSchema) })
  threshold(
    @Id() id: string,
    @Body() body: SetLowStockThresholdDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.inventory.setThreshold(user, id, body.lowStockThreshold, context);
  }

  @Post('movements')
  @RequirePermissions('seller.inventory.manage')
  @ApiOperation({
    summary:
      'Record stock in, stock out, adjustment, damaged, damaged write-off or a return. 409 INSUFFICIENT_STOCK when it would make stock negative',
  })
  @ApiBody({ schema: RecordMovementDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(movementResultSchema) })
  record(@Body() body: RecordMovementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventory.recordMovement(user, body);
  }

  @Get('movements')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'Inventory movement history (the ledger), newest first' })
  @ApiOkResponse({ schema: zodToOpenApi(movementListSchema) })
  movements(@Query() query: MovementListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventory.movements(user, query);
  }

  @Post('transfers')
  @RequirePermissions('seller.inventory.manage')
  @ApiOperation({ summary: 'Move stock between two of my warehouses (all items or none)' })
  @ApiBody({ schema: CreateTransferDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(transferSchema) })
  transfer(
    @Body() body: CreateTransferDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ) {
    return this.inventory.transfer(user, body, context);
  }

  @Get('transfers')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'Stock transfers, newest first' })
  @ApiOkResponse({ schema: zodToOpenApi(transferListSchema) })
  transfers(@Query() query: InventoryPageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventory.transfers(user, query.page, query.pageSize);
  }

  @Get('reservations')
  @Roles(...SELLER_ROLES)
  @ApiOperation({ summary: 'Stock held for checkouts and orders' })
  @ApiOkResponse({ schema: zodToOpenApi(reservationListSchema) })
  reservationList(@Query() query: ReservationListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reservations.list(user, query);
  }
}

/**
 * DEVELOPMENT ONLY: drives the reservation flow that checkout will use in the next phase,
 * so it can be tried from Swagger or the browser tests.
 */
@ApiTags('Developer tools (development only)')
@RequirePermissions('dev-tools.use')
@UseGuards(DevToolsEnabledGuard)
@Controller({ path: 'dev/inventory', version: '1' })
export class DevInventoryController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post('reservations')
  @ApiOperation({ summary: 'Reserve stock for a pretend checkout' })
  @ApiBody({ schema: DevReserveDto.openApiSchema })
  @ApiCreatedResponse({
    schema: zodToOpenApi(z.object({ reservations: z.array(reservationSchema) })),
  })
  async reserve(@Body() body: DevReserveDto) {
    return { reservations: await this.reservations.reserve(body) };
  }

  @Post('reservations/:id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release a reservation' })
  async release(@Id() id: string) {
    return { released: await this.reservations.release({ id }) };
  }

  @Post('reservations/:id/convert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Convert a reservation into a stock deduction (SALE)' })
  @ApiOkResponse({ schema: zodToOpenApi(reservationSchema) })
  convert(@Id() id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reservations.convert(id, user.id);
  }

  @Post('reservations/expire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the expiry sweep now (the worker runs it every minute)' })
  async expire() {
    return { expired: await this.reservations.expireDue() };
  }
}
