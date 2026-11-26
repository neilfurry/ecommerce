import { HttpStatus, Injectable } from '@nestjs/common';
import { financeSettingsInTx, Prisma } from '@marketplace/database';
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
  checkoutSettingsSchema,
  type FinanceSettings,
  type FinanceSettingsInput,
  financeSettingsSchema,
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
  finance: 'finance',
} as const;

/**
 * Settings administrators edit (stored as validated JSON in platform_settings), with safe
 * defaults when nothing was saved yet. Commission and tax rules have their own services.
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

  async all(): Promise<Omit<PlatformSettings, 'commissionRules'>> {
    return {
      checkout: await this.checkout(),
      shippingRates: await this.shippingRates(),
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

  // ---- Finance ---------------------------------------------------------------------------

  async finance(
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<FinanceSettings> {
    return financeSettingsInTx(db);
  }

  async saveFinance(
    user: AuthenticatedUser,
    input: FinanceSettingsInput,
    context: RequestContext,
  ): Promise<FinanceSettings> {
    const value = financeSettingsSchema.parse(input);
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: KEYS.finance },
        create: { key: KEYS.finance, value, updatedById: user.id },
        update: { value, updatedById: user.id },
      });
      await this.audit.record(
        {
          action: 'settings.finance_updated',
          actorId: user.id,
          entityType: 'platform_setting',
          entityId: KEYS.finance,
          metadata: { fees: value.fees, settlement: value.settlement, payouts: value.payouts },
        },
        context,
        tx,
      );
    });
    return value;
  }
}
