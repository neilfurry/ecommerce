import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import {
  type AuthenticatedUser,
  CARRIERS,
  DEFAULT_BANK_TRANSFER_WINDOW_HOURS,
  DEFAULT_RETURN_RESPONSE_DAYS,
  DEFAULT_RETURN_WINDOW_DAYS,
  PAYMENT_METHODS,
} from '@marketplace/shared-types';
import {
  type CheckoutSettings,
  type CheckoutSettingsInput,
  type CommissionRuleDto,
  type CommissionRuleInput,
  checkoutSettingsSchema,
  type OrderSettings,
  type OrderSettingsInput,
  orderSettingsSchema,
  type PlatformSettings,
  type ShippingRates,
  shippingRatesSchema,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  vat: { rate: '0.12', pricesIncludeVat: true },
  charges: [],
  paymentWindowMinutes: 60,
  paymentMethods: [...PAYMENT_METHODS],
};

/** Development rate table for the mock shipping provider (pesos). */
export const DEFAULT_SHIPPING_RATES: ShippingRates = {
  base: {
    sameCity: '85.00',
    sameRegion: '120.00',
    sameIslandGroup: '160.00',
    otherIslandGroup: '220.00',
  },
  perAdditionalKg: '35.00',
  volumetricDivisor: 3500,
  expressMultiplier: '1.60',
  sameDayFee: '180.00',
};

/** Orders, payments, cash on delivery, returns and couriers. */
export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  bankTransfer: {
    windowHours: DEFAULT_BANK_TRANSFER_WINDOW_HOURS,
    // No account until finance enters one: bank transfer is not offered without it.
    accounts: [],
    instructions:
      'Transfer the exact amount and put the payment reference in the transfer notes, then upload your receipt.',
  },
  cod: { maxOrderAmount: '50000.00', maxFailedDeliveries: 2 },
  returns: {
    windowDays: DEFAULT_RETURN_WINDOW_DAYS,
    sellerResponseDays: DEFAULT_RETURN_RESPONSE_DAYS,
  },
  // The mock courier is allowed outside production only (checked when booking).
  carriers: Object.fromEntries(
    CARRIERS.map((c) => [c, c === 'MOCK' || c === 'SELF']),
  ) as OrderSettings['carriers'],
};

const KEYS = {
  checkout: 'checkout',
  shippingRates: 'shipping_rates',
  orders: 'orders',
} as const;

/** A commission rule and the rate that applies, for a category (or its nearest ancestor). */
export interface ResolvedCommission {
  ruleId: string | null;
  ratePercent: Prisma.Decimal;
}

