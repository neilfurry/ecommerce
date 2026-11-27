import {
  accountLedgerSchema,
  codReconciliationSchema,
  commissionPreviewSchema,
  commissionReportSchema,
  commissionRuleDetailListSchema,
  commissionRuleDetailSchema,
  type CreateBankAccountRequest,
  type CreateCommissionRuleRequest,
  type CreateExpenseRequest,
  type CreateLedgerAccountRequest,
  type CreateTaxRuleRequest,
  eligibilityPreviewSchema,
  expenseListSchema,
  expenseSchema,
  financeDashboardSchema,
  financeDocumentListSchema,
  financeDocumentSchema,
  financeSettingsResponseSchema,
  financeSettingsSchema,
  type FinanceSettingsInput,
  journalListSchema,
  journalSchema,
  ledgerAccountListSchema,
  ledgerAccountSchema,
  type ManualJournalRequest,
  type MarkPayoutPaidRequest,
  payoutDetailSchema,
  payoutListSchema,
  reconciliationReportSchema,
  refundReportSchema,
  type RequestPayoutRequest,
  type ReserveRequest,
  revenueReportSchema,
  type ReviewBankAccountRequest,
  type RunSettlementRequest,
  runSettlementResultSchema,
  sellerBalanceListSchema,
  sellerBalancesSchema,
  sellerBankAccountListSchema,
  sellerBankAccountSchema,
  sellerFinanceOverviewSchema,
  type SellerInvoiceRequest,
  sellerTaxProfileSchema,
  settlementDetailSchema,
  settlementListSchema,
  settlementReportSchema,
  subledgerSchema,
  taxRuleListSchema,
  taxRuleSchema,
  trialBalanceSchema,
  type VerifySellerTaxRequest,
} from '@marketplace/validation';
import { z } from 'zod';
import type { RequestOptions } from './client';

type Request = <TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
) => Promise<z.output<TSchema>>;
type Query = Record<string, string | number | boolean | undefined>;
export type FinanceQuery = Record<string, string | number | boolean | undefined>;

const id = (value: string) => encodeURIComponent(value);
const asQuery = (value: object): Query =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== '')) as Query;
const period = (from: string, to: string) => ({ from, to });

/** Seller Center: balances, statements, documents, bank accounts, payouts and tax profile. */
function seller(request: Request) {
  const get = <T extends z.ZodType>(
    path: string,
    schema: T,
    query?: object,
    signal?: AbortSignal,
  ) => request(path, { schema, query: query ? asQuery(query) : undefined, signal });
  return {
    overview: (query: { from?: string; to?: string }, signal?: AbortSignal) =>
      get('/seller/finance/overview', sellerFinanceOverviewSchema, query, signal),
    transactions: (query: FinanceQuery, signal?: AbortSignal) =>
      get('/seller/finance/transactions', subledgerSchema, query, signal),
    settlements: (query: FinanceQuery, signal?: AbortSignal) =>
      get('/seller/finance/settlements', settlementListSchema, query, signal),
    settlement: (settlementId: string, signal?: AbortSignal) =>
      get(
        `/seller/finance/settlements/${id(settlementId)}`,
        settlementDetailSchema,
        undefined,
        signal,
      ),
    documents: (query: FinanceQuery, signal?: AbortSignal) =>
      get('/seller/finance/documents', financeDocumentListSchema, query, signal),
    document: (documentId: string, signal?: AbortSignal) =>
      get(`/seller/finance/documents/${id(documentId)}`, financeDocumentSchema, undefined, signal),
    bankAccounts: (signal?: AbortSignal) =>
      get('/seller/finance/bank-accounts', sellerBankAccountListSchema, undefined, signal),
    addBankAccount: (body: CreateBankAccountRequest) =>
      request('/seller/finance/bank-accounts', {
        method: 'POST',
        body,
        schema: sellerBankAccountSchema,
      }),
    disableBankAccount: (accountId: string) =>
      request(`/seller/finance/bank-accounts/${id(accountId)}/disable`, {
        method: 'POST',
        body: {},
        schema: sellerBankAccountSchema,
      }),
    payouts: (query: FinanceQuery, signal?: AbortSignal) =>
      get('/seller/finance/payouts', payoutListSchema, query, signal),
    payout: (payoutId: string, signal?: AbortSignal) =>
      get(`/seller/finance/payouts/${id(payoutId)}`, payoutDetailSchema, undefined, signal),
    requestPayout: (body: RequestPayoutRequest) =>
      request('/seller/finance/payouts', { method: 'POST', body, schema: payoutDetailSchema }),
    cancelPayout: (payoutId: string) =>
      request(`/seller/finance/payouts/${id(payoutId)}/cancel`, {
        method: 'POST',
        body: {},
        schema: payoutDetailSchema,
      }),
    taxProfile: (signal?: AbortSignal) =>
      get('/seller/finance/tax-profile', sellerTaxProfileSchema, undefined, signal),
    updateTaxName: (taxRegisteredName: string) =>
      request('/seller/finance/tax-profile', {
        method: 'PUT',
        body: { taxRegisteredName },
        schema: sellerTaxProfileSchema,
      }),
    setSalesInvoice: (sellerOrderId: string, body: SellerInvoiceRequest) =>
      request(`/seller/orders/${id(sellerOrderId)}/sales-invoice`, {
        method: 'PUT',
        body,
        schema: z.object({ sellerInvoice: z.object({ number: z.string(), date: z.string() }) }),
      }),
  };
}

