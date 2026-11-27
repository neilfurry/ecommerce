import { Injectable } from '@nestjs/common';
import { eligibleSellerOrders, financeSettingsInTx, Prisma } from '@marketplace/database';
import type {
  CodReconciliation,
  CommissionReport,
  FinanceDashboard,
  ReconciliationReport,
  RefundReport,
  RevenueReport,
  SettlementReport,
  TrialBalance,
} from '@marketplace/validation';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BalancesService } from './balances.service';
import { D, debitNormal, m, manilaDayEnd, manilaDayStart, ZERO } from './finance-common';

type Dec = Prisma.Decimal;
const num = (v: Dec | null | undefined) => D(v ?? 0);

/**
 * Accounting reports for a period (Philippine calendar days), all from posted ledger lines or
 * the immutable operational records, plus reconciliation checks between the two.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: BalancesService,
  ) {}

  private range(from: string, to: string) {
    return { start: manilaDayStart(from), end: manilaDayEnd(to) };
  }

  /** Net movement per account code in [start, end) (debit − credit). */
  private async movements(start: Date, end: Date) {
    const rows = await this.prisma.$queryRaw<{ code: string; debit: Dec; credit: Dec }[]>`
      SELECT a."code", SUM(e."debit") AS "debit", SUM(e."credit") AS "credit"
      FROM "journal_entries" e
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      JOIN "ledger_accounts" a ON a."id" = e."account_id"
      WHERE t."occurred_at" >= ${start} AND t."occurred_at" < ${end}
      GROUP BY a."code"`;
    return new Map(rows.map((r) => [r.code, { debit: num(r.debit), credit: num(r.credit) }]));
  }

  private async accountBalance(
    code: string,
    db: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma,
  ): Promise<Dec> {
    const [row] = await db.$queryRaw<{ amount: Dec | null }[]>`
      SELECT SUM(e."debit" - e."credit") AS "amount" FROM "journal_entries" e
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."code" = ${code}
    `;
    return num(row?.amount);
  }

  async trialBalance(from: string, to: string): Promise<TrialBalance> {
    const { start, end } = this.range(from, to);
    const [accounts, before, during] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } }),
      this.movements(new Date(0), start),
      this.movements(start, end),
    ]);
    const rows = accounts
      .map((a) => {
        const sign = debitNormal(a.type) ? 1 : -1;
        const b = before.get(a.code);
        const d = during.get(a.code);
        const opening = b ? b.debit.sub(b.credit).times(sign) : ZERO;
        const debit = d?.debit ?? ZERO;
        const credit = d?.credit ?? ZERO;
        return {
          code: a.code,
          name: a.name,
          type: a.type,
          opening: m(opening),
          debit: m(debit),
          credit: m(credit),
          closing: m(opening.add(debit.sub(credit).times(sign))),
        };
      })
      .filter(
        (r) =>
          r.opening !== '0.00' || r.debit !== '0.00' || r.credit !== '0.00' || r.closing !== '0.00',
      );
    const totalDebit = rows.reduce((s, r) => s.add(D(r.debit)), ZERO);
    const totalCredit = rows.reduce((s, r) => s.add(D(r.credit)), ZERO);
    return {
      from,
      to,
      rows,
      totalDebit: m(totalDebit),
      totalCredit: m(totalCredit),
      balanced: totalDebit.eq(totalCredit),
    };
  }

  async revenue(from: string, to: string): Promise<RevenueReport> {
    const { start, end } = this.range(from, to);
    const [accounts, during, gmv] = await Promise.all([
      this.prisma.ledgerAccount.findMany({
        where: { type: { in: ['REVENUE', 'EXPENSE'] } },
        orderBy: { code: 'asc' },
      }),
      this.movements(start, end),
      this.prisma.$queryRaw<{ amount: Dec | null }[]>`
        SELECT SUM(e."credit" - e."debit") AS "amount" FROM "journal_entries" e
        JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
        JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."code" = '2110'
        WHERE e."kind" = 'SALE' AND t."occurred_at" >= ${start} AND t."occurred_at" < ${end}`,
    ]);
    const net = (code: string, type: string) => {
      const d = during.get(code);
      if (!d) return ZERO;
      return type === 'REVENUE' ? d.credit.sub(d.debit) : d.debit.sub(d.credit);
    };
    const revenue = accounts
      .filter((a) => a.type === 'REVENUE')
      .map((a) => ({ code: a.code, label: a.name, amount: m(net(a.code, 'REVENUE')) }));
    const expenses = accounts
      .filter((a) => a.type === 'EXPENSE')
      .map((a) => ({ code: a.code, label: a.name, amount: m(net(a.code, 'EXPENSE')) }));
    const totalRevenue = revenue.reduce((s, r) => s.add(D(r.amount)), ZERO);
    const totalExpenses = expenses.reduce((s, r) => s.add(D(r.amount)), ZERO);
    const liability = (code: string) => {
      const d = during.get(code);
      return d ? d.credit.sub(d.debit) : ZERO;
    };
    return {
      from,
      to,
      revenue,
      expenses,
      totalRevenue: m(totalRevenue),
      totalExpenses: m(totalExpenses),
      netIncome: m(totalRevenue.sub(totalExpenses)),
      grossMerchandiseValue: m(num(gmv[0]?.amount)),
      outputVat: m(liability('2310')),
      withholdingTax: m(liability('2320')),
    };
  }

  async commission(from: string, to: string): Promise<CommissionReport> {
    const { start, end } = this.range(from, to);
    const rows = await this.prisma.$queryRaw<
      { seller_id: string; name: string; kind: string; amount: Dec; orders: bigint }[]
    >`
      SELECT e."seller_id", s."business_name" AS "name", e."kind",
             SUM(e."credit" - e."debit") AS "amount", COUNT(DISTINCT e."seller_order_id") AS "orders"
      FROM "journal_entries" e
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."seller_subledger"
      JOIN "sellers" s ON s."id" = e."seller_id"
      WHERE e."kind" IN ('SALE', 'COMMISSION', 'COMMISSION_REVERSAL')
        AND t."occurred_at" >= ${start} AND t."occurred_at" < ${end}
      GROUP BY e."seller_id", s."business_name", e."kind"`;
    const sellers = new Map<
      string,
      { name: string; orders: number; sales: Dec; commission: Dec; reversed: Dec }
    >();
    for (const r of rows) {
      const s = sellers.get(r.seller_id) ?? {
        name: r.name,
        orders: 0,
        sales: ZERO,
        commission: ZERO,
        reversed: ZERO,
      };
      if (r.kind === 'SALE') {
        s.sales = num(r.amount);
        s.orders = Number(r.orders);
      }
      if (r.kind === 'COMMISSION') s.commission = num(r.amount).neg();
      if (r.kind === 'COMMISSION_REVERSAL') s.reversed = num(r.amount);
      sellers.set(r.seller_id, s);
    }
    const scopes = await this.prisma.$queryRaw<
      { scope: string; type: string; items: bigint; commission: Dec }[]
    >`
      SELECT i."commission_scope" AS "scope", i."commission_type" AS "type", COUNT(*) AS "items",
             SUM(i."commission_amount") AS "commission"
      FROM "order_items" i
      JOIN "journal_transactions" t ON t."idempotency_key" = 'sale:' || i."seller_order_id"::text
       AND t."status" = 'POSTED' AND t."occurred_at" >= ${start} AND t."occurred_at" < ${end}
      GROUP BY i."commission_scope", i."commission_type" ORDER BY 1, 2`;
    const list = [...sellers.entries()]
      .map(([id, s]) => {
        const net = s.commission.sub(s.reversed);
        return {
          seller: { id, name: s.name },
          orders: s.orders,
          sales: m(s.sales),
          commission: m(s.commission),
          reversed: m(s.reversed),
          net: m(net),
          effectiveRate: s.sales.isZero() ? '0.00' : net.dividedBy(s.sales).times(100).toFixed(2),
        };
      })
      .sort((a, b) => Number(b.net) - Number(a.net));
    const sum = (k: 'sales' | 'commission' | 'reversed' | 'net') =>
      m(list.reduce((s, r) => s.add(D(r[k])), ZERO));
    return {
      from,
      to,
      rows: list,
      byScope: scopes.map((s) => ({
        scope: s.scope,
        type: s.type,
        items: Number(s.items),
        commission: m(s.commission),
      })),
      totals: {
        sales: sum('sales'),
        commission: sum('commission'),
        reversed: sum('reversed'),
        net: sum('net'),
      },
    };
  }

  async refunds(from: string, to: string): Promise<RefundReport> {
    const { start, end } = this.range(from, to);
    const rows = await this.prisma.refund.groupBy({
      by: ['reason'],
      where: { status: 'SUCCEEDED', succeededAt: { gte: start, lt: end } },
      _count: true,
      _sum: { amount: true, sellerDebit: true, commissionReversal: true },
    });
    const list = rows.map((r) => {
      const amount = num(r._sum.amount);
      const seller = num(r._sum.sellerDebit);
      return {
        reason: r.reason,
        count: r._count,
        amount: m(amount),
        sellerShare: m(seller),
        marketplaceShare: m(amount.sub(seller)),
        commissionReturned: m(num(r._sum.commissionReversal)),
      };
    });
    const sum = (k: 'amount' | 'sellerShare' | 'marketplaceShare' | 'commissionReturned') =>
      m(list.reduce((s, r) => s.add(D(r[k])), ZERO));
    return {
      from,
      to,
      rows: list,
      totals: {
        count: list.reduce((s, r) => s + r.count, 0),
        amount: sum('amount'),
        sellerShare: sum('sellerShare'),
        marketplaceShare: sum('marketplaceShare'),
        commissionReturned: sum('commissionReturned'),
      },
    };
  }

  async cod(from: string, to: string): Promise<CodReconciliation> {
    const { start, end } = this.range(from, to);
    const [collected, remitted, outstanding, ledger] = await Promise.all([
      this.prisma.$queryRaw<{ carrier: string; amount: Dec }[]>`
        SELECT COALESCE(c."carrier"::text, 'UNKNOWN') AS "carrier", SUM(c."collected_amount") AS "amount"
        FROM "cod_collections" c
        WHERE c."collected_at" >= ${start} AND c."collected_at" < ${end} AND c."status" IN ('COLLECTED', 'REMITTED')
        GROUP BY 1`,
      this.prisma.$queryRaw<{ carrier: string; expected: Dec; received: Dec }[]>`
        SELECT r."carrier"::text AS "carrier", SUM(r."expected_amount") AS "expected", SUM(r."amount") AS "received"
        FROM "cod_remittances" r WHERE r."remitted_at" >= ${start} AND r."remitted_at" < ${end}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ carrier: string; amount: Dec; parcels: bigint }[]>`
        SELECT COALESCE(c."carrier"::text, 'UNKNOWN') AS "carrier", SUM(c."collected_amount") AS "amount", COUNT(*) AS "parcels"
        FROM "cod_collections" c WHERE c."status" = 'COLLECTED' GROUP BY 1`,
      this.accountBalance('1100'),
    ]);
    const carriers = [
      ...new Set([...collected, ...remitted, ...outstanding].map((r) => r.carrier)),
    ].sort();
    const rows = carriers.map((carrier) => {
      const r = remitted.find((x) => x.carrier === carrier);
      const o = outstanding.find((x) => x.carrier === carrier);
      const expected = num(r?.expected);
      const received = num(r?.received);
      return {
        carrier,
        collected: m(num(collected.find((x) => x.carrier === carrier)?.amount)),
        remittedExpected: m(expected),
        remittedReceived: m(received),
        difference: m(received.sub(expected)),
        outstanding: m(num(o?.amount)),
        outstandingParcels: Number(o?.parcels ?? 0),
      };
    });
    const operational = outstanding.reduce((s, r) => s.add(num(r.amount)), ZERO);
    return {
      from,
      to,
      rows,
      ledgerReceivable: m(ledger),
      operationalOutstanding: m(operational),
      matches: ledger.eq(operational),
    };
  }

  async settlements(from: string, to: string): Promise<SettlementReport> {
    const { start, end } = this.range(from, to);
    const [agg, paid] = await Promise.all([
      this.prisma.settlement.aggregate({
        where: { createdAt: { gte: start, lt: end } },
        _count: true,
        _sum: {
          ordersCount: true,
          grossSales: true,
          commission: true,
          paymentFees: true,
          refunds: true,
          netSettled: true,
          withholdingTax: true,
        },
      }),
      this.prisma.payout.aggregate({
        where: { status: 'PAID', paidAt: { gte: start, lt: end } },
        _count: true,
        _sum: { amount: true },
      }),
    ]);
    return {
      from,
      to,
      settlements: agg._count,
      orders: agg._sum.ordersCount ?? 0,
      grossSales: m(agg._sum.grossSales),
      commission: m(agg._sum.commission),
      paymentFees: m(agg._sum.paymentFees),
      refunds: m(agg._sum.refunds),
      netSettled: m(agg._sum.netSettled),
      withholdingTax: m(agg._sum.withholdingTax),
      payoutsPaid: m(paid._sum.amount),
      payoutsPaidCount: paid._count,
    };
  }

  /**
   * Cross-checks between the ledger and the operational records, read from one consistent
   * snapshot (repeatable read) so work committing meanwhile cannot cause false alarms.
   */
  async reconciliation(): Promise<ReconciliationReport> {
    const checks = await this.prisma.$transaction((tx) => this.checksIn(tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60_000,
    });
    const negative = await this.balances.list({ page: 1, pageSize: 100, negativeOnly: true });
    checks.push({
      code: 'NEGATIVE',
      label: 'Sellers owing the marketplace (negative balance)',
      ok: true,
      detail:
        negative.items.length === 0
          ? 'No seller has a negative available balance.'
          : `${negative.totalItems} seller(s) owe the marketplace; it is deducted from their next settlements.`,
      items: negative.items
        .slice(0, 20)
        .map((r) => ({ id: r.seller.id, label: `${r.seller.name}: ₱${r.available}` })),
    });
    return { checkedAt: new Date().toISOString(), checks };
  }

  private async checksIn(db: Prisma.TransactionClient): Promise<ReconciliationReport['checks']> {
    const checks: ReconciliationReport['checks'] = [];
    const add = (
      code: string,
      label: string,
      items: { id: string; label: string }[],
      detail: string,
      ok = items.length === 0,
    ) => checks.push({ code, label, ok, detail, items: items.slice(0, 20) });

    const unbalanced = await db.$queryRaw<{ id: string; reference: string }[]>`
      SELECT t."id", t."reference" FROM "journal_transactions" t
      JOIN "journal_entries" e ON e."transaction_id" = t."id"
      WHERE t."status" = 'POSTED'
      GROUP BY t."id", t."reference" HAVING SUM(e."debit") <> SUM(e."credit")`;
    add(
      'BALANCED',
      'Every posted journal balances',
      unbalanced.map((r) => ({ id: r.id, label: r.reference })),
      unbalanced.length === 0
        ? 'Total debits equal total credits in every posted journal.'
        : `${unbalanced.length} journal(s) out of balance.`,
    );

    const receipts = await db.$queryRaw<{ id: string; reference: string }[]>`
      SELECT p."id", p."reference" FROM "payments" p
      WHERE p."provider" <> 'COD' AND p."amount_received" > 0
        AND NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'receipt:' || p."id"::text AND t."status" = 'POSTED')`;
    add(
      'RECEIPTS',
      'Received payments are in the ledger',
      receipts.map((r) => ({ id: r.id, label: r.reference })),
      receipts.length === 0
        ? 'Every received online payment and bank transfer is posted.'
        : `${receipts.length} payment(s) not posted.`,
    );

    const sales = await db.$queryRaw<{ id: string; number: string }[]>`
      SELECT so."id", so."number" FROM "seller_orders" so
      WHERE (EXISTS (SELECT 1 FROM "payments" p WHERE p."order_id" = so."order_id" AND p."status" = 'PAID' AND p."provider" <> 'COD')
          OR EXISTS (SELECT 1 FROM "cod_collections" c WHERE c."seller_order_id" = so."id" AND c."status" = 'REMITTED'))
        AND NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'sale:' || so."id"::text AND t."status" = 'POSTED')`;
    add(
      'SALES',
      'Paid seller orders have their sale posted',
      sales.map((r) => ({ id: r.id, label: r.number })),
      sales.length === 0
        ? 'Seller earnings and commission are posted for every paid seller order.'
        : `${sales.length} seller order(s) without a sale.`,
    );

    const refunds = await db.$queryRaw<{ id: string; reference: string }[]>`
      SELECT f."id", f."reference" FROM "refunds" f WHERE f."status" = 'SUCCEEDED'
        AND NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'refund:' || f."id"::text AND t."status" = 'POSTED')`;
    add(
      'REFUNDS',
      'Succeeded refunds are in the ledger',
      refunds.map((r) => ({ id: r.id, label: r.reference })),
      refunds.length === 0
        ? 'Every succeeded refund is posted.'
        : `${refunds.length} refund(s) not posted.`,
    );

    const [receivable, outstanding] = await Promise.all([
      this.accountBalance('1100', db),
      db.codCollection.aggregate({
        where: { status: 'COLLECTED' },
        _sum: { collectedAmount: true },
      }),
    ]);
    const notRemitted = num(outstanding._sum.collectedAmount);
    add(
      'COD',
      'COD receivable matches cash not yet remitted',
      [],
      `Ledger ₱${m(receivable)}; collections not remitted ₱${m(notRemitted)}.`,
      receivable.eq(notRemitted),
    );

    const [inPayout, openPayouts] = await Promise.all([
      this.accountBalance('2140', db),
      db.payout.aggregate({
        where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
        _sum: { amount: true },
      }),
    ]);
    const open = num(openPayouts._sum.amount);
    add(
      'PAYOUTS',
      'Payouts in process match open payout requests',
      [],
      `Ledger ₱${m(inPayout.neg())}; open payouts ₱${m(open)}.`,
      inPayout.neg().eq(open),
    );

    const settled = await db.$queryRaw<{ id: string; number: string }[]>`
      SELECT so."id", so."number" FROM "settlement_lines" l
      JOIN "seller_orders" so ON so."id" = l."seller_order_id"
      JOIN "journal_entries" e ON e."seller_order_id" = l."seller_order_id"
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."code" = '2110'
      GROUP BY so."id", so."number" HAVING SUM(e."credit" - e."debit") <> 0`;
    add(
      'SETTLED',
      'Settled orders have nothing left pending',
      settled.map((r) => ({ id: r.id, label: r.number })),
      settled.length === 0
        ? 'Every settled order moved fully to the available balance.'
        : `${settled.length} settled order(s) still have a pending amount.`,
    );

    const [clearing, expected] = await Promise.all([
      this.accountBalance('2010', db),
      db.$queryRaw<{ amount: Dec | null }[]>`
        SELECT
          COALESCE((SELECT SUM(c."collected_amount") FROM "cod_collections" c WHERE c."status" = 'COLLECTED'), 0)
        + COALESCE((SELECT SUM(p."amount_received" - COALESCE((SELECT SUM(f."amount") FROM "refunds" f
                       WHERE f."payment_id" = p."id" AND f."status" = 'SUCCEEDED'), 0))
                     FROM "payments" p WHERE p."status" = 'CANCELLED' AND p."amount_received" > 0), 0) AS "amount"`,
    ]);
    const unallocated = clearing.neg();
    const shouldBe = num(expected[0]?.amount);
    add(
      'CLEARING',
      'Unallocated customer money is explained',
      [],
      `Clearing ₱${m(unallocated)}; COD collected but not remitted plus late or duplicate payments not refunded ₱${m(shouldBe)}.`,
      unallocated.eq(shouldBe),
    );

    return checks;
  }

  async dashboard(from: string, to: string): Promise<FinanceDashboard> {
    const { start, end } = this.range(from, to);
    const settings = await financeSettingsInTx(this.prisma);
    const [
      during,
      gmv,
      balances,
      bank,
      provider,
      codReceivable,
      outputVat,
      withholding,
      queues,
      eligible,
      recon,
    ] = await Promise.all([
      this.movements(start, end),
      this.prisma.$queryRaw<{ amount: Dec | null }[]>`
          SELECT SUM(e."credit" - e."debit") AS "amount" FROM "journal_entries" e
          JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
          JOIN "ledger_accounts" a ON a."id" = e."account_id" AND a."code" = '2110'
          WHERE e."kind" = 'SALE' AND t."occurred_at" >= ${start} AND t."occurred_at" < ${end}`,
      this.balances.list({ page: 1, pageSize: 1 }),
      this.accountBalance('1010'),
      this.accountBalance('1020'),
      this.accountBalance('1100'),
      this.accountBalance('2310'),
      this.accountBalance('2320'),
      Promise.all([
        this.prisma.payout.count({ where: { status: 'REQUESTED' } }),
        this.prisma.payout.count({ where: { status: { in: ['APPROVED', 'PROCESSING'] } } }),
        this.prisma.sellerBankAccount.count({ where: { status: 'PENDING_VERIFICATION' } }),
        this.prisma.seller.count({ where: { status: 'VERIFIED', taxVerifiedAt: null } }),
      ]),
      eligibleSellerOrders(this.prisma, null, new Date(), settings.settlement.holdDays),
      this.reconciliation(),
    ]);
    const revenue = (code: string) => {
      const d = during.get(code);
      return d ? d.credit.sub(d.debit) : ZERO;
    };
    const expense = (code: string) => {
      const d = during.get(code);
      return d ? d.debit.sub(d.credit) : ZERO;
    };
    return {
      from,
      to,
      grossMerchandiseValue: m(num(gmv[0]?.amount)),
      commissionRevenue: m(revenue('4010')),
      feeRecoveries: m(revenue('4020')),
      paymentFees: m(expense('5010')),
      refunds: m(revenue('4090').neg()),
      sellerPayables: balances.totals,
      cash: { bank: m(bank), provider: m(provider), codReceivable: m(codReceivable) },
      taxes: { outputVat: m(outputVat.neg()), withholding: m(withholding.neg()) },
      queues: {
        payoutsToApprove: queues[0],
        payoutsToPay: queues[1],
        bankAccountsToVerify: queues[2],
        taxProfilesToVerify: queues[3],
        eligibleOrders: eligible.length,
      },
      reconciliationOk: recon.checks.every((c) => c.ok),
    };
  }
}
