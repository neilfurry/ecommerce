# Load test report

How the test runs: [load/README.md](../../load/README.md). In short, k6 runs against the
**production images** and configuration started with Docker Compose:

- Caddy with TLS, two API replicas and one worker;
- PostgreSQL 17 and Redis 7 with the production settings;
- synthetic data: 40 verified sellers, 5,000 active products, 60 customers, and one product
  with only 25 units for the contention test.

The deliberate differences from production are the mock payment provider (so k6 can sign
webhooks), mock shipping and SMS, and a raised global per-address limit (all k6 traffic comes
from one address).

**Hardware:** one GitHub Actions runner with 4 vCPU and 15 GiB RAM. Everything runs on that
one machine: k6, the edge, both API replicas, the worker, PostgreSQL, Redis, MinIO, Mailpit
and Prometheus.

**What this does and does not show:** the system met every threshold at the load levels below
on that machine. It **does not** establish a supported traffic level for a production server.
Higher levels (`SCALE=2` and beyond) were not run. Before launch, repeat the test on the
production-sized server with `SCALE` raised until a threshold fails; that run gives the
capacity figure.

## Thresholds

Each scenario must keep p95 under 2 s and fewer than 1% of requests may fail (excluding the
expected 409/422 answers when stock runs out). After the load, every integrity check must pass
(`load/verify.sql`).

## Results

CI run 46038506928, commit `a921376`. This is the first run after the fixes below. All
thresholds passed.

| Scenario        | Offered load                          | Requests | Req/s in window | p50 ms | p95 ms | p99 ms | Max ms | Errors |
| --------------- | ------------------------------------- | -------: | --------------: | -----: | -----: | -----: | -----: | -----: |
| browse          | ramp to 50 users, 2 min (think time)  |    7,623 |            63.5 |     38 |    153 |    264 |    645 |     0% |
| search          | 40 searches/s + suggestions, 2 min    |    9,602 |            80.0 |     22 |     38 |     89 |    322 |     0% |
| product_details | 60 products/s + reviews, 2 min        |   14,402 |           120.0 |      5 |      8 |     16 |    241 |     0% |
| cart            | 20 iterations/s, 2 min                |    9,604 |            80.0 |      7 |     35 |    151 |    382 |     0% |
| checkout        | 8 orders/s (quote + COD order), 2 min |    1,922 |            16.0 |     29 |     63 |    186 |    427 |     0% |
| contention      | 200 attempts, 50 users at once        |      400 |          ≥ 6.7¹ |    301 |    937 |  1,092 |  1,143 |     0% |
| webhook_burst   | 60 payments × 4 events, 50 conns      |      240 |          ≥ 4.0¹ |    351 |    738 |    776 |    785 |     0% |

¹ These scenarios finish before their one-minute window ends, so the rate is a lower bound.

Outcomes:

- **Orders:** 961 orders were placed in the checkout scenario (986 COD and 60 GCash in total,
  including setup and contention).
- **Contention:** 25 orders succeeded for the 25 units, and the other 175 attempts were
  correctly refused.
- **Webhooks:** 180 applied and 60 duplicates recognised. Every payment was received once.

The final verification run (CI run 46043489394, commit `e012465`) repeated the test with
the same outcome. All thresholds passed and every integrity check passed.

| Scenario | browse | search | product_details | cart | checkout | contention | webhook_burst |
| -------- | -----: | -----: | --------------: | ---: | -------: | ---------: | ------------: |
| p95 ms   |    159 |     47 |               9 |   12 |       49 |      1,168 |           765 |
| Errors   |     0% |     0% |              0% |   0% |       0% |         0% |            0% |

In that run, notifications reached users p95 0.62 s after commit (2,210 events, none left
pending).

### Integrity after the load (all passed)

- The contended product sold exactly its stock (25 ordered, never more).
- No stock level reserves more than it holds, and reserved stock equals the active
  reservations.
- Each paid payment received its amount once and has exactly one PAID event, and no order was
  paid twice.
- Every received online payment is in the ledger, and every posted journal balances.
- There is one order per idempotency key, and order totals equal their seller orders.

### Resources (peak over the run, from `docker stats` every 5 s)

| Container     | Peak CPU (100% = one core) | Peak memory |
| ------------- | -------------------------: | ----------: |
| PostgreSQL    |                       227% |     453 MiB |
| API replica 1 |                        84% |     333 MiB |
| API replica 2 |                        76% |     328 MiB |
| Worker        |                        27% |     230 MiB |
| Edge (Caddy)  |                        14% |      38 MiB |
| Redis         |                         7% |      10 MiB |

PostgreSQL measurements:

- 0 deadlocks;
- cache hit ratio 100%;
- no temporary files;
- 235 rolled-back transactions (the refused contention attempts and the expected conflicts).

### Background jobs

- **Notifications:** 2,212 notification events were written and all were delivered. The time
  from commit to delivery was p50 0.03 s, p95 0.63 s and max 1.16 s.
- **Order emails:** 1,046 order-placed and 1,046 new-order emails, plus 60 order updates,
  were sent with no failures and no dead-lettered jobs.

## Bottlenecks found and fixed

The first complete run (CI run 46034938822, commit `e21e4e9`) **failed** the search threshold
and showed slow background processing. Both are fixed ([AUDIT_REPORT.md](AUDIT_REPORT.md)
V2, V3):

| Measure                                          | Before (run 46034938822)                          | After (run 46038506928) |
| ------------------------------------------------ | ------------------------------------------------- | ----------------------- |
| Search p95                                       | **7,068 ms** (k6 ran out of virtual users at 200) | 38 ms                   |
| Search query in PostgreSQL (mean)                | 851 ms                                            | 15 ms                   |
| Search requests completed in the 2-minute window | 5,480 (45.7/s of the 80/s offered)                | 9,602 (80/s)            |
| PostgreSQL peak CPU                              | 371%                                              | 227%                    |
| Notification delivery after commit (p50 / p95)   | 35.6 s / 71.2 s                                   | 0.03 s / 0.63 s         |

**Causes:**

- **Search:** the text match was an `OR` across products, brands and categories, which no index
  could serve. PostgreSQL therefore computed the full-text vector of all 5,000 products on
  every search. The match was rewritten so each branch uses an index, with the same matching
  rules.
- **Notifications:** checkout never woke the dispatcher, so events waited for the 10-second
  sweep, which took at most 100 events per run. Checkout now kicks the dispatcher after its
  commit, and each run drains the whole backlog.

## Remaining observations (not failures)

- **Browse listing query:** the storefront category listing (no search words) is the most
  expensive query left: mean 70 ms, max 544 ms, 2,541 calls. Its laterals compute the current
  price and stock for every candidate product. Browse p95 was 153 ms, so this is acceptable
  now. A materialized "current price / in stock" column is the next step for a much larger
  catalogue.
- **Order and stock row locks:** `orders … FOR UPDATE` waited 133 ms on average during the
  webhook burst, and `stock_levels … FOR UPDATE` waited up to 808 ms during contention. These
  locks are intended: they are what keeps payments and stock correct under concurrency.
- **Sequential scans on `products` and `product_variants`:** at 5,000 rows the planner prefers
  them for the listing query. Re-check with `load/analysis.sql` when the catalogue grows past
  roughly 50,000 products.

## Reproducing

From a Linux machine or WSL with Docker and k6, follow
[load/README.md › Running it yourself](../../load/README.md#running-it-yourself). CI runs the
test on every pull request; results are printed in the "Load test" job log and uploaded as the
`load-test-results` artifact.
