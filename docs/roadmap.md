# Delivery roadmap

Approved on 2026-11-24. Each phase ends with a report in [docs/phases](phases/), and the next
phase starts only after the report is reviewed and approved.

| #   | Phase                                   | Main deliverables                                                                                                 | Status        |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Foundation                              | Monorepo, Docker Compose, config validation, Prisma, health checks, Swagger, logging, rate limiting, app shells, tests, scripts, docs, CI | **In review** |
| 2   | Identity and access                     | Users, Argon2 hashing, access/refresh token rotation (HTTP-only cookies), configurable RBAC for all 14 roles, CSRF, audit log, sign-in in all apps | Planned |
| 3   | Sellers and stores                      | Seller onboarding and KYC status, admin approval, stores, seller staff, ownership guards                           | Planned       |
| 4   | Catalog and inventory                   | Categories, products, variants/SKUs, image upload, retail/wholesale/tier pricing, MOQ, stock ledger, reservations, search | Planned |
| 5   | Cart and multi-seller checkout          | Cart, wholesale approval, customer-specific pricing, parent order with seller suborders, snapshots, idempotent checkout | Planned |
| 6   | Payments                                | Provider adapters (GCash, Maya, cards, QR Ph, bank transfer, COD) with mocks, signed webhooks, reconciliation      | Planned       |
| 7   | Fulfillment and shipping                | Suborder status machine, shipping adapters, warehouse/delivery flows, cancellations, returns                      | Planned       |
| 8   | Finance                                 | Configurable commissions, double-entry ledger, seller payables, refund adjustments, settlements, payouts           | Planned       |
| 9   | Marketing, notifications, reporting     | Vouchers and promotions, email/SMS adapters through BullMQ, live dashboards and reports                            | Planned       |
| 10  | Hardening and release                   | Full Playwright suites, performance indexes, production images, backups, security review, deployment docs          | Planned       |
