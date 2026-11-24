# ADR 0007: S3-compatible object storage, MinIO locally

- Status: Accepted
- Date: 2026-11-24

## Context

Product images and seller documents need object storage. The mandated local tool is MinIO. In
2025–2026 MinIO Inc. stopped publishing community binaries and Docker images (October 2025) and
archived the community repository (February 2026).

## Decision

- Code talks to storage only through the **AWS S3 SDK** (`StorageService`), so any S3-compatible
  provider works (AWS S3, Cloudflare R2, DigitalOcean Spaces, Wasabi, MinIO/AIStor, Garage...).
- Local development runs MinIO from **Chainguard's free, maintained image**
  (`cgr.dev/chainguard/minio`). The image is configurable through `MINIO_IMAGE`.
- In development the API creates the bucket on start-up (`S3_AUTO_CREATE_BUCKET=true`). This is
  rejected in production, where buckets are provisioned explicitly with their policies.
- Production will use a managed S3 service rather than self-hosted MinIO (decided in Phase 10).

## Consequences

No vendor lock-in. Security rules for uploads (type/size limits, private buckets, signed URLs,
malware-scan hook) are implemented in the storage module when uploads arrive in Phase 4.
