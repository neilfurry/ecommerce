import {
  createTransferSchema,
  createWarehouseSchema,
  devReserveSchema,
  inventoryOverviewQuerySchema,
  movementListQuerySchema,
  paginationQuerySchema,
  recordMovementSchema,
  reservationListQuerySchema,
  setLowStockThresholdSchema,
  stockLevelListQuerySchema,
  updateWarehouseSchema,
} from '@marketplace/validation';
import { createZodDto } from '../../common/validation/zod-dto';

export class CreateWarehouseDto extends createZodDto(createWarehouseSchema) {}
export class UpdateWarehouseDto extends createZodDto(updateWarehouseSchema) {}
export class StockLevelListQueryDto extends createZodDto(stockLevelListQuerySchema) {}
export class SetLowStockThresholdDto extends createZodDto(setLowStockThresholdSchema) {}
export class RecordMovementDto extends createZodDto(recordMovementSchema) {}
export class MovementListQueryDto extends createZodDto(movementListQuerySchema) {}
export class CreateTransferDto extends createZodDto(createTransferSchema) {}
export class ReservationListQueryDto extends createZodDto(reservationListQuerySchema) {}
export class InventoryPageQueryDto extends createZodDto(paginationQuerySchema) {}
export class InventoryOverviewQueryDto extends createZodDto(inventoryOverviewQuerySchema) {}
export class DevReserveDto extends createZodDto(devReserveSchema) {}
