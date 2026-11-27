import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ACCOUNT,
  cr,
  dr,
  financeReference,
  financeSettingsInTx,
  journalByKey,
  lockSellerBalanceInTx,
  postJournalInTx,
  Prisma,
  reverseJournalInTx,
  sellerBalances,
  emitNotificationInTx,
  sellerRecipientIdsInTx,
} from '@marketplace/database';
import { GatewayError, PayMongoPayouts, type PayoutProvider } from '@marketplace/payments';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type {
  CreateBankAccountRequest,
  MarkPayoutPaidRequest,
  PayoutDetail,
  PayoutDto,
  PayoutList,
  PayoutStatus,
  RequestPayoutRequest,
  ReviewBankAccountRequest,
  SellerBankAccountDto,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  conflict,
  D,
  decryptField,
  encryptField,
  invalid,
  iso,
  m,
  maskAccount,
  notFound,
  paged,
  personName,
} from './finance-common';

type Tx = Prisma.TransactionClient;
type Action = PayoutDetail['actions'][number];

const payoutInclude = {
  seller: { select: { id: true, businessName: true } },
  requestedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.PayoutInclude;
type PayoutRow = Prisma.PayoutGetPayload<{ include: typeof payoutInclude }>;

const bankInclude = {
  seller: { select: { id: true, businessName: true } },
} satisfies Prisma.SellerBankAccountInclude;
type BankRow = Prisma.SellerBankAccountGetPayload<{ include: typeof bankInclude }>;

/** What staff can do with a payout in each status. */
const ACTIONS: Record<PayoutStatus, Action[]> = {
  REQUESTED: ['APPROVE', 'REJECT'],
  APPROVED: ['MARK_PAID', 'SEND', 'MARK_FAILED', 'REJECT'],
  PROCESSING: ['CHECK', 'MARK_PAID', 'MARK_FAILED'],
  PAID: ['REVERSE'],
  FAILED: [],
  REJECTED: [],
  CANCELLED: [],
  REVERSED: [],
};

/**
 * Seller bank accounts and payouts (ADR 0028). Requesting a payout moves the amount from the
 * available balance to "payouts in process" in the ledger; paying it moves it out of the bank
 * (or the PayMongo wallet); a rejection, cancellation or failure reverses the request; a paid
 * payout returned by the bank is reversed. Every step is logged in payout_events.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);
  private readonly provider: PayoutProvider | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {
    const p = config.finance.paymongoPayouts;
    this.provider = p ? new PayMongoPayouts({ secretKey: p.secretKey, wallet: p.wallet }) : null;
  }

  // ---- Bank accounts ----------------------------------------------------------------------------

  private bankDto(b: BankRow): SellerBankAccountDto {
    return {
      id: b.id,
      institutionCode: b.institutionCode,
      institutionName: b.institutionName,
      accountName: b.accountName,
      accountNumberMasked: maskAccount(b.accountNumberLast4),
      status: b.status,
      isDefault: b.isDefault,
      reviewNote: b.reviewNote,
      reviewedAt: iso(b.reviewedAt),
      createdAt: b.createdAt.toISOString(),
      seller: { id: b.seller.id, name: b.seller.businessName },
    };
  }

  async bankAccounts(where: { sellerId?: string; status?: SellerBankAccountDto['status'] }) {
    const rows = await this.prisma.sellerBankAccount.findMany({
      where,
      include: bankInclude,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return { items: rows.map((r) => this.bankDto(r)) };
  }

  async addBankAccount(
    user: AuthenticatedUser,
    sellerId: string,
    input: CreateBankAccountRequest,
    context: RequestContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const makeDefault = input.makeDefault ?? true;
      if (makeDefault)
        await tx.sellerBankAccount.updateMany({
          where: { sellerId, isDefault: true },
          data: { isDefault: false },
        });
      const created = await tx.sellerBankAccount.create({
        data: {
          sellerId,
          institutionName: input.institutionName,
          institutionCode: input.institutionCode ?? null,
          accountName: input.accountName,
          accountNumberEncrypted: encryptField(
            input.accountNumber,
            this.config.finance.encryptionKey,
          ),
          accountNumberLast4: input.accountNumber.slice(-4),
          isDefault: makeDefault,
          createdById: user.id,
        },
        include: bankInclude,
      });
      // Never the number itself: only the last four digits are logged.
      await this.audit.record(
        {
          action: 'seller.bank_account_added',
          actorId: user.id,
          entityType: 'seller_bank_account',
          entityId: created.id,
          metadata: { institution: created.institutionName, last4: created.accountNumberLast4 },
        },
        context,
        tx,
      );
      return created;
    });
    return this.bankDto(row);
  }

  async disableBankAccount(
    user: AuthenticatedUser,
    sellerId: string,
    id: string,
    context: RequestContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const account = await tx.sellerBankAccount.findFirst({ where: { id, sellerId } });
      if (!account) throw notFound('Bank account');
      const open = await tx.payout.count({
        where: { bankAccountId: id, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
      });
      if (open > 0) throw conflict('A payout to this account is still being processed.');
      const updated = await tx.sellerBankAccount.update({
        where: { id },
        data: { status: 'DISABLED', isDefault: false },
        include: bankInclude,
      });
      await this.audit.record(
        {
          action: 'seller.bank_account_disabled',
          actorId: user.id,
          entityType: 'seller_bank_account',
          entityId: id,
        },
        context,
        tx,
      );
      return updated;
    });
    return this.bankDto(row);
  }

  async reviewBankAccount(
    user: AuthenticatedUser,
    id: string,
    input: ReviewBankAccountRequest,
    context: RequestContext,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      const account = await tx.sellerBankAccount.findUnique({ where: { id } });
      if (!account) throw notFound('Bank account');
      const status = { VERIFY: 'VERIFIED', REJECT: 'REJECTED', DISABLE: 'DISABLED' }[
        input.decision
      ] as 'VERIFIED' | 'REJECTED' | 'DISABLED';
      if (input.decision !== 'DISABLE' && account.status !== 'PENDING_VERIFICATION')
        throw conflict('This bank account has already been reviewed.');
      if (input.decision === 'REJECT' && !input.note) throw invalid('note', 'Tell the seller why.');
      const updated = await tx.sellerBankAccount.update({
        where: { id },
        data: {
          status,
          reviewNote: input.note ?? null,
          reviewedById: user.id,
          reviewedAt: new Date(),
          ...(status === 'VERIFIED' ? {} : { isDefault: false }),
        },
        include: bankInclude,
      });
      await this.audit.record(
        {
          action: `finance.bank_account_${status.toLowerCase()}`,
          actorId: user.id,
          entityType: 'seller_bank_account',
          entityId: id,
          metadata: { note: input.note ?? null },
        },
        context,
        tx,
      );
      return updated;
    });
    return this.bankDto(row);
  }

  // ---- Payouts ----------------------------------------------------------------------------------

  private dto(p: PayoutRow): PayoutDto {
    const d = p.destination as {
      institutionName: string;
      institutionCode: string | null;
      accountName: string;
      last4: string;
    };
    return {
      id: p.id,
      reference: p.reference,
      seller: { id: p.seller.id, name: p.seller.businessName },
      amount: m(p.amount),
      currency: p.currency,
      method: p.method as PayoutDto['method'],
      status: p.status,
      destination: {
        institutionName: d.institutionName,
        institutionCode: d.institutionCode,
        accountName: d.accountName,
        accountNumberMasked: maskAccount(d.last4),
      },
      transferReference: p.transferReference,
      transferFee: m(p.transferFee),
      failureReason: p.failureReason,
      livemode: p.livemode,
      requestedBy: personName(p.requestedBy),
      requestedAt: p.requestedAt.toISOString(),
      approvedAt: iso(p.approvedAt),
      paidAt: iso(p.paidAt),
      closedAt: iso(p.closedAt),
    };
  }

  async list(query: {
    page: number;
    pageSize: number;
    status?: PayoutStatus;
    sellerId?: string;
  }): Promise<PayoutList> {
    const where: Prisma.PayoutWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        include: payoutInclude,
        orderBy: { requestedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.payout.count({ where }),
    ]);
    return paged(
      rows.map((r) => this.dto(r)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async detail(id: string, viewer: { sellerId: string | null }): Promise<PayoutDetail> {
    const row = await this.prisma.payout.findFirst({
      where: { id, ...(viewer.sellerId ? { sellerId: viewer.sellerId } : {}) },
      include: {
        ...payoutInclude,
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!row) throw notFound('Payout');
    const actions = viewer.sellerId
      ? []
      : ACTIONS[row.status].filter((a) => a !== 'SEND' || this.provider !== null);
    return {
      ...this.dto(row),
      events: row.events.map((e) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: personName(e.actor),
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      actions,
    };
  }

  /** A seller asks for (part of) the available balance to be paid to a verified account. */
  async request(
    user: AuthenticatedUser,
    sellerId: string,
    input: RequestPayoutRequest,
    context: RequestContext,
  ) {
    const existing = await this.prisma.payout.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (existing.sellerId !== sellerId) throw conflict('This request key was already used.');
      return this.detail(existing.id, { sellerId });
    }
    const amount = D(input.amount);
    const id = await this.prisma.$transaction(async (tx) => {
      const seller = await tx.seller.findUniqueOrThrow({
        where: { id: sellerId },
        select: { status: true, taxVerifiedAt: true },
      });
      if (seller.status !== 'VERIFIED') throw conflict('Payouts are for verified sellers.');
      if (!seller.taxVerifiedAt)
        throw conflict(
          'Finance has to verify your BIR registration (tax profile) before your first payout.',
        );
      const account = await tx.sellerBankAccount.findFirst({
        where: { id: input.bankAccountId, sellerId },
      });
      if (!account) throw invalid('bankAccountId', 'Choose one of your bank accounts.');
      if (account.status !== 'VERIFIED')
        throw invalid('bankAccountId', 'This bank account is not verified yet.');
      const settings = await financeSettingsInTx(tx);
      if (amount.lt(D(settings.payouts.minimumAmount)))
        throw invalid('amount', `The minimum payout is ₱${settings.payouts.minimumAmount}.`);
      // Serialises payouts, reserves and settlements of this seller.
      await lockSellerBalanceInTx(tx, sellerId);
      const balances = await sellerBalances(tx, sellerId);
      if (balances.available.lt(amount))
        throw invalid(
          'amount',
          `Only ₱${m(balances.available.isNeg() ? D(0) : balances.available)} is available.`,
        );
      const payout = await tx.payout.create({
        data: {
          reference: financeReference('PO'),
          sellerId,
          bankAccountId: account.id,
          amount,
          destination: {
            institutionName: account.institutionName,
            institutionCode: account.institutionCode,
            accountName: account.accountName,
            last4: account.accountNumberLast4,
          },
          idempotencyKey: input.idempotencyKey,
          requestedById: user.id,
        },
      });
      const dims = { sellerId, kind: 'PAYOUT' };
      await postJournalInTx(tx, {
        type: 'PAYOUT_REQUESTED',
        description: `Payout ${payout.reference} requested`,
        idempotencyKey: `payout-request:${payout.id}`,
        sourceType: 'PAYOUT',
        sourceId: payout.id,
        createdById: user.id,
        lines: [
          dr(ACCOUNT.SELLER_AVAILABLE, amount, dims),
          cr(ACCOUNT.SELLER_PAYOUT, amount, dims),
        ],
      });
      await this.event(tx, payout.id, 'REQUESTED', null, 'REQUESTED', user.id, null);
      await this.audit.record(
        {
          action: 'seller.payout_requested',
          actorId: user.id,
          entityType: 'payout',
          entityId: payout.id,
          metadata: { amount: m(amount) },
        },
        context,
        tx,
      );
      return payout.id;
    });
    return this.detail(id, { sellerId });
  }

  private event(
    tx: Tx,
    payoutId: string,
    type: string,
    from: string | null,
    to: string | null,
    actorId: string | null,
    note: string | null,
    data: Record<string, unknown> = {},
  ) {
    return tx.payoutEvent.create({
      data: {
        payoutId,
        type,
        fromStatus: from,
        toStatus: to,
        actorId,
        note,
        data: data as Prisma.InputJsonValue,
      },
    });
  }

  /** Locks the payout row and checks the action is allowed in its current status. */
  private async lockFor(tx: Tx, id: string, allowed: PayoutStatus[], sellerId?: string) {
    const [row] = await tx.$queryRaw<{ id: string; status: PayoutStatus; seller_id: string }[]>`
      SELECT "id", "status"::text, "seller_id" FROM "payouts" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (!row || (sellerId && row.seller_id !== sellerId)) throw notFound('Payout');
    if (!allowed.includes(row.status))
      throw new ApiException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        `This payout is ${row.status.toLowerCase()}.`,
      );
    return tx.payout.findUniqueOrThrow({ where: { id } });
  }

  /** Returns a requested amount to the available balance (reverses the request journal). */
  private async releaseRequestInTx(tx: Tx, payoutId: string, actorId: string | null, why: string) {
    const request = await journalByKey(tx, `payout-request:${payoutId}`);
    if (request)
      await reverseJournalInTx(tx, request.id, { description: why, createdById: actorId });
  }

  private async transition(
    user: AuthenticatedUser | null,
    id: string,
    allowed: PayoutStatus[],
    run: (
      tx: Tx,
      payout: Prisma.PayoutGetPayload<object>,
    ) => Promise<{
      to: PayoutStatus;
      type: string;
      note: string | null;
      data?: Prisma.PayoutUpdateInput;
      audit: string;
    }>,
    context: RequestContext | null,
    sellerId?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const payout = await this.lockFor(tx, id, allowed, sellerId);
      await lockSellerBalanceInTx(tx, payout.sellerId);
      const result = await run(tx, payout);
      await tx.payout.update({
        where: { id },
        data: { status: result.to, ...(result.data ?? {}) },
      });
      await this.event(
        tx,
        id,
        result.type,
        payout.status,
        result.to,
        user?.id ?? null,
        result.note,
      );
      if (context)
        await this.audit.record(
          {
            action: result.audit,
            actorId: user?.id ?? null,
            entityType: 'payout',
            entityId: id,
            metadata: { from: payout.status, to: result.to, note: result.note },
          },
          context,
          tx,
        );
    });
    return this.detail(id, { sellerId: sellerId ?? null });
  }

  cancel(user: AuthenticatedUser, sellerId: string, id: string, context: RequestContext) {
    return this.transition(
      user,
      id,
      ['REQUESTED'],
      async (tx, p) => {
        await this.releaseRequestInTx(
          tx,
          p.id,
          user.id,
          `Payout ${p.reference} cancelled by the seller`,
        );
        return {
          to: 'CANCELLED',
          type: 'CANCELLED',
          note: null,
          data: { closedAt: new Date() },
          audit: 'seller.payout_cancelled',
        };
      },
      context,
      sellerId,
    );
  }

  approve(user: AuthenticatedUser, id: string, note: string | null, context: RequestContext) {
    return this.transition(
      user,
      id,
      ['REQUESTED'],
      async (_tx, p) => {
        if (p.requestedById === user.id)
          throw conflict('A payout cannot be approved by the person who requested it.');
        return {
          to: 'APPROVED',
          type: 'APPROVED',
          note,
          data: { approvedAt: new Date() },
          audit: 'finance.payout_approved',
        };
      },
      context,
    );
  }

  reject(user: AuthenticatedUser, id: string, reason: string, context: RequestContext) {
    return this.transition(
      user,
      id,
      ['REQUESTED', 'APPROVED'],
      async (tx, p) => {
        await this.releaseRequestInTx(
          tx,
          p.id,
          user.id,
          `Payout ${p.reference} rejected: ${reason}`,
        );
        return {
          to: 'REJECTED',
          type: 'REJECTED',
          note: reason,
          data: { failureReason: reason, closedAt: new Date() },
          audit: 'finance.payout_rejected',
        };
      },
      context,
    );
  }

  private async postPaidInTx(
    tx: Tx,
    p: Prisma.PayoutGetPayload<object>,
    fee: Prisma.Decimal,
    actorId: string | null,
    at: Date,
  ) {
    const cash = p.method === 'PAYMONGO' ? ACCOUNT.PROVIDER : ACCOUNT.BANK;
    const dims = { sellerId: p.sellerId, kind: 'PAYOUT' };
    await postJournalInTx(tx, {
      type: 'PAYOUT_PAID',
      description: `Payout ${p.reference} paid`,
      occurredAt: at,
      idempotencyKey: `payout-paid:${p.id}`,
      sourceType: 'PAYOUT',
      sourceId: p.id,
      createdById: actorId,
      lines: [
        dr(ACCOUNT.SELLER_PAYOUT, p.amount, dims),
        cr(cash, p.amount, dims),
        dr(ACCOUNT.TRANSFER_FEES, fee, { kind: 'TRANSFER_FEE' }),
        cr(cash, fee, { kind: 'TRANSFER_FEE' }),
      ],
    });
    const seller = await tx.seller.findUniqueOrThrow({
      where: { id: p.sellerId },
      select: { businessName: true },
    });
    await emitNotificationInTx(tx, {
      event: 'PAYOUT_PAID',
      userIds: await sellerRecipientIdsInTx(tx, p.sellerId),
      data: {
        sellerName: seller.businessName,
        reference: p.reference,
        amount: p.amount.toFixed(2),
      },
      link: '/finance/payouts',
    });
  }

  /** Finance paid it by bank transfer and records the bank's reference. */
  markPaid(
    user: AuthenticatedUser,
    id: string,
    input: MarkPayoutPaidRequest,
    context: RequestContext,
  ) {
    return this.transition(
      user,
      id,
      ['APPROVED', 'PROCESSING'],
      async (tx, p) => {
        const at = input.paidAt ? new Date(input.paidAt) : new Date();
        const fee = D(input.transferFee ?? '0');
        await this.postPaidInTx(tx, p, fee, user.id, at);
        return {
          to: 'PAID',
          type: 'PAID',
          note: `Bank reference ${input.transferReference}`,
          data: {
            transferReference: input.transferReference,
            transferFee: fee,
            paidAt: at,
            closedAt: at,
          },
          audit: 'finance.payout_paid',
        };
      },
      context,
    );
  }

  /** The transfer did not go through (before it was recorded as paid). */
  markFailed(user: AuthenticatedUser, id: string, reason: string, context: RequestContext) {
    return this.transition(
      user,
      id,
      ['APPROVED', 'PROCESSING'],
      async (tx, p) => {
        await this.releaseRequestInTx(tx, p.id, user.id, `Payout ${p.reference} failed: ${reason}`);
        return {
          to: 'FAILED',
          type: 'FAILED',
          note: reason,
          data: { failureReason: reason, closedAt: new Date() },
          audit: 'finance.payout_failed',
        };
      },
      context,
    );
  }

  /** A paid payout came back (returned by the bank) or was recorded in error. */
  reverse(user: AuthenticatedUser, id: string, reason: string, context: RequestContext) {
    return this.transition(
      user,
      id,
      ['PAID'],
      async (tx, p) => {
        const paid = await journalByKey(tx, `payout-paid:${p.id}`);
        if (paid)
          await reverseJournalInTx(tx, paid.id, {
            description: `Payout ${p.reference} reversed: ${reason}`,
            createdById: user.id,
          });
        await this.releaseRequestInTx(
          tx,
          p.id,
          user.id,
          `Payout ${p.reference} reversed: ${reason}`,
        );
        return {
          to: 'REVERSED',
          type: 'REVERSED',
          note: reason,
          data: { failureReason: reason, closedAt: new Date() },
          audit: 'finance.payout_reversed',
        };
      },
      context,
    );
  }

  // ---- PayMongo transfers ---------------------------------------------------------------------

  /**
   * Sends an approved payout through PayMongo. The payout is marked PROCESSING before the call
   * (so it cannot be sent twice); the provider's answer is then applied.
   */
  async send(user: AuthenticatedUser, id: string, context: RequestContext) {
    if (!this.provider)
      throw conflict(
        'PayMongo payouts are not set up (PAYMONGO_SECRET_KEY and PAYMONGO_WALLET_ACCOUNT_NUMBER).',
      );
    const settings = await financeSettingsInTx(this.prisma);
    if (!settings.payouts.payMongoEnabled)
      throw conflict('Payouts through PayMongo are turned off in finance settings.');
    let destination!: { accountNumber: string; accountName: string; bic: string };
    let payout!: Prisma.PayoutGetPayload<object>;
    await this.transition(
      user,
      id,
      ['APPROVED'],
      async (tx, p) => {
        const account = await tx.sellerBankAccount.findUniqueOrThrow({
          where: { id: p.bankAccountId },
        });
        if (!account.institutionCode)
          throw conflict('The bank account has no BIC; pay it manually.');
        destination = {
          accountNumber: decryptField(
            account.accountNumberEncrypted,
            this.config.finance.encryptionKey,
          ),
          accountName: account.accountName,
          bic: account.institutionCode,
        };
        payout = p;
        return {
          to: 'PROCESSING',
          type: 'SENT',
          note: 'Sent to PayMongo',
          data: { method: 'PAYMONGO', livemode: this.provider!.livemode },
          audit: 'finance.payout_sent',
        };
      },
      context,
    );
    try {
      const transfer = await this.provider.createTransfer({
        reference: payout.reference,
        amount: m(payout.amount),
        destination,
        description: `Marketplace payout ${payout.reference}`,
      });
      await this.prisma.payout.update({ where: { id }, data: { providerTransferId: transfer.id } });
      await this.applyProviderStatus(id, transfer.status, transfer.fee, transfer.failureReason);
    } catch (error) {
      const retryable = error instanceof GatewayError && error.retryable;
      this.logger.warn(
        `PayMongo transfer for ${payout.reference} failed: ${(error as Error).message}`,
      );
      if (retryable) {
        // Unknown outcome (timeout, provider error): the transfer may exist. It stays
        // PROCESSING; finance checks the PayMongo dashboard and records it as paid or failed.
        await this.prisma.payoutEvent.create({
          data: {
            payoutId: id,
            type: 'SEND_UNCERTAIN',
            note: `${(error as Error).message.slice(0, 800)} — check the PayMongo dashboard before retrying.`,
          },
        });
      } else {
        await this.applyProviderStatus(id, 'FAILED', null, (error as Error).message);
      }
    }
    return this.detail(id, { sellerId: null });
  }

  /** Asks PayMongo for the transfer's status (also run by finance from the payout page). */
  async check(id: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id } });
    if (!payout) throw notFound('Payout');
    if (payout.status !== 'PROCESSING' || !payout.providerTransferId || !this.provider)
      throw conflict('Only payouts sent to PayMongo and still processing can be checked.');
    const transfer = await this.provider.retrieveTransfer(payout.providerTransferId);
    await this.applyProviderStatus(id, transfer.status, transfer.fee, transfer.failureReason);
    return this.detail(id, { sellerId: null });
  }

  private async applyProviderStatus(
    id: string,
    status: 'PROCESSING' | 'PAID' | 'FAILED',
    fee: string | null,
    reason: string | null,
  ) {
    if (status === 'PROCESSING') return;
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status"::text FROM "payouts" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (row?.status !== 'PROCESSING') return; // already applied
      const p = await tx.payout.findUniqueOrThrow({ where: { id } });
      await lockSellerBalanceInTx(tx, p.sellerId);
      const now = new Date();
      if (status === 'PAID') {
        const transferFee = D(fee ?? '0');
        await this.postPaidInTx(tx, p, transferFee, null, now);
        await tx.payout.update({
          where: { id },
          data: {
            status: 'PAID',
            transferFee,
            paidAt: now,
            closedAt: now,
            transferReference: p.providerTransferId,
          },
        });
        await this.event(tx, id, 'PAID', 'PROCESSING', 'PAID', null, 'PayMongo transfer succeeded');
      } else {
        await this.releaseRequestInTx(tx, id, null, `Payout ${p.reference} failed at PayMongo`);
        await tx.payout.update({
          where: { id },
          data: {
            status: 'FAILED',
            failureReason: reason?.slice(0, 500) ?? 'Transfer failed',
            closedAt: now,
          },
        });
        await this.event(
          tx,
          id,
          'FAILED',
          'PROCESSING',
          'FAILED',
          null,
          reason?.slice(0, 900) ?? null,
        );
      }
    });
  }

  get payMongoConfigured() {
    return this.provider !== null;
  }
}
