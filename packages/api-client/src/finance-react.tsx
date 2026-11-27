import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FinanceQuery } from './finance';
import { useApiClient } from './react';

type Finance = ReturnType<typeof useApiClient>['finance'];

/** Query keys of the Phase 6 finance screens (Seller Center under 'seller', staff under 'admin'). */
export const financeKeys = {
  seller: (...parts: unknown[]) => ['seller', 'finance', ...parts] as const,
  admin: (...parts: unknown[]) => ['admin', 'finance', ...parts] as const,
};

function useFinanceQuery<T>(
  key: readonly unknown[],
  fn: (f: Finance, signal?: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fn(client.finance, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Runs one finance action and refreshes the finance and order views (balances, statements and
 * payouts all derive from the same ledger, so a broad refresh keeps every screen consistent).
 */
export function useFinanceAction() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, (f: Finance) => Promise<unknown>>({
    mutationFn: (run) => run(client.finance),
    onSuccess: () =>
      Promise.all(
        [['seller'], ['admin']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  });
}

// ---- Seller Center -------------------------------------------------------------------------------

export const useSellerFinanceOverview = (query: { from?: string; to?: string }) =>
  useFinanceQuery(financeKeys.seller('overview', query), (f, s) => f.seller.overview(query, s));
export const useSellerTransactions = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.seller('transactions', query), (f, s) =>
    f.seller.transactions(query, s),
  );
export const useSellerSettlements = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.seller('settlements', query), (f, s) =>
    f.seller.settlements(query, s),
  );
export const useSellerSettlement = (id: string | undefined) =>
  useFinanceQuery(
    financeKeys.seller('settlement', id),
    (f, s) => f.seller.settlement(id!, s),
    !!id,
  );
export const useSellerDocuments = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.seller('documents', query), (f, s) => f.seller.documents(query, s));
export const useSellerDocument = (id: string | undefined) =>
  useFinanceQuery(financeKeys.seller('document', id), (f, s) => f.seller.document(id!, s), !!id);
export const useSellerBankAccounts = () =>
  useFinanceQuery(financeKeys.seller('bank-accounts'), (f, s) => f.seller.bankAccounts(s));
export const useSellerPayouts = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.seller('payouts', query), (f, s) => f.seller.payouts(query, s));
export const useSellerPayout = (id: string | undefined) =>
  useFinanceQuery(financeKeys.seller('payout', id), (f, s) => f.seller.payout(id!, s), !!id);
export const useSellerTaxProfile = () =>
  useFinanceQuery(financeKeys.seller('tax-profile'), (f, s) => f.seller.taxProfile(s));

// ---- Admin Console -------------------------------------------------------------------------------

export const useFinanceDashboard = (from: string, to: string) =>
  useFinanceQuery(financeKeys.admin('dashboard', from, to), (f, s) =>
    f.admin.dashboard(from, to, s),
  );
export const useFinanceSettings = () =>
  useFinanceQuery(financeKeys.admin('settings'), (f, s) => f.admin.settings(s));
export const useCommissionRules = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.admin('commission', query), (f, s) =>
    f.admin.commission.list(query, s),
  );
export const useCommissionPreview = (productId: string | undefined) =>
  useFinanceQuery(
    financeKeys.admin('commission-preview', productId),
    (f, s) => f.admin.commission.preview(productId!, s),
    !!productId,
  );
export const useTaxRules = () =>
  useFinanceQuery(financeKeys.admin('tax-rules'), (f, s) => f.admin.taxes.list(s));
export const useTaxProfilesToVerify = () =>
  useFinanceQuery(financeKeys.admin('tax-profiles'), (f, s) => f.admin.taxes.toVerify(s));
export const useLedgerAccounts = () =>
  useFinanceQuery(financeKeys.admin('accounts'), (f, s) => f.admin.ledger.accounts(s));
