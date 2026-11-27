# Phase 7 report: Marketing, customer engagement and advanced marketplace features

- Branch: `phase-7-engagement` (PR #7, based on `phase-6-finance`)
- Date: 2026-11-27
- Verified on: GitHub Actions run `45950467158`, commit `369a59d` (all three jobs green, nothing flaky)
- Status: **Complete, awaiting review and approval.** Phase 8 will not start until you approve
  this phase and send its details.

Decisions applied (from the Phase 7 kick-off):

1. **Stacking: layered, best per item.** Each item gets at most one automatic promotion (flash
   sale, bundle, buy X get Y, percent or amount off), whichever saves the customer more. Then
   one seller coupon per store and one marketplace coupon. Free shipping comes from a campaign
   or a coupon, never both. Loyalty points apply last.
2. **Loyalty: earn on completion.** 1 point per ₱100 paid, credited when the order completes
   (after the return window). 1 point = ₱1 at checkout, up to 20% of the order. Points expire
   after 12 months; refunds reverse them proportionally. Everything is configurable.
3. **Affiliates: track and accrue in the ledger.** Customer referrals reward both people with
   points on the friend's first completed order. Approved affiliates earn a configurable
   commission, recorded per seller order and accrued in the double-entry ledger when it
   completes. Payouts are manual and recorded.
4. **Support: order tickets to the seller.** Support staff can read, join or take over any
   ticket; general inquiries go straight to marketplace support.

## 1. Implemented features

### Coupons (§1)

The Phase 4 coupons (fixed, percentage, free shipping; seller and marketplace; minimum spend,
maximum discount, usage and per-customer limits, dates) gain:

- **Product and category restrictions.** Categories include their subcategories. The discount
  and the minimum spend count only the covered items. Sellers can only pick their own products.
- **First-order coupons:** only for customers with no earlier order that was not cancelled.

### Promotion engine (§2, ADR 0030)

- **Campaigns** are automatic deals (no code). Types:
  - percent off;
  - amount off each item;
  - **bundle** (X% off once N eligible items from one store are in the order);
  - **buy X, get Y** (Buy 1 Take 1 = buy 1, get 1 at 100% off);
  - **free shipping** (with a minimum spend and an optional cap).
- **Scope:** marketplace-wide campaigns are marketplace-funded; seller campaigns are
  seller-funded and limited to their own products.
- **Seasonal labels** (e.g. "11.11"), schedules, pause, priority for ties, and usage stats.
- **Flash sales** (Phase 4) take part in the same "best deal per item" choice. A campaign that
  beats a flash price is applied to the regular price, and no flash-sale unit is used.
- **Stacking** is computed only by the server: in the quote and again when the order is
  placed. What was applied is stored on order items and in `order_promotions`.
- The **storefront** shows running deals on the home page and the promotions in the checkout
  summary.

### Loyalty (§3, ADR 0031)

- **Accounts and history.** Each customer has a points account. Every change is a row in the
  append-only points ledger: earned, used, given back, taken back, expired, adjusted, referral
  bonus. Each row has the balance after it and the order, refund, referral or staff member it
  came from.
- **Earning** happens when a seller order completes.
- **Redeeming:** the customer picks how many points to use at checkout; the cap is enforced by
  the server.
- **Cancellation and refunds:** cancelling gives every spent point back. A refund gives back
  the refunded items' share of the spent points and takes back earned points in proportion.
- **Expiry** is first-in, first-out, run daily by the worker.
- **Configuration and adjustments:** staff edit the rules and adjust points (with a reason).
- **Ledger postings:**
  - earned points: Dr 5050 Loyalty expense, Cr 2410 Points liability;
  - expiry and reversals: the opposite;
  - points used on a sale: Dr 2410 in the sale journal.

### Reviews (§4) and seller ratings (§5)

- **Reviews:**
  - **Photos:** up to 5 per review, re-encoded and shown only while the review is published.
  - **Verified purchase:** shown once the item was delivered.
  - **Seller replies** to reviews of their own products.
  - **Reports:** customers report inappropriate reviews (once each, never their own). Staff
    uphold (the review is hidden) or dismiss.
  - **One review per purchased item** (unique; a second attempt is refused with 409).
- **Seller ratings:**
  - Customers rate product quality, shipping and communication once per **delivered** seller
    order; the overall rating is their average.
  - Store and seller summaries come only from those verified orders.

### Referrals and affiliates (§6, ADR 0032)

- **Referrals:** referral codes and links, an optional code at sign-up, tracking per friend, and
  bonuses on the friend's first completed order.
- **Affiliate accounts:**
  - customers apply; staff approve, suspend or reject and can set an own commission rate;
  - the default rate is configurable;
  - links use `?aff=CODE`; clicks are recorded with no raw IP address.
- **Attribution:** at checkout, never to the affiliate's own orders.
- **Conversion records:** base, rate and commission are frozen in the database. They are
  accrued in the ledger (5060 / 2420) on completion, and refunds reverse commission.
- **Payouts:** recorded manually, with a minimum (2420 / 1010).
- **Reports:** monthly reports for affiliates and staff.

### Notifications (§7, ADR 0033)

- **Events are written in the same database transaction as the change** (outbox):
  - customer registration;
  - order confirmation;
  - payment confirmation;
  - shipment;
  - delivery;
  - refund approval;
  - seller payout;
  - low inventory;
  - new order for sellers;
  - points earned;
  - support updates;
  - review replies;
  - other order updates.
- **The worker processes them in the background:** a job kicked by the API plus a sweep every
  10 seconds. It delivers in-app (inbox and bell with unread count), email (Mailpit locally),
  SMS (mock provider until credentials) and push (subscriptions stored; mock provider until
  VAPID keys).
- **Delivery log:** every channel outcome is logged with masked destinations. Nothing is sent
  twice, and failures are retried.
- **Templates** per event and channel with `{{variables}}` are editable in the Admin Console.
  Events with a built-in order email keep it.
- **Preferences:** customers can turn email, SMS and push off.

### Customer support (§8, ADR 0034)

- **Routing:** tickets about an order go to that store; general inquiries go to marketplace
  support.
- **Seller teams** answer their own tickets and can add internal notes.
- **Staff** see everything and can join, take over (customer replies then go to support),
  assign, set priority, resolve, close or reopen.
- **Conversation:** statuses show who must act next. The history is append-only.
- **Attachments:** up to 5 images or PDFs per message, private.
- **Access:** every request is scoped (404 outside your tickets), and staff actions are
  audited.

### Analytics and dashboards (§9, §10, ADR 0035)

- **Admin reports:**
  - sales (GMV, net merchandise sales, platform revenue from the ledger, commissions, orders,
    AOV, customers, refund rate, payment success rate);
  - products, categories, sellers (with refund rate and seller rating), customers, payments by
    method, and refunds by reason.
- **Seller reports:** sales, orders, products, inventory (stock levels and movements), customer
  ratings, commission deductions and settlements.
- **Filters:** from/to dates and day, week, month or year periods, computed from live data.
- **Exports:** CSV, Excel (.xlsx) and PDF.
- **Dashboards:** KPI cards, a line chart with hover details (one measure at a time), and tables
  in both the Admin Console (Analytics) and the Seller Center (Reports).

## 2. Created and modified files

- **New:**
  - **Database:** migration `20261220090000_engagement`; `prisma/src/engagement.ts` (loyalty,
    referrals, affiliates, outbox, lifecycle hooks).
  - **API modules:** `engagement`, `support`, `analytics`; in `promotions`, `campaigns.service.ts`
    and `promotion-targets.ts`; `checkout/promotion-engine.ts`.
  - **Worker:** `notifications/*` (dispatcher, push provider) and `jobs/loyalty-expiry.ts`.
  - **Shared code:** `shared-types/engagement.ts`, `validation/engagement.ts`,
    `api-client/engagement*.ts(x)`; in `ui`, `patterns/report-view.tsx`; in `auth-ui`,
    `campaigns.tsx`, `promotion-targets.tsx`, `reports.tsx` and `support.tsx`.
  - **Pages:** `engagement-pages.tsx` in all three apps, and storefront components (campaign
    strip, review extras, seller rating form, affiliate links).
  - **Tests:** `engagement.e2e-spec.ts`, `promotion-engine.spec.ts`, `analytics.spec.ts`,
    `prisma/src/engagement.spec.ts`, `worker notifications.spec.ts`, admin
    `engagement.test.tsx`, Playwright `engagement.spec.ts`, and worker integration additions.
  - **Docs:** ADRs 0030–0035.
- **Modified:**
  - **Checkout pricing and order creation:** promotions, points and affiliates.
  - **Ledger:** the sale posting debits the points liability.
  - **Fulfilment:** the lifecycle hook.
  - **Payments, refunds, payouts, inventory and auth:** they now emit notification events.
  - **Reviews:** photos, replies, reports and ratings.
  - **Coupons:** restrictions and first-order coupons.
  - **Permissions:** the new keys listed in §5.
  - **Screens:** coupons, reviews, checkout, the order page, the layout, sign-up and the home
    page.
  - **Docs:** the API reference, the testing guide and the roadmap.

## 3. Database changes

- **New tables:**
  - **Coupons and campaigns:** `coupon_products`, `coupon_categories`, `campaigns`,
    `campaign_products`, `campaign_categories`, `order_promotions`.
  - **Loyalty, referrals and affiliates:** `loyalty_accounts`, `loyalty_transactions`,
    `referrals`, `affiliate_accounts`, `affiliate_clicks`, `affiliate_conversions`,
    `affiliate_payouts`.
  - **Reviews and ratings:** `review_images`, `review_reports`, `seller_ratings`.
  - **Notifications:** `notification_templates`, `notification_events`, `notifications`,
    `notification_deliveries`, `notification_preferences`, `push_subscriptions`.
  - **Support:** `support_tickets`, `support_messages`, `support_attachments`.
- **New columns:**
  - `users.referral_code`;
  - `coupons.applies_to` and `first_order_only`;
  - orders, seller orders and order items: `promotion_discount`, `points_discount` and points
    redeemed; `campaign_id` on items; the affiliate on orders;
  - reviews: seller reply and `open_reports`.
- **Rules in the database:**
  - append-only triggers on the points ledger, support messages and affiliate payouts;
  - frozen affiliate conversion amounts;
  - the order item snapshot now includes the promotion and points;
  - the order total check includes promotions and points;
  - balances can never go negative;
  - rating scores are limited to 1–5.
- **Seeded data:**
  - ledger accounts 2410, 2420, 5050 and 5060;
  - default notification templates.
- **Checks:** the migration was verified on an empty database (all migrations in order) and
  against `schema.prisma` by CI's `prisma migrate diff`.

## 4. API endpoints

See `docs/api/API_REFERENCE.md` › Phase 7.

## 5. Permissions and environment

- **New platform permissions:** `loyalty.manage`, `affiliates.manage`, `support.read`,
  `support.manage`, `notifications.manage`, `reports.read`.
  - Admins get all of them.
  - Finance admins get `affiliates.manage` and `reports.read`.
  - Customer support gets `support.*`.
- **New seller permissions:**
  - `seller.reviews.reply`: owner and manager.
  - `seller.support.manage`: owner, manager and order processor.
  - `seller.reports.read`: owner, manager and accounting.
- **Environment:** `SELLER_PORTAL_URL` and `ADMIN_PORTAL_URL` let the worker link
  notifications to the right app (defaults are the local ports). No new secrets: SMS stays on
  the mock provider and push on the mock push provider until credentials are supplied.

## 6. Starting the project (Windows PowerShell)

```powershell
git pull
pnpm install
.\scripts\setup.ps1          # applies the migration and syncs the new permissions
.\scripts\dev.ps1
```

**Try it:**

1. **Create a campaign.** In the Admin Console › Campaigns, create a "Buy 1, take 1" campaign
   on a product. Add two of that product to the cart: the checkout summary shows the promotion.
2. **Use points.** As staff, give a customer points (Loyalty points › select the customer ›
   Adjust points). At checkout they can use up to 20% of the items in points.
3. **Earn points.** Complete an order (or move it to Completed as staff). The customer's
   Rewards page shows the earned points, and the inbox (bell) shows "You earned … points".
4. **Check notifications.** Sign up a new customer: the welcome email is in Mailpit
   (http://localhost:8025) and in their inbox. The admin Notifications page shows each
   delivery.
5. **Ask support.** From an order, use "Ask … a question": the seller answers in Seller Center ›
   Customer questions; staff can take over from Admin › Support tickets.
6. **Look at the reports.** Open Admin › Analytics and Seller Center › Reports; change the
   period and download CSV, Excel or PDF.

## 7. Test results

All of these were executed. Earlier tests changed only where behaviour changed on purpose: the
seller manager's permission list gained the three new seller permissions, and the first Admin
Console sales test waits up to 5 seconds for its first render (route modules load on a cold CI
runner).

| Suite                                   | Result (CI run `45950467158`)                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, format                 | Pass                                                                                                                                                    |
| Unit tests (all packages and apps)      | 511 passed (new: promotion engine, report ranges and exports, loyalty rules, notification templates, analytics screen)                                  |
| API e2e                                 | 290 passed in 23 suites (new `engagement.e2e-spec.ts`: 18)                                                                                              |
| Worker integration                      | 11 passed (new: outbox delivery on all four channels; opted-out channel skipped; never delivered twice)                                                 |
| Playwright                              | 37 passed, 1 skipped, no flaky tests (new: welcome notification via the worker and Mailpit, support conversation, analytics, campaigns, seller reports) |
| Migration drift (`prisma migrate diff`) | Clean                                                                                                                                                   |
| PowerShell scripts                      | Pass                                                                                                                                                    |

How each §11 requirement is proven is listed in `docs/testing/TESTING_GUIDE.md` › Phase 7.

## 8. Assumptions

- **Marketplace-funded discounts:** points and marketplace campaigns are recorded like
  marketplace vouchers. The seller is credited the full price; only seller campaigns and coupons
  lower the seller's commission base.
- **Breakage:** expired points reduce the loyalty expense.
- **Partial refunds:** a refund that also covers shipping gives back points only for the items
  part.
- **Reversal shortfall:** a customer who already spent points that a refund takes back keeps
  the shortfall; it is never charged.
- **Affiliate commission base:** what the customer paid for the items after all discounts.
  Shipping and charges are excluded. Commission accrues only on completion.
- **Report dates:** Philippine time. Sales count orders by their placed date; refunds count by
  their success date.

## 9. Remaining issues and limitations

- **SMS and push are mock providers.** Real Semaphore credentials and VAPID keys plus a Web
  Push sender are needed for live delivery. The storefront stores subscriptions only once a
  service worker asks for them; the service worker is not part of this phase.
- **Affiliate link window:** the storefront remembers a code for 30 days, matching the default
  setting. The setting itself is enforced only through approval and status, not per click.
- **PDF reports** list at most 1,000 rows. CSV and Excel have everything returned by the
  report.
- **Template changes** affect only events delivered after the change.
- **Local runs without Mailpit:** `E2E_NO_MAILPIT=1` skips only the email check in the browser
  test.

## 10. Acceptance

| Criterion                                          | Status                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| All promotional rules correctly applied            | Server-side engine with unit and API tests for every type, conflict and stacking rule |
| Notifications processed through background workers | Outbox events delivered only by the worker (integration and browser tests)            |
| Loyalty transactions traceable                     | Append-only ledger with sources and journals                                          |
| Analytics reflect actual transactions              | Live queries; API test compares the report with the database                          |
| Existing modules remain operational                | Full earlier suites rerun (§7)                                                        |
