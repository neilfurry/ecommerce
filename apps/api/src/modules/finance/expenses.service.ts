import { Injectable } from '@nestjs/common';
import {
  ACCOUNT,
  cr,
  dr,
  financeReference,
  journalByKey,
  postJournalInTx,
  Prisma,
  reverseJournalInTx,
} from '@marketplace/database';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type { CreateExpenseRequest, ExpenseDto, ExpenseList } from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { conflict, D, invalid, iso, m, manilaDayStart, notFound, paged } from './finance-common';

const include = { account: { select: { code: true, name: true } } } satisfies Prisma.ExpenseInclude;
type Row = Prisma.ExpenseGetPayload<{ include: typeof include }>;

/**
 * Marketplace expenses (accounts payable): recording one posts the expense and input VAT
 * against vendor payables; paying it moves the payable to the bank; voiding an unpaid one
 * reverses its journal. Marketplace books only (sellers keep their own books).
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private dto(e: Row): ExpenseDto {
    return {
      id: e.id,
      reference: e.reference,
      vendorName: e.vendorName,
      vendorTin: e.vendorTin,
      description: e.description,
      account: e.account,
      amount: m(e.amount),
      inputVat: m(e.inputVat),
      total: m(e.total),
      invoiceNumber: e.invoiceNumber,
      incurredOn: e.incurredOn.toISOString().slice(0, 10),
      status: e.status,
      paidAt: iso(e.paidAt),
      paymentReference: e.paymentReference,
      createdAt: e.createdAt.toISOString(),
    };
  }

  async list(query: {
    page: number;
    pageSize: number;
    status?: 'UNPAID' | 'PAID' | 'VOID';
  }): Promise<ExpenseList> {
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include,
        orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.expense.count({ where }),
    ]);
    return paged(
      rows.map((r) => this.dto(r)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async create(user: AuthenticatedUser, input: CreateExpenseRequest, context: RequestContext) {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { code: input.accountCode },
    });
    if (!account || account.type !== 'EXPENSE' || !account.active)
      throw invalid('accountCode', 'Choose an active expense account.');
    const amount = D(input.amount);
    const vat = D(input.inputVat ?? '0');
    const id = await this.prisma.$transaction(async (tx) => {
      const occurredAt = manilaDayStart(input.incurredOn);
      const expense = await tx.expense.create({
        data: {
          reference: financeReference('EX'),
          vendorName: input.vendorName,
          vendorTin: input.vendorTin ?? null,
          description: input.description,
          accountId: account.id,
          amount,
          inputVat: vat,
          total: amount.add(vat),
          invoiceNumber: input.invoiceNumber ?? null,
          incurredOn: new Date(`${input.incurredOn}T00:00:00Z`),
          createdById: user.id,
        },
      });
      await postJournalInTx(tx, {
        type: 'EXPENSE',
        description: `${expense.reference} ${input.vendorName}: ${input.description}`,
        occurredAt,
        idempotencyKey: `expense:${expense.id}`,
        sourceType: 'EXPENSE',
        sourceId: expense.id,
        createdById: user.id,
        lines: [
          dr(account.code, amount, { kind: 'EXPENSE' }),
          dr(ACCOUNT.INPUT_VAT, vat, { kind: 'EXPENSE' }),
          cr(ACCOUNT.VENDOR_PAYABLE, amount.add(vat), { kind: 'EXPENSE' }),
        ],
      });
      await this.audit.record(
        {
          action: 'finance.expense_recorded',
          actorId: user.id,
          entityType: 'expense',
          entityId: expense.id,
          metadata: { total: m(amount.add(vat)) },
        },
        context,
        tx,
      );
      if (input.paidReference)
        await this.payInTx(tx, user, expense.id, input.paidReference, occurredAt);
      return expense.id;
    });
    return this.get(id);
  }

  async get(id: string) {
    const row = await this.prisma.expense.findUnique({ where: { id }, include });
    if (!row) throw notFound('Expense');
    return this.dto(row);
  }

  private async payInTx(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    id: string,
    reference: string,
    at = new Date(),
  ) {
    const [row] = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status"::text FROM "expenses" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (!row) throw notFound('Expense');
    if (row.status !== 'UNPAID') throw conflict(`This expense is ${row.status.toLowerCase()}.`);
    const e = await tx.expense.update({
      where: { id },
      data: { status: 'PAID', paidAt: at, paymentReference: reference },
    });
    await postJournalInTx(tx, {
      type: 'EXPENSE_PAYMENT',
      description: `${e.reference} paid (${reference})`,
      occurredAt: at,
      idempotencyKey: `expense-paid:${id}`,
      sourceType: 'EXPENSE',
      sourceId: id,
      createdById: user.id,
      lines: [
        dr(ACCOUNT.VENDOR_PAYABLE, e.total, { kind: 'EXPENSE' }),
        cr(ACCOUNT.BANK, e.total, { kind: 'EXPENSE' }),
      ],
    });
  }

  async pay(user: AuthenticatedUser, id: string, reference: string, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.payInTx(tx, user, id, reference);
      await this.audit.record(
        {
          action: 'finance.expense_paid',
          actorId: user.id,
          entityType: 'expense',
          entityId: id,
          metadata: { reference },
        },
        context,
        tx,
      );
    });
    return this.get(id);
  }

  /** Voids an unpaid expense recorded in error (its journal is reversed, nothing deleted). */
  async void(user: AuthenticatedUser, id: string, reason: string, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status"::text FROM "expenses" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!row) throw notFound('Expense');
      if (row.status !== 'UNPAID') throw conflict('Only unpaid expenses can be voided.');
      const journal = await journalByKey(tx, `expense:${id}`);
      if (journal)
        await reverseJournalInTx(tx, journal.id, {
          description: `Expense voided: ${reason}`,
          createdById: user.id,
        });
      await tx.expense.update({ where: { id }, data: { status: 'VOID' } });
      await this.audit.record(
        {
          action: 'finance.expense_voided',
          actorId: user.id,
          entityType: 'expense',
          entityId: id,
          metadata: { reason },
        },
        context,
        tx,
      );
    });
    return this.get(id);
  }
}