export const useAccountLedger = (code: string | undefined, query: FinanceQuery) =>
  useFinanceQuery(
    financeKeys.admin('account-ledger', code, query),
    (f, s) => f.admin.ledger.accountLedger(code!, query, s),
    !!code,
  );
export const useJournals = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.admin('journals', query), (f, s) =>
    f.admin.ledger.journals(query, s),
  );
export const useJournal = (id: string | undefined) =>
  useFinanceQuery(financeKeys.admin('journal', id), (f, s) => f.admin.ledger.journal(id!, s), !!id);
export const useSellerBalances = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.admin('balances', query), (f, s) => f.admin.balances.list(query, s));
export const useAdminSellerBalance = (sellerId: string | undefined) =>
  useFinanceQuery(
    financeKeys.admin('seller-balance', sellerId),
    (f, s) => f.admin.balances.seller(sellerId!, s),
    !!sellerId,
  );
export const useAdminSubledger = (sellerId: string | undefined, query: FinanceQuery) =>
  useFinanceQuery(
    financeKeys.admin('subledger', sellerId, query),
    (f, s) => f.admin.balances.subledger(sellerId!, query, s),
    !!sellerId,
  );
export const useAdminSettlements = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.admin('settlements', query), (f, s) =>
    f.admin.settlements.list(query, s),
  );
export const useAdminSettlement = (id: string | undefined) =>
  useFinanceQuery(
    financeKeys.admin('settlement', id),
    (f, s) => f.admin.settlements.get(id!, s),
    !!id,
  );
export const useSettlementPreview = () =>
  useFinanceQuery(financeKeys.admin('settlement-preview'), (f, s) =>
    f.admin.settlements.preview(s),
  );
export const useAdminDocuments = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.admin('documents', query), (f, s) =>
    f.admin.documents.list(query, s),
  );
export const useAdminDocument = (id: string | undefined) =>
  useFinanceQuery(financeKeys.admin('document', id), (f, s) => f.admin.documents.get(id!, s), !!id);
export const useAdminBankAccounts = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.admin('bank-accounts', query), (f, s) =>
    f.admin.bankAccounts.list(query, s),
  );
export const useAdminPayouts = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.admin('payouts', query), (f, s) => f.admin.payouts.list(query, s));
export const useAdminPayout = (id: string | undefined) =>
  useFinanceQuery(financeKeys.admin('payout', id), (f, s) => f.admin.payouts.get(id!, s), !!id);
export const useExpenses = (query: FinanceQuery) =>
  useFinanceQuery(financeKeys.admin('expenses', query), (f, s) => f.admin.expenses.list(query, s));
const report = (name: string, from: string, to: string) =>
  financeKeys.admin('report', name, from, to);
export const useTrialBalance = (from: string, to: string) =>
  useFinanceQuery(report('trial-balance', from, to), (f, s) =>
    f.admin.reports.trialBalance(from, to, s),
  );
export const useRevenueReport = (from: string, to: string) =>
  useFinanceQuery(report('revenue', from, to), (f, s) => f.admin.reports.revenue(from, to, s));
export const useCommissionReport = (from: string, to: string) =>
  useFinanceQuery(report('commission', from, to), (f, s) =>
    f.admin.reports.commission(from, to, s),
  );
export const useRefundReport = (from: string, to: string) =>
  useFinanceQuery(report('refunds', from, to), (f, s) => f.admin.reports.refunds(from, to, s));
export const useCodReport = (from: string, to: string) =>
  useFinanceQuery(report('cod', from, to), (f, s) => f.admin.reports.cod(from, to, s));
export const useSettlementReport = (from: string, to: string) =>
  useFinanceQuery(report('settlements', from, to), (f, s) =>
    f.admin.reports.settlements(from, to, s),
  );
export const useFinanceReconciliation = () =>
  useFinanceQuery(financeKeys.admin('reconciliation'), (f, s) => f.admin.reports.reconciliation(s));
