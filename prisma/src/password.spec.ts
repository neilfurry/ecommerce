import { describe, expect, it } from 'vitest';
import { dummyPasswordHash, hashPassword, passwordNeedsRehash, verifyPassword } from './password';

describe('password hashing (Argon2id)', () => {
  it('hashes with Argon2id and verifies', async () => {
    const hashed = await hashPassword('correct horse battery staple');
    expect(hashed).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(verifyPassword(hashed, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(hashed, 'wrong password!!')).resolves.toBe(false);
  });

  it('produces a different salt every time', async () => {
    expect(await hashPassword('same password here')).not.toBe(
      await hashPassword('same password here'),
    );
  });

  it('returns false instead of throwing for malformed hashes', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('flags hashes made with weaker parameters', async () => {
    expect(passwordNeedsRehash(await hashPassword('x'.repeat(12)))).toBe(false);
    expect(passwordNeedsRehash('$argon2id$v=19$m=4096,t=1,p=1$abc$def')).toBe(true);
    expect(passwordNeedsRehash('$2b$10$bcrypt-hash')).toBe(true);
  });

  it('provides a dummy hash for constant-time sign-in failures', async () => {
    const dummy = await dummyPasswordHash();
    await expect(verifyPassword(dummy, 'anything at all')).resolves.toBe(false);
  });
});
