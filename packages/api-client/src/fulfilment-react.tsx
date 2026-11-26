import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FulfilmentListQuery } from './fulfilment';
import { useApiClient } from './react';

type Fulfilment = ReturnType<typeof useApiClient>['fulfilment'];

/** Query keys of the Phase 5 screens (prefixes match the order keys, so actions refresh both). */
export const fulfilmentKeys = {
  mockSession: (id: string) => ['account', 'mock-payment', id] as const,
  myReturns: (query: object) => ['account', 'returns', query] as const,
  myReturn: (id: string) => ['account', 'returns', 'detail', id] as const,
  sellerCounts: ['seller', 'orders', 'counts'] as const,
  sellerCarriers: ['seller', 'carriers'] as const,
  sellerReturns: (query: object) => ['seller', 'returns', query] as const,
  sellerReturn: (id: string) => ['seller', 'returns', 'detail', id] as const,
  sellerLedger: (query: object) => ['seller', 'ledger', query] as const,
  payments: (query: object) => ['admin', 'payments', query] as const,
  payment: (id: string) => ['admin', 'payments', 'detail', id] as const,
  gateways: ['admin', 'payments', 'gateways'] as const,
  reconciliation: (from: string, to: string) =>
    ['admin', 'payments', 'reconciliation', from, to] as const,
  webhookEvents: (query: object) => ['admin', 'payments', 'webhook-events', query] as const,
  proofs: (query: object) => ['admin', 'proofs', query] as const,
  refunds: (query: object) => ['admin', 'refunds', query] as const,
  codCollections: (query: object) => ['admin', 'cod', 'collections', query] as const,
  remittances: (query: object) => ['admin', 'cod', 'remittances', query] as const,
  carriers: ['admin', 'carriers'] as const,
  shipments: (query: object) => ['admin', 'shipments', query] as const,
  returns: (query: object) => ['admin', 'returns', query] as const,
  return: (id: string) => ['admin', 'returns', 'detail', id] as const,
  sellerLedgerAdmin: (sellerId: string, query: object) =>
    ['admin', 'seller-ledger', sellerId, query] as const,
};

function useList<T>(
  key: readonly unknown[],
  fn: (f: Fulfilment, signal?: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fn(client.fulfilment, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Runs one Phase 5 action and refreshes every order, payment, shipment and return view of
 * the app (they all share the account/seller/admin key prefixes). Actions are rare and
 * explicit, so a broad refresh keeps every screen consistent without bookkeeping.
 */
export function useFulfilmentAction() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, (f: Fulfilment) => Promise<unknown>>({
    mutationFn: (run) => run(client.fulfilment),
    onSuccess: () =>
      Promise.all(
        [['account'], ['seller'], ['admin']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

// ---- Customers ---------------------------------------------------------------------------------

export const useMockPaymentSession = (sessionId: string | undefined) =>
  useList(
    fulfilmentKeys.mockSession(sessionId ?? ''),
    (f, s) => f.customer.mockSession(sessionId!, s),
    !!sessionId,
  );
export const useMyReturns = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.myReturns(query), (f, s) => f.customer.returns.list(query, s));
export const useMyReturn = (returnId: string | undefined) =>
  useList(
    fulfilmentKeys.myReturn(returnId ?? ''),
    (f, s) => f.customer.returns.get(returnId!, s),
    !!returnId,
  );

// ---- Sellers -----------------------------------------------------------------------------------

export const useSellerOrderCounts = () =>
  useList(fulfilmentKeys.sellerCounts, (f, s) => f.seller.counts(s));
export const useSellerCarriers = () =>
  useList(fulfilmentKeys.sellerCarriers, (f, s) => f.seller.carriers(s));
export const useSellerReturns = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.sellerReturns(query), (f, s) => f.seller.returns.list(query, s));
export const useSellerReturn = (returnId: string | undefined) =>
  useList(
    fulfilmentKeys.sellerReturn(returnId ?? ''),
    (f, s) => f.seller.returns.get(returnId!, s),
    !!returnId,
  );
export const useSellerLedger = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.sellerLedger(query), (f, s) => f.seller.ledger(query, s));

// ---- Staff -------------------------------------------------------------------------------------

export const useAdminPayments = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.payments(query), (f, s) => f.admin.payments.list(query, s));
export const useAdminPayment = (paymentId: string | undefined) =>
  useList(
    fulfilmentKeys.payment(paymentId ?? ''),
    (f, s) => f.admin.payments.get(paymentId!, s),
    !!paymentId,
  );
export const usePaymentGateways = () =>
  useList(fulfilmentKeys.gateways, (f, s) => f.admin.payments.gateways(s));
export const useReconciliation = (from: string, to: string) =>
  useList(fulfilmentKeys.reconciliation(from, to), (f, s) =>
    f.admin.payments.reconciliation(from, to, s),
  );
export const useWebhookEvents = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.webhookEvents(query), (f, s) => f.admin.payments.webhookEvents(query, s));
export const useBankProofs = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.proofs(query), (f, s) => f.admin.proofs.list(query, s));
export const useAdminRefunds = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.refunds(query), (f, s) => f.admin.refunds.list(query, s));
export const useCodCollections = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.codCollections(query), (f, s) => f.admin.cod.collections(query, s));
export const useRemittances = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.remittances(query), (f, s) => f.admin.cod.remittances(query, s));
export const useAdminCarriers = () =>
  useList(fulfilmentKeys.carriers, (f, s) => f.admin.shipping.carriers(s));
export const useAdminShipments = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.shipments(query), (f, s) => f.admin.shipping.shipments(query, s));
export const useAdminReturns = (query: FulfilmentListQuery) =>
  useList(fulfilmentKeys.returns(query), (f, s) => f.admin.returns.list(query, s));
export const useAdminReturn = (returnId: string | undefined) =>
  useList(
    fulfilmentKeys.return(returnId ?? ''),
    (f, s) => f.admin.returns.get(returnId!, s),
    !!returnId,
  );
export const useAdminSellerLedger = (sellerId: string | undefined, query: FulfilmentListQuery) =>
  useList(
    fulfilmentKeys.sellerLedgerAdmin(sellerId ?? '', query),
    (f, s) => f.admin.sellerLedger(sellerId!, query, s),
    !!sellerId,
  );
