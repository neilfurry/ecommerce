/**
 * Phase 6: commission rules, tax rules, the double-entry ledger, seller balances, settlements,
 * payouts, bank accounts, service invoices, expenses and accounting reports.
 */
import { PAYMENT_METHODS } from '@marketplace/shared-types';
import { z } from 'zod';
import { decimalStringSchema, paginationQuerySchema } from './common';
import { paginatedSchema } from './dev-tools';

const money = decimalStringSchema({ scale: 2 });
const percent = decimalStringSchema({ scale: 4 }).refine((v) => Number(v) <= 100, 'At most 100%');

// ---- Finance settings ----------------------------------------------------------------------

/** Who pays a payment channel's fee: deducted from the seller at settlement, or absorbed. */
export const FEE_BEARERS = ['SELLER', 'MARKETPLACE'] as const;
export type FeeBearer = (typeof FEE_BEARERS)[number];
export const FEE_CHANNELS = ['ONLINE', 'BANK_TRANSFER', 'COD'] as const;
export type FeeChannel = (typeof FEE_CHANNELS)[number];
export const SETTLEMENT_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;
export type SettlementFrequency = (typeof SETTLEMENT_FREQUENCIES)[number];

const feeSchema = z.object({ percent, fixed: money });

export const financeSettingsSchema = z.object({
  /** The marketplace operator as it appears on service invoices. */
  issuer: z.object({
    legalName: z.string().trim().min(2).max(200),
    tin: z
      .string()
      .regex(/^\d{9}(\d{3,5})?$/, '9 digits plus an optional 3–5 digit branch code')
      .nullable(),
    address: z.string().trim().max(300).nullable(),
  }),
  fees: z.object({
    bearer: z.object({
      ONLINE: z.enum(FEE_BEARERS),
      BANK_TRANSFER: z.enum(FEE_BEARERS),
      COD: z.enum(FEE_BEARERS),
    }),
    /** The provider's (or courier's, for COD) contracted fee per payment method. */
    methods: z.object(
      Object.fromEntries(PAYMENT_METHODS.map((m) => [m, feeSchema])) as Record<
        (typeof PAYMENT_METHODS)[number],
        typeof feeSchema
      >,
    ),
  }),
  settlement: z.object({
    frequency: z.enum(SETTLEMENT_FREQUENCIES),
    /** First day of a weekly/biweekly period (0 Sunday … 6 Saturday; Philippine time). */
    weekStartsOn: z.coerce.number().int().min(0).max(6),
    /** Extra days to wait after the return window before earnings become eligible. */
    holdDays: z.coerce.number().int().min(0).max(60),
  }),
  payouts: z.object({
    minimumAmount: money,
    /** Allow sending payouts through PayMongo (needs PayMongo keys and a wallet). */
    payMongoEnabled: z.boolean(),
  }),
});
export type FinanceSettings = z.infer<typeof financeSettingsSchema>;
export type FinanceSettingsInput = z.input<typeof financeSettingsSchema>;

const zeroFee = { percent: '0', fixed: '0.00' };
/** Defaults: fees are zero until finance enters the contracted rates. */
export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  issuer: { legalName: 'Marketplace Operator', tin: null, address: null },
  fees: {
    bearer: { ONLINE: 'SELLER', BANK_TRANSFER: 'SELLER', COD: 'SELLER' },
    methods: Object.fromEntries(
      PAYMENT_METHODS.map((m) => [m, zeroFee]),
    ) as FinanceSettings['fees']['methods'],
  },
  settlement: { frequency: 'WEEKLY', weekStartsOn: 1, holdDays: 0 },
  payouts: { minimumAmount: '100.00', payMongoEnabled: false },
};

const iso = () => z.iso.datetime({ offset: true });
const page = <T extends z.ZodTypeAny>(item: T) => paginatedSchema(item);

// ---- Commission rules ----------------------------------------------------------------------

export const COMMISSION_SCOPES = [
  'DEFAULT',
  'CATEGORY',
  'SELLER',
  'SELLER_CATEGORY',
  'PRODUCT',
] as const;
export type CommissionScope = (typeof COMMISSION_SCOPES)[number];
export const COMMISSION_TYPES = ['PERCENTAGE', 'FIXED', 'EXEMPT'] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];
export const RULE_STATES = ['CURRENT', 'SCHEDULED', 'ENDED'] as const;
export type RuleState = (typeof RULE_STATES)[number];

