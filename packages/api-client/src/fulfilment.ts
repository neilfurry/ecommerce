import {
  type AddNoteRequest,
  type AdminOrderDetail,
  adminOrderDetailSchema,
  type AdminPaymentDetail,
  adminPaymentDetailSchema,
  adminPaymentListSchema,
  type AdminProof,
  adminProofListSchema,
  adminProofSchema,
  adminShipmentListSchema,
  type BookShipmentRequest,
  carrierListSchema,
  codCollectionListSchema,
  type CreateRefundRequest,
  type MockPaymentSession,
  mockPaymentSessionSchema,
  type OrderDetail,
  orderDetailSchema,
  type OrderSettingsInput,
  orderSettingsSchema,
  paymentGatewayListSchema,
  type Reconciliation,
  reconciliationSchema,
  type RecordRemittanceRequest,
  type RefundDto,
  refundListSchema,
  refundSchema,
  remittanceListSchema,
  remittanceSchema,
  type ReturnDto,
  returnListSchema,
  returnSchema,
  type SellerOrderCounts,
  sellerOrderCountsSchema,
  type SellerOrderDetail,
  sellerOrderDetailSchema,
  type SellerReturnDecision,
  sellerLedgerSchema,
  type ShipmentDto,
  shipmentSchema,
  type ShipmentUpdateRequest,
  type StaffReturnDecision,
  type StartPaymentResponse,
  startPaymentResponseSchema,
  webhookEventListSchema,
  webhookEventSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import type { RequestOptions } from './client';

type Request = <TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
) => Promise<z.output<TSchema>>;
type Query = Record<string, string | number | boolean | undefined>;
export type FulfilmentListQuery = { page?: number; pageSize?: number } & Record<
  string,
  string | number | boolean | undefined
>;

const id = (value: string) => encodeURIComponent(value);
const asQuery = (value: object): Query =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== '')) as Query;
const blob = z.instanceof(Blob);
const post = <T extends z.ZodType>(request: Request, path: string, schema: T, body: unknown = {}) =>
  request(path, { method: 'POST', body, schema });

/** Customers: paying, bank transfer proofs, cancelling, notes, deliveries and returns. */
function customer(request: Request) {
  return {
    pay: (orderId: string): Promise<StartPaymentResponse> =>
      post(request, `/account/orders/${id(orderId)}/payments`, startPaymentResponseSchema),
    /** After returning from the payment page: the API asks the provider; never trusts the redirect. */
    verifyPayment: (orderId: string): Promise<OrderDetail> =>
      post(request, `/account/orders/${id(orderId)}/payments/verify`, orderDetailSchema),
    /** Multipart: file, bankName, referenceNumber, amount, transferredAt. */
    uploadProof: (orderId: string, form: FormData): Promise<OrderDetail> =>
      request(`/account/orders/${id(orderId)}/bank-transfer-proofs`, {
        method: 'POST',
        body: form,
        schema: orderDetailSchema,
      }),
    proofFile: (orderId: string, proofId: string): Promise<Blob> =>
      request(`/account/orders/${id(orderId)}/bank-transfer-proofs/${id(proofId)}/file`, {
        schema: blob,
        responseType: 'blob',
      }),
    addNote: (orderId: string, body: AddNoteRequest): Promise<OrderDetail> =>
      post(request, `/account/orders/${id(orderId)}/notes`, orderDetailSchema, body),
    cancelPart: (sellerOrderId: string, reason: string): Promise<OrderDetail> =>
      post(request, `/account/seller-orders/${id(sellerOrderId)}/cancel`, orderDetailSchema, {
        reason,
      }),
    requestCancellation: (sellerOrderId: string, reason: string): Promise<OrderDetail> =>
      post(
        request,
        `/account/seller-orders/${id(sellerOrderId)}/cancellation-request`,
        orderDetailSchema,
        {
          reason,
        },
      ),
    confirmReceived: (sellerOrderId: string): Promise<OrderDetail> =>
      post(
        request,
        `/account/seller-orders/${id(sellerOrderId)}/confirm-received`,
        orderDetailSchema,
      ),
    mockSession: (sessionId: string, signal?: AbortSignal): Promise<MockPaymentSession> =>
      request(`/dev/mock-payments/${id(sessionId)}`, { schema: mockPaymentSessionSchema, signal }),
    completeMock: (sessionId: string, outcome: 'paid' | 'failed'): Promise<MockPaymentSession> =>
      post(request, `/dev/mock-payments/${id(sessionId)}`, mockPaymentSessionSchema, { outcome }),
    returns: {
      list: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/account/returns', { query: asQuery(query), schema: returnListSchema, signal }),
      get: (returnId: string, signal?: AbortSignal): Promise<ReturnDto> =>
        request(`/account/returns/${id(returnId)}`, { schema: returnSchema, signal }),
      /** Multipart: "data" (JSON) and up to five "images". */
      create: (form: FormData): Promise<ReturnDto> =>
        request('/account/returns', { method: 'POST', body: form, schema: returnSchema }),
      escalate: (returnId: string, note: string): Promise<ReturnDto> =>
        post(request, `/account/returns/${id(returnId)}/escalate`, returnSchema, { note }),
      cancel: (returnId: string): Promise<ReturnDto> =>
        post(request, `/account/returns/${id(returnId)}/cancel`, returnSchema),
      shipBack: (
        returnId: string,
        body: { carrierName: string; trackingNumber: string },
      ): Promise<ReturnDto> =>
        post(request, `/account/returns/${id(returnId)}/ship-back`, returnSchema, body),
    },
  };
}

