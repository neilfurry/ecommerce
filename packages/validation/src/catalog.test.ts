import { describe, expect, it } from 'vitest';
import {
  createCategorySchema,
  createProductSchema,
  customerPriceInputSchema,
  priceQuoteRequestSchema,
  priceSchema,
  productDetailsFormSchema,
  updateProductSchema,
  putCategoryAttributesSchema,
  setProductOptionsSchema,
  slugify,
  updateVariantSchema,
} from './catalog';
import { createTransferSchema, createWarehouseSchema, recordMovementSchema } from './inventory';

const UUID = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d70';
const UUID2 = '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d71';

describe('catalog contracts', () => {
  it('slugifies names', () => {
    expect(slugify('Sinandomeng Rice 25 kg!')).toBe('sinandomeng-rice-25-kg');
    expect(slugify('  Ñiño — Café  ')).toBe('nino-cafe');
    expect(slugify('***')).toBe('');
  });

  it('lets the details form leave optional attributes empty, but not the API', () => {
    const body = {
      name: 'Dinorado Rice 5 kg',
      attributeValues: { net_weight: 5, variety: undefined },
    };
    expect(productDetailsFormSchema.safeParse(body).success).toBe(true);
    expect(updateProductSchema.safeParse(body).success).toBe(false);
  });

  it('accepts prices as decimal strings only, above zero, with centavos at most', () => {
    expect(priceSchema.safeParse('499.50').success).toBe(true);
    expect(priceSchema.safeParse('0').success).toBe(false);
    expect(priceSchema.safeParse('1.999').success).toBe(false);
    expect(priceSchema.safeParse(499.5).success).toBe(false);
  });

  it('treats a blank category link as "generate it"', () => {
    expect(createCategorySchema.parse({ name: 'Snacks', slug: '' }).slug).toBeUndefined();
    expect(createCategorySchema.safeParse({ name: 'Snacks', slug: 'Bad Slug' }).success).toBe(
      false,
    );
  });

  it('needs two choices for choice-list attributes and unique codes', () => {
    const one = putCategoryAttributesSchema.safeParse({
      attributes: [{ code: 'colour', name: 'Colour', type: 'SELECT', options: ['Red'] }],
    });
    expect(one.success).toBe(false);
    const dup = putCategoryAttributesSchema.safeParse({
      attributes: [
        { code: 'a', name: 'A', type: 'TEXT' },
        { code: 'a', name: 'B', type: 'TEXT' },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it('requires a SKU and a price to create a product', () => {
    const base = { storeId: UUID, categoryId: UUID2, name: 'Rice' };
    expect(
      createProductSchema.safeParse({ ...base, sku: 'R-1', regularPrice: '500.00' }).success,
    ).toBe(true);
    expect(
      createProductSchema.safeParse({ ...base, sku: 'has space', regularPrice: '500.00' }).success,
    ).toBe(false);
    expect(createProductSchema.safeParse({ ...base, sku: 'R-1' }).success).toBe(false);
  });

  it('refuses duplicate option names and values', () => {
    const generate = { skuPrefix: 'TEE', regularPrice: '299.00' };
    expect(
      setProductOptionsSchema.safeParse({
        options: [{ name: 'Size', values: ['S', 's'] }],
        generate,
      }).success,
    ).toBe(false);
    expect(
      setProductOptionsSchema.safeParse({
        options: [
          { name: 'Size', values: ['S'] },
          { name: 'size', values: ['M'] },
        ],
        generate,
      }).success,
    ).toBe(false);
  });

  it('checks the sale window order', () => {
    expect(
      updateVariantSchema.safeParse({
        saleStartsAt: '2026-12-02T00:00:00Z',
        saleEndsAt: '2026-12-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('never accepts a price in a quote request', () => {
    expect(
      priceQuoteRequestSchema.safeParse({ items: [{ variantId: UUID, quantity: 2 }] }).success,
    ).toBe(true);
    expect(
      priceQuoteRequestSchema.safeParse({
        items: [{ variantId: UUID, quantity: 2 }],
        total: '1.00',
      }).success,
    ).toBe(false);
    const parsed = priceQuoteRequestSchema.parse({
      items: [{ variantId: UUID, quantity: 2, unitPrice: '1.00' }],
    });
    expect(parsed.items[0]).toEqual({ variantId: UUID, quantity: 2 });
  });

  it('validates customer price windows', () => {
    expect(
      customerPriceInputSchema.safeParse({
        customerEmail: 'a@example.com',
        unitPrice: '400.00',
        startsAt: '2026-12-01T00:00:00Z',
        endsAt: '2026-11-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});

describe('inventory contracts', () => {
  const movement = { warehouseId: UUID, variantId: UUID2 };

  it('allows negative quantities only for adjustments, and requires reasons where it matters', () => {
    expect(
      recordMovementSchema.safeParse({ ...movement, type: 'STOCK_IN', quantity: 10 }).success,
    ).toBe(true);
    expect(
      recordMovementSchema.safeParse({ ...movement, type: 'STOCK_IN', quantity: -1 }).success,
    ).toBe(false);
    expect(
      recordMovementSchema.safeParse({
        ...movement,
        type: 'ADJUSTMENT',
        quantity: -3,
        reason: 'Count',
      }).success,
    ).toBe(true);
    expect(
      recordMovementSchema.safeParse({ ...movement, type: 'ADJUSTMENT', quantity: 0, reason: 'x' })
        .success,
    ).toBe(false);
    expect(
      recordMovementSchema.safeParse({ ...movement, type: 'STOCK_OUT', quantity: 1 }).success,
    ).toBe(false);
    // Sales and transfers are not manual movements.
    expect(
      recordMovementSchema.safeParse({ ...movement, type: 'SALE', quantity: 1, reason: 'x' })
        .success,
    ).toBe(false);
  });

  it('upper-cases warehouse codes and normalises mobiles', () => {
    const parsed = createWarehouseSchema.parse({
      name: 'Main',
      code: 'qc-1',
      addressLine1: '12 Mabini St',
      city: 'Quezon City',
      province: 'Metro Manila',
      phone: '0917 123 4567',
    });
    expect(parsed).toMatchObject({ code: 'QC-1', phone: '+639171234567' });
  });

  it('needs two different warehouses and unique items for a transfer', () => {
    expect(
      createTransferSchema.safeParse({
        fromWarehouseId: UUID,
        toWarehouseId: UUID,
        items: [{ variantId: UUID2, quantity: 1 }],
      }).success,
    ).toBe(false);
    expect(
      createTransferSchema.safeParse({
        fromWarehouseId: UUID,
        toWarehouseId: UUID2,
        items: [
          { variantId: UUID2, quantity: 1 },
          { variantId: UUID2, quantity: 2 },
        ],
      }).success,
    ).toBe(false);
  });
});