export const commissionRuleDetailSchema = z.object({
  id: z.uuid(),
  scope: z.enum(COMMISSION_SCOPES),
  type: z.enum(COMMISSION_TYPES),
  category: z.object({ id: z.uuid(), name: z.string(), path: z.array(z.string()) }).nullable(),
  seller: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  product: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  ratePercent: z.string(),
  fixedAmount: z.string().nullable(),
  effectiveFrom: iso(),
  effectiveTo: iso().nullable(),
  state: z.enum(RULE_STATES),
  reason: z.string().nullable(),
  createdBy: z.string().nullable(),
  endedBy: z.string().nullable(),
  createdAt: iso(),
});
export type CommissionRuleDetail = z.infer<typeof commissionRuleDetailSchema>;
export const commissionRuleDetailListSchema = page(commissionRuleDetailSchema);
export type CommissionRuleDetailList = z.infer<typeof commissionRuleDetailListSchema>;
export const commissionRuleQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(COMMISSION_SCOPES).optional(),
  state: z.enum(RULE_STATES).optional(),
  sellerId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type CommissionRuleQuery = z.input<typeof commissionRuleQuerySchema>;

export const createCommissionRuleSchema = z
  .object({
    scope: z.enum(COMMISSION_SCOPES),
    type: z.enum(COMMISSION_TYPES),
    categoryId: z.uuid().nullish(),
    sellerId: z.uuid().nullish(),
    productId: z.uuid().nullish(),
    ratePercent: decimalStringSchema()
      .refine((v) => Number(v) <= 100, 'At most 100%')
      .nullish(),
    fixedAmount: money.nullish(),
    /** Default: now. A later time schedules the rule. */
    effectiveFrom: iso().nullish(),
    effectiveTo: iso().nullish(),
    reason: z.string().trim().min(3).max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    const need = (field: 'categoryId' | 'sellerId' | 'productId', wanted: boolean) => {
      if (wanted && !v[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'Required' });
      if (!wanted && v[field])
        ctx.addIssue({ code: 'custom', path: [field], message: 'Not used for this scope' });
    };
    need('categoryId', v.scope === 'CATEGORY' || v.scope === 'SELLER_CATEGORY');
    need('sellerId', v.scope === 'SELLER' || v.scope === 'SELLER_CATEGORY');
    need('productId', v.scope === 'PRODUCT');
    if (v.type === 'PERCENTAGE' && !v.ratePercent)
      ctx.addIssue({ code: 'custom', path: ['ratePercent'], message: 'Enter the rate' });
    if (v.type === 'FIXED' && !v.fixedAmount)
      ctx.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'Enter the amount per unit' });
    if (v.type === 'EXEMPT' && !v.reason)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Explain the exemption' });
    if (v.type === 'EXEMPT' && v.scope === 'DEFAULT')
      ctx.addIssue({
        code: 'custom',
        path: ['type'],
        message: 'The default cannot be an exemption',
      });
    if (v.effectiveFrom && v.effectiveTo && v.effectiveTo <= v.effectiveFrom)
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Must be after the start' });
  });
export type CreateCommissionRuleRequest = z.input<typeof createCommissionRuleSchema>;
export const endRuleSchema = z.object({
  /** Default: now. */
  effectiveTo: iso().nullish(),
});
export type EndRuleRequest = z.input<typeof endRuleSchema>;

export const commissionPreviewQuerySchema = z.object({
  productId: z.uuid(),
  at: iso().optional(),
});
export const commissionPreviewSchema = z.object({
  product: z.object({ id: z.uuid(), name: z.string() }),
  seller: z.object({ id: z.uuid(), name: z.string() }),
  categoryPath: z.array(z.string()),
  at: iso(),
  rule: commissionRuleDetailSchema.nullable(),
  /** Commission on ₱1,000 of sales (one unit), to compare rules. */
  exampleOn1000: z.string(),
});
export type CommissionPreview = z.infer<typeof commissionPreviewSchema>;

// ---- Tax rules ----------------------------------------------------------------------------------

