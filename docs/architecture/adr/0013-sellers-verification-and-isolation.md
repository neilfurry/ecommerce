# ADR 0013: Seller accounts, verification and data isolation

- Status: Accepted
- Date: 2026-11-26

## Context

Phase 2 adds sellers: businesses that apply, are verified by the marketplace, run stores and
employ staff. The master instructions require that a seller can only ever see and change its own
data, that verification documents are never publicly reachable, and that sensitive admin actions
are audited.

## Decision

- **Sellers apply themselves.** `POST /auth/sellers/sign-up` (Seller Center only) creates the
  owner account with the `SELLER_OWNER` role, a `PENDING` seller and an active membership in one
  transaction. Marketplace staff remain admin-invited only.
- **Membership, not roles alone, makes someone part of a seller.** `seller_members` links a user
  to exactly one seller (`user_id` is unique). A seller role counts only while the person has an
  `ACTIVE` membership of a seller that is not `CLOSED`; without one, the Seller Center refuses the
  sign-in.
- **Permissions have a scope.** Every permission is `platform` or `seller`, and a role only
  contributes permissions of its own scope (a seller role can never be given `users.read`, and
  the roles API rejects it with 400). Owners and managers can give an employee extra seller
  permissions on top of their roles, never more than they hold themselves. `SUPER_ADMIN` and
  `SELLER_OWNER` are locked to every permission of their scope.
- **Isolation is enforced by queries, not by permissions.** The principal carries
  `seller.id`; seller endpoints read it through `sellerScope(user)` and put it in every `where`
  clause. Records of another seller are therefore indistinguishable from records that do not
  exist (404), which also avoids revealing ids. Tests cover reading, changing and deleting
  another seller's stores, documents and employees.
- **Verification is an explicit state machine:** `PENDING → UNDER_REVIEW → VERIFIED | REJECTED`,
  `UNDER_REVIEW → PENDING` (more information requested), `VERIFIED ⇄ SUSPENDED`, any → `CLOSED`.
  Each transition is a compare-and-set update (two reviewers cannot both decide), writes a
  `seller_events` history row and an audit entry, invalidates the members' cached principals and
  emails the owner. Rejection and information requests require a note. Submission is refused
  (422) until the email is confirmed and the address, registration number, TIN and required
  documents are present. Legal details lock once submitted.
- **Documents are private files.** They are stored in the private bucket with purpose
  `SELLER_DOCUMENT` and are only streamed by the API after the scope or permission check, with
  `Cache-Control: private, no-store` and an attachment disposition. There is no presigned or public
  URL. Each staff view is audited (`seller.document_viewed`). Store logos and banners are the
  only public seller files, served through `/stores/{id}/logo|banner`.
- **Stores** belong to a verified seller (at most 5). Slugs are permanent and unique. Shoppers
  see only `ACTIVE` stores of `VERIFIED` sellers. Suspending or closing a seller therefore hides
  every store without changing each store's own status. `custom_domain` exists on the table but
  is not settable until a later phase.
- **Employees** join by emailed invitation (SHA-256 hash stored, 7 days, a new invitation
  replaces the open one). People without an account create one; people with an account confirm
  their password. Marketplace staff and people already in another seller are refused. Owners
  assign any seller role except owner; managers assign roles below manager. Nobody manages the
  owner or themselves. Suspending or removing an employee ends their Seller Center sessions.

## Consequences

- Later phases (products, orders, payouts) reuse `sellerScope(user)` on every seller query and
  add seller-scope permissions to the catalog.
- A person can belong to one seller at a time; supporting several would need a seller switcher
  and a `sellerId` in the session.
