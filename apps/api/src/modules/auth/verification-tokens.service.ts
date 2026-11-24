import { Injectable } from '@nestjs/common';
import type { Prisma, VerificationTokenPurpose } from '@marketplace/database';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomToken, sha256 } from './crypto';

type Db = Prisma.TransactionClient | PrismaService;

export const TOKEN_LIFETIMES_MS: Record<VerificationTokenPurpose, number> = {
  EMAIL_VERIFICATION: 3 * 86_400_000,
  PASSWORD_RESET: 30 * 60_000,
  INVITATION: 7 * 86_400_000,
};

/**
 * Single-use tokens for links sent by email. Issuing a new token invalidates earlier
 * unused tokens of the same purpose for that user, so only the latest link works.
 */
@Injectable()
export class VerificationTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(
    userId: string,
    purpose: VerificationTokenPurpose,
    db: Db = this.prisma,
  ): Promise<string> {
    const now = new Date();
    await db.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    const token = randomToken();
    await db.verificationToken.create({
      data: {
        userId,
        purpose,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + TOKEN_LIFETIMES_MS[purpose]),
      },
    });
    return token;
  }

  /**
   * Atomically consumes a valid token and returns its user id, or null when the token is
   * unknown, expired, already used or for another purpose.
   */
  async consume(
    token: string,
    purpose: VerificationTokenPurpose,
    db: Db = this.prisma,
  ): Promise<string | null> {
    const row = await db.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt <= new Date())
      return null;
    const updated = await db.verificationToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return updated.count === 1 ? row.userId : null;
  }
}