export const TAX_KINDS = ['VAT', 'PERCENTAGE_TAX', 'WITHHOLDING'] as const;
export const TAX_APPLIES_TO = ['GOODS', 'MARKETPLACE_SERVICES', 'SELLER_REMITTANCE'] as const;
export type TaxAppliesTo = (typeof TAX_APPLIES_TO)[number];
export const SELLER_REGISTRATIONS = ['ANY', 'VAT_REGISTERED', 'NON_VAT'] as const;

export const taxRuleSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  jurisdiction: z.string(),
  kind: z.enum(TAX_KINDS),
  appliesTo: z.enum(TAX_APPLIES_TO),
  sellerRegistration: z.enum(SELLER_REGISTRATIONS),
  ratePercent: z.string(),
  basePercent: z.string(),
  inclusive: z.boolean(),
  effectiveFrom: iso(),
  effectiveTo: iso().nullable(),
  state: z.enum(RULE_STATES),
  legalReference: z.string().nullable(),
  createdAt: iso(),
});
export type TaxRuleDto = z.infer<typeof taxRuleSchema>;
export const taxRuleListSchema = z.object({ items: z.array(taxRuleSchema) });
export const createTaxRuleSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9-]{1,39}$/, 'Upper-case letters, digits and -'),
    name: z.string().trim().min(3).max(120),
    jurisdiction: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default('PH'),
    kind: z.enum(TAX_KINDS),
    appliesTo: z.enum(TAX_APPLIES_TO),
    sellerRegistration: z.enum(SELLER_REGISTRATIONS).default('ANY'),
    ratePercent: percent,
    basePercent: percent.refine((v) => Number(v) > 0, 'More than 0').default('100'),
    inclusive: z.boolean(),
    effectiveFrom: iso().nullish(),
    legalReference: z.string().trim().max(300).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.appliesTo === 'MARKETPLACE_SERVICES' && !v.inclusive)
      ctx.addIssue({
        code: 'custom',
        path: ['inclusive'],
        message: 'Commission and fees are charged tax-inclusive',
      });
    if (v.appliesTo === 'SELLER_REMITTANCE' && v.kind !== 'WITHHOLDING')
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Remittances only have withholding',
      });
    if (v.appliesTo !== 'SELLER_REMITTANCE' && v.kind === 'WITHHOLDING')
      ctx.addIssue({
        code: 'custom',
        path: ['appliesTo'],
        message: 'Withholding applies to remittances',
      });
  });
export type CreateTaxRuleRequest = z.input<typeof createTaxRuleSchema>;

export const sellerTaxProfileSchema = z.object({
  sellerId: z.uuid(),
  businessName: z.string(),
  taxRegisteredName: z.string().nullable(),
  tin: z.string().nullable(),
  vatRegistered: z.boolean(),
  verifiedAt: iso().nullable(),
  verifiedBy: z.string().nullable(),
  withholdingExemptUntil: z.string().nullable(),
  withholdingExemptNote: z.string().nullable(),
  /** BIR certificate of registration / sworn declaration documents uploaded. */
  documents: z.array(z.object({ id: z.uuid(), type: z.string(), uploadedAt: iso() })),
});
export type SellerTaxProfile = z.infer<typeof sellerTaxProfileSchema>;
export const verifySellerTaxSchema = z.object({
  verified: z.boolean(),
  /** Accept a sworn declaration until this date (null: no exemption). */
  withholdingExemptUntil: z.iso.date().nullable(),
  note: z.string().trim().max(500).nullish(),
});
export type VerifySellerTaxRequest = z.input<typeof verifySellerTaxSchema>;

// ---- Ledger -----------------------------------------------------------------------------------

export const LEDGER_ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const ledgerAccountSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: z.enum(LEDGER_ACCOUNT_TYPES),
  description: z.string().nullable(),
  sellerSubledger: z.boolean(),
  system: z.boolean(),
  active: z.boolean(),
  /** Debit-normal accounts: debits − credits; credit-normal: credits − debits. */
  balance: z.string(),
});
export type LedgerAccountDto = z.infer<typeof ledgerAccountSchema>;
export const ledgerAccountListSchema = z.object({ items: z.array(ledgerAccountSchema) });
export const createLedgerAccountSchema = z.object({
  code: z.string().regex(/^[1-5]\d{3}$/, 'Four digits starting with 1–5'),
  name: z.string().trim().min(2).max(120),
  type: z.enum(LEDGER_ACCOUNT_TYPES),
  description: z.string().trim().max(500).nullish(),
});
export type CreateLedgerAccountRequest = z.input<typeof createLedgerAccountSchema>;
export const updateLedgerAccountSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullish(),
  active: z.boolean().optional(),
});

