import type { NestExpressApplication } from '@nestjs/platform-express';
import { EMAIL_JOBS } from '@marketplace/config';
import { releaseExpiredReservations } from '@marketplace/database';
import {
  apiErrorBodySchema,
  inventoryOverviewSchema,
  inventorySummarySchema,
  movementListSchema,
  movementResultSchema,
  reservationSchema,
  stockLevelListSchema,
  stockLevelSchema,
  transferSchema,
  warehouseListSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { z } from 'zod';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { ReservationsService } from '../src/modules/inventory/reservations.service';
import { findJob, signedInClient, TestClient } from './auth-helpers';
import {
  approvedProduct,
  testCategory,
  testEmployee,
  testSeller,
  type TestSeller,
  unique,
} from './catalog-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;
const reservationsSchema = z.object({ reservations: z.array(reservationSchema) });

/** Warehouses, the stock ledger, transfers and reservations. */
describe('Inventory (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['SUPER_ADMIN'], 'inventory-admin')).client;
    categoryId = (await testCategory(app)).id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** A verified seller with two warehouses and one approved product. */
  async function setup() {
    const seller = await testSeller(app);
    const first = warehouseListSchema.parse(
      (
        await seller.client
          .post('/api/v1/inventory/warehouses')
          .send({
            name: 'Quezon City main',
            code: 'qc-1',
            addressLine1: '12 Mabini St',
            city: 'Quezon City',
            province: 'Metro Manila',
            postalCode: '1105',
          })
          .expect(201)
      ).body,
    );
    const both = warehouseListSchema.parse(
      (
        await seller.client
          .post('/api/v1/inventory/warehouses')
          .send({
            name: 'Cavite',
            code: 'CAV-1',
            addressLine1: '3 Aguinaldo Hwy',
            city: 'Dasmariñas',
            province: 'Cavite',
          })
          .expect(201)
      ).body,
    );
    const product = await approvedProduct(seller, admin, categoryId);
    return {
      seller,
      main: first.warehouses[0]!,
      cavite: both.warehouses.find((w) => w.code === 'CAV-1')!,
      product,
      variantId: product.variants[0]!.id,
    };
  }

  const move = (seller: TestSeller, body: Record<string, unknown>) =>
    seller.client.post('/api/v1/inventory/movements').send(body);

  async function available(warehouseId: string, variantId: string) {
    const level = await prisma.stockLevel.findUniqueOrThrow({
      where: { warehouseId_variantId: { warehouseId, variantId } },
    });
    return {
      onHand: level.quantityOnHand,
      reserved: level.reservedQuantity,
      damaged: level.damagedQuantity,
      available: level.quantityOnHand - level.reservedQuantity,
    };
  }

  describe('warehouses', () => {
    it('makes the first warehouse the default and keeps codes unique', async () => {
      const { seller, main, cavite } = await setup();
      expect(main).toMatchObject({ code: 'QC-1', isDefault: true });
      expect(cavite.isDefault).toBe(false);
      await seller.client
        .post('/api/v1/inventory/warehouses')
        .send({
          name: 'Dup',
          code: 'QC-1',
          addressLine1: '1 St',
          city: 'Pasig',
          province: 'Metro Manila',
        })
        .expect(409);
      const switched = warehouseListSchema.parse(
        (await seller.client.post(`/api/v1/inventory/warehouses/${cavite.id}/default`).expect(201))
          .body,
      );
      expect(switched.warehouses.filter((w) => w.isDefault).map((w) => w.id)).toEqual([cavite.id]);
      // The default cannot be deactivated.
      await seller.client
        .patch(`/api/v1/inventory/warehouses/${cavite.id}`)
        .send({ status: 'INACTIVE' })
        .expect(409);
    });

    it('keeps warehouses private to their seller', async () => {
      const { main } = await setup();
      const other = await testSeller(app);
      const list = warehouseListSchema.parse(
        (await other.client.get('/api/v1/inventory/warehouses').expect(200)).body,
      );
      expect(list.warehouses).toHaveLength(0);
      await other.client
        .patch(`/api/v1/inventory/warehouses/${main.id}`)
        .send({ name: 'Mine now' })
        .expect(404);
    });
  });

  describe('movements and the ledger', () => {
    it('records each movement with the resulting quantities', async () => {
      const { seller, main, variantId } = await setup();
      const steps: [string, number, string | null, { onHand: number; damaged: number }][] = [
        ['STOCK_IN', 100, null, { onHand: 100, damaged: 0 }],
        ['STOCK_OUT', 5, 'Samples for a trade fair', { onHand: 95, damaged: 0 }],
        ['ADJUSTMENT', -3, 'Cycle count found 3 missing', { onHand: 92, damaged: 0 }],
        ['ADJUSTMENT', 1, 'Found behind the shelf', { onHand: 93, damaged: 0 }],
        ['DAMAGED', 4, 'Torn sacks', { onHand: 89, damaged: 4 }],
        ['DAMAGED_WRITE_OFF', 2, 'Disposed', { onHand: 89, damaged: 2 }],
        ['RETURN_RESTOCK', 2, null, { onHand: 91, damaged: 2 }],
        ['RETURN_DAMAGED', 1, 'Returned wet', { onHand: 91, damaged: 3 }],
      ];
      for (const [type, quantity, reason, expected] of steps) {
        const result = movementResultSchema.parse(
          (
            await move(seller, { warehouseId: main.id, variantId, type, quantity, reason }).expect(
              201,
            )
          ).body,
        );
        expect(result.stockLevel).toMatchObject({
          quantityOnHand: expected.onHand,
          damagedQuantity: expected.damaged,
        });
        expect(result.movement).toMatchObject({
          type,
          onHandAfter: expected.onHand,
          damagedAfter: expected.damaged,
        });
      }
      const history = movementListSchema.parse(
        (await seller.client.get(`/api/v1/inventory/movements?variantId=${variantId}`).expect(200))
          .body,
      );
      expect(history.items.map((m) => m.type)).toEqual(steps.map(([type]) => type).reverse());
      expect(history.items[0]!.actor).toMatch(/Test/);
    });

    it('refuses changes that would make stock negative', async () => {
      const { seller, main, variantId } = await setup();
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_IN',
        quantity: 10,
      }).expect(201);
      const out = await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_OUT',
        quantity: 11,
        reason: 'Too many',
      }).expect(409);
      expect(errorCode(out)).toBe('INSUFFICIENT_STOCK');
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'ADJUSTMENT',
        quantity: -11,
        reason: 'Count',
      }).expect(409);
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'DAMAGED_WRITE_OFF',
        quantity: 1,
        reason: 'None damaged',
      }).expect(409);
      expect(await available(main.id, variantId)).toMatchObject({ onHand: 10, damaged: 0 });
    });

    it('requires a reason for stock out, adjustments and damage', async () => {
      const { seller, main, variantId } = await setup();
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_OUT',
        quantity: 1,
      }).expect(400);
      await move(seller, { warehouseId: main.id, variantId, type: 'DAMAGED', quantity: 1 }).expect(
        400,
      );
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_IN',
        quantity: -1,
      }).expect(400);
    });

    it('keeps the ledger append-only', async () => {
      const { seller, main, variantId } = await setup();
      const result = movementResultSchema.parse(
        (
          await move(seller, {
            warehouseId: main.id,
            variantId,
            type: 'STOCK_IN',
            quantity: 3,
          }).expect(201)
        ).body,
      );
      await expect(
        prisma.inventoryMovement.update({
          where: { id: result.movement.id },
          data: { quantityChange: 300 },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.inventoryMovement.delete({ where: { id: result.movement.id } }),
      ).rejects.toThrow(/append-only/);
    });

    it('never lets concurrent stock-outs take more than is there', async () => {
      const { seller, main, variantId } = await setup();
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_IN',
        quantity: 100,
      }).expect(201);
      // 25 requests for 10 units each, all at once, against 100 units.
      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          move(seller, {
            warehouseId: main.id,
            variantId,
            type: 'STOCK_OUT',
            quantity: 10,
            reason: 'Concurrent test',
          }),
        ),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(10);
      expect(statuses.filter((s) => s === 409)).toHaveLength(15);
      expect(await available(main.id, variantId)).toMatchObject({ onHand: 0 });
      const ledger = await prisma.inventoryMovement.findMany({
        where: { variantId, type: 'STOCK_OUT' },
        orderBy: { createdAt: 'asc' },
      });
      expect(ledger).toHaveLength(10);
      // Every ledger row records a distinct, consistent result.
      expect(ledger.map((m) => m.onHandAfter).sort((a, b) => b - a)).toEqual([
        90, 80, 70, 60, 50, 40, 30, 20, 10, 0,
      ]);
    });

    it('rejects other sellers’ warehouses and variants', async () => {
      const a = await setup();
      const b = await setup();
      await move(b.seller, {
        warehouseId: a.main.id,
        variantId: b.variantId,
        type: 'STOCK_IN',
        quantity: 1,
      }).expect(422);
      await move(b.seller, {
        warehouseId: b.main.id,
        variantId: a.variantId,
        type: 'STOCK_IN',
        quantity: 1,
      }).expect(422);
      const stock = stockLevelListSchema.parse(
        (await b.seller.client.get('/api/v1/inventory/stock?pageSize=100').expect(200)).body,
      );
      expect(stock.items.every((l) => l.variant.id !== a.variantId)).toBe(true);
    });

    it('lets inventory staff record movements but not product editors', async () => {
      const { seller, main, variantId } = await setup();
      const inventory = (await testEmployee(app, seller.sellerId, 'SELLER_INVENTORY')).client;
      await move(
        { ...seller, client: inventory },
        { warehouseId: main.id, variantId, type: 'STOCK_IN', quantity: 1 },
      ).expect(201);
      const encoder = (await testEmployee(app, seller.sellerId, 'SELLER_ENCODER')).client;
      await move(
        { ...seller, client: encoder },
        { warehouseId: main.id, variantId, type: 'STOCK_IN', quantity: 1 },
      ).expect(403);
      await encoder.get('/api/v1/inventory/movements').expect(200);
    });
  });

  describe('transfers', () => {
    it('moves stock between warehouses with a pair of ledger rows', async () => {
      const { seller, main, cavite, variantId } = await setup();
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_IN',
        quantity: 50,
      }).expect(201);
      const transfer = transferSchema.parse(
        (
          await seller.client
            .post('/api/v1/inventory/transfers')
            .send({
              fromWarehouseId: main.id,
              toWarehouseId: cavite.id,
              items: [{ variantId, quantity: 20 }],
              note: 'Restock Cavite',
            })
            .expect(201)
        ).body,
      );
      expect(transfer.items[0]).toMatchObject({ variantId, quantity: 20 });
      expect(await available(main.id, variantId)).toMatchObject({ onHand: 30 });
      expect(await available(cavite.id, variantId)).toMatchObject({ onHand: 20 });
      const rows = await prisma.inventoryMovement.findMany({
        where: { transferId: transfer.id },
        orderBy: { type: 'asc' },
      });
      expect(rows.map((r) => [r.type, r.quantityChange])).toEqual([
        ['TRANSFER_OUT', -20],
        ['TRANSFER_IN', 20],
      ]);
    });

    it('moves nothing when any item is short (all or nothing)', async () => {
      const { seller, main, cavite, variantId, product } = await setup();
      const second = await approvedProduct(seller, admin, categoryId);
      const secondId = second.variants[0]!.id;
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_IN',
        quantity: 10,
      }).expect(201);
      await move(seller, {
        warehouseId: main.id,
        variantId: secondId,
        type: 'STOCK_IN',
        quantity: 2,
      }).expect(201);
      const res = await seller.client
        .post('/api/v1/inventory/transfers')
        .send({
          fromWarehouseId: main.id,
          toWarehouseId: cavite.id,
          items: [
            { variantId, quantity: 5 },
            { variantId: secondId, quantity: 3 },
          ],
        })
        .expect(409);
      expect(errorCode(res)).toBe('INSUFFICIENT_STOCK');
      expect(await available(main.id, variantId)).toMatchObject({ onHand: 10 });
      expect(await prisma.stockTransfer.count({ where: { sellerId: seller.sellerId } })).toBe(0);
      expect(product.id).toBeDefined();
      await seller.client
        .post('/api/v1/inventory/transfers')
        .send({
          fromWarehouseId: main.id,
          toWarehouseId: main.id,
          items: [{ variantId, quantity: 1 }],
        })
        .expect(400);
    });
  });

  describe('low stock', () => {
    it('notifies once when available stock reaches the threshold, and re-arms after restocking', async () => {
      const { seller, main, variantId, product } = await setup();
      const stocked = movementResultSchema.parse(
        (
          await move(seller, {
            warehouseId: main.id,
            variantId,
            type: 'STOCK_IN',
            quantity: 30,
          }).expect(201)
        ).body,
      );
      const level = stockLevelSchema.parse(
        (
          await seller.client
            .put(`/api/v1/inventory/stock/${stocked.stockLevel.id}/threshold`)
            .send({ lowStockThreshold: 10 })
            .expect(200)
        ).body,
      );
      expect(level.isLowStock).toBe(false);
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_OUT',
        quantity: 20,
        reason: 'Big order',
      }).expect(201);
      const job = await findJob<{ items: { sku: string; available: number }[] }>(
        app,
        'email',
        (data, j) =>
          j.name === EMAIL_JOBS.LOW_STOCK &&
          data.items.some((i) => i.sku === product.variants[0]!.sku),
      );
      expect(job.data.items[0]).toMatchObject({ available: 10 });
      const notifiedAt = (await prisma.stockLevel.findUniqueOrThrow({ where: { id: level.id } }))
        .lowStockNotifiedAt;
      expect(notifiedAt).not.toBeNull();
      // Falling further does not send another notice.
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_OUT',
        quantity: 1,
        reason: 'One more',
      }).expect(201);
      expect(
        (await prisma.stockLevel.findUniqueOrThrow({ where: { id: level.id } })).lowStockNotifiedAt,
      ).toEqual(notifiedAt);
      // Restocking re-arms the notice.
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_IN',
        quantity: 50,
      }).expect(201);
      expect(
        (await prisma.stockLevel.findUniqueOrThrow({ where: { id: level.id } })).lowStockNotifiedAt,
      ).toBeNull();
      const low = stockLevelListSchema.parse(
        (await seller.client.get('/api/v1/inventory/stock?lowStock=true').expect(200)).body,
      );
      expect(low.items).toHaveLength(0);
    });
  });

  describe('reservations', () => {
    const reserve = (
      items: { variantId: string; quantity: number }[],
      ttlMinutes = 15,
      ref = unique('checkout'),
    ) =>
      admin
        .post('/api/v1/dev/inventory/reservations')
        .send({ checkoutReference: ref, items, ttlMinutes });

    it('holds stock, prevents overselling, releases and converts', async () => {
      const { seller, main, variantId } = await setup();
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_IN',
        quantity: 10,
      }).expect(201);
      const held = reservationsSchema.parse(
        (await reserve([{ variantId, quantity: 7 }]).expect(201)).body,
      ).reservations;
      expect(held[0]).toMatchObject({ quantity: 7, status: 'ACTIVE' });
      expect(await available(main.id, variantId)).toMatchObject({
        onHand: 10,
        reserved: 7,
        available: 3,
      });

      const short = await reserve([{ variantId, quantity: 4 }]).expect(409);
      expect(errorCode(short)).toBe('INSUFFICIENT_STOCK');
      // Reserved stock cannot be taken out either.
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_OUT',
        quantity: 4,
        reason: 'x',
      }).expect(409);

      await admin.post(`/api/v1/dev/inventory/reservations/${held[0]!.id}/release`).expect(200);
      expect(await available(main.id, variantId)).toMatchObject({ reserved: 0, available: 10 });

      const second = reservationsSchema.parse(
        (await reserve([{ variantId, quantity: 6 }]).expect(201)).body,
      ).reservations[0]!;
      const converted = reservationSchema.parse(
        (await admin.post(`/api/v1/dev/inventory/reservations/${second.id}/convert`).expect(200))
          .body,
      );
      expect(converted.status).toBe('CONVERTED');
      expect(await available(main.id, variantId)).toMatchObject({ onHand: 4, reserved: 0 });
      const sale = await prisma.inventoryMovement.findFirstOrThrow({
        where: { reservationId: second.id },
      });
      expect(sale).toMatchObject({ type: 'SALE', quantityChange: -6, onHandAfter: 4 });
      // Releasing a converted reservation changes nothing.
      await admin.post(`/api/v1/dev/inventory/reservations/${second.id}/release`).expect(200);
      expect(await available(main.id, variantId)).toMatchObject({ onHand: 4, reserved: 0 });
    });

    it('reserves from the default warehouse first, then others', async () => {
      const { seller, main, cavite, variantId } = await setup();
      await move(seller, { warehouseId: main.id, variantId, type: 'STOCK_IN', quantity: 3 }).expect(
        201,
      );
      await move(seller, {
        warehouseId: cavite.id,
        variantId,
        type: 'STOCK_IN',
        quantity: 5,
      }).expect(201);
      const held = reservationsSchema.parse(
        (await reserve([{ variantId, quantity: 6 }]).expect(201)).body,
      ).reservations;
      expect(held.map((r) => [r.warehouse.code, r.quantity]).sort()).toEqual([
        ['CAV-1', 3],
        ['QC-1', 3],
      ]);
    });

    it('never oversells under concurrent checkouts', async () => {
      const { seller, main, variantId } = await setup();
      await move(seller, {
        warehouseId: main.id,
        variantId,
        type: 'STOCK_IN',
        quantity: 20,
      }).expect(201);
      const service = app.get(ReservationsService);
      const results = await Promise.allSettled(
        Array.from({ length: 30 }, (_, i) =>
          service.reserve({ checkoutReference: `race-${i}`, items: [{ variantId, quantity: 3 }] }),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok).toHaveLength(6);
      expect(await available(main.id, variantId)).toMatchObject({
        onHand: 20,
        reserved: 18,
        available: 2,
      });
    });

    it('expires reservations and gives the stock back; expired ones cannot be converted', async () => {
      const { seller, main, variantId } = await setup();
      await move(seller, { warehouseId: main.id, variantId, type: 'STOCK_IN', quantity: 5 }).expect(
        201,
      );
      const held = reservationsSchema.parse(
        (await reserve([{ variantId, quantity: 5 }], 1).expect(201)).body,
      ).reservations[0]!;
      // Pretend the checkout timed out.
      await prisma.stockReservation.update({
        where: { id: held.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const converted = await admin
        .post(`/api/v1/dev/inventory/reservations/${held.id}/convert`)
        .expect(409);
      expect(errorCode(converted)).toBe('RESERVATION_NOT_ACTIVE');
      // A new checkout releases the expired hold itself, even before the sweep runs.
      const fresh = reservationsSchema.parse(
        (await reserve([{ variantId, quantity: 5 }]).expect(201)).body,
      ).reservations[0]!;
      expect(fresh.quantity).toBe(5);
      expect(
        (await prisma.stockReservation.findUniqueOrThrow({ where: { id: held.id } })).status,
      ).toBe('EXPIRED');
      expect(await available(main.id, variantId)).toMatchObject({ reserved: 5 });

      // The sweep (as run by the worker) releases what is due.
      await prisma.stockReservation.update({
        where: { id: fresh.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await releaseExpiredReservations(prisma)).toBeGreaterThanOrEqual(1);
      expect(await releaseExpiredReservations(prisma)).toBe(0);
      expect(await available(main.id, variantId)).toMatchObject({ reserved: 0, available: 5 });
    });

    it('shows sellers their reservations', async () => {
      const { seller, main, variantId } = await setup();
      await move(seller, { warehouseId: main.id, variantId, type: 'STOCK_IN', quantity: 5 }).expect(
        201,
      );
      await reserve([{ variantId, quantity: 2 }]).expect(201);
      const summary = inventorySummarySchema.parse(
        (await seller.client.get('/api/v1/inventory/summary').expect(200)).body,
      );
      expect(summary).toMatchObject({
        onHand: 5,
        reserved: 2,
        available: 3,
        activeReservations: 1,
        warehouses: 2,
      });
      const other = await testSeller(app);
      const theirs = await other.client.get('/api/v1/inventory/reservations').expect(200);
      expect((theirs.body as { items: unknown[] }).items).toHaveLength(0);
    });
  });

  it('gives staff with inventory.read an overview across sellers', async () => {
    const { seller, main, variantId } = await setup();
    await move(seller, { warehouseId: main.id, variantId, type: 'STOCK_IN', quantity: 7 }).expect(
      201,
    );
    // Look the seller up by name: a database used for many runs has more sellers than a page.
    const { businessName } = await prisma.seller.findUniqueOrThrow({
      where: { id: seller.sellerId },
      select: { businessName: true },
    });
    const overview = inventoryOverviewSchema.parse(
      (
        await admin
          .get('/api/v1/inventory/overview')
          .query({ search: businessName, pageSize: 100 })
          .expect(200)
      ).body,
    );
    expect(overview.totals.onHand).toBeGreaterThanOrEqual(7);
    expect(overview.sellers.items.find((s) => s.sellerId === seller.sellerId)).toMatchObject({
      onHand: 7,
      warehouses: 2,
    });
    await seller.client.get('/api/v1/inventory/overview').expect(403);
  });
});
