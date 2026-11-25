# ADR 0015: Catalog ownership, product approval and product images

- Status: Accepted
- Date: 2026-11-27

## Context

Phase 3 adds products that belong to sellers but must be approved by marketplace staff before
shoppers see them. Categories and brands are shared by every seller. Sellers upload photos that
are shown publicly.

## Decision

- **Global reference data is staff-owned.** Only `catalog.categories.manage` can change the
  category tree (three levels at most, enforced by a CHECK on `depth`). Category attributes are
  inherited by subcategories; a child may not redefine a parent's attribute code. Brands are
  created by `catalog.brands.manage`; sellers may _request_ a brand (`PENDING`) and use it on
  their own products immediately, but a product cannot be approved until its brand is active.
- **Approval covers content, not commerce.** Name, description, category, brand,
  specifications, attribute values, options and new or replaced photos are content: changing
  them on an approved product sends it back to `PENDING_APPROVAL` and records a
  `CHANGED_AFTER_APPROVAL` event. Prices, stock, SKUs and barcodes apply at once (user decision,
  Phase 3 kick-off).
- **Every status change is an event** (`product_events`): submitted, approved, rejected with
  note, taken down with reason, archived, restored. The seller is emailed for decisions through
  the email queue.
- **Variants come from options.** Up to three options; every combination is a variant keyed by
  a stable `optionKey`, so re-running generation only adds new combinations and removes
  dropped ones (refused when stock records exist). SKUs are unique per seller.
- **Photos are re-encoded, never served as uploaded.** The API checks the extension _and_ the
  magic bytes (JPEG, PNG, WebP), the size (≤ 5 MB), the pixel count (≤ 40 MP, against
  decompression bombs) and the minimum edge (200 px). sharp applies EXIF rotation, strips all
  metadata (including GPS) and writes a WebP of at most 1600 px plus a 400 px thumbnail.
  Originals are discarded. Files are `StoredFile` rows (purposes `PRODUCT_IMAGE`,
  `PRODUCT_IMAGE_THUMBNAIL`, `CATEGORY_IMAGE`) in private object storage and served by the API
  with a version query (`?v=fileId`) and an immutable cache header, so a replaced photo gets a
  new URL.

## Consequences

- No malware scanning of uploads yet; re-encoding removes embedded payloads from the served
  files, but a scanning hook is still planned for hardening.
- Serving photos through the API is simple and keeps storage private; a CDN in front of the
  versioned URLs can be added later without code changes.