export const journalEntrySchema = z.object({
  id: z.uuid(),
  lineNo: z.number().int(),
  account: z.object({ code: z.string(), name: z.string() }),
  seller: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  sellerOrder: z.object({ id: z.uuid(), number: z.string() }).nullable(),
  kind: z.string().nullable(),
  debit: z.string(),
  credit: z.string(),
  description: z.string().nullable(),
});
export const journalSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  type: z.string(),
  status: z.enum(['DRAFT', 'POSTED']),
  description: z.string(),
  currency: z.string(),
  occurredAt: iso(),
  postedAt: iso().nullable(),
  source: z.object({ type: z.string(), id: z.uuid() }).nullable(),
  reversalOf: z.object({ id: z.uuid(), reference: z.string() }).nullable(),
  reversedBy: z.object({ id: z.uuid(), reference: z.string() }).nullable(),
  createdBy: z.string().nullable(),
  postedBy: z.string().nullable(),
  totalDebit: z.string(),
  totalCredit: z.string(),
  entries: z.array(journalEntrySchema),
});
export type JournalDto = z.infer<typeof journalSchema>;
export const journalSummarySchema = journalSchema.omit({ entries: true });
export type JournalSummary = z.infer<typeof journalSummarySchema>;
export const journalListSchema = page(journalSummarySchema);
export type JournalList = z.infer<typeof journalListSchema>;
export const journalQuerySchema = paginationQuerySchema.extend({
  type: z.string().max(30).optional(),
  status: z.enum(['DRAFT', 'POSTED']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  accountCode: z.string().max(10).optional(),
  sellerId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type JournalQuery = z.input<typeof journalQuerySchema>;

export const manualJournalSchema = z
  .object({
    description: z.string().trim().min(3).max(300),
    occurredAt: z.iso.date(),
    lines: z
      .array(
        z.object({
          accountCode: z.string().regex(/^\d{4}$/),
          debit: money.default('0'),
          credit: money.default('0'),
          sellerId: z.uuid().nullish(),
          description: z.string().trim().max(300).nullish(),
        }),
      )
      .min(2)
      .max(50),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((l, i) => {
      if (Number(l.debit) > 0 === Number(l.credit) > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'debit'],
          message: 'Enter either a debit or a credit',
        });
    });
    const cents = (s: string) => Math.round(Number(s) * 100);
    const dr = v.lines.reduce((a, l) => a + cents(l.debit), 0);
    const cr = v.lines.reduce((a, l) => a + cents(l.credit), 0);
    if (dr !== cr)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Total debits must equal total credits',
      });
  });
export type ManualJournalRequest = z.input<typeof manualJournalSchema>;
export const reverseJournalSchema = z.object({ reason: z.string().trim().min(3).max(250) });

export const accountLedgerQuerySchema = paginationQuerySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sellerId: z.uuid().optional(),
});
export const accountLedgerLineSchema = z.object({
  entryId: z.uuid(),
  journal: z.object({ id: z.uuid(), reference: z.string(), type: z.string() }),
  occurredAt: iso(),
  description: z.string(),
  seller: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  debit: z.string(),
  credit: z.string(),
  /** Balance after this line (in the account's normal direction). */
  balance: z.string(),
});
export const accountLedgerSchema = page(accountLedgerLineSchema).extend({
  account: ledgerAccountSchema,
  openingBalance: z.string(),
  closingBalance: z.string(),
});
export type AccountLedger = z.infer<typeof accountLedgerSchema>;

// ---- Seller balances, statements and payouts ------------------------------------------------

export const sellerBalancesSchema = z.object({
  pending: z.string(),
  held: z.string(),
  available: z.string(),
  reserved: z.string(),
  inPayout: z.string(),
  paid: z.string(),
  /** Available minus the payout minimum check: what can be requested now. */
  withdrawable: z.string(),
  minimumPayout: z.string(),
  currency: z.string(),
});
export type SellerBalancesDto = z.infer<typeof sellerBalancesSchema>;

