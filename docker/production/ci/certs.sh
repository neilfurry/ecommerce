#!/usr/bin/env bash
# Self-signed certificate for the CI backup MinIO (pgBackRest requires HTTPS).
set -euo pipefail
dir="$(dirname "$0")/certs"
mkdir -p "$dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=minio-backup \
  -addext "subjectAltName=DNS:minio-backup" \
  -keyout "$dir/private.key" -out "$dir/public.crt" 2>/dev/null
chmod 644 "$dir/private.key" "$dir/public.crt"