/**
 * Settings administrators edit (stored as validated JSON in platform_settings), with safe
 * defaults when nothing was saved yet, and the commission rate table.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async checkout(
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<CheckoutSettings> {
    const row = await db.platformSetting.findUnique({ where: { key: KEYS.checkout } });
    const parsed = row ? checkoutSettingsSchema.safeParse(row.value) : null;
    return parsed?.success ? parsed.data : DEFAULT_CHECKOUT_SETTINGS;
  }

  async shippingRates(
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<ShippingRates> {
    const row = await db.platformSetting.findUnique({ where: { key: KEYS.shippingRates } });
    const parsed = row ? shippingRatesSchema.safeParse(row.value) : null;
    return parsed?.success ? parsed.data : DEFAULT_SHIPPING_RATES;
  }

  async orders(db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<OrderSettings> {
    const row = await db.platformSetting.findUnique({ where: { key: KEYS.orders } });
    const parsed = row ? orderSettingsSchema.safeParse(row.value) : null;
    if (!parsed?.success) return DEFAULT_ORDER_SETTINGS;
    return {
      ...parsed.data,
      carriers: { ...DEFAULT_ORDER_SETTINGS.carriers, ...parsed.data.carriers },
    };
  }

  /**
   * Saves order settings. `carrierAvailable` says which couriers can actually book
   * shipments; enabling one that cannot is refused.
   */
  async saveOrders(
    user: AuthenticatedUser,
    input: OrderSettingsInput,
    context: RequestContext,
    carrierAvailable: (carrier: string) => boolean,
  ): Promise<OrderSettings> {
    const value = orderSettingsSchema.parse(input);
    const refused = Object.entries(value.carriers)
      .filter(([carrier, enabled]) => enabled && !carrierAvailable(carrier))
      .map(([carrier]) => carrier);
    if (refused.length > 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        `These couriers are not set up yet: ${refused.join(', ')}.`,
        refused.map((carrier) => ({ path: `carriers.${carrier}`, message: 'Not set up yet' })),
      );
    }
    await this.save(KEYS.orders, value, user, context);
    return value;
  }

  async all(): Promise<PlatformSettings> {
    return {
      checkout: await this.checkout(),
      shippingRates: await this.shippingRates(),
      commissionRules: await this.commissionRules(),
      orders: await this.orders(),
    };
  }

  async saveCheckout(
    user: AuthenticatedUser,
    input: CheckoutSettingsInput,
    context: RequestContext,
  ): Promise<CheckoutSettings> {
    const value = checkoutSettingsSchema.parse(input);
    const codes = value.charges.map((c) => c.code);
    if (new Set(codes).size !== codes.length) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Each charge needs its own code.',
        [{ path: 'charges', message: 'Each charge needs its own code' }],
      );
    }
    await this.save(KEYS.checkout, value, user, context);
    return value;
  }

  async saveShippingRates(
    user: AuthenticatedUser,
    input: ShippingRates,
    context: RequestContext,
  ): Promise<ShippingRates> {
    const value = shippingRatesSchema.parse(input);
    await this.save(KEYS.shippingRates, value, user, context);
    return value;
  }

  private async save(key: string, value: object, user: AuthenticatedUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, updatedById: user.id },
        update: { value: value as Prisma.InputJsonValue, updatedById: user.id },
      });
      await this.audit.record(
        {
          action: 'settings.updated',
          actorId: user.id,
          entityType: 'platform_setting',
          entityId: key,
          metadata: { setting: key },
        },
        context,
        tx,
      );
    });
  }

  // ---- Commission ------------------------------------------------------------------------

  async commissionRules(): Promise<CommissionRuleDto[]> {
    const [rules, categories] = await Promise.all([
      this.prisma.commissionRule.findMany({ include: { category: true } }),
      this.prisma.category.findMany({ select: { id: true, name: true, parentId: true } }),
    ]);
    const byId = new Map(categories.map((c) => [c.id, c]));
    const path = (id: string) => {
      const names: string[] = [];
      for (let c = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined)
        names.unshift(c.name);
      return names;
    };
    return rules
      .map((r) => ({
        id: r.id,
        category: r.category
          ? { id: r.category.id, name: r.category.name, path: path(r.category.id) }
          : null,
        ratePercent: r.ratePercent.toFixed(2),
        updatedAt: r.updatedAt.toISOString(),
      }))
      .sort((a, b) =>
        a.category === null
          ? -1
          : b.category === null
            ? 1
            : a.category.path.join('/').localeCompare(b.category.path.join('/')),
      );
  }

  async putCommissionRule(
    user: AuthenticatedUser,
    input: CommissionRuleInput,
    context: RequestContext,
  ): Promise<CommissionRuleDto[]> {
    const rate = new Prisma.Decimal(input.ratePercent);
    if (input.categoryId) {
      const exists = await this.prisma.category.count({ where: { id: input.categoryId } });
      if (!exists) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Choose a category.',
          [{ path: 'categoryId', message: 'Choose a category' }],
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.commissionRule.findFirst({
        where: { categoryId: input.categoryId ?? null },
      });
      if (existing)
        await tx.commissionRule.update({ where: { id: existing.id }, data: { ratePercent: rate } });
      else
        await tx.commissionRule.create({
          data: { categoryId: input.categoryId ?? null, ratePercent: rate },
        });
      await this.audit.record(
        {
          action: 'settings.commission_rate_set',
          actorId: user.id,
          entityType: 'commission_rule',
          entityId: input.categoryId ?? 'default',
          metadata: { ratePercent: rate.toFixed(2) },
        },
        context,
        tx,
      );
    });
    return this.commissionRules();
  }

  async deleteCommissionRule(
    user: AuthenticatedUser,
    id: string,
    context: RequestContext,
  ): Promise<CommissionRuleDto[]> {
    const rule = await this.prisma.commissionRule.findUnique({ where: { id } });
    if (!rule)
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Commission rate not found.');
    if (rule.categoryId === null) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'The default rate can be changed but not removed.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.commissionRule.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'settings.commission_rate_removed',
          actorId: user.id,
          entityType: 'commission_rule',
          entityId: rule.categoryId!,
        },
        context,
        tx,
      );
    });
    return this.commissionRules();
  }

  /**
   * The commission for products in each category: the category's own rate, else its nearest
   * ancestor's, else the default. Missing default (should not happen; seeded) means 0%.
   */
  async commissionFor(
    categoryIds: string[],
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, ResolvedCommission>> {
    const [rules, categories] = await Promise.all([
      db.commissionRule.findMany(),
      db.category.findMany({ select: { id: true, parentId: true } }),
    ]);
    const parent = new Map(categories.map((c) => [c.id, c.parentId]));
    const byCategory = new Map(rules.filter((r) => r.categoryId).map((r) => [r.categoryId!, r]));
    const fallback = rules.find((r) => r.categoryId === null);
    const result = new Map<string, ResolvedCommission>();
    for (const id of categoryIds) {
      let rule = undefined;
      for (let c: string | null | undefined = id; c && !rule; c = parent.get(c))
        rule = byCategory.get(c);
      rule ??= fallback;
      result.set(id, {
        ruleId: rule?.id ?? null,
        ratePercent: rule?.ratePercent ?? new Prisma.Decimal(0),
      });
    }
    return result;
  }
}
