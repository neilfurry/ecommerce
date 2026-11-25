import {
  INVENTORY_MOVEMENT_TYPES,
  MANUAL_MOVEMENT_TYPES,
  MAX_RESERVATION_TTL_MINUTES,
  STOCK_RESERVATION_STATUSES,
  WAREHOUSE_STATUSES,
} from '@marketplace/shared-types';
import { z } from 'zod';
import { paginationQuerySchema } from './common';
import { paginatedSchema } from './dev-tools';
import { phMobileSchema } from './identity';
import { postalCodeSchema } from './sellers';

/** Contracts for warehouses, stock levels, the movement ledger, transfers and reservations. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const warehouseStatusSchema = z.enum(WAREHOUSE_STATUSES);
export const movementTypeSchema = z.enum(INVENTORY_MOVEMENT_TYPES);
export const manualMovementTypeSchema = z.enum(MANUAL_MOVEMENT_TYPES);
export const reservationStatusSchema = z.enum(STOCK_RESERVATION_STATUSES);

// ---- Warehouses ---------------------------------------------------------------------------

const warehouseShape = {
  name: z.string().trim().min(2, 'Enter a name').max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, 'Up to 20 letters, numbers and "-", e.g. QC-1'),
  addressLine1: z.string().trim().min(3, 'Enter the street address').max(160),
  addressLine2: optionalText(160),
  barangay: optionalText(100),
  city: z.string().trim().min(2, 'Enter the city or municipality').max(100),
  province: z.string().trim().min(2, 'Enter the province').max(100),
  postalCode: postalCodeSchema.nullable().optional(),
  contactName: optionalText(120),
  phone: phMobileSchema.nullable().optional(),
  /**
   * The address as PSGC codes (the shipping origin). When given, the barangay, city and
   * province text is taken from the official names.
   */
  location: z
    .object({
      regionCode: z.string().regex(/^\d{10}$/),
      provinceCode: z
        .string()
        .regex(/^\d{10}$/)
        .nullable()
        .optional(),
      cityCode: z.string().regex(/^\d{10}$/),
      barangayCode: z.string().regex(/^\d{10}$/),
    })
    .nullable()
    .optional(),
};

export const createWarehouseSchema = z.object({
  ...warehouseShape,
  isDefault: z.boolean().default(false),
});
export type CreateWarehouseRequest = z.input<typeof createWarehouseSchema>;

export const updateWarehouseSchema = z
  .object({ ...warehouseShape, status: warehouseStatusSchema })
  .partial();
export type UpdateWarehouseRequest = z.input<typeof updateWarehouseSchema>;

export const warehouseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  barangay: z.string().nullable(),
  city: z.string(),
  province: z.string(),
  postalCode: z.string().nullable(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  location: z
    .object({
      regionCode: z.string(),
      provinceCode: z.string().nullable(),
      cityCode: z.string(),
      barangayCode: z.string().nullable(),
    })
    .nullable(),
  /** Whether checkout can quote shipping from here (the address has a PSGC location). */
  canShip: z.boolean(),
  status: warehouseStatusSchema,
  isDefault: z.boolean(),
  totals: z.object({
    skus: z.number().int(),
    onHand: z.number().int(),
    reserved: z.number().int(),
    damaged: z.number().int(),
  }),
  createdAt: z.iso.datetime(),
});
export type WarehouseDto = z.infer<typeof warehouseSchema>;
export const warehouseListSchema = z.object({ warehouses: z.array(warehouseSchema) });
export type WarehouseList = z.infer<typeof warehouseListSchema>;

// ---- Stock levels -------------------------------------------------------------------------

