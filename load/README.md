# Load tests

[k6](https://k6.io) scenarios against the **production images** started with Docker Compose,
with synthetic data. CI runs them on every pull request (`load-test` job in
`.github/workflows/ci.yml`); results are uploaded as the `load-test-results` artifact and
printed in the job log. The latest results and their interpretation are in
[docs/production/LOAD_TEST_REPORT.md](../docs/production/LOAD_TEST_REPORT.md).

## What runs

`load/run.sh` (Linux/WSL bash, needs Docker and k6):

1. **Synthetic data** (`prisma/load-test-data.ts`, refused in production): 40 verified sellers,
   each with a store and a stocked warehouse in a real barangay (Quezon City, Cebu, Davao,
   Makati, Iloilo), 125 active products per seller (5,000 products) with varied names, prices
   and weights, 60 customers with default addresses, and one product with only 25 units for
   the contention test.
2. **k6** (`load/k6/marketplace.js`), one scenario after another, each measured alone:

   | Scenario          | Load                             | What it does                                                                    |
   | ----------------- | -------------------------------- | ------------------------------------------------------------------------------- |
   | `browse`          | ramp to 50 virtual users, 2 min  | home page, categories, listing pages (think time 1–3 s)                         |
   | `search`          | 40 searches/s, 2 min             | full-text product search + suggestions                                          |
   | `product_details` | 60/s, 2 min                      | product page + reviews                                                          |
   | `cart`            | 20/s, 2 min                      | guest cart pricing; signed-in add, change, remove                               |
   | `checkout`        | 8 orders/s, 2 min                | quote + cash-on-delivery order (stock reserved)                                 |
   | `contention`      | 200 attempts by 50 users at once | everyone buys the 25-unit product                                               |
   | `webhook_burst`   | 50 connections                   | signed provider events for 60 online payments: 3 distinct events + 1 retry each |

   Setup signs in 10 customers (the per-address sign-in limit of 10/minute stays on) and
   creates the 60 online-payment orders for the burst.

3. **Resource sampling** every 5 s (`docker stats`): CPU and memory per container.
4. **Integrity checks** (`load/verify.sql`): the contended product sold exactly its stock;
   no stock level over-reserved; reserved = active reservations; every paid payment received
   once with one PAID event; no order paid twice; receipts in the ledger; journals balance;
   one order per idempotency key; order totals add up. Any failure fails the job.
5. **Database analysis** (`load/analysis.sql`): top statements by total and mean time
   (`pg_stat_statements`), sequential scans, cache hit ratio, deadlocks, notification outbox
   latency (background jobs), orders placed.

## Differences from production

`docker/production/compose.loadtest.yml`: mock payment provider (k6 signs the webhooks), mock
shipping and SMS, a raised **global** per-IP limit (all k6 traffic comes from one address;
per-route limits stay), one-hour access tokens. Everything else — images, Caddy with TLS,
two API replicas, PostgreSQL settings, Redis — is the production configuration.

## Running it yourself

On a Linux machine or WSL (not PowerShell) with Docker and k6, from the repository root:

```bash
cd docker/production
./ci/make-env.sh > .env.production && ./ci/certs.sh
echo "127.0.0.1 shop.marketplace.test api.marketplace.test" | sudo tee -a /etc/hosts
# build the five images as in ci.yml (docker build -f docker/production/Dockerfile --target api -t local/api:ci ../..)
DC="docker compose -f compose.yml -f compose.ci.yml -f compose.loadtest.yml --env-file .env.production --profile storage"
$DC up -d --wait postgres redis minio minio-backup mailpit && $DC run --rm buckets
$DC run --rm migrate && $DC run --rm migrate pnpm db:seed
$DC up -d --wait edge api worker prometheus postgres-exporter redis-exporter
cd ../../load && ./run.sh
```

`SCALE=2 ./run.sh` doubles every rate. Never point it at production.