export const sellerBalanceRowSchema = sellerBalancesSchema.extend({
  seller: z.object({ id: z.uuid(), name: z.string(), status: z.string() }),
});
export const sellerBalanceListSchema = page(sellerBalanceRowSchema).extend({
  totals: sellerBalancesSchema.omit({ withdrawable: true, minimumPayout: true, currency: true }),
});
export type SellerBalanceList = z.infer<typeof sellerBalanceListSchema>;

export const financeSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  grossSales: z.string(),
  commission: z.string(),
  paymentFees: z.string(),
  refunds: z.string(),
  shippingCredits: z.string(),
  netEarnings: z.string(),
  orders: z.number().int(),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

export const sellerFinanceOverviewSchema = z.object({
  balances: sellerBalancesSchema,
  summary: financeSummarySchema,
  nextSettlement: z.object({ periodStart: iso(), periodEnd: iso() }),
  bankAccountVerified: z.boolean(),
  taxProfileVerified: z.boolean(),
});
export type SellerFinanceOverview = z.infer<typeof sellerFinanceOverviewSchema>;

export const settlementLineSchema = z.object({
  sellerOrderId: z.uuid(),
  orderNumber: z.string(),
  grossSales: z.string(),
  shippingCredits: z.string(),
  commission: z.string(),
  paymentFees: z.string(),
  refunds: z.string(),
  commissionReversals: z.string(),
  otherAdjustments: z.string(),
  net: z.string(),
  withholdingBase: z.string(),
});
export const financeDocumentSchema = z.object({
  id: z.uuid(),
  type: z.enum(['SERVICE_INVOICE', 'CREDIT_NOTE']),
  number: z.string(),
  issuedAt: iso(),
  subtotal: z.string(),
  taxAmount: z.string(),
  total: z.string(),
  lines: z.array(z.object({ description: z.string(), amount: z.string(), taxAmount: z.string() })),
  taxSnapshot: z.record(z.string(), z.unknown()),
  buyer: z.record(z.string(), z.unknown()),
  issuer: z.record(z.string(), z.unknown()),
  settlement: z.object({ id: z.uuid(), reference: z.string() }).nullable(),
  seller: z.object({ id: z.uuid(), name: z.string() }),
});
export type FinanceDocumentDto = z.infer<typeof financeDocumentSchema>;
export const financeDocumentListSchema = page(financeDocumentSchema.omit({ lines: true }));
export type FinanceDocumentList = z.infer<typeof financeDocumentListSchema>;

