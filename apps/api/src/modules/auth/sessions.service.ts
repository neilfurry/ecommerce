import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { REDIS_KEYS } from '@marketplace/config';
import type { ClientApp as DbClientApp, Prisma, SessionRevokeReason } from '@marketplace/database';
import type { ClientApp } from '@marketplace/shared-types';
import type { Redis } from 'ioredis';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { AccessTokenService } from './access-token.service';
import { randomToken, sha256 } from './crypto';

type Db = Prisma.TransactionClient | PrismaService;

export const toDbApp = (app: ClientApp): DbClientApp => app.toUpperCase() as DbClientApp;
export const fromDbApp = (app: DbClientApp): ClientApp => app.toLowerCase() as ClientApp;

/** A refresh token presented again within this window is treated as a concurrent-tab race. */
export const ROTATION_GRACE_MS = 10_000;

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type RotationResult =
  | { status: 'rotated'; userId: string; session: IssuedSession }
  | { status: 'race' }
  | { status: 'reuse'; userId: string; familyId: string }
  | { status: 'invalid' };

/**
 * Sessions are rows of rotating, single-use refresh tokens (only SHA-256 hashes stored).
 * Customers get sliding 30-day sessions; staff get absolute 12-hour sessions from sign-in.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly accessTokens: AccessTokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  sessionLifetimeMs(app: ClientApp): number {
    return app === 'storefront'
      ? this.config.auth.customerSessionDays * 86_400_000
      : this.config.auth.staffSessionHours * 3_600_000;
  }

  /** Starts a new session (a new rotation family) after a successful sign-in. */
  async start(userId: string, app: ClientApp, context: RequestContext, db: Db = this.prisma) {
    return this.createRow(db, {
      userId,
      app,
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + this.sessionLifetimeMs(app)),
      context,
    });
  }

  async rotate(
    refreshToken: string,
    app: ClientApp,
    context: RequestContext,
  ): Promise<RotationResult> {
    const existing = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    if (!existing || fromDbApp(existing.app) !== app) return { status: 'invalid' };

    const now = Date.now();
    if (existing.revokedAt) {
      if (existing.revokedReason === 'ROTATED') {
        if (now - existing.revokedAt.getTime() < ROTATION_GRACE_MS) return { status: 'race' };
        await this.revokeFamily(existing.familyId, 'REUSE_DETECTED');
        return { status: 'reuse', userId: existing.userId, familyId: existing.familyId };
      }
      return { status: 'invalid' };
    }
    if (existing.expiresAt.getTime() <= now) return { status: 'invalid' };

    const expiresAt =
      app === 'storefront' ? new Date(now + this.sessionLifetimeMs(app)) : existing.expiresAt;

    const session = await this.prisma
      .$transaction(async (tx) => {
        const issued = await this.createRow(tx, {
          userId: existing.userId,
          app,
          familyId: existing.familyId,
          expiresAt,
          context,
        });
        // Compare-and-set: only one concurrent rotation of the same token can win.
        const updated = await tx.session.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: {
            revokedAt: new Date(now),
            revokedReason: 'ROTATED',
            replacedById: issued.sessionId,
          },
        });
        if (updated.count !== 1) throw new RotationRaceError();
        return issued;
      })
      .catch((error: unknown) => {
        if (error instanceof RotationRaceError) return null;
        throw error;
      });
    if (!session) return { status: 'race' };
    return { status: 'rotated', userId: existing.userId, session };
  }

  async revoke(sessionId: string, reason: SessionRevokeReason): Promise<void> {
    await this.revokeWhere({ id: sessionId }, reason);
  }

  async revokeFamily(familyId: string, reason: SessionRevokeReason): Promise<void> {
    await this.revokeWhere({ familyId }, reason);
  }

  /** Signs a user out everywhere (optionally keeping the current session). */
  async revokeAllForUser(
    userId: string,
    reason: SessionRevokeReason,
    exceptSessionId?: string,
  ): Promise<number> {
    return this.revokeWhere(
      { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      reason,
    );
  }

  async countActive(userId: string): Promise<number> {
    return this.prisma.session.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  /** True when the session was revoked (checked on every request via Redis). */
  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(`${REDIS_KEYS.REVOKED_SESSION_PREFIX}${sessionId}`)) === 1;
  }

  private async revokeWhere(
    where: Prisma.SessionWhereInput,
    reason: SessionRevokeReason,
  ): Promise<number> {
    const targets = await this.prisma.session.findMany({
      where: { ...where, revokedAt: null },
      select: { id: true },
    });
    if (targets.length === 0) return 0;
    const ids = targets.map((t) => t.id);
    await this.prisma.session.updateMany({
      where: { id: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    // Access tokens of these sessions stop working immediately, not at expiry.
    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.set(
        `${REDIS_KEYS.REVOKED_SESSION_PREFIX}${id}`,
        reason,
        'EX',
        this.config.auth.accessTokenTtlSeconds + 60,
      );
    }
    await pipeline.exec();
    return ids.length;
  }

  private async createRow(
    db: Db,
    input: {
      userId: string;
      app: ClientApp;
      familyId: string;
      expiresAt: Date;
      context: RequestContext;
    },
  ): Promise<IssuedSession> {
    const refreshToken = randomToken();
    const row = await db.session.create({
      data: {
        userId: input.userId,
        familyId: input.familyId,
        app: toDbApp(input.app),
        refreshTokenHash: sha256(refreshToken),
        expiresAt: input.expiresAt,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      },
      select: { id: true },
    });
    const access = this.accessTokens.issue({
      userId: input.userId,
      sessionId: row.id,
      app: input.app,
    });
    return {
      sessionId: row.id,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshExpiresAt: input.expiresAt,
    };
  }
}

class RotationRaceError extends Error {}