export const stockLevelSchema = z.object({
  id: z.uuid(),
  warehouse: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
  variant: z.object({ id: z.uuid(), sku: z.string(), title: z.string() }),
  product: z.object({ id: z.uuid(), name: z.string(), status: z.string() }),
  quantityOnHand: z.number().int(),
  reservedQuantity: z.number().int(),
  availableQuantity: z.number().int(),
  damagedQuantity: z.number().int(),
  lowStockThreshold: z.number().int().nullable(),
  isLowStock: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type StockLevelDto = z.infer<typeof stockLevelSchema>;
export const stockLevelListSchema = paginatedSchema(stockLevelSchema);
export type StockLevelList = z.infer<typeof stockLevelListSchema>;

export const stockLevelListQuerySchema = paginationQuerySchema.extend({
  warehouseId: z.uuid().optional(),
  productId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type StockLevelListQuery = z.infer<typeof stockLevelListQuerySchema>;

export const setLowStockThresholdSchema = z.object({
  lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000).nullable(),
});

export const inventorySummarySchema = z.object({
  warehouses: z.number().int(),
  skus: z.number().int(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  damaged: z.number().int(),
  lowStock: z.number().int(),
  outOfStock: z.number().int(),
  activeReservations: z.number().int(),
});
export type InventorySummary = z.infer<typeof inventorySummarySchema>;

// ---- Movements (ledger) -------------------------------------------------------------------

/**
 * POST /inventory/movements: records a manual movement. `quantity` is the number of units
 * (positive); for ADJUSTMENT it is signed (+ found, − missing). Transfers and sales have
 * their own flows.
 */
export const recordMovementSchema = z
  .object({
    warehouseId: z.uuid('Choose a warehouse'),
    variantId: z.uuid('Choose a product variant'),
    type: manualMovementTypeSchema,
    quantity: z.coerce.number().int().min(-1_000_000).max(1_000_000),
    reason: optionalText(500),
  })
  .refine((v) => v.quantity !== 0, { message: 'Enter a quantity', path: ['quantity'] })
  .refine((v) => v.type === 'ADJUSTMENT' || v.quantity > 0, {
    message: 'Enter a positive number of units',
    path: ['quantity'],
  })
  .refine((v) => ['STOCK_IN', 'RETURN_RESTOCK'].includes(v.type) || !!v.reason, {
    message: 'Explain the reason',
    path: ['reason'],
  });
export type RecordMovementRequest = z.input<typeof recordMovementSchema>;

export const movementSchema = z.object({
  id: z.uuid(),
  type: movementTypeSchema,
  warehouse: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
  variant: z.object({ id: z.uuid(), sku: z.string(), title: z.string() }),
  product: z.object({ id: z.uuid(), name: z.string() }),
  quantityChange: z.number().int(),
  damagedChange: z.number().int(),
  onHandAfter: z.number().int(),
  reservedAfter: z.number().int(),
  damagedAfter: z.number().int(),
  reason: z.string().nullable(),
  transferId: z.uuid().nullable(),
  reservationId: z.uuid().nullable(),
  actor: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type MovementDto = z.infer<typeof movementSchema>;
export const movementListSchema = paginatedSchema(movementSchema);
export type MovementList = z.infer<typeof movementListSchema>;

export const movementListQuerySchema = paginationQuerySchema.extend({
  warehouseId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  productId: z.uuid().optional(),
  type: movementTypeSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;

/** The result of recording a movement: the ledger row and the stock level after it. */
export const movementResultSchema = z.object({
  movement: movementSchema,
  stockLevel: stockLevelSchema,
});
export type MovementResult = z.infer<typeof movementResultSchema>;

// ---- Transfers ----------------------------------------------------------------------------

export const createTransferSchema = z
  .object({
    fromWarehouseId: z.uuid('Choose where the stock comes from'),
    toWarehouseId: z.uuid('Choose where the stock goes'),
    items: z
      .array(
        z.object({
          variantId: z.uuid(),
          quantity: z.coerce.number().int().min(1, 'At least 1').max(1_000_000),
        }),
      )
      .min(1, 'Add at least one item')
      .max(100),
    note: optionalText(500),
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    message: 'Choose two different warehouses',
    path: ['toWarehouseId'],
  })
  .refine((v) => new Set(v.items.map((i) => i.variantId)).size === v.items.length, {
    message: 'Each variant can appear once',
    path: ['items'],
  });
export type CreateTransferRequest = z.input<typeof createTransferSchema>;

export const transferSchema = z.object({
  id: z.uuid(),
  fromWarehouse: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
  toWarehouse: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
  items: z.array(
    z.object({
      variantId: z.uuid(),
      sku: z.string(),
      title: z.string(),
      productName: z.string(),
      quantity: z.number().int(),
    }),
  ),
  note: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});
export type TransferDto = z.infer<typeof transferSchema>;
export const transferListSchema = paginatedSchema(transferSchema);
export type TransferList = z.infer<typeof transferListSchema>;

// ---- Reservations -------------------------------------------------------------------------

export const reservationSchema = z.object({
  id: z.uuid(),
  variant: z.object({ id: z.uuid(), sku: z.string(), title: z.string() }),
  warehouse: z.object({ id: z.uuid(), name: z.string(), code: z.string() }),
  quantity: z.number().int(),
  status: reservationStatusSchema,
  checkoutReference: z.string(),
  orderItemId: z.uuid().nullable(),
  /** Null while the stock is held for a placed order (until fulfilment or cancellation). */
  expiresAt: z.iso.datetime().nullable(),
  releasedAt: z.iso.datetime().nullable(),
  convertedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReservationDto = z.infer<typeof reservationSchema>;
export const reservationListSchema = paginatedSchema(reservationSchema);
export type ReservationList = z.infer<typeof reservationListSchema>;
export const reservationListQuerySchema = paginationQuerySchema.extend({
  status: reservationStatusSchema.optional(),
  variantId: z.uuid().optional(),
});

/**
 * Development tools only (/dev/inventory/reservations): exercises the reservation flow that
 * checkout will use in the next phase.
 */
export const devReserveSchema = z.object({
  checkoutReference: z.string().trim().min(1).max(100),
  items: z
    .array(z.object({ variantId: z.uuid(), quantity: z.coerce.number().int().min(1).max(10_000) }))
    .min(1)
    .max(50),
  ttlMinutes: z.coerce.number().int().min(1).max(MAX_RESERVATION_TTL_MINUTES).default(15),
});
export type DevReserveRequest = z.input<typeof devReserveSchema>;

// ---- Admin overview -----------------------------------------------------------------------

export const sellerInventoryRowSchema = z.object({
  sellerId: z.uuid(),
  businessName: z.string(),
  warehouses: z.number().int(),
  skus: z.number().int(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  damaged: z.number().int(),
  lowStock: z.number().int(),
  outOfStock: z.number().int(),
});
export const inventoryOverviewSchema = z.object({
  totals: inventorySummarySchema,
  sellers: paginatedSchema(sellerInventoryRowSchema),
});
export type InventoryOverview = z.infer<typeof inventoryOverviewSchema>;
export const inventoryOverviewQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});