export const settlementSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  seller: z.object({ id: z.uuid(), name: z.string() }),
  periodStart: iso(),
  periodEnd: iso(),
  ordersCount: z.number().int(),
  grossSales: z.string(),
  shippingCredits: z.string(),
  commission: z.string(),
  paymentFees: z.string(),
  refunds: z.string(),
  commissionReversals: z.string(),
  otherAdjustments: z.string(),
  netSettled: z.string(),
  withholdingBase: z.string(),
  withholdingTax: z.string(),
  withholding: z.record(z.string(), z.unknown()),
  openingAvailable: z.string(),
  closingAvailable: z.string(),
  journal: z.object({ id: z.uuid(), reference: z.string() }).nullable(),
  createdAt: iso(),
});
export type SettlementDto = z.infer<typeof settlementSchema>;
export const settlementDetailSchema = settlementSchema.extend({
  lines: z.array(settlementLineSchema),
  documents: z.array(
    financeDocumentSchema.pick({ id: true, type: true, number: true, total: true }),
  ),
});
export type SettlementDetail = z.infer<typeof settlementDetailSchema>;
export const settlementListSchema = page(settlementSchema);
export type SettlementList = z.infer<typeof settlementListSchema>;
export const settlementQuerySchema = paginationQuerySchema.extend({
  sellerId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export const runSettlementSchema = z.object({
  /** A date inside the period to settle (default: the last closed period). */
  periodContaining: z.iso.date().nullish(),
  sellerId: z.uuid().nullish(),
});
export type RunSettlementRequest = z.input<typeof runSettlementSchema>;
export const runSettlementResultSchema = z.object({
  periodStart: iso(),
  periodEnd: iso(),
  settled: z.array(
    z.object({
      settlementId: z.uuid(),
      reference: z.string(),
      ordersCount: z.number().int(),
      netSettled: z.string(),
      withholdingTax: z.string(),
    }),
  ),
});
export type RunSettlementResult = z.infer<typeof runSettlementResultSchema>;
export const eligibilityPreviewSchema = z.object({
  periodStart: iso(),
  periodEnd: iso(),
  sellers: z.array(z.object({ sellerId: z.uuid(), name: z.string(), orders: z.number().int() })),
});

export const reserveSchema = z.object({
  action: z.enum(['PLACE', 'RELEASE']),
  amount: money.refine((v) => Number(v) > 0, 'More than 0'),
  reason: z.string().trim().min(3).max(250),
});
export type ReserveRequest = z.input<typeof reserveSchema>;

export const subledgerLineSchema = z.object({
  id: z.uuid(),
  journal: z.object({ id: z.uuid(), reference: z.string(), type: z.string() }),
  occurredAt: iso(),
  account: z.enum(['PENDING', 'AVAILABLE', 'RESERVED', 'IN_PAYOUT']),
  kind: z.string().nullable(),
  description: z.string(),
  sellerOrder: z.object({ id: z.uuid(), number: z.string() }).nullable(),
  /** Positive: owed to the seller; negative: deducted. */
  amount: z.string(),
});
export const subledgerSchema = page(subledgerLineSchema);
export type Subledger = z.infer<typeof subledgerSchema>;
export const subledgerQuerySchema = paginationQuerySchema.extend({
  account: z.enum(['PENDING', 'AVAILABLE', 'RESERVED', 'IN_PAYOUT']).optional(),
  kind: z.string().max(30).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

// ---- Bank accounts and payouts ---------------------------------------------------------------

export const BANK_ACCOUNT_STATUSES = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'REJECTED',
  'DISABLED',
] as const;
export const sellerBankAccountSchema = z.object({
  id: z.uuid(),
  institutionCode: z.string().nullable(),
  institutionName: z.string(),
  accountName: z.string(),
  /** Only the last four digits ever leave the server. */
  accountNumberMasked: z.string(),
  status: z.enum(BANK_ACCOUNT_STATUSES),
  isDefault: z.boolean(),
  reviewNote: z.string().nullable(),
  reviewedAt: iso().nullable(),
  createdAt: iso(),
  seller: z.object({ id: z.uuid(), name: z.string() }),
});
export type SellerBankAccountDto = z.infer<typeof sellerBankAccountSchema>;
export const sellerBankAccountListSchema = z.object({ items: z.array(sellerBankAccountSchema) });
export const createBankAccountSchema = z.object({
  institutionName: z.string().trim().min(2).max(120),
  institutionCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, '8 or 11 letters/digits (BIC)')
    .nullish(),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, '6–20 digits'),
  makeDefault: z.boolean().default(true),
});
export type CreateBankAccountRequest = z.input<typeof createBankAccountSchema>;
export const reviewBankAccountSchema = z.object({
  decision: z.enum(['VERIFY', 'REJECT', 'DISABLE']),
  note: z.string().trim().max(500).nullish(),
});
export type ReviewBankAccountRequest = z.input<typeof reviewBankAccountSchema>;

export const PAYOUT_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'REVERSED',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const payoutEventSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  actor: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: iso(),
});
export const payoutSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  seller: z.object({ id: z.uuid(), name: z.string() }),
  amount: z.string(),
  currency: z.string(),
  method: z.enum(['MANUAL', 'PAYMONGO']),
  status: z.enum(PAYOUT_STATUSES),
  destination: z.object({
    institutionName: z.string(),
    institutionCode: z.string().nullable(),
    accountName: z.string(),
    accountNumberMasked: z.string(),
  }),
  transferReference: z.string().nullable(),
  transferFee: z.string(),
  failureReason: z.string().nullable(),
  livemode: z.boolean(),
  requestedBy: z.string().nullable(),
  requestedAt: iso(),
  approvedAt: iso().nullable(),
  paidAt: iso().nullable(),
  closedAt: iso().nullable(),
});
export type PayoutDto = z.infer<typeof payoutSchema>;
export const payoutDetailSchema = payoutSchema.extend({
  events: z.array(payoutEventSchema),
  /** Staff: what can be done now. */
  actions: z.array(
    z.enum(['APPROVE', 'REJECT', 'CANCEL', 'MARK_PAID', 'SEND', 'CHECK', 'MARK_FAILED', 'REVERSE']),
  ),
});
export type PayoutDetail = z.infer<typeof payoutDetailSchema>;
export const payoutListSchema = page(payoutSchema);
export type PayoutList = z.infer<typeof payoutListSchema>;
export const payoutQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PAYOUT_STATUSES).optional(),
  sellerId: z.uuid().optional(),
});
export const requestPayoutSchema = z.object({
  amount: money.refine((v) => Number(v) > 0, 'More than 0'),
  bankAccountId: z.uuid(),
  /** Sent again with a retried request so it is not created twice. */
  idempotencyKey: z.string().trim().min(8).max(100),
});
export type RequestPayoutRequest = z.input<typeof requestPayoutSchema>;
export const payoutDecisionSchema = z.object({ note: z.string().trim().max(1000).nullish() });
export const payoutReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const markPayoutPaidSchema = z.object({
  transferReference: z.string().trim().min(3).max(120),
  transferFee: money.default('0'),
  paidAt: iso().nullish(),
});
export type MarkPayoutPaidRequest = z.input<typeof markPayoutPaidSchema>;