/** Seller Center: acting on orders, shipments, returns and the payables ledger. */
function seller(request: Request) {
  const order = (soId: string, action: string, body: unknown = {}): Promise<SellerOrderDetail> =>
    post(request, `/seller/orders/${id(soId)}/${action}`, sellerOrderDetailSchema, body);
  return {
    counts: (signal?: AbortSignal): Promise<SellerOrderCounts> =>
      request('/seller/orders/counts', { schema: sellerOrderCountsSchema, signal }),
    accept: (soId: string) => order(soId, 'accept'),
    cancel: (soId: string, reason: string) => order(soId, 'cancel', { reason }),
    approveCancellation: (soId: string, response?: string) =>
      order(soId, 'cancellation-request/approve', { response }),
    rejectCancellation: (soId: string, response: string) =>
      order(soId, 'cancellation-request/reject', { response }),
    addNote: (soId: string, body: AddNoteRequest) => order(soId, 'notes', body),
    carriers: (signal?: AbortSignal) =>
      request('/seller/shipping/carriers', { schema: carrierListSchema, signal }),
    book: (soId: string, body: BookShipmentRequest): Promise<ShipmentDto> =>
      post(request, `/seller/orders/${id(soId)}/shipments`, shipmentSchema, body),
    cancelShipment: (shipmentId: string): Promise<ShipmentDto> =>
      post(request, `/seller/shipments/${id(shipmentId)}/cancel`, shipmentSchema),
    updateShipment: (shipmentId: string, body: ShipmentUpdateRequest): Promise<ShipmentDto> =>
      post(request, `/seller/shipments/${id(shipmentId)}/events`, shipmentSchema, body),
    waybill: (shipmentId: string): Promise<Blob> =>
      request(`/seller/shipments/${id(shipmentId)}/waybill`, {
        schema: blob,
        responseType: 'blob',
      }),
    returns: {
      list: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/seller/returns', { query: asQuery(query), schema: returnListSchema, signal }),
      get: (returnId: string, signal?: AbortSignal): Promise<ReturnDto> =>
        request(`/seller/returns/${id(returnId)}`, { schema: returnSchema, signal }),
      approve: (returnId: string, body: SellerReturnDecision): Promise<ReturnDto> =>
        post(request, `/seller/returns/${id(returnId)}/approve`, returnSchema, body),
      reject: (returnId: string, response: string): Promise<ReturnDto> =>
        post(request, `/seller/returns/${id(returnId)}/reject`, returnSchema, { response }),
      receive: (returnId: string, restock: boolean): Promise<ReturnDto> =>
        post(request, `/seller/returns/${id(returnId)}/receive`, returnSchema, { restock }),
      replacement: (
        returnId: string,
        body: { carrierName: string; trackingNumber: string },
      ): Promise<ReturnDto> =>
        post(request, `/seller/returns/${id(returnId)}/replacement`, returnSchema, body),
    },
    ledger: (query: FulfilmentListQuery, signal?: AbortSignal) =>
      request('/seller/ledger', { query: asQuery(query), schema: sellerLedgerSchema, signal }),
  };
}

