import {
  calculatePrice,
  Decimal,
  QuantityOutOfRangeError,
  type VariantPricing,
} from './price-engine';

const NOW = new Date('2026-11-25T08:00:00Z');
const d = (v: string) => new Decimal(v);
const tier = (
  minQuantity: number,
  unitPrice: string,
  extra: Partial<VariantPricing['tiers'][number]> = {},
) => ({
  id: `tier-${minQuantity}-${extra.variantId ?? 'all'}`,
  variantId: null,
  minQuantity,
  unitPrice: d(unitPrice),
  startsAt: null,
  endsAt: null,
  ...extra,
});

/** The example from the Phase 3 brief: 1–9 ₱500, 10–49 ₱450, 50–99 ₱420, 100+ ₱390. */
function rice(overrides: Partial<VariantPricing> = {}): VariantPricing {
  return {
    variantId: 'v1',
    productId: 'p1',
    sellerId: 's1',
    sku: 'RICE-25KG',
    currency: 'PHP',
    regularPrice: d('500.00'),
    salePrice: null,
    saleStartsAt: null,
    saleEndsAt: null,
    minOrderQuantity: 1,
    maxOrderQuantity: null,
    wholesaleEnabled: true,
    wholesaleMinOrderQuantity: 1,
    tiers: [tier(1, '500.00'), tier(10, '450.00'), tier(50, '420.00'), tier(100, '390.00')],
    customerPrices: [],
    ...overrides,
  };
}
const wholesale = { wholesale: true };
const retail = { wholesale: false };