// ---- Expenses -----------------------------------------------------------------------------------

export const expenseSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  vendorName: z.string(),
  vendorTin: z.string().nullable(),
  description: z.string(),
  account: z.object({ code: z.string(), name: z.string() }),
  amount: z.string(),
  inputVat: z.string(),
  total: z.string(),
  invoiceNumber: z.string().nullable(),
  incurredOn: z.string(),
  status: z.enum(['UNPAID', 'PAID', 'VOID']),
  paidAt: iso().nullable(),
  paymentReference: z.string().nullable(),
  createdAt: iso(),
});
export type ExpenseDto = z.infer<typeof expenseSchema>;
export const expenseListSchema = page(expenseSchema);
export type ExpenseList = z.infer<typeof expenseListSchema>;
export const createExpenseSchema = z.object({
  vendorName: z.string().trim().min(2).max(160),
  vendorTin: z
    .string()
    .regex(/^\d{9}(\d{3,5})?$/)
    .nullish(),
  description: z.string().trim().min(3).max(300),
  accountCode: z.string().regex(/^5\d{3}$/, 'An expense account (5xxx)'),
  amount: money.refine((v) => Number(v) > 0, 'More than 0'),
  inputVat: money.default('0'),
  invoiceNumber: z.string().trim().max(60).nullish(),
  incurredOn: z.iso.date(),
  /** Already paid from the bank: record the payment too. */
  paidReference: z.string().trim().min(3).max(120).nullish(),
});
export type CreateExpenseRequest = z.input<typeof createExpenseSchema>;
export const payExpenseSchema = z.object({ paymentReference: z.string().trim().min(3).max(120) });

// ---- Reports ----------------------------------------------------------------------------------

export const reportPeriodQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});
export type ReportPeriodQuery = z.input<typeof reportPeriodQuerySchema>;
const amountRow = z.object({ label: z.string(), amount: z.string() });

export const trialBalanceSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      type: z.enum(LEDGER_ACCOUNT_TYPES),
      opening: z.string(),
      debit: z.string(),
      credit: z.string(),
      closing: z.string(),
    }),
  ),
  totalDebit: z.string(),
  totalCredit: z.string(),
  balanced: z.boolean(),
});
export type TrialBalance = z.infer<typeof trialBalanceSchema>;

export const revenueReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  revenue: z.array(amountRow.extend({ code: z.string() })),
  expenses: z.array(amountRow.extend({ code: z.string() })),
  totalRevenue: z.string(),
  totalExpenses: z.string(),
  netIncome: z.string(),
  /** Seller sales the marketplace facilitated (not marketplace revenue). */
  grossMerchandiseValue: z.string(),
  outputVat: z.string(),
  withholdingTax: z.string(),
});
export type RevenueReport = z.infer<typeof revenueReportSchema>;