/** Admin Console: payments, bank transfers, COD, refunds, shipping, disputes and order actions. */
function admin(request: Request) {
  return {
    cancelOrder: (orderId: string, reason: string): Promise<AdminOrderDetail> =>
      post(request, `/orders/${id(orderId)}/cancel`, adminOrderDetailSchema, { reason }),
    addOrderNote: (orderId: string, body: AddNoteRequest): Promise<AdminOrderDetail> =>
      post(request, `/orders/${id(orderId)}/notes`, adminOrderDetailSchema, body),
    verifyPayment: (orderId: string): Promise<AdminOrderDetail> =>
      post(request, `/orders/${id(orderId)}/payments/verify`, adminOrderDetailSchema),
    cancelSellerOrder: (soId: string, reason: string): Promise<SellerOrderDetail> =>
      post(request, `/seller-orders/${id(soId)}/cancel`, sellerOrderDetailSchema, { reason }),
    transition: (soId: string, to: string, note: string): Promise<SellerOrderDetail> =>
      post(request, `/seller-orders/${id(soId)}/transition`, sellerOrderDetailSchema, { to, note }),
    answerCancellation: (soId: string, decision: 'approve' | 'reject', response?: string) =>
      post(
        request,
        `/seller-orders/${id(soId)}/cancellation-request/${decision}`,
        sellerOrderDetailSchema,
        {
          response,
        },
      ),
    addSellerOrderNote: (soId: string, body: AddNoteRequest): Promise<SellerOrderDetail> =>
      post(request, `/seller-orders/${id(soId)}/notes`, sellerOrderDetailSchema, body),
    payments: {
      list: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/payments', { query: asQuery(query), schema: adminPaymentListSchema, signal }),
      get: (paymentId: string, signal?: AbortSignal): Promise<AdminPaymentDetail> =>
        request(`/payments/${id(paymentId)}`, { schema: adminPaymentDetailSchema, signal }),
      resolve: (paymentId: string, note: string): Promise<AdminPaymentDetail> =>
        post(request, `/payments/${id(paymentId)}/resolve`, adminPaymentDetailSchema, { note }),
      gateways: (signal?: AbortSignal) =>
        request('/payments/gateways', { schema: paymentGatewayListSchema, signal }),
      reconciliation: (from: string, to: string, signal?: AbortSignal): Promise<Reconciliation> =>
        request('/payments/reconciliation', {
          query: { from, to },
          schema: reconciliationSchema,
          signal,
        }),
      webhookEvents: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/payments/webhook-events', {
          query: asQuery(query),
          schema: webhookEventListSchema,
          signal,
        }),
      reprocess: (eventId: string) =>
        post(request, `/payments/webhook-events/${id(eventId)}/reprocess`, webhookEventSchema),
    },
    proofs: {
      list: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/payments/bank-transfer-proofs', {
          query: asQuery(query),
          schema: adminProofListSchema,
          signal,
        }),
      file: (proofId: string): Promise<Blob> =>
        request(`/payments/bank-transfer-proofs/${id(proofId)}/file`, {
          schema: blob,
          responseType: 'blob',
        }),
      approve: (proofId: string): Promise<AdminProof> =>
        post(request, `/payments/bank-transfer-proofs/${id(proofId)}/approve`, adminProofSchema),
      reject: (proofId: string, reason: string): Promise<AdminProof> =>
        post(request, `/payments/bank-transfer-proofs/${id(proofId)}/reject`, adminProofSchema, {
          reason,
        }),
    },
    refunds: {
      list: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/refunds', { query: asQuery(query), schema: refundListSchema, signal }),
      create: (body: CreateRefundRequest): Promise<RefundDto> =>
        post(request, '/refunds', refundSchema, body),
      markPaid: (refundId: string, payoutReference: string): Promise<RefundDto> =>
        post(request, `/refunds/${id(refundId)}/mark-paid`, refundSchema, { payoutReference }),
      retry: (refundId: string): Promise<RefundDto> =>
        post(request, `/refunds/${id(refundId)}/retry`, refundSchema),
      resend: (refundId: string): Promise<RefundDto> =>
        post(request, `/refunds/${id(refundId)}/resend`, refundSchema),
    },
    cod: {
      collections: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/cod/collections', {
          query: asQuery(query),
          schema: codCollectionListSchema,
          signal,
        }),
      remittances: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/cod/remittances', {
          query: asQuery(query),
          schema: remittanceListSchema,
          signal,
        }),
      record: (body: RecordRemittanceRequest) =>
        post(request, '/cod/remittances', remittanceSchema, body),
    },
    shipping: {
      carriers: (signal?: AbortSignal) =>
        request('/shipping/carriers', { schema: carrierListSchema, signal }),
      saveSettings: (body: OrderSettingsInput) =>
        request('/settings/orders', { method: 'PUT', body, schema: orderSettingsSchema }),
      shipments: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/shipments', { query: asQuery(query), schema: adminShipmentListSchema, signal }),
      update: (shipmentId: string, body: ShipmentUpdateRequest): Promise<ShipmentDto> =>
        post(request, `/shipments/${id(shipmentId)}/events`, shipmentSchema, body),
      cancel: (shipmentId: string): Promise<ShipmentDto> =>
        post(request, `/shipments/${id(shipmentId)}/cancel`, shipmentSchema),
      simulate: (shipmentId: string, status: string): Promise<ShipmentDto> =>
        post(request, `/shipments/${id(shipmentId)}/simulate`, shipmentSchema, { status }),
      waybill: (shipmentId: string): Promise<Blob> =>
        request(`/shipments/${id(shipmentId)}/waybill`, { schema: blob, responseType: 'blob' }),
    },
    returns: {
      list: (query: FulfilmentListQuery, signal?: AbortSignal) =>
        request('/returns', { query: asQuery(query), schema: returnListSchema, signal }),
      get: (returnId: string, signal?: AbortSignal): Promise<ReturnDto> =>
        request(`/returns/${id(returnId)}`, { schema: returnSchema, signal }),
      decide: (returnId: string, body: StaffReturnDecision): Promise<ReturnDto> =>
        post(request, `/returns/${id(returnId)}/decide`, returnSchema, body),
      receive: (returnId: string, restock: boolean): Promise<ReturnDto> =>
        post(request, `/returns/${id(returnId)}/receive`, returnSchema, { restock }),
    },
    sellerLedger: (sellerId: string, query: FulfilmentListQuery, signal?: AbortSignal) =>
      request(`/sellers/${id(sellerId)}/ledger`, {
        query: asQuery(query),
        schema: sellerLedgerSchema,
        signal,
      }),
  };
}

/** Phase 5 endpoints, grouped by app. */
export function createFulfilmentClient(request: Request) {
  return { customer: customer(request), seller: seller(request), admin: admin(request) };
}
