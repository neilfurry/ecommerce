import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  otpauthUrl,
  timeStep,
  totpAt,
  verifyTotp,
} from './totp';

describe('TOTP', () => {
  // RFC 6238 appendix B test secret ("12345678901234567890"), SHA-1, truncated to 6 digits.
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 test vector at T=%i', (seconds, code) => {
    expect(totpAt(rfcSecret, timeStep(seconds * 1000))).toBe(code);
  });

  it('round-trips base32', () => {
    const buffer = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
    expect(base32Decode(base32Encode(buffer))).toEqual(buffer);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts the previous, current and next step, and never the same step twice', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = timeStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), now, null)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), now, step)).toBeNull();
  });

  it('builds an otpauth URI for authenticator apps', () => {
    const url = otpauthUrl('ABC', 'ana@example.ph', 'Marketplace');
    expect(url).toBe(
      'otpauth://totp/Marketplace%3Aana%40example.ph?secret=ABC&issuer=Marketplace&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('encrypts secrets so they cannot be read or altered without the key', () => {
    const encrypted = encryptSecret('JBSWY3DPEHPK3PXP', 'key-one-that-is-long-enough-0123456789');
    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(encrypted, 'key-one-that-is-long-enough-0123456789')).toBe(
      'JBSWY3DPEHPK3PXP',
    );
    expect(() => decryptSecret(encrypted, 'another-key-that-is-long-enough-01234')).toThrow();
  });

  it('generates distinct recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});