describe('calculatePrice', () => {
  it.each([
    [1, '500.00', 'REGULAR'],
    [9, '500.00', 'REGULAR'],
    [10, '450.00', 'WHOLESALE_TIER'],
    [49, '450.00', 'WHOLESALE_TIER'],
    [50, '420.00', 'WHOLESALE_TIER'],
    [99, '420.00', 'WHOLESALE_TIER'],
    [100, '390.00', 'WHOLESALE_TIER'],
    [5000, '390.00', 'WHOLESALE_TIER'],
  ])('wholesale buyer, %i units → ₱%s (%s)', (qty, price, source) => {
    const line = calculatePrice(rice(), qty, wholesale, NOW);
    expect(line.unitPrice).toBe(price);
    expect(line.source).toBe(source);
    expect(line.lineTotal).toBe(new Decimal(price).times(qty).toFixed(2));
  });

  it('records the tier that produced the price', () => {
    const line = calculatePrice(rice(), 60, wholesale, NOW);
    expect(line.rule).toEqual({
      type: 'PRICE_TIER',
      id: 'tier-50-all',
      minQuantity: 50,
      startsAt: null,
      endsAt: null,
    });
    expect(line.tiers).toHaveLength(4);
  });

  it('retail buyers always pay retail, at any quantity, and see no tiers', () => {
    const line = calculatePrice(rice(), 500, retail, NOW);
    expect(line).toMatchObject({
      unitPrice: '500.00',
      source: 'REGULAR',
      wholesaleEligible: false,
    });
    expect(line.tiers).toEqual([]);
  });

  it('ignores tiers when the product has wholesale turned off', () => {
    const line = calculatePrice(rice({ wholesaleEnabled: false }), 100, wholesale, NOW);
    expect(line.source).toBe('REGULAR');
  });

  it('applies tiers only from the wholesale minimum quantity', () => {
    const data = rice({ wholesaleMinOrderQuantity: 20 });
    expect(calculatePrice(data, 15, wholesale, NOW).unitPrice).toBe('500.00');
    expect(calculatePrice(data, 20, wholesale, NOW).unitPrice).toBe('450.00');
  });

  it("prefers a variant's own tiers over the product's", () => {
    const data = rice({ tiers: [...rice().tiers, tier(10, '440.00', { variantId: 'v1' })] });
    expect(calculatePrice(data, 100, wholesale, NOW)).toMatchObject({ unitPrice: '440.00' });
  });

  it('uses the sale price while the sale runs, and the regular price outside it', () => {
    const sale = {
      salePrice: d('475.00'),
      saleStartsAt: new Date('2026-11-20T00:00:00Z'),
      saleEndsAt: new Date('2026-12-01T00:00:00Z'),
    };
    expect(calculatePrice(rice(sale), 1, retail, NOW)).toMatchObject({
      unitPrice: '475.00',
      source: 'SALE',
    });
    const later = new Date('2026-12-02T00:00:00Z');
    expect(calculatePrice(rice(sale), 1, retail, later)).toMatchObject({ source: 'REGULAR' });
  });

  it('never charges a wholesale buyer more than the running sale price', () => {
    const line = calculatePrice(rice({ salePrice: d('430.00') }), 10, wholesale, NOW);
    expect(line).toMatchObject({ unitPrice: '430.00', source: 'SALE' });
  });

  it('honours tier effective dates', () => {
    const data = rice({
      tiers: [
        tier(10, '450.00', { endsAt: new Date('2026-11-01T00:00:00Z') }),
        tier(10, '460.00', { id: 'new', startsAt: new Date('2026-11-01T00:00:00Z') }),
      ],
    });
    expect(calculatePrice(data, 10, wholesale, NOW).rule?.id).toBe('new');
  });

  it('gives a customer their agreed price over every other price', () => {
    const data = rice({
      customerPrices: [
        tier(1, '480.00', { id: 'all-variants' }),
        tier(1, '470.00', { id: 'this-variant', variantId: 'v1' }),
      ],
    });
    expect(calculatePrice(data, 2, retail, NOW)).toMatchObject({
      unitPrice: '470.00',
      source: 'CUSTOMER_PRICE',
      rule: { id: 'this-variant' },
    });
  });

  it('ignores an agreed price below its quantity or outside its dates', () => {
    const data = rice({
      customerPrices: [
        tier(20, '400.00'),
        tier(1, '410.00', { id: 'expired', endsAt: new Date('2026-01-01T00:00:00Z') }),
      ],
    });
    expect(calculatePrice(data, 5, retail, NOW).source).toBe('REGULAR');
    expect(calculatePrice(data, 20, retail, NOW).unitPrice).toBe('400.00');
  });

  it('enforces the minimum and maximum order quantity', () => {
    const data = rice({ minOrderQuantity: 2, maxOrderQuantity: 10 });
    expect(() => calculatePrice(data, 1, retail, NOW)).toThrow(QuantityOutOfRangeError);
    expect(() => calculatePrice(data, 11, retail, NOW)).toThrow('between 2 and 10');
    expect(calculatePrice(data, 10, retail, NOW).lineTotal).toBe('5000.00');
  });

  it('computes totals exactly, without floating-point error', () => {
    const line = calculatePrice(rice({ regularPrice: d('0.10'), tiers: [] }), 3, retail, NOW);
    expect(line.lineTotal).toBe('0.30');
  });

  describe('flash sales', () => {
    const flash = (extra: Partial<NonNullable<VariantPricing['flash']>> = {}) => ({
      itemId: 'flash-1',
      flashPrice: d('399.00'),
      startsAt: new Date('2026-11-25T00:00:00Z'),
      endsAt: new Date('2026-11-26T00:00:00Z'),
      remaining: 10,
      perOrderLimit: 2,
      ...extra,
    });

    it('applies the flash price while it runs, within the per-order limit and units left', () => {
      const line = calculatePrice(rice({ flash: flash() }), 2, retail, NOW);
      expect(line).toMatchObject({
        unitPrice: '399.00',
        source: 'FLASH_SALE',
        lineTotal: '798.00',
      });
      expect(line.rule).toMatchObject({ type: 'FLASH_SALE', id: 'flash-1' });
      expect(line.flashSale).toEqual({
        itemId: 'flash-1',
        endsAt: '2026-11-26T00:00:00.000Z',
        remaining: 10,
        perOrderLimit: 2,
      });
    });

    it('charges retail for the whole line above the per-order limit or the units left', () => {
      expect(calculatePrice(rice({ flash: flash() }), 3, retail, NOW).source).toBe('REGULAR');
      const few = flash({ remaining: 1, perOrderLimit: null });
      expect(calculatePrice(rice({ flash: few }), 2, retail, NOW).unitPrice).toBe('500.00');
      expect(calculatePrice(rice({ flash: few }), 1, retail, NOW).unitPrice).toBe('399.00');
    });

    it('ignores a flash sale that has not started or has ended', () => {
      const later = flash({ startsAt: new Date('2026-11-25T09:00:00Z') });
      expect(calculatePrice(rice({ flash: later }), 1, retail, NOW).source).toBe('REGULAR');
      const over = flash({ endsAt: new Date('2026-11-25T08:00:00Z') });
      expect(calculatePrice(rice({ flash: over }), 1, retail, NOW).source).toBe('REGULAR');
    });

    it('keeps the cheaper of a sale price and the flash price', () => {
      const onSale = rice({ salePrice: d('350.00'), flash: flash() });
      expect(calculatePrice(onSale, 1, retail, NOW)).toMatchObject({
        unitPrice: '350.00',
        source: 'SALE',
        flashSale: null,
      });
    });

    it('gives wholesale buyers the tier when it beats the flash price, and agreed prices win', () => {
      const cheapTiers = rice({
        flash: flash({ perOrderLimit: null, remaining: 500 }),
        tiers: [tier(100, '380.00')],
      });
      expect(calculatePrice(cheapTiers, 100, wholesale, NOW).source).toBe('WHOLESALE_TIER');
      expect(calculatePrice(cheapTiers, 10, wholesale, NOW).source).toBe('FLASH_SALE');
      const agreed = rice({
        flash: flash(),
        customerPrices: [tier(1, '450.00', { id: 'agreed' })],
      });
      expect(calculatePrice(agreed, 1, retail, NOW)).toMatchObject({
        source: 'CUSTOMER_PRICE',
        flashSale: null,
      });
    });
  });
});
