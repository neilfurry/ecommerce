# ADR 0022: Payment providers, webhooks and the mock gateway

- Status: Accepted
- Date: 2026-11-26

## Context

Phase 5 needs GCash, Maya, cards, QR Ph, bank transfer and cash on delivery, with a sandbox
when credentials exist and a mock for local work. Money handling must be correct under
retries: "No duplicate payment, refund or order processing is possible through webhook
retries", and "Never trust a frontend payment-success redirect as proof of payment".

## Providers evaluated

|                              | PayMongo                                                                                       | Xendit                                                    | Maya Business                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Methods (PH)                 | GCash, Maya, cards, QR Ph, GrabPay, BillEase                                                   | GCash, Maya, cards, QR Ph, direct debit, over the counter | Maya wallet, cards, QR Ph                                               |
| Hosted checkout              | Checkout Sessions (`/v2/checkout_sessions`; v1 also exists)                                    | Invoices / Payment Sessions                               | Maya Checkout                                                           |
| Webhook authenticity         | HMAC-SHA256 signature over `timestamp.rawBody` (`Paymongo-Signature`, `te`/`li` for test/live) | Static `x-callback-token` header (no body signature)      | Webhooks registered per merchant (confirm the signing method with Maya) |
| Refunds                      | API, full and partial, idempotency key                                                         | API                                                       | Must be enabled by a Maya relationship manager                          |
| Marketplace split settlement | Only with **PayMongo Platforms** and a configured merchant relationship                        | Only with **xenPlatform**                                 | Not offered as a self-service feature                                   |
| Sandbox                      | Self-service test keys                                                                         | Self-service test keys                                    | Sandbox keys through onboarding                                         |

The table reflects the providers' public documentation as read during Phase 5 (PayMongo in
detail, Xendit and Maya at overview level). Method lists, fees and capabilities must be
confirmed against current documentation and the merchant agreement before go-live.

**Choice:** PayMongo is the first real adapter (self-service sandbox, signed webhooks, refund
API with idempotency). Xendit and Maya Business are prepared adapters that refuse every call
until they are built against a signed merchant agreement and their current documentation.

**Split settlement is not assumed.** The marketplace collects the whole payment into its own
account and records what it owes each seller in an append-only payables ledger
(ADR 0025). Payouts to sellers are the Finance phase. Moving to PayMongo Platforms or
xenPlatform later needs a merchant agreement and a review of their actual capabilities.

## Decision

- **`@marketplace/payments`** holds the `PaymentGateway` interface (`createCheckout`,
  `retrieve`, `expire`, `refund`, `parseWebhook`) and the adapters: `MockGateway`,
  `PayMongoGateway`, `MayaBusinessGateway` and `XenditGateway` (both refusing). The API and the
  worker use the same adapters.
- **Configuration:** `PAYMENT_PROVIDER=mock|paymongo`. `paymongo` needs `PAYMONGO_SECRET_KEY` and
  `PAYMONGO_WEBHOOK_SECRET`; the API refuses to start without them. The mock is refused in
  production and is never constructed there.
- **Mock payments are marked as tests everywhere.** The mock's `livemode` is always false; every
  payment, refund and shipment stores `livemode`, and every screen shows a "Test" badge for
  non-live records. The mock's checkout page says that no money moves. The reconciliation report
  shows test money on separate lines.
- **One payment row per attempt**, with its own reference (`PAY-XXXXXXXX`). A partial unique
  index allows one `PAID` payment per order.
- **Webhooks:**
  1. The signature is checked over the raw request body (Nest `rawBody: true`). A bad or missing
     signature returns 401 and nothing is stored.
  2. The event is stored once per (source, provider event id) (unique index). A redelivered
     event finds its row: already processed means 200 `duplicate: true`.
  3. It is processed in one transaction holding the event row lock, so concurrent deliveries
     wait and the second sees `PROCESSED`.
  4. A processing error marks the event `FAILED` and answers 500, so the provider retries. Staff
     can reprocess failed events from the stored, already verified payload.
- **One confirmation path.** Webhooks, server-side verification (`retrieve`) after the customer
  returns from the provider's page, the worker's reconciliation, and finance approval of a
  bank transfer all call `applyPaymentSucceededInTx`. It locks the order and then the payment,
  is idempotent (`ALREADY_PAID`), and sends money that cannot pay the order to a finance
  review queue instead of applying it: `LATE_PAYMENT` (order expired or cancelled),
  `DUPLICATE_PAYMENT` (already paid by another attempt) or `AMOUNT_MISMATCH`. Nothing is
  refunded automatically; finance refunds it from the queue.
- **The redirect proves nothing.** The success URL only brings the customer back to the order
  page, which asks the API to verify; the API asks the provider.
- **Expiry:** an unpaid order is cancelled when its deadline passes. Just before, the worker asks
  the provider about its open attempts (a payment made at the last second is applied, not
  lost). After a cancellation the provider's checkout is expired too.
- **Bank transfer** uses the same model with provider `MANUAL_BANK`: instructions and the
  payment reference, proof upload (PDF, JPG, PNG), a finance queue, approval (through
  `applyPaymentSucceededInTx`) or rejection with a reason, which gives the customer a new
  window. While a proof waits for review the order does not expire and its stock is held.
  The receiving accounts are the marketplace's public collection accounts set in the Admin
  Console; seller bank details are never exposed.

## Consequences

- Retries, duplicates and races are safe by construction (unique event ids, row locks,
  compare-and-set, partial unique indexes), and the e2e tests deliver the same event
  concurrently.
- Real money needs a merchant agreement with PayMongo (or another provider) and live keys;
  nothing else changes in the code.
