import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, taxRuleAt, type TaxRuleSnapshot } from '@marketplace/database';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type { CreateTaxRuleRequest, EndRuleRequest, TaxRuleDto } from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ruleState } from './commission-rules.service';

type Db = Prisma.TransactionClient | PrismaService;

const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);

/**
 * Versioned tax rules per jurisdiction (ADR 0029): goods tax by seller registration (checkout),
 * marketplace services tax (commission and fee recoveries), withholding on remittances
 * (settlement). Nothing assumes a single VAT rate; with no rule in force, no tax applies.
 */
@Injectable()
export class TaxRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private dto(r: Prisma.TaxRuleGetPayload<object>, now = new Date()): TaxRuleDto {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      jurisdiction: r.jurisdiction,
      kind: r.kind,
      appliesTo: r.appliesTo,
      sellerRegistration: r.sellerRegistration as TaxRuleDto['sellerRegistration'],
      ratePercent: r.ratePercent.toString(),
      basePercent: r.basePercent.toString(),
      inclusive: r.inclusive,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      state: ruleState(r, now),
      legalReference: r.legalReference,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(): Promise<{ items: TaxRuleDto[] }> {
    const rows = await this.prisma.taxRule.findMany({
      orderBy: [{ jurisdiction: 'asc' }, { appliesTo: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return { items: rows.map((r) => this.dto(r)) };
  }

  /** A new version for (jurisdiction, applies to, seller registration) ends the current one. */
  async create(user: AuthenticatedUser, input: CreateTaxRuleRequest, context: RequestContext) {
    const now = new Date();
    const from = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
    if (from.getTime() < now.getTime() - 60_000)
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Rules cannot start in the past.',
        [{ path: 'effectiveFrom', message: 'Must be now or later' }],
      );
    const jurisdiction = input.jurisdiction ?? 'PH';
    const registration = input.sellerRegistration ?? 'ANY';
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tax-rules'))`;
      const open = await tx.taxRule.findMany({
        where: {
          jurisdiction,
          appliesTo: input.appliesTo,
          sellerRegistration: registration,
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
        },
      });
      for (const rule of open) {
        if (rule.effectiveFrom.getTime() >= from.getTime())
          throw conflict('A rule for the same taxes starts at or after this time. End it first.');
        await tx.taxRule.update({
          where: { id: rule.id },
          data: { effectiveTo: from, endedById: user.id },
        });
      }
      const created = await tx.taxRule.create({
        data: {
          code: input.code,
          name: input.name,
          jurisdiction,
          kind: input.kind,
          appliesTo: input.appliesTo,
          sellerRegistration: registration,
          ratePercent: new Prisma.Decimal(input.ratePercent),
          basePercent: new Prisma.Decimal(input.basePercent ?? '100'),
          inclusive: input.inclusive,
          effectiveFrom: from,
          legalReference: input.legalReference ?? null,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          action: 'tax.rule_created',
          actorId: user.id,
          entityType: 'tax_rule',
          entityId: created.id,
          metadata: {
            code: created.code,
            appliesTo: created.appliesTo,
            ratePercent: created.ratePercent.toString(),
            effectiveFrom: from.toISOString(),
          },
        },
        context,
        tx,
      );
      return created;
    });
    return this.dto(row);
  }

  async end(user: AuthenticatedUser, id: string, input: EndRuleRequest, context: RequestContext) {
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tax-rules'))`;
      const rule = await tx.taxRule.findUnique({ where: { id } });
      if (!rule) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Tax rule not found.');
      if (rule.effectiveTo && rule.effectiveTo.getTime() <= now.getTime())
        throw conflict('This rule has already ended.');
      let at = input.effectiveTo ? new Date(input.effectiveTo) : now;
      if (at.getTime() < now.getTime()) at = now;
      if (at.getTime() < rule.effectiveFrom.getTime()) at = rule.effectiveFrom;
      const updated = await tx.taxRule.update({
        where: { id },
        data: { effectiveTo: at, endedById: user.id },
      });
      await this.audit.record(
        {
          action: 'tax.rule_ended',
          actorId: user.id,
          entityType: 'tax_rule',
          entityId: id,
          metadata: { effectiveTo: at.toISOString() },
        },
        context,
        tx,
      );
      return updated;
    });
    return this.dto(row);
  }

  /** Goods tax rule per seller at a time (VAT-registered or not). */
  async goodsTaxFor(sellerIds: string[], at: Date, db: Db = this.prisma) {
    const sellers = await db.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, vatRegistered: true },
    });
    const [vat, nonVat] = await Promise.all([
      taxRuleAt(db, 'GOODS', at, 'VAT_REGISTERED'),
      taxRuleAt(db, 'GOODS', at, 'NON_VAT'),
    ]);
    return new Map<string, TaxRuleSnapshot>(
      sellers.map((s) => [s.id, s.vatRegistered ? vat : nonVat]),
    );
  }
}
