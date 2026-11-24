import { constantTimeEqual, hashOtp, randomOtpCode, randomToken, sha256 } from './crypto';

describe('auth crypto helpers', () => {
  it('generates URL-safe 256-bit tokens that do not repeat', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => randomToken()));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates six-digit codes, keeping leading zeros', () => {
    for (let i = 0; i < 200; i += 1) expect(randomOtpCode()).toMatch(/^\d{6}$/);
  });

  it('hashes tokens with SHA-256', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('binds OTP hashes to the secret and the challenge', () => {
    const base = hashOtp('secret', 'challenge-1', '123456');
    expect(hashOtp('secret', 'challenge-1', '123456')).toBe(base);
    expect(hashOtp('secret', 'challenge-2', '123456')).not.toBe(base);
    expect(hashOtp('other', 'challenge-1', '123456')).not.toBe(base);
  });

  it('compares strings of different lengths without throwing', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });
});
