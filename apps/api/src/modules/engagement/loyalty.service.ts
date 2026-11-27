import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  addMonths,
  affiliateSettingsInTx,
  daysFrom,
  expiringPointsInTx,
  InsufficientPointsError,
  loyaltySettingsInTx,
  pointsForAmount,
  postLoyaltyInTx,
  Prisma,
} from '@marketplace/database';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import {
  type AdminLoyaltyAccount,
  type AdminLoyaltyAccountList,
  type AffiliateSettings,
  affiliateSettingsSchema,
  type LoyaltyAdjustmentRequest,
  type LoyaltySettings,
  loyaltySettingsSchema,
  type LoyaltySummary,
  type LoyaltyTransactionDto,
  type MyReferrals,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const randomCode = (length: number, prefix = '') => {
  let code = prefix;
  while (code.length < length) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
};

const page = <T>(items: T[], q: { page: number; pageSize: number }, totalItems: number) => ({
  items,
  page: q.page,
  pageSize: q.pageSize,
  totalItems,
  totalPages: Math.ceil(totalItems / q.pageSize),
});

/**
 * Loyalty points (ADR 0031) and customer referrals: balances and the points ledger for
 * customers, staff views and adjustments, and the loyalty / affiliate settings.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  // ---- Settings ---------------------------------------------------------------------------

  loyaltySettings(): Promise<LoyaltySettings> {
    return loyaltySettingsInTx(this.prisma);
  }

  affiliateSettings(): Promise<AffiliateSettings> {
    return affiliateSettingsInTx(this.prisma);
  }

  async saveSettings(
    key: 'loyalty' | 'affiliates',
    input: unknown,
    user: AuthenticatedUser,
    context: RequestContext,
  ) {
    const value =
      key === 'loyalty' ? loyaltySettingsSchema.parse(input) : affiliateSettingsSchema.parse(input);
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, updatedById: user.id },
        update: { value: value as Prisma.InputJsonValue, updatedById: user.id },
      });
      await this.audit.record(
        {
          action: `settings.${key}_updated`,
          actorId: user.id,
          entityType: 'platform_setting',
          entityId: key,
          metadata: value as Record<string, unknown>,
        },
        context,
        tx,
      );
    });
    return value;
  }

  // ---- Customer ---------------------------------------------------------------------------

  async summary(userId: string): Promise<LoyaltySummary> {
    const settings = await loyaltySettingsInTx(this.prisma);
    const account = await this.prisma.loyaltyAccount.findUnique({ where: { userId } });
    const now = new Date();
    const expiring = await expiringPointsInTx(this.prisma, userId, now, daysFrom(now, 30));
    // Seller orders delivered but not completed yet: points still to come.
    const open = await this.prisma.sellerOrder.findMany({
      where: {
        order: { customerId: userId },
        status: { in: ['PENDING', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED'] },
      },
      select: { items: { select: { lineTotal: true } } },
      take: 200,
    });
    const pending = settings.enabled
      ? open.reduce(
          (n, so) =>
            n +
            pointsForAmount(
              so.items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0)),
              settings,
            ),
          0,
        )
      : 0;
    const balance = account?.balance ?? 0;
    return {
      enabled: settings.enabled,
      balance,
      value: (balance * Number(settings.pointValue)).toFixed(2),
      lifetimeEarned: account?.lifetimeEarned ?? 0,
      expiringSoon: { points: expiring.points, firstAt: expiring.firstAt?.toISOString() ?? null },
      pending,
      rules: {
        pesosPerPoint: settings.pesosPerPoint,
        pointValue: settings.pointValue,
        maxRedeemPercent: settings.maxRedeemPercent,
        expiryMonths: settings.expiryMonths,
      },
    };
  }

  async transactions(
    userId: string,
    query: { page: number; pageSize: number; type?: LoyaltyTransactionDto['type'] },
  ): Promise<PaginatedResponse<LoyaltyTransactionDto>> {
    const where: Prisma.LoyaltyTransactionWhereInput = {
      userId,
      ...(query.type ? { type: query.type } : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.loyaltyTransaction.findMany({
        where,
        include: { order: { select: { orderNumber: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.loyaltyTransaction.count({ where }),
    ]);
    return page(
      rows.map((t) => ({
        id: t.id,
        type: t.type,
        points: t.points,
        balanceAfter: t.balanceAfter,
        value: t.value.toFixed(2),
        expiresAt: t.expiresAt?.toISOString() ?? null,
        description: t.description,
        orderNumber: t.order?.orderNumber ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
      query,
      totalItems,
    );
  }

  /** The customer's referral code (created on first use) and the friends who joined with it. */
  async referrals(user: AuthenticatedUser): Promise<MyReferrals> {
    const settings = await loyaltySettingsInTx(this.prisma);
    let code = (
      await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { referralCode: true },
      })
    ).referralCode;
    for (let attempt = 0; !code && attempt < 5; attempt++) {
      const candidate = randomCode(8);
      const { count } = await this.prisma.user
        .updateMany({
          where: { id: user.id, referralCode: null },
          data: { referralCode: candidate },
        })
        .catch(() => ({ count: 0 }));
      code = count
        ? candidate
        : (await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).referralCode;
    }
    const rows = await this.prisma.referral.findMany({
      where: { referrerId: user.id },
      include: { referee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      enabled: settings.enabled && settings.referral.enabled,
      code: code!,
      link: `${this.config.appUrls.storefront}/sign-up?ref=${code}`,
      referrerPoints: settings.referral.referrerPoints,
      refereePoints: settings.referral.refereePoints,
      referrals: rows.map((r) => ({
        name: `${r.referee.firstName} ${r.referee.lastName.slice(0, 1)}.`,
        status: r.status,
        joinedAt: r.createdAt.toISOString(),
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
      })),
    };
  }

  // ---- Staff ------------------------------------------------------------------------------

  async accounts(query: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<AdminLoyaltyAccountList> {
    const where: Prisma.LoyaltyAccountWhereInput = query.search
      ? {
          user: {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          },
        }
      : {};
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.loyaltyAccount.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.loyaltyAccount.count({ where }),
    ]);
    return page(
      rows.map((a) => ({
        userId: a.userId,
        name: `${a.user.firstName} ${a.user.lastName}`,
        email: a.user.email,
        balance: a.balance,
        lifetimeEarned: a.lifetimeEarned,
        updatedAt: a.updatedAt.toISOString(),
      })),
      query,
      totalItems,
    );
  }

  async account(userId: string): Promise<AdminLoyaltyAccount> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Customer not found.');
    return {
      ...(await this.summary(userId)),
      user: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
    };
  }

  /** A manual correction with a reason; posted to the ledger (5050 ↔ 2410). */
  async adjust(
    staff: AuthenticatedUser,
    userId: string,
    input: LoyaltyAdjustmentRequest,
    context: RequestContext,
  ): Promise<AdminLoyaltyAccount> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Customer not found.');
    const settings = await loyaltySettingsInTx(this.prisma);
    const points = Number(input.points);
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const result = await postLoyaltyInTx(tx, {
          userId,
          type: 'ADJUST',
          points,
          description: input.reason,
          idempotencyKey: `adjust:${userId}:${now.getTime()}:${randomCode(6)}`,
          createdById: staff.id,
          expiresAt: points > 0 ? addMonths(now, settings.expiryMonths) : null,
          posting: 'EXPENSE',
          now,
        });
        await this.audit.record(
          {
            action: 'loyalty.adjusted',
            actorId: staff.id,
            entityType: 'user',
            entityId: userId,
            metadata: { points, reason: input.reason, transactionId: result?.id ?? null },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      if (error instanceof InsufficientPointsError) {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', error.message);
      }
      throw error;
    }
    return this.account(userId);
  }
}
