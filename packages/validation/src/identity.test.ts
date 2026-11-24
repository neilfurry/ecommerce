import { describe, expect, it } from 'vitest';
import {
  customerSignUpSchema,
  emailAddressSchema,
  maskMobile,
  passwordSchema,
  phMobileSchema,
  phTinSchema,
  reviewWholesaleSchema,
  changePasswordSchema,
} from './identity';

describe('phMobileSchema', () => {
  it.each([
    ['09171234567', '+639171234567'],
    ['0917 123 4567', '+639171234567'],
    ['0917-123-4567', '+639171234567'],
    ['+63 917 123 4567', '+639171234567'],
    ['639171234567', '+639171234567'],
    ['+639981112222', '+639981112222'],
  ])('normalises %s', (input, expected) => {
    expect(phMobileSchema.parse(input)).toBe(expected);
  });

  it.each(['0217123456', '091712345', '+6591234567', '9171234567', 'abc', '+63817 123 4567'])(
    'rejects %s',
    (input) => {
      expect(phMobileSchema.safeParse(input).success).toBe(false);
    },
  );

  it('masks numbers for display', () => {
    expect(maskMobile('+639171234567')).toBe('+63 917 *** 4567');
  });
});

describe('emailAddressSchema', () => {
  it('trims and lower-cases', () => {
    expect(emailAddressSchema.parse('  Juan.DelaCruz@Example.PH ')).toBe(
      'juan.delacruz@example.ph',
    );
  });

  it('rejects invalid addresses', () => {
    expect(emailAddressSchema.safeParse('juan@').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('requires at least 12 characters', () => {
    expect(passwordSchema.safeParse('short-pass1').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });

  it('rejects whitespace-only passwords and overly long ones', () => {
    expect(passwordSchema.safeParse(' '.repeat(16)).success).toBe(false);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});

describe('phTinSchema', () => {
  it.each([
    ['123-456-789', '123456789'],
    ['123-456-789-000', '123456789000'],
    ['123456789-00000', '12345678900000'],
  ])('normalises %s', (input, expected) => {
    expect(phTinSchema.parse(input)).toBe(expected);
  });

  it.each(['12345', '123-456-789-0', 'ABC-DEF-GHI'])('rejects %s', (input) => {
    expect(phTinSchema.safeParse(input).success).toBe(false);
  });
});

describe('customerSignUpSchema', () => {
  const base = {
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    email: 'Juan@Example.ph',
    mobile: '0917 123 4567',
    password: 'a long enough password',
  };

  it('defaults to a retail account and normalises contact details', () => {
    expect(customerSignUpSchema.parse(base)).toMatchObject({
      accountType: 'RETAIL',
      email: 'juan@example.ph',
      mobile: '+639171234567',
    });
  });

  it('requires business details for wholesale accounts', () => {
    const result = customerSignUpSchema.safeParse({ ...base, accountType: 'WHOLESALE' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['business']);
  });

  it('accepts a complete wholesale sign-up', () => {
    const parsed = customerSignUpSchema.parse({
      ...base,
      accountType: 'WHOLESALE',
      business: {
        businessName: 'Sari-Sari Supply Co.',
        tin: '123-456-789-000',
        businessAddress: '123 Rizal Avenue, Quezon City, Metro Manila',
      },
    });
    expect(parsed.business?.tin).toBe('123456789000');
  });
});

describe('reviewWholesaleSchema', () => {
  it('requires a note when rejecting', () => {
    expect(reviewWholesaleSchema.safeParse({ decision: 'REJECT' }).success).toBe(false);
    expect(
      reviewWholesaleSchema.safeParse({ decision: 'REJECT', note: 'TIN not found' }).success,
    ).toBe(true);
    expect(reviewWholesaleSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
  });
});

describe('changePasswordSchema', () => {
  it('requires a different new password', () => {
    const same = 'the same long password';
    expect(
      changePasswordSchema.safeParse({ currentPassword: same, newPassword: same }).success,
    ).toBe(false);
  });
});
