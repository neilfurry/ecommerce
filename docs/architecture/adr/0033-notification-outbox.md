# ADR 0033: Notification outbox, templates and channels

- Status: Accepted
- Date: 2026-11-27

## Context

In-app, email, SMS and push notifications with configurable templates; "events should trigger
background jobs"; Mailpit locally and mock SMS until credentials exist. Earlier phases send
transactional emails through BullMQ jobs from the API after commits.

## Decision

- **Outbox:** `notification_events` rows are written in the same transaction as the change
  (order placed, payment confirmed, shipped, delivered, refund, payout, low stock, registration,
  points earned, support updates, review replies, other order updates). Nothing is lost if the
  API crashes after commit.
- **Worker:** `notifications.dispatch` (kicked by the API after commits) and a sweep every 10
  seconds lock a pending event (`FOR UPDATE SKIP LOCKED`), render each channel's template for
  each recipient and deliver: in-app (`notifications` inbox), email (shared layout, Mailpit
  locally), SMS (mock provider until Semaphore credentials), push (`push_subscriptions` through
  a mock provider until VAPID keys). Every outcome is logged in `notification_deliveries` with
  masked destinations; a channel already sent is never sent again; failures retry (5 attempts).
- **Templates:** `notification_templates` per event and channel with `{{variables}}` (unknown
  variables are refused), editable by `notifications.manage`. Events that already have a
  built-in transactional email with order details (order placed, new seller order, low stock,
  other order updates) keep it; their other channels use templates. The duplicate "payment
  received", "shipped", "delivered" and "refund sent" emails were replaced by the new events.
- **Preferences:** users can turn email, SMS and push off; the inbox is always on.

## Consequences

Notifications are processed only by background workers, are auditable per channel, and a
real SMS or push provider is a provider swap.
