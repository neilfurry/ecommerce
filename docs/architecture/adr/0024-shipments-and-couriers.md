# ADR 0024: Shipments, the mock courier and prepared courier adapters

- Status: Accepted
- Date: 2026-11-26

## Context

ADR 0021 added quoting. Phase 5 needs booking, waybills, tracking, pickup, delivery
confirmation, failed delivery and return shipments, with adapters for J&T Express, LBC,
Ninja Van, Flash Express and 2GO, "only implementing real APIs when credentials and
documentation are available". None are available, so we use a mock courier plus deliveries the
seller arranges and tracks.

## Decision

- **`CourierAdapter`** (`book`, `cancel`, `parseWebhook`, `unavailableReason`).
  - `MockCourier`: tracking numbers `MCK` + 10 digits, a one-page A6 PDF label marked
    `TEST LABEL`, and tracking updates sent as HMAC-signed webhooks
    (`/shipping/webhooks/mock-courier`). Staff trigger them from the Admin Console ("Simulate
    courier update"), which goes through the same signed path. Refused in production.
  - `SelfDelivery`: the seller records the courier name and tracking number (e.g. Lalamove) and
    updates the status; the customer can confirm receipt.
  - `PreparedCourier` for J&T, LBC, Ninja Van, Flash and 2GO: unavailable, with the reason
    shown in the Admin Console. Staff cannot enable a courier whose adapter is not ready.
- **Shipments** have their own status table (booked, picked up, in transit, out for delivery,
  delivered, delivery failed, returning, returned, cancelled) and an event history. Courier
  events are stored once (webhook event id and a unique event id per shipment); out-of-order
  events are kept in the history without moving anything.
- One active delivery shipment per seller order (partial unique index). Real couriers' tracking
  numbers are unique per courier; self-arranged ones may repeat.
- Return parcels (customer to seller) and replacement parcels (seller to customer) are shipments
  linked to the return request.
- **Waybills** are generated before the database transaction and stored as private files;
  sellers and staff download them through the API.

## Consequences

- Adding a real courier means writing its adapter against its documentation and signed
  agreement, and turning it on in Admin Console › Shipping. The rest of the flow does not change.
