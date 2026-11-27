import { Injectable } from '@nestjs/common';
import {
  eligibleSellerOrders,
  financeSettingsInTx,
  lastClosedPeriod,
  periodContaining,
  Prisma,
  runSettlement,
} from '@marketplace/database';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type {
  FinanceDocumentDto,
  FinanceDocumentList,
  RunSettlementRequest,
  RunSettlementResult,
  SellerTaxProfile,
  SettlementDetail,
  SettlementDto,
  SettlementList,
  VerifySellerTaxRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  conflict,
  iso,
  m,
  manilaDayEnd,
  manilaDayStart,
  notFound,
  paged,
  personName,
} from './finance-common';

const settlementInclude = {
  seller: { select: { id: true, businessName: true } },
} satisfies Prisma.SettlementInclude;
type SettlementRow = Prisma.SettlementGetPayload<{ include: typeof settlementInclude }>;

const documentInclude = {
  seller: { select: { id: true, businessName: true } },
  settlement: { select: { id: true, reference: true } },
} satisfies Prisma.FinanceDocumentInclude;
type DocumentRow = Prisma.FinanceDocumentGetPayload<{ include: typeof documentInclude }>;

/**
 * Settlement periods, statements and the marketplace's service invoices and credit notes
 * (ADR 0028), plus sellers' tax profiles (ADR 0029). Sellers only ever see their own.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async journalRefs(ids: string[]) {
    const rows = await this.prisma.journalTransaction.findMany({
      where: { id: { in: ids } },
      select: { id: true, reference: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private dto(
    s: SettlementRow,
    journals: Map<string, { id: string; reference: string }>,
  ): SettlementDto {
    return {
      id: s.id,
      reference: s.reference,
      seller: { id: s.seller.id, name: s.seller.businessName },
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      ordersCount: s.ordersCount,
      grossSales: m(s.grossSales),
      shippingCredits: m(s.shippingCredits),
      commission: m(s.commission),
      paymentFees: m(s.paymentFees),
      refunds: m(s.refunds),
      commissionReversals: m(s.commissionReversals),
      otherAdjustments: m(s.otherAdjustments),
      netSettled: m(s.netSettled),
      withholdingBase: m(s.withholdingBase),
      withholdingTax: m(s.withholdingTax),
      withholding: s.withholdingSnapshot as Record<string, unknown>,
      openingAvailable: m(s.openingAvailable),
      closingAvailable: m(s.closingAvailable),
      journal: s.journalId ? (journals.get(s.journalId) ?? null) : null,
      createdAt: s.createdAt.toISOString(),
    };
  }

  async list(query: {
    page: number;
    pageSize: number;
    sellerId?: string;
    from?: string;
    to?: string;
  }): Promise<SettlementList> {
    const where: Prisma.SettlementWhereInput = {
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      ...(query.from || query.to
        ? {
            periodStart: {
              ...(query.from ? { gte: manilaDayStart(query.from) } : {}),
              ...(query.to ? { lt: manilaDayEnd(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        include: settlementInclude,
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.settlement.count({ where }),
    ]);
    const journals = await this.journalRefs(
      rows.map((r) => r.journalId).filter((x): x is string => !!x),
    );
    return paged(
      rows.map((r) => this.dto(r, journals)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async detail(id: string, sellerId: string | null): Promise<SettlementDetail> {
    const row = await this.prisma.settlement.findFirst({
      where: { id, ...(sellerId ? { sellerId } : {}) },
      include: {
        ...settlementInclude,
        lines: { orderBy: { orderNumber: 'asc' } },
        documents: {
          select: { id: true, type: true, number: true, total: true },
          orderBy: { number: 'asc' },
        },
      },
    });
    if (!row) throw notFound('Settlement');
    const journals = await this.journalRefs(row.journalId ? [row.journalId] : []);
    return {
      ...this.dto(row, journals),
      lines: row.lines.map((l) => ({
        sellerOrderId: l.sellerOrderId,
        orderNumber: l.orderNumber,
        grossSales: m(l.grossSales),
        shippingCredits: m(l.shippingCredits),
        commission: m(l.commission),
        paymentFees: m(l.paymentFees),
        refunds: m(l.refunds),
        commissionReversals: m(l.commissionReversals),
        otherAdjustments: m(l.otherAdjustments),
        net: m(l.net),
        withholdingBase: m(l.withholdingBase),
      })),
      documents: row.documents.map((d) => ({
        id: d.id,
        type: d.type,
        number: d.number,
        total: m(d.total),
      })),
    };
  }

  /** Which sellers have orders that a settlement run would include now. */
  async preview(periodDate?: string | null) {
    const settings = await financeSettingsInTx(this.prisma);
    const period = periodDate
      ? periodContaining(manilaDayStart(periodDate), settings.settlement)
      : lastClosedPeriod(new Date(), settings.settlement);
    const rows = await eligibleSellerOrders(
      this.prisma,
      null,
      period.end,
      settings.settlement.holdDays,
    );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.seller_id, (counts.get(r.seller_id) ?? 0) + 1);
    const sellers = await this.prisma.seller.findMany({
      where: { id: { in: [...counts.keys()] } },
      select: { id: true, businessName: true },
    });
    return {
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      sellers: sellers.map((s) => ({
        sellerId: s.id,
        name: s.businessName,
        orders: counts.get(s.id)!,
      })),
    };
  }

  /**
   * Settles a closed period now (the worker does it on schedule). Periods that have not ended
   * cannot be settled.
   */
  async run(
    user: AuthenticatedUser,
    input: RunSettlementRequest,
    context: RequestContext,
  ): Promise<RunSettlementResult> {
    const settings = await financeSettingsInTx(this.prisma);
    const now = new Date();
    const period = input.periodContaining
      ? periodContaining(manilaDayStart(input.periodContaining), settings.settlement)
      : lastClosedPeriod(now, settings.settlement);
    if (period.end.getTime() > now.getTime())
      throw conflict('This period has not ended yet; it is settled once it closes.');
    const settled = await runSettlement(this.prisma, {
      period,
      createdById: user.id,
      sellerId: input.sellerId ?? undefined,
      now,
    });
    await this.audit.record(
      {
        action: 'finance.settlement_run',
        actorId: user.id,
        entityType: 'settlement_period',
        entityId: period.start.toISOString(),
        metadata: { sellers: settled.length, sellerId: input.sellerId ?? null },
      },
      context,
    );
    return {
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      settled,
    };
  }

  // ---- Service invoices and credit notes ------------------------------------------------------

  private documentDto(d: DocumentRow): FinanceDocumentDto {
    return {
      id: d.id,
      type: d.type,
      number: d.number,
      issuedAt: d.issuedAt.toISOString(),
      subtotal: m(d.subtotal),
      taxAmount: m(d.taxAmount),
      total: m(d.total),
      lines: d.lines as FinanceDocumentDto['lines'],
      taxSnapshot: d.taxSnapshot as Record<string, unknown>,
      buyer: d.buyerSnapshot as Record<string, unknown>,
      issuer: d.issuerSnapshot as Record<string, unknown>,
      settlement: d.settlement,
      seller: { id: d.seller.id, name: d.seller.businessName },
    };
  }

  async documents(query: {
    page: number;
    pageSize: number;
    sellerId?: string;
  }): Promise<FinanceDocumentList> {
    const where = query.sellerId ? { sellerId: query.sellerId } : {};
    const [rows, total] = await Promise.all([
      this.prisma.financeDocument.findMany({
        where,
        include: documentInclude,
        orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.financeDocument.count({ where }),
    ]);
    return paged(
      rows.map((r) => {
        const { lines: _lines, ...rest } = this.documentDto(r);
        return rest;
      }),
      query.page,
      query.pageSize,
      total,
    );
  }

  async document(id: string, sellerId: string | null): Promise<FinanceDocumentDto> {
    const row = await this.prisma.financeDocument.findFirst({
      where: { id, ...(sellerId ? { sellerId } : {}) },
      include: documentInclude,
    });
    if (!row) throw notFound('Document');
    return this.documentDto(row);
  }

  // ---- Seller tax profiles -----------------------------------------------------------------------

  async taxProfile(sellerId: string): Promise<SellerTaxProfile> {
    const s = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        businessName: true,
        taxRegisteredName: true,
        tin: true,
        vatRegistered: true,
        taxVerifiedAt: true,
        taxVerifiedBy: { select: { firstName: true, lastName: true } },
        withholdingExemptUntil: true,
        withholdingExemptNote: true,
        documents: {
          where: { type: { in: ['BIR_REGISTRATION', 'SWORN_DECLARATION'] } },
          select: { id: true, type: true, createdAt: true },
        },
      },
    });
    if (!s) throw notFound('Seller');
    return {
      sellerId: s.id,
      businessName: s.businessName,
      taxRegisteredName: s.taxRegisteredName,
      tin: s.tin,
      vatRegistered: s.vatRegistered,
      verifiedAt: iso(s.taxVerifiedAt),
      verifiedBy: personName(s.taxVerifiedBy),
      withholdingExemptUntil: s.withholdingExemptUntil?.toISOString().slice(0, 10) ?? null,
      withholdingExemptNote: s.withholdingExemptNote,
      documents: s.documents.map((d) => ({
        id: d.id,
        type: d.type,
        uploadedAt: d.createdAt.toISOString(),
      })),
    };
  }

  async taxProfilesToVerify(): Promise<{ items: SellerTaxProfile[] }> {
    const rows = await this.prisma.seller.findMany({
      where: { taxVerifiedAt: null, status: 'VERIFIED' },
      select: { id: true },
      orderBy: { businessName: 'asc' },
      take: 100,
    });
    return { items: await Promise.all(rows.map((r) => this.taxProfile(r.id))) };
  }

  async updateTaxName(
    user: AuthenticatedUser,
    sellerId: string,
    taxRegisteredName: string,
    context: RequestContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.seller.findUniqueOrThrow({
        where: { id: sellerId },
        select: { taxRegisteredName: true },
      });
      if (before.taxRegisteredName === taxRegisteredName) return;
      // A change needs finance to check the registration again.
      await tx.seller.update({
        where: { id: sellerId },
        data: { taxRegisteredName, taxVerifiedAt: null, taxVerifiedById: null },
      });
      await this.audit.record(
        {
          action: 'seller.tax_name_changed',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
        },
        context,
        tx,
      );
    });
    return this.taxProfile(sellerId);
  }

  /** Finance checked the TIN, registration and CoR; optionally accepts a sworn declaration. */
  async verifyTax(
    user: AuthenticatedUser,
    sellerId: string,
    input: VerifySellerTaxRequest,
    context: RequestContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const seller = await tx.seller.findUnique({ where: { id: sellerId }, select: { tin: true } });
      if (!seller) throw notFound('Seller');
      if (input.verified && !seller.tin)
        throw conflict('The seller has no TIN yet; it cannot be verified.');
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          taxVerifiedAt: input.verified ? new Date() : null,
          taxVerifiedById: input.verified ? user.id : null,
          withholdingExemptUntil: input.withholdingExemptUntil
            ? new Date(`${input.withholdingExemptUntil}T00:00:00Z`)
            : null,
          withholdingExemptNote: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'seller.tax_verified',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: {
            verified: input.verified,
            withholdingExemptUntil: input.withholdingExemptUntil ?? null,
          },
        },
        context,
        tx,
      );
    });
    return this.taxProfile(sellerId);
  }
}