export const commissionReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      seller: z.object({ id: z.uuid(), name: z.string() }),
      orders: z.number().int(),
      sales: z.string(),
      commission: z.string(),
      reversed: z.string(),
      net: z.string(),
      effectiveRate: z.string(),
    }),
  ),
  byScope: z.array(
    z.object({
      scope: z.string(),
      type: z.string(),
      items: z.number().int(),
      commission: z.string(),
    }),
  ),
  totals: z.object({
    sales: z.string(),
    commission: z.string(),
    reversed: z.string(),
    net: z.string(),
  }),
});
export type CommissionReport = z.infer<typeof commissionReportSchema>;

export const refundReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      reason: z.string(),
      count: z.number().int(),
      amount: z.string(),
      sellerShare: z.string(),
      marketplaceShare: z.string(),
      commissionReturned: z.string(),
    }),
  ),
  totals: z.object({
    count: z.number().int(),
    amount: z.string(),
    sellerShare: z.string(),
    marketplaceShare: z.string(),
    commissionReturned: z.string(),
  }),
});
export type RefundReport = z.infer<typeof refundReportSchema>;

export const codReconciliationSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      carrier: z.string(),
      collected: z.string(),
      remittedExpected: z.string(),
      remittedReceived: z.string(),
      difference: z.string(),
      outstanding: z.string(),
      outstandingParcels: z.number().int(),
    }),
  ),
  /** COD receivable in the ledger vs collections not yet remitted. */
  ledgerReceivable: z.string(),
  operationalOutstanding: z.string(),
  matches: z.boolean(),
});
export type CodReconciliation = z.infer<typeof codReconciliationSchema>;

export const settlementReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  settlements: z.number().int(),
  orders: z.number().int(),
  grossSales: z.string(),
  commission: z.string(),
  paymentFees: z.string(),
  refunds: z.string(),
  netSettled: z.string(),
  withholdingTax: z.string(),
  payoutsPaid: z.string(),
  payoutsPaidCount: z.number().int(),
});
export type SettlementReport = z.infer<typeof settlementReportSchema>;

export const reconciliationCheckSchema = z.object({
  code: z.string(),
  label: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  /** Records to look at (up to 20). */
  items: z.array(z.object({ id: z.string(), label: z.string() })),
});
export const reconciliationReportSchema = z.object({
  checkedAt: iso(),
  checks: z.array(reconciliationCheckSchema),
});
export type ReconciliationReport = z.infer<typeof reconciliationReportSchema>;

export const financeDashboardSchema = z.object({
  from: z.string(),
  to: z.string(),
  grossMerchandiseValue: z.string(),
  commissionRevenue: z.string(),
  feeRecoveries: z.string(),
  paymentFees: z.string(),
  refunds: z.string(),
  sellerPayables: sellerBalancesSchema.omit({
    withdrawable: true,
    minimumPayout: true,
    currency: true,
  }),
  cash: z.object({ bank: z.string(), provider: z.string(), codReceivable: z.string() }),
  taxes: z.object({ outputVat: z.string(), withholding: z.string() }),
  queues: z.object({
    payoutsToApprove: z.number().int(),
    payoutsToPay: z.number().int(),
    bankAccountsToVerify: z.number().int(),
    taxProfilesToVerify: z.number().int(),
    eligibleOrders: z.number().int(),
  }),
  reconciliationOk: z.boolean(),
});
export type FinanceDashboard = z.infer<typeof financeDashboardSchema>;

export const sellerInvoiceSchema = z.object({
  sellerInvoiceNumber: z.string().trim().min(1).max(40),
  sellerInvoiceDate: z.iso.date(),
});
export type SellerInvoiceRequest = z.input<typeof sellerInvoiceSchema>;

/** GET /finance/settings: the settings plus whether PayMongo payouts are configured. */
export const financeSettingsResponseSchema = financeSettingsSchema.extend({
  payMongoPayoutsConfigured: z.boolean(),
});
export type FinanceSettingsResponse = z.infer<typeof financeSettingsResponseSchema>;
export const financePeriodQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export const sellerTaxNameSchema = z.object({
  taxRegisteredName: z.string().trim().min(2).max(200),
});
export const financePageQuery = paginationQuerySchema;