/** Admin Console finance. */
function admin(request: Request) {
  const get = <T extends z.ZodType>(
    path: string,
    schema: T,
    query?: object,
    signal?: AbortSignal,
  ) => request(path, { schema, query: query ? asQuery(query) : undefined, signal });
  const post = <T extends z.ZodType>(path: string, schema: T, body: unknown = {}) =>
    request(path, { method: 'POST', body, schema });
  return {
    dashboard: (from: string, to: string, signal?: AbortSignal) =>
      get('/finance/dashboard', financeDashboardSchema, period(from, to), signal),
    settings: (signal?: AbortSignal) =>
      get('/finance/settings', financeSettingsResponseSchema, undefined, signal),
    saveSettings: (body: FinanceSettingsInput) =>
      request('/finance/settings', { method: 'PUT', body, schema: financeSettingsSchema }),
    commission: {
      list: (query: FinanceQuery, signal?: AbortSignal) =>
        get('/finance/commission-rules', commissionRuleDetailListSchema, query, signal),
      preview: (productId: string, signal?: AbortSignal) =>
        get('/finance/commission-rules/preview', commissionPreviewSchema, { productId }, signal),
      create: (body: CreateCommissionRuleRequest) =>
        post('/finance/commission-rules', commissionRuleDetailSchema, body),
      end: (ruleId: string, effectiveTo?: string) =>
        post(
          `/finance/commission-rules/${id(ruleId)}/end`,
          commissionRuleDetailSchema,
          effectiveTo ? { effectiveTo } : {},
        ),
    },
    taxes: {
      list: (signal?: AbortSignal) =>
        get('/finance/tax-rules', taxRuleListSchema, undefined, signal),
      create: (body: CreateTaxRuleRequest) => post('/finance/tax-rules', taxRuleSchema, body),
      end: (ruleId: string) => post(`/finance/tax-rules/${id(ruleId)}/end`, taxRuleSchema),
      toVerify: (signal?: AbortSignal) =>
        get(
          '/finance/tax-profiles',
          z.object({ items: z.array(sellerTaxProfileSchema) }),
          undefined,
          signal,
        ),
      profile: (sellerId: string, signal?: AbortSignal) =>
        get(
          `/finance/sellers/${id(sellerId)}/tax-profile`,
          sellerTaxProfileSchema,
          undefined,
          signal,
        ),
      verify: (sellerId: string, body: VerifySellerTaxRequest) =>
        post(`/finance/sellers/${id(sellerId)}/tax-profile/verify`, sellerTaxProfileSchema, body),
    },
    ledger: {
      accounts: (signal?: AbortSignal) =>
        get('/finance/accounts', ledgerAccountListSchema, undefined, signal),
      createAccount: (body: CreateLedgerAccountRequest) =>
        post('/finance/accounts', ledgerAccountSchema, body),
      updateAccount: (
        accountId: string,
        body: { name?: string; description?: string | null; active?: boolean },
      ) =>
        request(`/finance/accounts/${id(accountId)}`, {
          method: 'PATCH',
          body,
          schema: ledgerAccountSchema,
        }),
      accountLedger: (code: string, query: FinanceQuery, signal?: AbortSignal) =>
        get(`/finance/accounts/${id(code)}/ledger`, accountLedgerSchema, query, signal),
      journals: (query: FinanceQuery, signal?: AbortSignal) =>
        get('/finance/journals', journalListSchema, query, signal),
      journal: (journalId: string, signal?: AbortSignal) =>
        get(`/finance/journals/${id(journalId)}`, journalSchema, undefined, signal),
      createManual: (body: ManualJournalRequest) => post('/finance/journals', journalSchema, body),
      post: (journalId: string) => post(`/finance/journals/${id(journalId)}/post`, journalSchema),
      discard: (journalId: string) =>
        request(`/finance/journals/${id(journalId)}`, { method: 'DELETE', schema: z.unknown() }),
      reverse: (journalId: string, reason: string) =>
        post(`/finance/journals/${id(journalId)}/reverse`, journalSchema, { reason }),
    },
    balances: {
      list: (query: FinanceQuery, signal?: AbortSignal) =>
        get('/finance/balances', sellerBalanceListSchema, query, signal),
      seller: (sellerId: string, signal?: AbortSignal) =>
        get(`/finance/sellers/${id(sellerId)}/balances`, sellerBalancesSchema, undefined, signal),
      subledger: (sellerId: string, query: FinanceQuery, signal?: AbortSignal) =>
        get(`/finance/sellers/${id(sellerId)}/subledger`, subledgerSchema, query, signal),
      reserve: (sellerId: string, body: ReserveRequest) =>
        post(`/finance/sellers/${id(sellerId)}/reserve`, sellerBalancesSchema, body),
    },
    settlements: {
      list: (query: FinanceQuery, signal?: AbortSignal) =>
        get('/finance/settlements', settlementListSchema, query, signal),
      get: (settlementId: string, signal?: AbortSignal) =>
        get(`/finance/settlements/${id(settlementId)}`, settlementDetailSchema, undefined, signal),
      preview: (signal?: AbortSignal) =>
        get('/finance/settlements/preview', eligibilityPreviewSchema, undefined, signal),
      run: (body: RunSettlementRequest) =>
        post('/finance/settlements/run', runSettlementResultSchema, body),
    },
    documents: {
      list: (query: FinanceQuery, signal?: AbortSignal) =>
        get('/finance/documents', financeDocumentListSchema, query, signal),
      get: (documentId: string, signal?: AbortSignal) =>
        get(`/finance/documents/${id(documentId)}`, financeDocumentSchema, undefined, signal),
    },
    bankAccounts: {
      list: (query: FinanceQuery, signal?: AbortSignal) =>
        get('/finance/bank-accounts', sellerBankAccountListSchema, query, signal),
      review: (accountId: string, body: ReviewBankAccountRequest) =>
        post(`/finance/bank-accounts/${id(accountId)}/review`, sellerBankAccountSchema, body),
    },
    payouts: {
      list: (query: FinanceQuery, signal?: AbortSignal) =>
        get('/finance/payouts', payoutListSchema, query, signal),
      get: (payoutId: string, signal?: AbortSignal) =>
        get(`/finance/payouts/${id(payoutId)}`, payoutDetailSchema, undefined, signal),
      approve: (payoutId: string, note?: string) =>
        post(`/finance/payouts/${id(payoutId)}/approve`, payoutDetailSchema, note ? { note } : {}),
      reject: (payoutId: string, reason: string) =>
        post(`/finance/payouts/${id(payoutId)}/reject`, payoutDetailSchema, { reason }),
      markPaid: (payoutId: string, body: MarkPayoutPaidRequest) =>
        post(`/finance/payouts/${id(payoutId)}/mark-paid`, payoutDetailSchema, body),
      send: (payoutId: string) => post(`/finance/payouts/${id(payoutId)}/send`, payoutDetailSchema),
      check: (payoutId: string) =>
        post(`/finance/payouts/${id(payoutId)}/check`, payoutDetailSchema),
      markFailed: (payoutId: string, reason: string) =>
        post(`/finance/payouts/${id(payoutId)}/mark-failed`, payoutDetailSchema, { reason }),
      reverse: (payoutId: string, reason: string) =>
        post(`/finance/payouts/${id(payoutId)}/reverse`, payoutDetailSchema, { reason }),
    },
    expenses: {
      list: (query: FinanceQuery, signal?: AbortSignal) =>
        get('/finance/expenses', expenseListSchema, query, signal),
      create: (body: CreateExpenseRequest) => post('/finance/expenses', expenseSchema, body),
      pay: (expenseId: string, paymentReference: string) =>
        post(`/finance/expenses/${id(expenseId)}/pay`, expenseSchema, { paymentReference }),
      void: (expenseId: string, reason: string) =>
        post(`/finance/expenses/${id(expenseId)}/void`, expenseSchema, { reason }),
    },
    reports: {
      trialBalance: (from: string, to: string, signal?: AbortSignal) =>
        get('/finance/reports/trial-balance', trialBalanceSchema, period(from, to), signal),
      revenue: (from: string, to: string, signal?: AbortSignal) =>
        get('/finance/reports/revenue', revenueReportSchema, period(from, to), signal),
      commission: (from: string, to: string, signal?: AbortSignal) =>
        get('/finance/reports/commission', commissionReportSchema, period(from, to), signal),
      refunds: (from: string, to: string, signal?: AbortSignal) =>
        get('/finance/reports/refunds', refundReportSchema, period(from, to), signal),
      cod: (from: string, to: string, signal?: AbortSignal) =>
        get('/finance/reports/cod', codReconciliationSchema, period(from, to), signal),
      settlements: (from: string, to: string, signal?: AbortSignal) =>
        get('/finance/reports/settlements', settlementReportSchema, period(from, to), signal),
      reconciliation: (signal?: AbortSignal) =>
        get('/finance/reconciliation', reconciliationReportSchema, undefined, signal),
    },
  };
}

export function createFinanceClient(request: Request) {
  return { seller: seller(request), admin: admin(request) };
}
