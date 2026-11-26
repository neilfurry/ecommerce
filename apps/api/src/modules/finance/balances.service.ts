import { Injectable } from '@nestjs/common';
import {
  ACCOUNT,
  cr,
  dr,
  financeSettingsInTx,
  lockSellerBalanceInTx,
  periodContaining,
  postJournalInTx,
  Prisma,
  sellerBalances,
  type SellerBalances,
} from '@marketplace/database';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type {
  FinanceSummary,
  ReserveRequest,
  SellerBalanceList,
  SellerBalancesDto,
  SellerFinanceOverview,
  Subledger,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  conflict,
  D,
  m,
  manilaDayEnd,
  manilaDayStart,
  notFound,
  paged,
  SELLER_ACCOUNT_BY_CODE,
  SELLER_ACCOUNT_CODES,
  ZERO,
} from './finance-common';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | 'platformSetting'>;

/** Seller balances, statements of account and reserves, all derived from ledger lines. */
@Injectable()
export class BalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async balancesDto(sellerId: string, db: Db = this.prisma): Promise<SellerBalancesDto> {
    const [b, settings] = await Promise.all([
      sellerBalances(db, sellerId),
      financeSettingsInTx(db),
    ]);
    return this.dto(b, settings.payouts.minimumAmount);
  }

  private dto(b: SellerBalances, minimum: string): SellerBalancesDto {
    const withdrawable = b.available.gte(D(minimum)) ? b.available : ZERO;
    return {
      pending: m(b.pending),
      held: m(b.held),
      available: m(b.available),
      reserved: m(b.reserved),
      inPayout: m(b.inPayout),
      paid: m(b.paid),
      withdrawable: m(withdrawable),
      minimumPayout: minimum,
      currency: 'PHP',
    };
  }

  /** Every seller with ledger activity (or matching the search), with totals. */
  async list(query: {
    page: number;
    pageSize: number;
    q?: string;
    negativeOnly?: boolean;
  }): Promise<SellerBalanceList> {
    const rows = await this.prisma.$queryRaw<
      { seller_id: string; code: string; balance: Prisma.Decimal }[]
    >`
      SELECT e."seller_id", a."code", SUM(e."credit" - e."debit") AS "balance"
      FROM "journal_entries" e
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."seller_subledger"
      GROUP BY e."seller_id", a."code"`;
    const paidRows = await this.prisma.$queryRaw<{ seller_id: string; amount: Prisma.Decimal }[]>`
      SELECT e."seller_id", SUM(e."credit" - e."debit") AS "amount"
      FROM "journal_entries" e
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."code" IN ('1010', '1020')
      WHERE e."kind" = 'PAYOUT' AND e."seller_id" IS NOT NULL
      GROUP BY e."seller_id"`;
    const bySeller = new Map<string, SellerBalances>();
    const get = (id: string) => {
      let b = bySeller.get(id);
      if (!b) {
        b = {
          pending: ZERO,
          held: ZERO,
          available: ZERO,
          reserved: ZERO,
          inPayout: ZERO,
          paid: ZERO,
        };
        bySeller.set(id, b);
      }
      return b;
    };
    for (const r of rows) {
      const b = get(r.seller_id);
      const key = {
        '2110': 'pending',
        '2120': 'available',
        '2130': 'reserved',
        '2140': 'inPayout',
      }[r.code] as keyof SellerBalances | undefined;
      if (key) b[key] = D(r.balance);
    }
    for (const r of paidRows) get(r.seller_id).paid = D(r.amount);
    const sellers = await this.prisma.seller.findMany({
      where: {
        id: { in: [...bySeller.keys()] },
        ...(query.q ? { businessName: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      select: { id: true, businessName: true, status: true },
      orderBy: { businessName: 'asc' },
    });
    const settings = await financeSettingsInTx(this.prisma);
    let all = sellers.map((s) => ({
      seller: { id: s.id, name: s.businessName, status: s.status },
      ...this.dto(bySeller.get(s.id)!, settings.payouts.minimumAmount),
    }));
    if (query.negativeOnly) all = all.filter((r) => Number(r.available) < 0);
    const total = (k: 'pending' | 'held' | 'available' | 'reserved' | 'inPayout' | 'paid') =>
      m(all.reduce((s, r) => s.add(D(r[k])), ZERO));
    const start = (query.page - 1) * query.pageSize;
    return {
      ...paged(all.slice(start, start + query.pageSize), query.page, query.pageSize, all.length),
      totals: {
        pending: total('pending'),
        held: total('held'),
        available: total('available'),
        reserved: total('reserved'),
        inPayout: total('inPayout'),
        paid: total('paid'),
      },
    };
  }

  /** The seller's payable lines (statement of account), newest first. */
  async subledger(
    sellerId: string,
    query: {
      page: number;
      pageSize: number;
      account?: keyof typeof SELLER_ACCOUNT_CODES;
      kind?: string;
      from?: string;
      to?: string;
    },
  ): Promise<Subledger> {
    const where: Prisma.JournalEntryWhereInput = {
      sellerId,
      account: query.account
        ? { code: SELLER_ACCOUNT_CODES[query.account] }
        : { sellerSubledger: true },
      transaction: {
        status: 'POSTED',
        ...(query.from || query.to
          ? {
              occurredAt: {
                ...(query.from ? { gte: manilaDayStart(query.from) } : {}),
                ...(query.to ? { lt: manilaDayEnd(query.to) } : {}),
              },
            }
          : {}),
      },
      ...(query.kind ? { kind: query.kind } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          transaction: {
            select: { id: true, reference: true, type: true, occurredAt: true, description: true },
          },
          account: { select: { code: true } },
          sellerOrder: { select: { id: true, number: true } },
        },
        orderBy: [
          { transaction: { occurredAt: 'desc' } },
          { createdAt: 'desc' },
          { lineNo: 'desc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return paged(
      rows.map((e) => ({
        id: e.id,
        journal: {
          id: e.transaction.id,
          reference: e.transaction.reference,
          type: e.transaction.type,
        },
        occurredAt: e.transaction.occurredAt.toISOString(),
        account: SELLER_ACCOUNT_BY_CODE[e.account.code]!,
        kind: e.kind,
        description: e.description ?? e.transaction.description,
        sellerOrder: e.sellerOrder,
        amount: m(e.credit.sub(e.debit)),
      })),
      query.page,
      query.pageSize,
      total,
    );
  }

  /** Sales, deductions and earnings recognised for a seller in a period (from ledger lines). */
  async summary(sellerId: string, from: string, to: string): Promise<FinanceSummary> {
    const rows = await this.prisma.$queryRaw<
      { kind: string | null; amount: Prisma.Decimal; orders: bigint }[]
    >`
      SELECT e."kind", SUM(e."credit" - e."debit") AS "amount", COUNT(DISTINCT e."seller_order_id") AS "orders"
      FROM "journal_entries" e
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."code" = '2110'
      WHERE e."seller_id" = ${sellerId}::uuid
        AND t."occurred_at" >= ${manilaDayStart(from)} AND t."occurred_at" < ${manilaDayEnd(to)}
      GROUP BY e."kind"`;
    const of = (k: string) => D(rows.find((r) => r.kind === k)?.amount ?? 0);
    const grossSales = of('SALE');
    const commission = of('COMMISSION').add(of('COMMISSION_REVERSAL')).neg();
    const fees = of('PAYMENT_FEE').add(of('COD_FEE')).neg();
    const refunds = of('REFUND').neg();
    const shipping = of('SHIPPING_CREDIT');
    return {
      from,
      to,
      grossSales: m(grossSales),
      commission: m(commission),
      paymentFees: m(fees),
      refunds: m(refunds),
      shippingCredits: m(shipping),
      netEarnings: m(grossSales.sub(commission).sub(fees).sub(refunds).add(shipping)),
      orders: Number(rows.find((r) => r.kind === 'SALE')?.orders ?? 0),
    };
  }

  async overview(sellerId: string, from: string, to: string): Promise<SellerFinanceOverview> {
    const settings = await financeSettingsInTx(this.prisma);
    const current = periodContaining(new Date(), settings.settlement);
    const [balances, summary, bank, seller] = await Promise.all([
      this.balancesDto(sellerId),
      this.summary(sellerId, from, to),
      this.prisma.sellerBankAccount.count({ where: { sellerId, status: 'VERIFIED' } }),
      this.prisma.seller.findUniqueOrThrow({
        where: { id: sellerId },
        select: { taxVerifiedAt: true },
      }),
    ]);
    return {
      balances,
      summary,
      // The current period is settled once it closes.
      nextSettlement: {
        periodStart: current.start.toISOString(),
        periodEnd: current.end.toISOString(),
      },
      bankAccountVerified: bank > 0,
      taxProfileVerified: seller.taxVerifiedAt !== null,
    };
  }

  /** Finance holds back (or releases) part of a seller's available balance. */
  async reserve(
    user: AuthenticatedUser,
    sellerId: string,
    input: ReserveRequest,
    context: RequestContext,
  ) {
    const amount = D(input.amount);
    await this.prisma.$transaction(async (tx) => {
      const seller = await tx.seller.findUnique({
        where: { id: sellerId },
        select: { businessName: true },
      });
      if (!seller) throw notFound('Seller');
      await lockSellerBalanceInTx(tx, sellerId);
      const b = await sellerBalances(tx, sellerId);
      const place = input.action === 'PLACE';
      if (place && b.available.lt(amount))
        throw conflict(`Only ₱${m(b.available)} is available to reserve.`);
      if (!place && b.reserved.lt(amount)) throw conflict(`Only ₱${m(b.reserved)} is reserved.`);
      const dims = { sellerId, kind: 'RESERVE', description: input.reason };
      const journal = await postJournalInTx(tx, {
        type: place ? 'RESERVE' : 'RESERVE_RELEASE',
        description: `${place ? 'Reserve on' : 'Reserve released for'} ${seller.businessName}: ${input.reason}`,
        sourceType: 'SELLER',
        sourceId: sellerId,
        createdById: user.id,
        lines: place
          ? [dr(ACCOUNT.SELLER_AVAILABLE, amount, dims), cr(ACCOUNT.SELLER_RESERVED, amount, dims)]
          : [dr(ACCOUNT.SELLER_RESERVED, amount, dims), cr(ACCOUNT.SELLER_AVAILABLE, amount, dims)],
      });
      await this.audit.record(
        {
          action: place ? 'finance.reserve_placed' : 'finance.reserve_released',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: { amount: m(amount), reason: input.reason, journal: journal?.reference },
        },
        context,
        tx,
      );
    });
    return this.balancesDto(sellerId);
  }
}
