import { D } from './money';
import {
  campaignHeadline,
  campaignSaving,
  chooseItemPromotions,
  chooseShippingPromotion,
  type EngineCampaign,
  type EngineLine,
  targets,
} from './promotion-engine';

let n = 0;
const campaign = (c: Partial<EngineCampaign> & Pick<EngineCampaign, 'type'>): EngineCampaign => ({
  id: `c${++n}`,
  name: `Campaign ${n}`,
  season: null,
  scope: 'PLATFORM',
  sellerId: null,
  value: D(10),
  maxDiscount: null,
  minQuantity: 1,
  buyQuantity: null,
  getQuantity: null,
  minSpend: D(0),
  appliesTo: 'ALL',
  productIds: [],
  categoryIds: [],
  priority: 0,
  createdAt: new Date(2026, 0, n),
  ...c,
});
const line = (l: Partial<EngineLine> = {}): EngineLine => ({
  productId: 'p1',
  categoryPath: ['leaf', 'root'],
  sellerId: 's1',
  quantity: 1,
  unitPrice: D(1000),
  regularPrice: D(1000),
  isFlashSale: false,
  ...l,
});

describe('promotion engine', () => {
  it('matches product and category targets (categories include their subcategories)', () => {
    expect(targets({ appliesTo: 'ALL', productIds: [], categoryIds: [] }, line())).toBe(true);
    expect(targets({ appliesTo: 'PRODUCTS', productIds: ['p2'], categoryIds: [] }, line())).toBe(
      false,
    );
    expect(
      targets({ appliesTo: 'CATEGORIES', productIds: [], categoryIds: ['root'] }, line()),
    ).toBe(true);
  });

  it('computes each campaign type’s saving', () => {
    const l = line({ quantity: 3, unitPrice: D(200), regularPrice: D(200) });
    expect(
      campaignSaving(campaign({ type: 'PERCENTAGE_OFF', value: D(15) }), l, D(200)).toFixed(2),
    ).toBe('90.00');
    expect(
      campaignSaving(
        campaign({ type: 'PERCENTAGE_OFF', value: D(50), maxDiscount: D(100) }),
        l,
        D(200),
      ).toFixed(2),
    ).toBe('100.00');
    expect(
      campaignSaving(campaign({ type: 'FIXED_OFF', value: D(250) }), l, D(200)).toFixed(2),
    ).toBe('600.00');
    const b1t1 = campaign({ type: 'BUY_X_GET_Y', value: D(100), buyQuantity: 1, getQuantity: 1 });
    expect(campaignSaving(b1t1, l, D(200)).toFixed(2)).toBe('200.00');
    const b2g1half = campaign({
      type: 'BUY_X_GET_Y',
      value: D(50),
      buyQuantity: 2,
      getQuantity: 1,
    });
    expect(campaignSaving(b2g1half, line({ quantity: 6 }), D(100)).toFixed(2)).toBe('100.00');
  });

  it('keeps the flash sale unless a campaign saves more, and then prices from the regular price', () => {
    const flash = line({ unitPrice: D(900), regularPrice: D(1000), isFlashSale: true });
    const small = campaign({ type: 'PERCENTAGE_OFF', value: D(5) });
    expect(chooseItemPromotions([flash], [small])[0]).toMatchObject({ campaign: null });
    const big = campaign({ type: 'PERCENTAGE_OFF', value: D(15) });
    const choice = chooseItemPromotions([flash], [small, big])[0]!;
    expect(choice.campaign?.id).toBe(big.id);
    expect(choice.discount.toFixed(2)).toBe('150.00');
    expect(choice.dropsFlashSale).toBe(true);
    // A tie keeps the flash sale.
    const tie = campaign({ type: 'FIXED_OFF', value: D(100) });
    expect(chooseItemPromotions([flash], [tie])[0]!.campaign).toBeNull();
  });

  it('gives at most one campaign per item: the best, then higher priority, then the older one', () => {
    const a = campaign({ type: 'PERCENTAGE_OFF', value: D(10) });
    const b = campaign({ type: 'FIXED_OFF', value: D(100), priority: 5 });
    const c = campaign({ type: 'FIXED_OFF', value: D(100) });
    expect(chooseItemPromotions([line()], [a, c, b])[0]!.campaign?.id).toBe(b.id);
    expect(chooseItemPromotions([line()], [c, a])[0]!.campaign?.id).toBe(a.id);
  });

  it('only gives a bundle when enough units of that store take it', () => {
    const bundle = campaign({
      type: 'BUNDLE',
      value: D(10),
      minQuantity: 3,
      productIds: ['p1', 'p2'],
      appliesTo: 'PRODUCTS',
    });
    const better = campaign({
      type: 'PERCENTAGE_OFF',
      value: D(20),
      productIds: ['p2'],
      appliesTo: 'PRODUCTS',
    });
    const lines = [line({ quantity: 2 }), line({ productId: 'p2', quantity: 1 })];
    // p2 prefers the 20% campaign, leaving 2 units for the bundle: below 3, so no bundle.
    const choices = chooseItemPromotions(lines, [bundle, better]);
    expect(choices[0]!.campaign).toBeNull();
    expect(choices[1]!.campaign?.id).toBe(better.id);
    // Without the competing campaign all 3 units qualify.
    const both = chooseItemPromotions(lines, [bundle]);
    expect(both.map((c) => c.campaign?.id)).toEqual([bundle.id, bundle.id]);
    // Another store's units do not count.
    const split = chooseItemPromotions(
      [line({ quantity: 2 }), line({ productId: 'p2', sellerId: 's2' })],
      [bundle],
    );
    expect(split.map((c) => c.campaign)).toEqual([null, null]);
  });

  it('caps a bundle at its maximum discount per store', () => {
    const bundle = campaign({ type: 'BUNDLE', value: D(50), minQuantity: 2, maxDiscount: D(300) });
    const choices = chooseItemPromotions([line(), line({ productId: 'p2' })], [bundle]);
    expect(choices.reduce((s, c) => s.plus(c.discount), D(0)).toFixed(2)).toBe('300.00');
  });

  it('limits seller campaigns to that seller’s items', () => {
    const mine = campaign({ type: 'PERCENTAGE_OFF', scope: 'SELLER', sellerId: 's2' });
    expect(chooseItemPromotions([line()], [mine])[0]!.campaign).toBeNull();
  });

  it('chooses free shipping when the eligible items reach the minimum spend', () => {
    const ship = campaign({ type: 'FREE_SHIPPING', minSpend: D(500), maxDiscount: D(80) });
    const items = [{ line: line(), itemsAfterPromotions: D(400) }];
    expect(chooseShippingPromotion('s1', items, D(120), [ship])).toBeNull();
    const ok = chooseShippingPromotion(
      's1',
      [{ line: line(), itemsAfterPromotions: D(600) }],
      D(120),
      [ship],
    );
    expect(ok?.discount.toFixed(2)).toBe('80.00');
    expect(chooseShippingPromotion('s1', items, D(0), [ship])).toBeNull();
  });

  it('describes campaigns for the storefront', () => {
    const base = { value: '100', minQuantity: 1, buyQuantity: 1, getQuantity: 1, minSpend: '0' };
    expect(campaignHeadline({ ...base, type: 'BUY_X_GET_Y' })).toBe('Buy 1, take 1');
    expect(campaignHeadline({ ...base, type: 'PERCENTAGE_OFF', value: '15' })).toBe('15% off');
    expect(campaignHeadline({ ...base, type: 'FREE_SHIPPING', minSpend: '999' })).toBe(
      'Free shipping over ₱999.00',
    );
  });
});
