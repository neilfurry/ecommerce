# ADR 0008: Background jobs, retries and dead letters

- Status: Accepted
- Date: 2026-11-24

## Context

Email, notifications, image processing, reports, payment webhooks and order processing must not
block HTTP requests, must survive restarts, and must never be lost silently. Payment events in
particular must eventually be processed exactly once in effect.

## Decision

- **BullMQ on Redis**, with one queue per domain: `email`, `notifications`, `image-processing`,
  `reports`, `payment-events`, `order-processing`, plus `system` for platform housekeeping.
- **One registry** (`packages/config/src/queues.ts`) defines each queue's attempts, first backoff
  delay and concurrency. The API (producers) and worker (consumers) both register queues from it,
  so every job gets the same policy wherever it is enqueued.
- **Exponential backoff** for every processed queue. Completed jobs are kept 24 h, failed jobs
  7 days.
- **Dead-letter queue.** When a job fails its last attempt, or throws `UnrecoverableError`, the
  worker copies it (source queue, job id, name, payload, error, attempts) to `dead-letter`, using
  a deterministic job id so recording twice is harmless. Dead letters are never processed
  automatically; admins retry or discard them.
- **Handler routing.** One processor per queue routes jobs by name (`<queue>.<action>`) to
  `JobHandler`s. Unknown names fail with `UnrecoverableError`, so nothing waits forever.
- **Idempotency is the handler's job.** Handlers must tolerate running more than once.
  Payment-event handlers will key on the provider's event id (Phase 6).
- **Heartbeat via BullMQ's job scheduler**, not a timer, so `/health` proves the full pipeline.

## Consequences

- One Redis serves rate limiting, heartbeats and queues. Redis runs with `noeviction` and AOF
  persistence so jobs are not dropped.
- A dedicated admin page for dead letters (beyond the development tools) and alerting on the
  dead-letter count are planned for Phase 9/10.
