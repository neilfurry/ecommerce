import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with the OWASP Password Storage Cheat Sheet baseline (19 MiB, 2 iterations,
 * 1 lane). Parameters are encoded in each hash, so they can be raised later and old
 * hashes upgraded on the next successful sign-in (see passwordNeedsRehash).
 */
export const ARGON2_PARAMS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

/** Never throws for malformed hashes; returns false instead. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** True when the hash was made with weaker parameters than the current ones. */
export function passwordNeedsRehash(passwordHash: string): boolean {
  const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
  if (!match) return true;
  const [, m, t, p] = match.map(Number);
  return (
    m! < ARGON2_PARAMS.memoryCost || t! < ARGON2_PARAMS.timeCost || p! < ARGON2_PARAMS.parallelism
  );
}

/**
 * A valid hash of a random value, verified against when an account does not exist so
 * sign-in takes the same time either way (prevents account enumeration by timing).
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(`not-a-real-password-${Math.random()}`);
  return dummyHash;
}
