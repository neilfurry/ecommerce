# Admin Console guide

For marketplace staff: administrators, finance, customer support, warehouse and delivery staff. The
Admin Console is at `https://admin.<your-domain>`. What you see depends on your role; menu
items you have no permission for are hidden and the server refuses those actions anyway.

## 1. Signing in

1. Sign in with your work e-mail and password (your administrator sends an invitation; the
   link lets you choose a password).
2. **Two-step verification is required.** On first sign-in the console shows only _Turn on
   two-step verification_: scan the QR code with an authenticator app (Google Authenticator,
   Microsoft Authenticator, 1Password…), enter the 6-digit code, and **store the recovery
   codes** somewhere safe. From then on every sign-in asks for a code.
3. Lost your phone? Use a recovery code, or ask a super admin to reset your two-step
   verification (Users › your account › _Reset two-step verification_).
4. Sessions last 12 hours. _Account menu › Sign out everywhere_ ends all your sessions.

Five failed passwords lock the account for 15 minutes.

## 2. First day (super admin)

| Where                    | What                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Users                    | Invite each staff member with the least role they need: _Admin_, _Finance admin_, _Customer support_, _Warehouse staff_, _Delivery staff_ (only a super admin can create admins) (Roles and Permissions show what each role can do). |
| Settings                 | Return window (days), bank transfer accounts shown to customers, shipping rate table (base fee per route, per extra kg, express multiplier, same-day fee), order and payment deadlines.                                              |
| Commission               | Default rate and rules per category or seller.                                                                                                                                                                                       |
| Taxes / Finance settings | VAT and withholding rules, settlement schedule and hold days, minimum payout, who bears payment fees, invoice issuer details.                                                                                                        |
| Categories, Brands       | The catalogue tree and attributes sellers fill in.                                                                                                                                                                                   |
| Storefront content       | Home page banners and featured items.                                                                                                                                                                                                |
| Notifications            | E-mail/SMS templates for each event.                                                                                                                                                                                                 |

## 3. Daily work

### Sellers (Sellers, Stores)

- _Sellers_ lists applications. Open one to see the business details and documents (DTI/SEC/
  CDA certificate, BIR 2303, owner's ID). **Approve**, **Request information** (with a note
  the seller sees), or **Reject**. Approved sellers can open stores and list products.
- Suspend a seller or a store to stop sales at once (existing orders continue); reinstate
  later. Every decision is in the _Audit log_.

### Products (Products, Inventory)

- The review queue shows products waiting for approval. Check name, category, attributes,
  photos and price, then **Approve** or **Reject** with a reason. Edits to approved content go
  back to review.
- _Take down_ removes a live product that breaks the rules.

### Orders (Orders, Shipping)

- Search by order number, customer or seller. An order shows one _seller order_ per store,
  each with its items, payment, shipment and history.
- Staff can cancel (with a reason) and add notes (staff-only or visible to the seller/customer).
- Shipping: courier status updates come from the courier or the seller's tracking entries.

### Returns and disputes

- Customers request returns within the return window; the seller approves or refuses first.
- When the customer **escalates** a refusal, it appears in _Returns and disputes_. Open it,
  read both sides and the photos, then choose the **Decision** (full refund, partial refund,
  replacement, rejected), whether the item must come back first, and a note (shown to both),
  and _Record decision_. A refund decision creates the refund automatically.

### Customer support (Support tickets)

- Order tickets go to the seller first; support can read, reply and take over. General
  questions come to support directly. Status, internal notes and attachments are kept per ticket.

### Reviews

- Reported reviews wait in _Reviews_: keep or hide them. Hidden reviews disappear from the
  storefront and the seller's rating is recalculated.

## 4. Finance

| Page                                             | Use                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payments                                         | Every payment attempt; the _review_ queue holds late or duplicate payments for a decision (refund or keep). _Provider events_ lists PayMongo webhooks; failed ones can be **re-processed** safely.                                                                           |
| Bank transfers                                   | Verify customers' transfer proofs against the bank statement; approve or reject.                                                                                                                                                                                             |
| Cash on delivery                                 | Record courier remittances against collected parcels (shortages are flagged).                                                                                                                                                                                                |
| Refunds                                          | Create (full or partial), track, mark manual refunds as paid, retry failed ones. Concurrent or repeated requests never refund more than was paid.                                                                                                                            |
| Payment reconciliation / Ledger › Reconciliation | All checks must be green: journals balance, every payment, sale and refund posted, COD and payouts match, stock holds match reservations, refunds within payments, no order paid twice, order totals add up. A red check lists the records to investigate.                   |
| Seller balances, Settlements                     | Pending vs available balance per seller; settlements run on schedule (or _Settle last period now_); each has a statement and documents.                                                                                                                                      |
| Payouts                                          | Sellers request payouts to a verified bank account; **Approve** (or reject with a reason), then _Mark as paid_ with the transfer reference (or send through PayMongo when configured). Bank accounts and BIR tax profiles must be verified first (Seller balances › seller). |
| Taxes, Invoices to sellers, Expenses, Reports    | VAT and withholding, commission invoices, expense records, financial reports and exports (Excel, CSV, PDF).                                                                                                                                                                  |

## 5. Analytics

_Analytics_ shows sales, orders, conversion, refunds, top products and sellers for any date
range by day, week, month or year, with exports to Excel, CSV and PDF. Figures are live from
the database.

## 6. Security reminders

- Never share your account or recovery codes; staff accounts are personal.
- Payment card details never appear in the console; if anyone asks you for them, report it.
- Use _Users › Suspend_ immediately when someone leaves; their sessions end at once.
- Every sensitive action (approvals, refunds, payouts, role changes, bank account reviews) is
  recorded in the _Audit log_ with who, when and from where.
