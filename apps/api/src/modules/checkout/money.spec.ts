import { allocate, D, includedVat, sum } from './money';

describe('money helpers', () => {
  it('allocates exactly, giving leftover centavos to the largest remainders', () => {
    const parts = allocate(D('100.00'), [D('1'), D('1'), D('1')]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(parts).toFixed(2)).toBe('100.00');
  });

  it('allocates in proportion to the weights', () => {
    const parts = allocate(D('100.00'), [D('32999.00'), D('599.00'), D('2199.00')]);
    expect(sum(parts).toFixed(2)).toBe('100.00');
    expect(parts.map((p) => p.toFixed(2))).toEqual(['92.19', '1.67', '6.14']);
  });

  it('gives nothing when there is nothing to split or no weight', () => {
    expect(allocate(D('0'), [D('5')])[0]!.toFixed(2)).toBe('0.00');
    expect(allocate(D('5'), [D('0'), D('0')]).map((p) => p.toFixed(2))).toEqual(['0.00', '0.00']);
  });

  it('works out the VAT included in a VAT-inclusive amount', () => {
    expect(includedVat(D('112.00'), D('0.12')).toFixed(2)).toBe('12.00');
    expect(includedVat(D('35897.00'), D('0.12')).toFixed(2)).toBe('3846.11');
    expect(includedVat(D('100.00'), D('0')).toFixed(2)).toBe('0.00');
  });
});
