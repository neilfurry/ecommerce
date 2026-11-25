# ADR 0021: Shipping provider interface with a mock rate table for development

- Status: Accepted
- Date: 2026-11-28

## Context

The brief asks for a shipping-provider interface (origin, destination, weight, dimensions,
method and estimated fee) with mock rates in development. Real couriers (J&T, LBC, Ninja Van
and others) will be connected later.

## Decision

- **`ShippingProvider`** (abstract class) has one method:
  `quote({ origin, destination, parcel: { weightGrams, volumeCm3 } }) → rates[]`. Each rate
  has a method (`STANDARD`, `EXPRESS`, `SAME_DAY`), carrier, service name, fee, chargeable
  weight and estimated days. Origin and destination are PSGC places (ADR 0020).
- **`ShippingService`** works out what the provider needs:
  - **Origin:** the seller's default active warehouse with a location, else their oldest
    active warehouse with a location.
  - **Parcel:** the total weight of the seller's items (500 g for items without a weight) and
    their total volume from the dimensions.
- **`MockShippingProvider`** answers from a rate table that staff edit in Admin Console ›
  Settings › Shipping (stored in `platform_settings`):
  - **Route:** same city, same region, same island group (Luzon, Visayas, Mindanao, from the
    region code), or another island group.
  - **Fee:** the route's base fee for the first kilogram plus a fee for each additional
    kilogram. The weight used is the larger of the actual weight and the volumetric weight
    (volume ÷ divisor, 3,500 cm³/kg by default).
  - **Express:** the standard fee times a multiplier (1.6 by default), in about half the days.
  - **Same day:** a flat fee, offered only within the same city and up to 20 kg.
  - **Defaults:** ₱85 same city, ₱120 same region, ₱160 same island group, ₱220 another island
    group, ₱35 per additional kilogram, ₱180 same day.
- The provider is chosen with `SHIPPING_PROVIDER` (only `mock` exists). The API **refuses to
  start in production with the mock**, so real orders cannot be charged invented fees.
- The provider gets checkout's database transaction, so a quote inside the order transaction
  does not need a second connection while row locks are held. (Without this, the
  concurrent-checkout test exhausted the connection pool.)
- Each seller order stores its shipping group (method, carrier, service, origin label,
  weights, fee, discount, estimated days and an estimated parcel). This record is the start of
  fulfilment in a later phase.

## Consequences

- A real courier is one new class behind `ShippingProvider` plus an environment value. Live
  rate calls will need timeouts and a fallback, and quotes may need caching.
- The ship-from warehouse is not always where stock is reserved: reservations take stock from
  the default warehouse first, then others. Choosing the origin by stock location is left to
  the fulfilment phase.
