# Phase 5 report: Order management, payment processing and shipping

- Branch: `phase-5-orders` (PR #5, based on `phase-4-storefront`)
- Date: 2026-11-26
- Verified on: GitHub Actions run `45822065277`, commit `b81f822` (all three jobs green; see §7)
- Status: **Complete, awaiting review and approval.** Phase 6 has not been started and will not
  start until you send the Phase 6 details.

Decisions applied (from the Phase 5 kick-off):

1. **PayMongo** is the real adapter (its sandbox is used when `PAYMONGO_SECRET_KEY` and
   `PAYMONGO_WEBHOOK_SECRET` are set). Maya Business and Xendit are prepared adapters that refuse
   every call. The evaluation of all three is in ADR 0022.
2. **The marketplace collects all money.** Split settlement is not assumed. Each seller's share
   is recorded in an append-only payables ledger; payouts belong to the Finance phase.
3. **Returns:** the seller answers first, within a deadline. The customer can escalate to the
   marketplace, finance carries out refunds, and the return window is 7 days (configurable).
4. **Couriers:** a mock courier, plus deliveries the seller arranges and tracks. J&T, LBC,
   Ninja Van, Flash and 2GO are prepared but disabled until credentials and documentation are
   available.

## 1. Implemented features

### Orders (§1)

- Parent orders, one seller order per seller, item snapshots and status history from Phase 4.
  Phase 5 adds:
  - the fulfilment statuses: new → processing → ready for pickup → shipped →
    delivered → completed, plus delivery failed, returning and returned to seller;
  - cancellation requests, notes with visibility (customer, seller, staff only) and tracking.
- **Controlled state machine** (ADR 0023). One table lists every allowed move and who may make
  it. Every change is a compare-and-set in a transaction that locks the order first and writes
  the history (from, to, actor).
- Customers see the whole order with each package's status. Sellers see only their own seller
  orders (others' answer 404). Staff see everything.
- Scheduled jobs:
  - delivered orders past the return window are completed;
  - unanswered return requests go to the marketplace.

### Payments (§2–§4)

- **Provider abstraction** (`@marketplace/payments`):
  - mock gateway, PayMongo checkout sessions, prepared Maya Business and Xendit adapters;
  - **all six methods:** GCash, Maya, cards and QR Ph through the gateway, plus bank transfer
    and cash on delivery.
- **Payment lifecycle:**
  - **Start and reference:** each attempt gets its own reference (`PAY-XXXXXXXX`). The provider's
    checkout opens right after the order is saved; "Pay now" opens it again or starts a new
    attempt after a failure.
  - **Verification:** server to server, when the customer returns from the provider.
  - **Webhooks:** signature checked over the raw body; each event stored once per provider event
    id; processed in a single transaction.
  - **Failures:** a declined attempt can be retried.
  - **Expiry:** the provider is asked first, then the order is cancelled and the provider's
    checkout closed.
  - **Refunds and reconciliation** are also covered.
- **Mock payments are never presented as real.** They carry a "Test" badge everywhere, `livemode`
  is stored on every payment, refund and shipment, and the mock's checkout page says that no
  money moves. The reconciliation report lists test money separately. The mock cannot run in
  production.
- **The redirect proves nothing.** Only a signed webhook, a status check with the provider, or a
  finance decision marks a payment paid, and all of them use the same idempotent function.
- **Money that cannot pay the order goes to a finance review queue:** late (order expired),
  duplicate (already paid) or wrong amount. Nothing is refunded automatically.

### Bank transfers (§5)

- Bank details and the payment reference are shown to the customer, who uploads proof
  (PDF/JPG/PNG).
- A finance queue (oldest first) approves or rejects with a reason. A rejection gives the
  customer more time.
- An order whose proof is under review does not expire, and its stock stays held.
- Bank transfer is offered only while finance has listed a receiving account.

### Cash on delivery (§6)

- Eligibility: a maximum order amount and a limit on earlier failed deliveries.
- Each seller order has an expected amount. Its collection moves from to collect → collected
  (courier) → remitted (finance).
- **Only the remittance counts as received.** That is when the payment, the order's payment
  status and the seller's earnings change. A remittance must match what was collected or carry
  an explanation, and each courier reference can be used once.
- Failed delivery and return to seller restock the items and close the collection.

### Shipping (§7)

- Courier abstraction (ADR 0024). The mock courier provides:
  - booking, tracking numbers and a PDF waybill marked "TEST LABEL";
  - signed tracking webhooks, sent from the Admin Console's "Simulate courier update".
- Self-arranged deliveries are updated by the seller, and the customer can confirm receipt.
- Supported: pickup (held stock leaves the warehouse), tracking events, delivery confirmation
  (starts the return window), failed delivery, return shipments and replacements.

### Returns and refunds (§8)

- **Returns:** requests with items, reason, description and up to 5 photos (re-encoded). The
  seller reviews: full or partial refund or a replacement, with or without the item back, or a
  rejection. The customer can escalate, and staff resolve the dispute.
- **Refunds:**
  - full and partial, back to the original payment or as a manual payout, tracked to the end;
  - each one updates the payment, the order's payment status and the seller's payables (refund
    and commission reversal);
  - **duplicates are impossible:** idempotency keys, one live refund per return and per
    cancellation, the amount reserved on the payment under a lock (refunded ≤ received), and
    the provider's idempotency key (ADR 0025).

### Seller Center (§9)

- Order dashboard with tabs and counts: new, processing, ready for pickup, shipped, completed
  and cancelled. Search by number, tracking number or customer.
- Order actions: accept, cancel with a reason, answer cancellation requests, book a courier or
  record their own, print labels, update self-arranged deliveries, and notes.
- Returns: approve, reject, receive (restock or damaged) and send replacements.
- Payables ledger with the balance.

### Admin Console (§10)

- Global order monitoring with actions:
  - cancel an order or a seller order;
  - accept for the seller, or complete a delivered order;
  - answer cancellation requests, add notes and refund.
- Payments: all attempts, the review queue, the failed payment queue, provider events
  (reprocess failed ones) and gateway status.
- Bank transfer verification, COD reconciliation (select parcels, record the remittance) and
  refunds (mark manual payouts paid, retry, resend).
- Reconciliation report and shipping settings (couriers, bank accounts, COD limits, return
  windows).
- Returns and disputes.

### Worker

- Asks providers about open payments every 5 minutes and before expiry.
- Auto-completes delivered orders and escalates overdue returns.
- One generic order-update email (payment received, shipped, delivered, return decided, refund
  sent).

## 2. Created and modified files

114 files changed relative to Phase 4 (54 added, 60 modified). Main additions:

- **Payments:**
  - `packages/payments/` (gateway interface, mock, PayMongo, prepared adapters, tests);
  - `apps/api/src/modules/orders/payments/` (gateways, payments, reconciliation, controllers).
- **Order services** under `apps/api/src/modules/orders/`:
  - `orders.service.ts` (rewritten), `order-mapping.ts`, `order-stock.ts`, `order-notifier.service.ts`;
  - `shipments/` (couriers, waybill PDF, service), `cod/`, `refunds/`, `returns/`;
  - `fulfilment.controller.ts`.
- **Database:** `prisma/src/fulfilment.ts` and `prisma/src/payments.ts` (state machine and the
  money functions shared by the API and the worker).
- **Worker:** `jobs/payment-reconciliation.ts` and `jobs/fulfilment-sweep.ts`.
- **Shared contracts:** `packages/shared-types/src/orders.ts`, `packages/validation/src/fulfilment.ts`,
  `packages/api-client/src/fulfilment*.ts{,x}` and `packages/ui/src/patterns/fulfilment.tsx`.
- **Screens:**
  - storefront `components/orders/order-actions.tsx`, `pages/account/returns-page.tsx` and
    `pages/pay/mock-pay-page.tsx`;
  - seller `pages/orders/orders-page.tsx` (rewritten) and `returns-page.tsx`;
  - admin `pages/orders/order-actions.tsx`, `pages/finance/finance-pages.tsx` and
    `pages/fulfilment/fulfilment-pages.tsx`.
- **Tests:**
  - API `test/payments.e2e-spec.ts`, `test/fulfilment.e2e-spec.ts`, `test/order-helpers.ts`;
  - `src/modules/orders/fulfilment.spec.ts`;
  - storefront `pages/account/orders.test.tsx`;
  - admin `pages/finance/finance.test.tsx`;
  - `e2e/fulfilment.spec.ts`.
- **Docs:** ADRs 0022–0025, API reference, testing guide, roadmap and this report.

## 3. Database changes

Two migrations:

- `20261201090000_order_fulfilment_statuses`: new enum values for order, seller order and
  payment statuses and order event types.
- `20261201100000_payments_shipping_returns`: the tables and their rules.
  - **16 tables:** payments, payment_events, webhook_events, mock_payment_sessions,
    bank_transfer_proofs, shipments, shipment_events, cod_collections, cod_remittances,
    cancellation_requests, order_notes, return_requests, return_items, return_images, refunds,
    seller_ledger_entries.
  - **Integrity rules enforced in the database:**
    - CHECK constraints: amounts; refunded ≤ received; paid needs a date; a remittance equals
      what was collected or carries a note; refund parts add up;
    - partial unique indexes: one paid payment per order, one proof under review, one active
      delivery, one open cancellation request, one live refund per return and per
      cancellation, ledger entries posted once;
    - unique (source, event id) for webhooks;
    - append-only triggers on the seller ledger and payment history;
    - updated order status rules (completed, partly paid, refunded).

Both migrations apply cleanly to an empty database, and CI's drift check reports no difference
between the migrations and `schema.prisma`.

## 4. API endpoints

About 70 new endpoints, listed in [API_REFERENCE.md](../api/API_REFERENCE.md#phase-5-orders-payments-shipping-returns-and-refunds):

- customer payment, proof, cancellation, return and mock-checkout endpoints;
- three signed webhooks;
- Seller Center order, shipment, return and ledger endpoints;
- Admin Console payment, bank transfer, refund, COD, reconciliation, shipping, settings and
  dispute endpoints.

New error codes: `INVALID_TRANSITION` (409) and `PROVIDER_ERROR` (502/503).

## 5. Permissions and environment

- **New permissions:** `orders.manage`, `payments.read`, `payments.manage`, `refunds.manage`,
  `cod.manage`, `shipping.manage`, `disputes.manage`, `seller.orders.manage` and
  `seller.returns.manage`.
- **Defaults:**
  - Finance admins handle payments, refunds and COD.
  - Customer support handles orders and disputes.
  - Delivery staff handle shipments.
  - Seller managers and order processors manage orders and returns.
- **Environment (`.env.example`):**
  - `PAYMENT_PROVIDER` (`mock` locally; refused in production) and `MOCK_WEBHOOK_SECRET`;
  - for the PayMongo sandbox: `PAYMONGO_SECRET_KEY` (`sk_test_…`), `PAYMONGO_WEBHOOK_SECRET` and
    `PAYMONGO_CHECKOUT_VERSION` (`v2`), with the webhook at `<API>/api/v1/payments/webhooks/paymongo`.
  - The worker reads the same variables.

## 6. Starting the project (Windows PowerShell)

```powershell
git pull
pnpm install
.\scripts\setup.ps1          # builds and applies the two new migrations
.\scripts\dev.ps1
```

**Try it:**

1. As `customer@marketplace.local`, buy something and choose GCash. You land on the mock
   provider's test page; choose "Pay (test)". Back on the order, it is paid.
2. As the seller (e.g. `seller3.owner@marketplace.local`), open the order in the Seller Center,
   accept it, book the mock courier and print the label.
3. In the Admin Console › Shipping (or on the seller order), choose a status and press
   "Simulate courier update".
4. Once delivered, the customer can request a return.
5. For cash on delivery, record the courier's remittance in Admin Console › Cash on delivery.
6. For bank transfer, first add a receiving account in Admin Console › Shipping.

## 7. Test results

All results below come from real runs.

GitHub Actions run `45822065277`, commit `b81f822`:

| Suite                                                   | Result                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (12 packages)                                | **460 passed** (28 more than Phase 4): api 128, validation 96, worker 52, admin-portal 43, seller-portal 32, ui 28, api-client 26, storefront 19, payments 15, config 8, database 7, auth-ui 6 |
| API e2e (real PostgreSQL, Redis, S3-compatible storage) | **257 passed** in 21 suites. New: payments 7, fulfilment 6 (each covering several §11 items). All 244 Phase 1–4 tests still pass                                                               |
| Worker integration                                      | **9 passed**                                                                                                                                                                                   |
| Playwright (desktop + Pixel 7)                          | **34 passed**, 1 skipped (a mobile-only test in the desktop project). New: GCash on the mock provider → paid → seller books the mock courier → delivered → return offered                      |
| Typecheck, lint, formatting, builds                     | Passed                                                                                                                                                                                         |
| Migration drift check                                   | No difference detected                                                                                                                                                                         |
| PowerShell scripts + Docker Compose                     | Passed                                                                                                                                                                                         |

**Note on the CI history:**

- On the first attempt of this run, one Phase 2 browser test (sign up by SMS and confirm the
  email; Phase 5 did not change that code) failed once and passed on its retry. CI counts that
  as a failure, so the job was red.
- Rerunning the job turned everything green. That test also passed in the previous run
  (`45819769237`).
- It is an intermittent test, listed under §8.
- That earlier run also failed because the new Phase 5 browser test and the shopping test used
  the same demo customer's cart in parallel. Fixed: the new test uses the wholesale demo
  customer.

**Run locally as well:**

- unit 460 passed, API e2e 257 passed;
- Playwright: every test that does not need Mailpit passed on desktop and Pixel 7. Mailpit is
  not available here, so the email tests run only in CI.

§11 coverage, all with real requests against PostgreSQL
([TESTING_GUIDE.md](../testing/TESTING_GUIDE.md#phase-5-orders-payments-shipping-returns-and-refunds)):

| §11 item                        | What the tests show                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate payment webhook       | The same signed event sent 3 times concurrently and again later gives one payment, one event row and earnings posted once                               |
| Invalid webhook signature       | A tampered or unsigned event gets 401 and nothing is stored (payments and the mock courier)                                                             |
| Payment timeout                 | Expiry cancels the order. Money arriving afterwards is flagged `LATE_PAYMENT`, appears in the review queue and reconciliation, and can be refunded once |
| Failed payment                  | The declined attempt is recorded; a new attempt then pays; "pay now" twice returns the same attempt                                                     |
| Successful payment              | Mock checkout → webhook → paid. Returning from the provider without paying leaves the order unpaid                                                      |
| Refund                          | Cancelling a paid seller order refunds it automatically; the ledger nets to zero; no second refund is possible                                          |
| Partial refund                  | A goodwill partial refund costs the seller nothing; a return partial refund charges the seller proportionally; over-refunds are refused                 |
| Multiple seller suborders       | Two sellers each see only their own orders and labels; the customer sees both packages                                                                  |
| COD reconciliation              | Collected is not received; a short remittance needs a note; a duplicate reference is refused; earnings post on remittance                               |
| Shipment status updates         | Pickup converts stock; failed delivery and return restock and close COD; out-of-order events are ignored; illegal manual moves are refused              |
| Concurrent order status updates | 3 simultaneous accepts give one winner; approve vs. decline of a cancellation gives one winner; a return received twice is processed once               |

**Fixed during verification:**

- **Deadlock risk:** some paths locked the payment before the order. All order changes now lock
  the order row first.
- **Cancellation requests:** approving and declining at the same moment could both act. Approval
  now succeeds only while the request is still open.
- **COD rules:** the Phase 4 database rules did not allow partly paid or refunded orders. They
  were updated in the migration.
- **Tracking numbers:** self-arranged tracking numbers had to be unique across all sellers. They
  are now unique only for real couriers.
- **Courier pickup scans:** a courier reporting "delivered" without a pickup scan was ignored.
  Couriers may now skip steps.
- **Mobile menu:** the staff apps' mobile menu could not scroll, so links fell off-screen with
  the new menu items.
- **Reviews:** they stayed open for completed orders and closed for cancelled or returned
  packages.
- **Checkout right after sign-in (a Phase 4 bug):** checkout could be quoted before the browser
  cart was merged into the account and then showed "Nothing to check out" until reloaded. The
  quote is now refreshed after the merge. The new unit test fails on the old code and passes on
  the new.

## 8. Remaining issues and limitations

- **No real money yet.**
  - The PayMongo adapter is written and unit-tested against its documented formats. It has not
    been run against the PayMongo sandbox, because no test keys were provided. Please add
    `sk_test_` keys and a webhook secret to run it.
  - Live payments need a PayMongo merchant agreement.
  - Maya Business and Xendit adapters are not implemented (they refuse every call).
- **No real couriers.** J&T, LBC, Ninja Van, Flash and 2GO need credentials, documentation and
  agreements. The mock courier and self-arranged deliveries cover the flow until then.
- **No payouts.** Seller payables are recorded, but payouts, statements and invoices or official
  receipts are the Finance phase.
- **COD refunds wait for the remittance.** Cash refunds of COD orders are possible only after the
  remittance, as the brief requires. A return on a COD order before the courier remits must
  wait.
- **Bank transfer proofs** are checked by hand. There is no bank statement import, and uploaded
  files are not malware-scanned (as for images since Phase 3).
- **Intermittent Phase 2 browser test:** the SMS sign-up and email confirmation test failed once
  in CI and passed on retry and on the rerun. I could not reproduce it here, because it needs
  Mailpit.
- **Local test data builds up.** Repeated local browser runs reserve the demo laptop's stock and
  leave pending wholesale applications, which can make the Phase 3–4 browser tests time out on a
  long-used database. Running `pnpm db:reset` and then `.\scripts\setup.ps1` restores it; CI always starts
  fresh.

## 9. Acceptance

| Requirement (brief §)                                                                                                                                             | Status                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| §1 Parent orders, suborders, items, snapshots, history, cancellation requests, notes, tracking; validated state machine; isolation                                | Done (ADR 0023)                                                |
| §2 Provider abstraction; GCash, Maya, cards, QR Ph, bank transfer, COD; init, reference, status, verification, webhooks, failure, expiry, refunds, reconciliation | Done                                                           |
| §3 PayMongo, Xendit and Maya evaluated; sandbox when configured; mock never presented as real; split settlement not assumed                                       | Done (ADR 0022); sandbox not yet run (no keys provided)        |
| §4 Signature verification, event-id uniqueness, idempotency, logging, retry-safe, duplicate protection, reconciliation; redirect never trusted                    | Done                                                           |
| §5 Bank transfer instructions, reference, proof, queue, approval, rejection with reason, status updates                                                           | Done                                                           |
| §6 COD eligibility, expected amount, collection, confirmation, remittance, reconciliation, failed delivery, return to seller; counted only on remittance          | Done (ADR 0025)                                                |
| §7 Shipping abstraction; J&T, LBC, Ninja Van, Flash, 2GO prepared; creation, waybill, tracking, events, status, pickup, delivery, failure, return                 | Done (ADR 0024); real couriers await credentials               |
| §8 Returns with reasons and images, seller review, admin disputes, full and partial refunds, replacement, tracking; payables updated; no duplicates               | Done                                                           |
| §9 Seller dashboard with the six tabs, returns, shipment management                                                                                               | Done                                                           |
| §10 Admin order monitoring, payments, failed queue, bank verification, COD reconciliation, refunds, shipping configuration, disputes                              | Done                                                           |
| §11 Tests                                                                                                                                                         | Done (see §7)                                                  |
| §12 Payment methods, mock locally, sandbox when configured, validated statuses, isolation, reconciliation, no duplicates through retries                          | Done; the PayMongo sandbox needs test keys to be shown working |
