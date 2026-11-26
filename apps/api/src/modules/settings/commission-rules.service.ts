import { HttpStatus, Injectable } from '@nestjs/common';
import {
  commissionAmount,
  type CommissionRuleLike,
  type CommissionTarget,
  Prisma,
  resolveCommission,
  type ResolvedCommission,
} from '@marketplace/database';
import { type AuthenticatedUser, hasPermission } from '@marketplace/shared-types';
import type {
  CommissionPreview,
  CommissionRuleDetail,
  CommissionRuleDetailList,
  CommissionRuleDto,
  CommissionRuleInput,
  CommissionRuleQuery,
  CreateCommissionRuleRequest,
  EndRuleRequest,
  RuleState,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type Db = Prisma.TransactionClient | PrismaService;
type Tx = Prisma.TransactionClient;

const ruleInclude = {
  category: { select: { id: true, name: true } },
  seller: { select: { id: true, businessName: true } },
  product: { select: { id: true, name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  endedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CommissionRuleInclude;
type RuleRow = Prisma.CommissionRuleGetPayload<{ include: typeof ruleInclude }>;

const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);

export function ruleState(
  rule: { effectiveFrom: Date; effectiveTo: Date | null },
  now = new Date(),
): RuleState {
  if (rule.effectiveTo && rule.effectiveTo.getTime() <= now.getTime()) return 'ENDED';
  if (rule.effectiveFrom.getTime() > now.getTime()) return 'SCHEDULED';
  return 'CURRENT';
}

const name = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.firstName} ${u.lastName}`.trim() : null;

/**
 * Versioned commission rules (ADR 0026). A rule is never edited or deleted (the database
 * refuses): a new rule for the same target ends the current one where it starts; ending a
 * rule sets its end. Order items keep the rule used, so history never changes.
 */
@Injectable()
export class CommissionRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async categoryPaths(db: Db) {
    const categories = await db.category.findMany({
      select: { id: true, name: true, parentId: true },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));
    return {
      names(id: string) {
        const names: string[] = [];
        for (let c = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined)
          names.unshift(c.name);
        return names;
      },
      ids(id: string) {
        const ids: string[] = [];
        for (let c = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined)
          ids.push(c.id);
        return ids;
      },
    };
  }

  private dto(
    r: RuleRow,
    paths: { names(id: string): string[] },
    now = new Date(),
  ): CommissionRuleDetail {
    return {
      id: r.id,
      scope: r.scope,
      type: r.type,
      category: r.category
        ? { id: r.category.id, name: r.category.name, path: paths.names(r.category.id) }
        : null,
      seller: r.seller ? { id: r.seller.id, name: r.seller.businessName } : null,
      product: r.product ? { id: r.product.id, name: r.product.name } : null,
      ratePercent: r.ratePercent.toFixed(2),
      fixedAmount: r.fixedAmount?.toFixed(2) ?? null,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      state: ruleState(r, now),
      reason: r.reason,
      createdBy: name(r.createdBy),
      endedBy: name(r.endedBy),
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(
    query: CommissionRuleQuery & { page: number; pageSize: number },
  ): Promise<CommissionRuleDetailList> {
    const now = new Date();
    const stateWhere: Prisma.CommissionRuleWhereInput =
      query.state === 'CURRENT'
        ? { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }
        : query.state === 'SCHEDULED'
          ? { effectiveFrom: { gt: now } }
          : query.state === 'ENDED'
            ? { effectiveTo: { lte: now } }
            : {};
    const where: Prisma.CommissionRuleWhereInput = {
      AND: [
        stateWhere,
        query.scope ? { scope: query.scope } : {},
        query.sellerId ? { sellerId: query.sellerId } : {},
        query.q
          ? {
              OR: [
                { category: { name: { contains: query.q, mode: 'insensitive' } } },
                { seller: { businessName: { contains: query.q, mode: 'insensitive' } } },
                { product: { name: { contains: query.q, mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };
    const [rows, total, paths] = await Promise.all([
      this.prisma.commissionRule.findMany({
        where,
        include: ruleInclude,
        orderBy: [{ scope: 'asc' }, { effectiveFrom: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.commissionRule.count({ where }),
      this.categoryPaths(this.prisma),
    ]);
    return {
      items: rows.map((r) => this.dto(r, paths, now)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Creates a rule version. The current rule for the same target ends where the new one
   * starts; a rule already scheduled after that start must be ended first.
   */
  async create(
    user: AuthenticatedUser,
    input: CreateCommissionRuleRequest,
    context: RequestContext,
  ): Promise<CommissionRuleDetail> {
    if (input.type === 'EXEMPT' && !hasPermission(user, 'commission.exempt')) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Granting commission exemptions needs the commission.exempt permission.',
      );
    }
    const now = new Date();
    const from = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
    if (from.getTime() < now.getTime() - 60_000)
      throw invalid('effectiveFrom', 'Rules cannot start in the past (history never changes).');
    const to = input.effectiveTo ? new Date(input.effectiveTo) : null;
    const target = {
      scope: input.scope,
      categoryId: input.categoryId ?? null,
      sellerId: input.sellerId ?? null,
      productId: input.productId ?? null,
    };
    await this.checkTarget(target);
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('commission-rules'))`;
      await this.replaceInTx(tx, target, from, user.id);
      const rule = await tx.commissionRule.create({
        data: {
          ...target,
          type: input.type,
          ratePercent: input.type === 'PERCENTAGE' ? new Prisma.Decimal(input.ratePercent!) : 0,
          fixedAmount: input.type === 'FIXED' ? new Prisma.Decimal(input.fixedAmount!) : null,
          effectiveFrom: from,
          effectiveTo: to,
          reason: input.reason ?? null,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          action:
            input.type === 'EXEMPT' ? 'commission.exemption_granted' : 'commission.rule_created',
          actorId: user.id,
          entityType: 'commission_rule',
          entityId: rule.id,
          metadata: {
            ...target,
            type: input.type,
            ratePercent: rule.ratePercent.toFixed(2),
            fixedAmount: rule.fixedAmount?.toFixed(2) ?? null,
            effectiveFrom: from.toISOString(),
            effectiveTo: to?.toISOString() ?? null,
          },
        },
        context,
        tx,
      );
      return rule.id;
    });
    return this.get(id);
  }

  async get(id: string): Promise<CommissionRuleDetail> {
    const row = await this.prisma.commissionRule.findUnique({
      where: { id },
      include: ruleInclude,
    });
    if (!row)
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Commission rule not found.');
    return this.dto(row, await this.categoryPaths(this.prisma));
  }

  private async checkTarget(target: {
    scope: string;
    categoryId: string | null;
    sellerId: string | null;
    productId: string | null;
  }) {
    if (
      target.categoryId &&
      !(await this.prisma.category.count({ where: { id: target.categoryId } }))
    )
      throw invalid('categoryId', 'Choose a category.');
    if (target.sellerId && !(await this.prisma.seller.count({ where: { id: target.sellerId } })))
      throw invalid('sellerId', 'Choose a seller.');
    if (target.productId && !(await this.prisma.product.count({ where: { id: target.productId } })))
      throw invalid('productId', 'Choose a product.');
  }

  /** Ends the rules of a target that are still in force at `from`. */
  private async replaceInTx(
    tx: Tx,
    target: {
      scope: string;
      categoryId: string | null;
      sellerId: string | null;
      productId: string | null;
    },
    from: Date,
    userId: string,
  ) {
    const open = await tx.commissionRule.findMany({
      where: {
        scope: target.scope as 'DEFAULT',
        categoryId: target.categoryId,
        sellerId: target.sellerId,
        productId: target.productId,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }],
      },
    });
    for (const rule of open) {
      if (rule.effectiveFrom.getTime() >= from.getTime()) {
        throw conflict(
          'Another rule for the same target starts at or after this time. End that scheduled rule first.',
        );
      }
      await tx.commissionRule.update({
        where: { id: rule.id },
        data: { effectiveTo: from, endedById: userId },
      });
    }
  }

  /** Ends a rule (now, or at a later time). The default rule can only be replaced. */
  async end(
    user: AuthenticatedUser,
    id: string,
    input: EndRuleRequest,
    context: RequestContext,
  ): Promise<CommissionRuleDetail> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('commission-rules'))`;
      const rule = await tx.commissionRule.findUnique({ where: { id } });
      if (!rule)
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Commission rule not found.');
      if (rule.scope === 'DEFAULT')
        throw conflict('The default rate can be replaced by a new rate but not ended.');
      if (rule.effectiveTo && rule.effectiveTo.getTime() <= now.getTime())
        throw conflict('This rule has already ended.');
      if (rule.type === 'EXEMPT' && !hasPermission(user, 'commission.exempt'))
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Ending exemptions needs commission.exempt.',
        );
      let at = input.effectiveTo ? new Date(input.effectiveTo) : now;
      if (at.getTime() < now.getTime()) at = now;
      // A scheduled rule ended before it starts never applies (zero-length).
      if (at.getTime() < rule.effectiveFrom.getTime()) at = rule.effectiveFrom;
      await tx.commissionRule.update({
        where: { id },
        data: { effectiveTo: at, endedById: user.id },
      });
      await this.audit.record(
        {
          action: 'commission.rule_ended',
          actorId: user.id,
          entityType: 'commission_rule',
          entityId: id,
          metadata: { effectiveTo: at.toISOString() },
        },
        context,
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * Loads the rules in force at a time once and returns a resolver for products, so checkout
   * prices many items with one query.
   */
  async resolverAt(at: Date, db: Db = this.prisma) {
    const [rules, paths] = await Promise.all([
      db.commissionRule.findMany({
        where: {
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
      }),
      this.categoryPaths(db),
    ]);
    const like: CommissionRuleLike[] = rules;
    return (
      target: Omit<CommissionTarget, 'categoryPath'> & { categoryId: string },
    ): ResolvedCommission =>
      resolveCommission(like, { ...target, categoryPath: paths.ids(target.categoryId) }, at);
  }

  async preview(productId: string, at?: string): Promise<CommissionPreview> {
    const when = at ? new Date(at) : new Date();
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        categoryId: true,
        seller: { select: { id: true, businessName: true } },
      },
    });
    if (!product) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product not found.');
    const resolve = await this.resolverAt(when);
    const resolved = resolve({
      productId,
      sellerId: product.seller.id,
      categoryId: product.categoryId,
    });
    const paths = await this.categoryPaths(this.prisma);
    return {
      product: { id: product.id, name: product.name },
      seller: { id: product.seller.id, name: product.seller.businessName },
      categoryPath: paths.names(product.categoryId),
      at: when.toISOString(),
      rule: resolved.ruleId ? await this.get(resolved.ruleId) : null,
      exampleOn1000: commissionAmount(resolved, new Prisma.Decimal(1000), 1).toFixed(2),
    };
  }

  // ---- Phase 4 settings endpoints (default and category percentage rates) --------------------

  async currentBasicRules(): Promise<CommissionRuleDto[]> {
    const now = new Date();
    const [rules, paths] = await Promise.all([
      this.prisma.commissionRule.findMany({
        where: {
          scope: { in: ['DEFAULT', 'CATEGORY'] },
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        include: { category: true },
      }),
      this.categoryPaths(this.prisma),
    ]);
    return rules
      .map((r) => ({
        id: r.id,
        category: r.category
          ? { id: r.category.id, name: r.category.name, path: paths.names(r.category.id) }
          : null,
        ratePercent: r.ratePercent.toFixed(2),
        updatedAt: r.createdAt.toISOString(),
      }))
      .sort((a, b) =>
        a.category === null
          ? -1
          : b.category === null
            ? 1
            : a.category.path.join('/').localeCompare(b.category.path.join('/')),
      );
  }

  async putBasic(user: AuthenticatedUser, input: CommissionRuleInput, context: RequestContext) {
    await this.create(
      user,
      {
        scope: input.categoryId ? 'CATEGORY' : 'DEFAULT',
        type: 'PERCENTAGE',
        categoryId: input.categoryId ?? null,
        ratePercent: input.ratePercent,
      },
      context,
    );
    return this.currentBasicRules();
  }

  async endBasic(user: AuthenticatedUser, id: string, context: RequestContext) {
    await this.end(user, id, {}, context);
    return this.currentBasicRules();
  }
}
