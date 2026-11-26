import { Injectable } from '@nestjs/common';
import { financeReference, Prisma, reverseJournalInTx } from '@marketplace/database';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type {
  AccountLedger,
  CreateLedgerAccountRequest,
  JournalDto,
  JournalList,
  JournalQuery,
  LedgerAccountDto,
  ManualJournalRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  conflict,
  D,
  debitNormal,
  invalid,
  iso,
  m,
  manilaDayEnd,
  manilaDayStart,
  notFound,
  paged,
  personName,
  ZERO,
} from './finance-common';

const journalInclude = {
  entries: {
    orderBy: { lineNo: 'asc' },
    include: {
      account: { select: { code: true, name: true } },
      seller: { select: { id: true, businessName: true } },
      sellerOrder: { select: { id: true, number: true } },
    },
  },
  reversalOf: { select: { id: true, reference: true } },
  reversedBy: { select: { id: true, reference: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  postedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.JournalTransactionInclude;
type JournalRow = Prisma.JournalTransactionGetPayload<{ include: typeof journalInclude }>;

/**
 * Chart of accounts, journals (automatic and manual), reversals and account ledgers
 * (ADR 0027). Posted journals are read-only; corrections are reversals.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Accounts ------------------------------------------------------------------------------

  private async balances(): Promise<
    Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>
  > {
    const rows = await this.prisma.$queryRaw<
      { account_id: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]
    >`
      SELECT e."account_id", SUM(e."debit") AS "debit", SUM(e."credit") AS "credit"
      FROM "journal_entries" e
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      GROUP BY e."account_id"`;
    return new Map(rows.map((r) => [r.account_id, { debit: D(r.debit), credit: D(r.credit) }]));
  }

  private accountDto(
    a: Prisma.LedgerAccountGetPayload<object>,
    totals?: { debit: Prisma.Decimal; credit: Prisma.Decimal },
  ): LedgerAccountDto {
    const debit = totals?.debit ?? ZERO;
    const credit = totals?.credit ?? ZERO;
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      description: a.description,
      sellerSubledger: a.sellerSubledger,
      system: a.system,
      active: a.active,
      balance: m(debitNormal(a.type) ? debit.sub(credit) : credit.sub(debit)),
    };
  }

  async accounts(): Promise<{ items: LedgerAccountDto[] }> {
    const [accounts, totals] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } }),
      this.balances(),
    ]);
    return { items: accounts.map((a) => this.accountDto(a, totals.get(a.id))) };
  }

  async createAccount(
    user: AuthenticatedUser,
    input: CreateLedgerAccountRequest,
    context: RequestContext,
  ) {
    const expected = {
      '1': 'ASSET',
      '2': 'LIABILITY',
      '3': 'EQUITY',
      '4': 'REVENUE',
      '5': 'EXPENSE',
    }[input.code[0]!];
    if (expected !== input.type)
      throw invalid('type', `Accounts starting with ${input.code[0]} are ${expected} accounts.`);
    if (await this.prisma.ledgerAccount.count({ where: { code: input.code } }))
      throw conflict(`Account ${input.code} already exists.`);
    const account = await this.prisma.$transaction(async (tx) => {
      const a = await tx.ledgerAccount.create({
        data: {
          code: input.code,
          name: input.name,
          type: input.type,
          description: input.description ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'ledger.account_created',
          actorId: user.id,
          entityType: 'ledger_account',
          entityId: a.id,
          metadata: { code: a.code, name: a.name },
        },
        context,
        tx,
      );
      return a;
    });
    return this.accountDto(account);
  }

  async updateAccount(
    user: AuthenticatedUser,
    id: string,
    input: { name?: string; description?: string | null; active?: boolean },
    context: RequestContext,
  ) {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { id } });
    if (!account) throw notFound('Account');
    if (account.system && input.active === false)
      throw conflict('System accounts are used by automatic postings and stay active.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const a = await tx.ledgerAccount.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'ledger.account_updated',
          actorId: user.id,
          entityType: 'ledger_account',
          entityId: id,
          metadata: { ...input },
        },
        context,
        tx,
      );
      return a;
    });
    return this.accountDto(updated, (await this.balances()).get(id));
  }

  /** One account's lines with the running balance, for a period (and optionally a seller). */
  async accountLedger(
    code: string,
    query: { page: number; pageSize: number; from?: string; to?: string; sellerId?: string },
  ): Promise<AccountLedger> {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { code } });
    if (!account) throw notFound('Account');
    const from = query.from ? manilaDayStart(query.from) : new Date(0);
    const to = query.to ? manilaDayEnd(query.to) : new Date('2999-01-01');
    const sign = debitNormal(account.type) ? 1 : -1;
    const seller = query.sellerId ?? null;
    const [opening] = await this.prisma.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
      SELECT SUM(e."debit" - e."credit") AS "amount" FROM "journal_entries" e
      JOIN "journal_transactions" t ON t."id" = e."transaction_id" AND t."status" = 'POSTED'
      WHERE e."account_id" = ${account.id}::uuid AND t."occurred_at" < ${from}
        AND (${seller}::uuid IS NULL OR e."seller_id" = ${seller}::uuid)`;
    const where: Prisma.JournalEntryWhereInput = {
      accountId: account.id,
      transaction: { status: 'POSTED', occurredAt: { gte: from, lt: to } },
      ...(seller ? { sellerId: seller } : {}),
    };
    const [rows, total, before, all] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          transaction: {
            select: { id: true, reference: true, type: true, occurredAt: true, description: true },
          },
          seller: { select: { id: true, businessName: true } },
        },
        orderBy: [{ transaction: { occurredAt: 'asc' } }, { createdAt: 'asc' }, { lineNo: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
      // Lines of earlier pages, for the running balance.
      this.prisma.journalEntry.findMany({
        where,
        select: { debit: true, credit: true },
        orderBy: [{ transaction: { occurredAt: 'asc' } }, { createdAt: 'asc' }, { lineNo: 'asc' }],
        take: (query.page - 1) * query.pageSize,
      }),
      this.prisma.journalEntry.aggregate({ where, _sum: { debit: true, credit: true } }),
    ]);
    const openingNet = D(opening?.amount ?? 0).times(sign);
    let running = before.reduce((b, e) => b.add(e.debit.sub(e.credit).times(sign)), openingNet);
    const items = rows.map((e) => {
      running = running.add(e.debit.sub(e.credit).times(sign));
      return {
        entryId: e.id,
        journal: {
          id: e.transaction.id,
          reference: e.transaction.reference,
          type: e.transaction.type,
        },
        occurredAt: e.transaction.occurredAt.toISOString(),
        description: e.description ?? e.transaction.description,
        seller: e.seller ? { id: e.seller.id, name: e.seller.businessName } : null,
        debit: m(e.debit),
        credit: m(e.credit),
        balance: m(running),
      };
    });
    const movement = D(all._sum.debit ?? 0)
      .sub(D(all._sum.credit ?? 0))
      .times(sign);
    return {
      ...paged(items, query.page, query.pageSize, total),
      account: this.accountDto(account),
      openingBalance: m(openingNet),
      closingBalance: m(openingNet.add(movement)),
    };
  }

  // ---- Journals ---------------------------------------------------------------------------------

  private journalDto(j: JournalRow): JournalDto {
    return {
      id: j.id,
      reference: j.reference,
      type: j.type,
      status: j.status,
      description: j.description,
      currency: j.currency,
      occurredAt: j.occurredAt.toISOString(),
      postedAt: iso(j.postedAt),
      source: j.sourceType && j.sourceId ? { type: j.sourceType, id: j.sourceId } : null,
      reversalOf: j.reversalOf,
      reversedBy: j.reversedBy,
      createdBy: personName(j.createdBy),
      postedBy: personName(j.postedBy),
      totalDebit: m(j.entries.reduce((s, e) => s.add(e.debit), ZERO)),
      totalCredit: m(j.entries.reduce((s, e) => s.add(e.credit), ZERO)),
      entries: j.entries.map((e) => ({
        id: e.id,
        lineNo: e.lineNo,
        account: e.account,
        seller: e.seller ? { id: e.seller.id, name: e.seller.businessName } : null,
        sellerOrder: e.sellerOrder,
        kind: e.kind,
        debit: m(e.debit),
        credit: m(e.credit),
        description: e.description,
      })),
    };
  }

  async journals(query: JournalQuery & { page: number; pageSize: number }): Promise<JournalList> {
    const where: Prisma.JournalTransactionWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: manilaDayStart(query.from) } : {}),
              ...(query.to ? { lt: manilaDayEnd(query.to) } : {}),
            },
          }
        : {}),
      ...(query.accountCode || query.sellerId
        ? {
            entries: {
              some: {
                ...(query.accountCode ? { account: { code: query.accountCode } } : {}),
                ...(query.sellerId ? { sellerId: query.sellerId } : {}),
              },
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { reference: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.journalTransaction.findMany({
        where,
        include: journalInclude,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.journalTransaction.count({ where }),
    ]);
    return paged(
      rows.map((r) => {
        const { entries: _entries, ...summary } = this.journalDto(r);
        return summary;
      }),
      query.page,
      query.pageSize,
      total,
    );
  }

  async journal(id: string): Promise<JournalDto> {
    const row = await this.prisma.journalTransaction.findUnique({
      where: { id },
      include: journalInclude,
    });
    if (!row) throw notFound('Journal');
    return this.journalDto(row);
  }

  /** A manual journal is saved as a draft (editable, not in balances) until posted. */
  async createManual(
    user: AuthenticatedUser,
    input: ManualJournalRequest,
    context: RequestContext,
  ) {
    const lines = await this.manualLines(input);
    const id = await this.prisma.$transaction(async (tx) => {
      const j = await tx.journalTransaction.create({
        data: {
          reference: financeReference('JE'),
          type: 'MANUAL',
          status: 'DRAFT',
          description: input.description,
          occurredAt: manilaDayStart(input.occurredAt),
          createdById: user.id,
          entries: { create: lines },
        },
      });
      await this.audit.record(
        {
          action: 'ledger.manual_journal_drafted',
          actorId: user.id,
          entityType: 'journal',
          entityId: j.id,
          metadata: { reference: j.reference },
        },
        context,
        tx,
      );
      return j.id;
    });
    return this.journal(id);
  }

  private async manualLines(input: ManualJournalRequest) {
    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { code: { in: codes } } });
    return input.lines.map((l, i) => {
      const a = accounts.find((x) => x.code === l.accountCode);
      if (!a) throw invalid(`lines.${i}.accountCode`, `Account ${l.accountCode} does not exist.`);
      if (!a.active)
        throw invalid(`lines.${i}.accountCode`, `Account ${l.accountCode} is inactive.`);
      if (a.sellerSubledger && !l.sellerId)
        throw invalid(`lines.${i}.sellerId`, 'Seller payable lines must name the seller.');
      return {
        lineNo: i + 1,
        accountId: a.id,
        sellerId: l.sellerId ?? null,
        kind: a.sellerSubledger ? 'ADJUSTMENT' : null,
        debit: D(l.debit ?? '0'),
        credit: D(l.credit ?? '0'),
        description: l.description ?? null,
      };
    });
  }

  async updateDraft(
    user: AuthenticatedUser,
    id: string,
    input: ManualJournalRequest,
    context: RequestContext,
  ) {
    const lines = await this.manualLines(input);
    await this.prisma.$transaction(async (tx) => {
      const [j] = await tx.$queryRaw<{ status: string; type: string }[]>`
        SELECT "status"::text, "type" FROM "journal_transactions" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!j) throw notFound('Journal');
      if (j.status !== 'DRAFT' || j.type !== 'MANUAL')
        throw conflict('Only draft manual journals can be edited.');
      await tx.journalEntry.deleteMany({ where: { transactionId: id } });
      await tx.journalTransaction.update({
        where: { id },
        data: {
          description: input.description,
          occurredAt: manilaDayStart(input.occurredAt),
          entries: { create: lines },
        },
      });
      await this.audit.record(
        {
          action: 'ledger.manual_journal_edited',
          actorId: user.id,
          entityType: 'journal',
          entityId: id,
        },
        context,
        tx,
      );
    });
    return this.journal(id);
  }

  async deleteDraft(user: AuthenticatedUser, id: string, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const [j] = await tx.$queryRaw<{ status: string; reference: string }[]>`
        SELECT "status"::text, "reference" FROM "journal_transactions" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!j) throw notFound('Journal');
      if (j.status !== 'DRAFT')
        throw conflict('Posted journals are never deleted; reverse them instead.');
      await tx.journalEntry.deleteMany({ where: { transactionId: id } });
      await tx.journalTransaction.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'ledger.manual_journal_discarded',
          actorId: user.id,
          entityType: 'journal',
          entityId: id,
          metadata: { reference: j.reference },
        },
        context,
        tx,
      );
    });
  }

  /** Posts a draft: the database checks it balances. */
  async post(user: AuthenticatedUser, id: string, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const [j] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status"::text FROM "journal_transactions" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!j) throw notFound('Journal');
      if (j.status !== 'DRAFT') throw conflict('This journal is already posted.');
      const sums = await tx.journalEntry.aggregate({
        where: { transactionId: id },
        _sum: { debit: true, credit: true },
        _count: true,
      });
      if (!D(sums._sum.debit ?? 0).eq(D(sums._sum.credit ?? 0)) || sums._count < 2)
        throw invalid('lines', 'Total debits must equal total credits.');
      await tx.journalTransaction.update({
        where: { id },
        data: { status: 'POSTED', postedAt: new Date(), postedById: user.id },
      });
      await this.audit.record(
        { action: 'ledger.journal_posted', actorId: user.id, entityType: 'journal', entityId: id },
        context,
        tx,
      );
    });
    return this.journal(id);
  }

  /** Reverses a posted manual journal (automatic postings are reversed by their workflows). */
  async reverse(user: AuthenticatedUser, id: string, reason: string, context: RequestContext) {
    const reversalId = await this.prisma.$transaction(async (tx) => {
      const j = await tx.journalTransaction.findUnique({
        where: { id },
        select: { status: true, type: true, reference: true, reversedBy: { select: { id: true } } },
      });
      if (!j) throw notFound('Journal');
      if (j.status !== 'POSTED') throw conflict('Only posted journals can be reversed.');
      if (j.reversedBy) throw conflict('This journal has already been reversed.');
      if (j.type !== 'MANUAL')
        throw conflict(
          'Automatic postings are corrected through their workflow (refund, payout, settlement) or a manual adjustment.',
        );
      const reversal = await reverseJournalInTx(tx, id, {
        description: `Reversal of ${j.reference}: ${reason}`,
        createdById: user.id,
      });
      await this.audit.record(
        {
          action: 'ledger.journal_reversed',
          actorId: user.id,
          entityType: 'journal',
          entityId: id,
          metadata: { reason, reversal: reversal?.reference },
        },
        context,
        tx,
      );
      return reversal!.id;
    });
    return this.journal(reversalId);
  }
}
