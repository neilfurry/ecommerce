import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ACCOUNT,
  affiliatePayableInTx,
  affiliateSettingsInTx,
  cr,
  dr,
  financeReference,
  postJournalInTx,
  Prisma,
} from '@marketplace/database';
import { AFFILIATE_QUERY_PARAM, type AuthenticatedUser } from '@marketplace/shared-types';
import type {
  AffiliateAccountDto,
  AffiliateAccountList,
  AffiliateApplication,
  AffiliateClickRequest,
  AffiliateConversionList,
  AffiliatePayoutDto,
  AffiliateReport,
  RecordAffiliatePayoutRequest,
  ReviewAffiliateRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { randomCode } from './loyalty.service';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal | null | undefined) => D(v ?? 0).toFixed(2);
const notFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Affiliate account not found.');
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);

const include = {
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.AffiliateAccountInclude;
type AccountRow = Prisma.AffiliateAccountGetPayload<{ include: typeof include }>;

/**
 * Affiliates (ADR 0032): approved accounts share links with their code; checkout attributes
 * the order; each seller order gets a conversion with a frozen base, rate and commission,
 * accrued in the double-entry ledger (5060 / 2420) when the seller order completes, reversed
 * for refunds, and paid out manually by finance (2420 / 1010). Every amount is traceable from
 * the report to the conversion, the order and the journal.
 */
@Injectable()
export class AffiliatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  private link(code: string) {
    return `${this.config.appUrls.storefront}/?${AFFILIATE_QUERY_PARAM}=${code}`;
  }

  private async totals(ids: string[]) {
    const result = new Map<string, AffiliateAccountDto['totals']>();
    if (ids.length === 0) return result;
    const list = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    const conv = await this.prisma.$queryRaw<
      {
        id: string;
        conversions: number;
        sales: Prisma.Decimal | null;
        pending: Prisma.Decimal | null;
        accrued: Prisma.Decimal | null;
        paid: Prisma.Decimal | null;
        reversed: Prisma.Decimal | null;
      }[]
    >`
      SELECT "affiliate_account_id" AS "id",
        COUNT(*) FILTER (WHERE "status" <> 'CANCELLED')::int AS "conversions",
        SUM("base_amount") FILTER (WHERE "status" <> 'CANCELLED') AS "sales",
        SUM("commission_amount" - "reversed_amount") FILTER (WHERE "status" = 'PENDING') AS "pending",
        SUM("commission_amount" - "reversed_amount") FILTER (WHERE "status" IN ('ACCRUED', 'PAID')) AS "accrued",
        SUM("commission_amount" - "reversed_amount") FILTER (WHERE "status" = 'PAID') AS "paid",
        SUM("reversed_amount") FILTER (WHERE "status" IN ('ACCRUED', 'PAID')) AS "reversed"
      FROM "affiliate_conversions" WHERE "affiliate_account_id" IN (${list})
      GROUP BY "affiliate_account_id"`;
    const clicks = await this.prisma.$queryRaw<{ id: string; clicks: number }[]>`
      SELECT "affiliate_account_id" AS "id", COUNT(*)::int AS "clicks"
      FROM "affiliate_clicks" WHERE "affiliate_account_id" IN (${list}) GROUP BY 1`;
    const payouts = await this.prisma.$queryRaw<{ id: string; total: Prisma.Decimal | null }[]>`
      SELECT "affiliate_account_id" AS "id", SUM("amount") AS "total"
      FROM "affiliate_payouts" WHERE "affiliate_account_id" IN (${list}) GROUP BY 1`;
    for (const id of ids) {
      const c = conv.find((r) => r.id === id);
      const k = clicks.find((r) => r.id === id)?.clicks ?? 0;
      const paidOut = D(payouts.find((r) => r.id === id)?.total ?? 0);
      const accrued = D(c?.accrued ?? 0);
      const conversions = c?.conversions ?? 0;
      result.set(id, {
        clicks: k,
        conversions,
        conversionRate: k > 0 ? ((conversions / k) * 100).toFixed(2) : '0.00',
        sales: money(c?.sales),
        pending: money(c?.pending),
        accrued: money(accrued),
        paid: money(paidOut),
        reversed: money(c?.reversed),
        payable: money(accrued.sub(paidOut)),
      });
    }
    return result;
  }

  private async dto(row: AccountRow, totals?: AffiliateAccountDto['totals']) {
    const settings = await affiliateSettingsInTx(this.prisma);
    const t = totals ?? (await this.totals([row.id])).get(row.id)!;
    return {
      id: row.id,
      code: row.code,
      link: this.link(row.code),
      displayName: row.displayName,
      website: row.website,
      status: row.status,
      commissionRate: (row.commissionRate ?? D(settings.defaultCommissionRate)).toFixed(2),
      ownRate: row.commissionRate?.toFixed(2) ?? null,
      reviewNote: row.reviewNote,
      user: {
        id: row.user.id,
        name: `${row.user.firstName} ${row.user.lastName}`,
        email: row.user.email,
      },
      totals: t,
      createdAt: row.createdAt.toISOString(),
    } satisfies AffiliateAccountDto;
  }

  // ---- Customers --------------------------------------------------------------------------

  async apply(user: AuthenticatedUser, input: AffiliateApplication): Promise<AffiliateAccountDto> {
    const settings = await affiliateSettingsInTx(this.prisma);
    if (!settings.enabled) throw conflict('The affiliate programme is not open right now.');
    const existing = await this.prisma.affiliateAccount.findUnique({ where: { userId: user.id } });
    if (existing) throw conflict('You already have an affiliate account.');
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const row = await this.prisma.affiliateAccount.create({
          data: {
            userId: user.id,
            code: randomCode(8, 'AF'),
            displayName: input.displayName,
            website: input.website ?? null,
          },
          include,
        });
        return this.dto(row);
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        if (await this.prisma.affiliateAccount.count({ where: { userId: user.id } }))
          throw conflict('You already have an affiliate account.');
      }
    }
    throw conflict('Please try again.');
  }

  private async mine(user: AuthenticatedUser) {
    const row = await this.prisma.affiliateAccount.findUnique({
      where: { userId: user.id },
      include,
    });
    if (!row) throw notFound();
    return row;
  }

  async me(user: AuthenticatedUser): Promise<AffiliateAccountDto> {
    return this.dto(await this.mine(user));
  }

  async myReport(user: AuthenticatedUser, months = 12): Promise<AffiliateReport> {
    return this.report((await this.mine(user)).id, months);
  }

  async myConversions(user: AuthenticatedUser, query: { page: number; pageSize: number }) {
    return this.conversions((await this.mine(user)).id, query);
  }

  async myPayouts(user: AuthenticatedUser) {
    return this.payouts((await this.mine(user)).id);
  }

  /** Monthly clicks, conversions, sales and commission (Philippine time). */
  async report(accountId: string, months = 12): Promise<AffiliateReport> {
    const since = new Date(Date.now() - months * 31 * 86_400_000);
    const rows = await this.prisma.$queryRaw<
      { month: string; conversions: number; sales: Prisma.Decimal; commission: Prisma.Decimal }[]
    >`
      SELECT to_char("created_at" AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS "month",
        COUNT(*)::int AS "conversions", SUM("base_amount") AS "sales",
        SUM("commission_amount" - "reversed_amount") AS "commission"
      FROM "affiliate_conversions"
      WHERE "affiliate_account_id" = ${accountId}::uuid AND "status" <> 'CANCELLED' AND "created_at" >= ${since}
      GROUP BY 1 ORDER BY 1`;
    const clicks = await this.prisma.$queryRaw<{ month: string; clicks: number }[]>`
      SELECT to_char("created_at" AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS "month", COUNT(*)::int AS "clicks"
      FROM "affiliate_clicks" WHERE "affiliate_account_id" = ${accountId}::uuid AND "created_at" >= ${since}
      GROUP BY 1`;
    const monthsSet = [
      ...new Set([...rows.map((r) => r.month), ...clicks.map((c) => c.month)]),
    ].sort();
    return {
      totals: (await this.totals([accountId])).get(accountId)!,
      months: monthsSet.map((month) => {
        const r = rows.find((x) => x.month === month);
        return {
          month,
          clicks: clicks.find((c) => c.month === month)?.clicks ?? 0,
          conversions: r?.conversions ?? 0,
          sales: money(r?.sales),
          commission: money(r?.commission),
        };
      }),
    };
  }

  async conversions(
    accountId: string,
    query: {
      page: number;
      pageSize: number;
      status?: 'PENDING' | 'ACCRUED' | 'CANCELLED' | 'PAID';
    },
  ): Promise<AffiliateConversionList> {
    const where: Prisma.AffiliateConversionWhereInput = {
      affiliateAccountId: accountId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.affiliateConversion.findMany({
        where,
        include: {
          order: { select: { orderNumber: true } },
          sellerOrder: { select: { number: true } },
          payout: { select: { reference: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.affiliateConversion.count({ where }),
    ]);
    return {
      items: rows.map((c) => ({
        id: c.id,
        orderNumber: c.order.orderNumber,
        sellerOrderNumber: c.sellerOrder.number,
        status: c.status,
        baseAmount: money(c.baseAmount),
        rate: c.rate.toFixed(2),
        commissionAmount: money(c.commissionAmount),
        reversedAmount: money(c.reversedAmount),
        accruedAt: c.accruedAt?.toISOString() ?? null,
        payoutReference: c.payout?.reference ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async payouts(accountId: string): Promise<{ items: AffiliatePayoutDto[] }> {
    const rows = await this.prisma.affiliatePayout.findMany({
      where: { affiliateAccountId: accountId },
      include: { _count: { select: { conversions: true } } },
      orderBy: { paidAt: 'desc' },
    });
    return {
      items: rows.map((p) => ({
        id: p.id,
        reference: p.reference,
        amount: money(p.amount),
        method: p.method,
        externalReference: p.externalReference,
        note: p.note,
        conversions: p._count.conversions,
        paidAt: p.paidAt.toISOString(),
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  /** A visit through an affiliate link (approved accounts only; no raw IP kept). */
  async click(
    input: AffiliateClickRequest,
    context: RequestContext,
  ): Promise<{ recorded: boolean }> {
    const settings = await affiliateSettingsInTx(this.prisma);
    if (!settings.enabled) return { recorded: false };
    const account = await this.prisma.affiliateAccount.findUnique({
      where: { code: input.code.toUpperCase() },
      select: { id: true, status: true },
    });
    if (!account || account.status !== 'APPROVED') return { recorded: false };
    const day = new Date().toISOString().slice(0, 10);
    const visitorHash = context.ipAddress
      ? createHash('sha256')
          .update(`${account.id}:${day}:${context.ipAddress}:${context.userAgent ?? ''}`)
          .digest('hex')
      : null;
    await this.prisma.affiliateClick.create({
      data: {
        affiliateAccountId: account.id,
        landingPath: (input.landingPath ?? '/').slice(0, 300),
        visitorHash,
      },
    });
    return { recorded: true };
  }

  // ---- Staff ------------------------------------------------------------------------------

  async list(query: {
    page: number;
    pageSize: number;
    status?: AccountRow['status'];
    search?: string;
  }): Promise<AffiliateAccountList> {
    const where: Prisma.AffiliateAccountWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search.toUpperCase() } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { user: { email: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.affiliateAccount.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.affiliateAccount.count({ where }),
    ]);
    const totals = await this.totals(rows.map((r) => r.id));
    return {
      items: await Promise.all(rows.map((r) => this.dto(r, totals.get(r.id)))),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async get(id: string): Promise<AffiliateAccountDto> {
    const row = await this.prisma.affiliateAccount.findUnique({ where: { id }, include });
    if (!row) throw notFound();
    return this.dto(row);
  }

  async review(
    staff: AuthenticatedUser,
    id: string,
    input: ReviewAffiliateRequest,
    context: RequestContext,
  ): Promise<AffiliateAccountDto> {
    const row = await this.prisma.affiliateAccount.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (row.userId === staff.id) throw conflict('You cannot review your own affiliate account.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.affiliateAccount.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.commissionRate !== undefined
            ? { commissionRate: input.commissionRate === null ? null : D(input.commissionRate) }
            : {}),
          reviewNote: input.note ?? null,
          reviewedById: staff.id,
          reviewedAt: new Date(),
        },
        include,
      });
      await this.audit.record(
        {
          action: 'affiliate.reviewed',
          actorId: staff.id,
          entityType: 'affiliate_account',
          entityId: id,
          metadata: { from: row.status, to: input.status, commissionRate: input.commissionRate },
        },
        context,
        tx,
      );
      return result;
    });
    return this.dto(updated);
  }

  /**
   * Records a manual payout of everything payable (accrued commission net of reversals, less
   * earlier payouts) and marks the accrued conversions paid. Posted Dr 2420 / Cr 1010.
   */
  async recordPayout(
    staff: AuthenticatedUser,
    id: string,
    input: RecordAffiliatePayoutRequest,
    context: RequestContext,
  ): Promise<AffiliatePayoutDto> {
    const settings = await affiliateSettingsInTx(this.prisma);
    const payoutId = await this.prisma.$transaction(async (tx) => {
      const [account] = await tx.$queryRaw<{ id: string; user_id: string }[]>`
        SELECT "id", "user_id" FROM "affiliate_accounts" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!account) throw notFound();
      if (account.user_id === staff.id) throw conflict('You cannot pay yourself.');
      const amount = await affiliatePayableInTx(tx, id);
      if (amount.lte(0)) throw conflict('Nothing is payable to this affiliate.');
      if (amount.lt(settings.minPayout))
        throw conflict(
          `The payable ₱${amount.toFixed(2)} is below the minimum payout of ₱${settings.minPayout}.`,
        );
      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
      const payout = await tx.affiliatePayout.create({
        data: {
          affiliateAccountId: id,
          reference: financeReference('AP'),
          amount,
          method: input.method,
          externalReference: input.externalReference ?? null,
          note: input.note ?? null,
          paidAt,
          createdById: staff.id,
        },
      });
      await tx.affiliateConversion.updateMany({
        where: { affiliateAccountId: id, status: 'ACCRUED' },
        data: { status: 'PAID', payoutId: payout.id },
      });
      await postJournalInTx(tx, {
        type: 'AFFILIATE_PAYOUT',
        description: `Affiliate payout ${payout.reference}`,
        occurredAt: paidAt,
        idempotencyKey: `affiliate-payout:${payout.id}`,
        sourceType: 'AFFILIATE_PAYOUT',
        sourceId: payout.id,
        createdById: staff.id,
        lines: [
          dr(ACCOUNT.AFFILIATE_PAYABLE, amount, { kind: 'AFFILIATE_PAYOUT' }),
          cr(ACCOUNT.BANK, amount, { kind: 'AFFILIATE_PAYOUT' }),
        ],
      });
      await this.audit.record(
        {
          action: 'affiliate.payout_recorded',
          actorId: staff.id,
          entityType: 'affiliate_account',
          entityId: id,
          metadata: { payoutId: payout.id, reference: payout.reference, amount: amount.toFixed(2) },
        },
        context,
        tx,
      );
      return payout.id;
    });
    const all = await this.payouts(id);
    return all.items.find((p) => p.id === payoutId)!;
  }
}
