# ADR 0020: Philippine locations from the PSGC, stored in the database

- Status: Accepted
- Date: 2026-11-28

## Context

Addresses need region, province, city or municipality and barangay, and the brief says this
data must be configurable, not hardcoded. Shipping fees depend on where a package travels
from and to, so addresses and warehouses need the same official codes.

## Decision

- **Source:** the Philippine Standard Geographic Code (PSGC) from the Philippine Statistics
  Authority. The bundled file comes from the npm package `psgc-areas@1.0.0` (PSA, April 2024
  edition, `data/all.json`). It holds 17 regions, 83 province-level entries (including the
  BARMM Special Geographic Area), 149 cities, 1,493 municipalities, 14 sub-municipalities
  (Manila's districts) and 42,004 barangays.
- **Storage:** one table, `ph_locations` (code, name, level, parent code, region, province
  and city codes, active flag), with indexes for "children of" lookups. Nothing about places
  is hardcoded in the apps.
- **Import:** `pnpm db:import-locations [-- --file <path>]` loads the bundled file or a newer
  PSGC file in batches of 2,000 (`INSERT … ON CONFLICT DO UPDATE`). Places missing from a new
  file are **deactivated, not deleted**, so old addresses and orders keep their references.
  `pnpm db:seed` imports the file when the table is empty.
- **Data fix during import:** the package lists some highly urbanized cities under the
  province they are geographically in. PSGC codes tell the truth: when a city's province
  digits differ from the listed province, the city is placed directly under its region with
  no province (as Metro Manila cities are). Entries marked "(Not a Province)" are not
  imported as provinces.
- **Address picker:** `GET /locations` returns regions, then the next step under a chosen
  code: provinces and independent cities under a region, cities and municipalities under a
  province, barangays under a city or municipality. The storefront address form and the
  Seller Center warehouse form use it step by step.
- **Addresses** store the four codes (province is null for Metro Manila and independent cities).
  Order addresses are copied as text at checkout, so later PSGC changes do not alter past
  orders.
- **Warehouses** gain optional location codes. A warehouse without them cannot be a shipping
  origin, and the Seller Center flags it ("No location for shipping").

## Consequences

- Staff can refresh the location list without a code change when PSA publishes an update.
- Existing Phase 3 warehouses (text addresses only) keep working for stock. They need a
  location before checkout can ship from them. The demo seed sets one for the demo
  warehouses.
