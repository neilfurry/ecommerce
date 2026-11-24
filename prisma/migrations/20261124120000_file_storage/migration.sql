-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('PENDING', 'AVAILABLE', 'DELETED');

-- CreateEnum
CREATE TYPE "file_purpose" AS ENUM ('DEV_TEST');

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "bucket" VARCHAR(63) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(127) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "purpose" "file_purpose" NOT NULL,
    "status" "file_status" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stored_files_purpose_status_created_at_idx" ON "stored_files"("purpose", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_bucket_object_key_key" ON "stored_files"("bucket", "object_key");

-- Database-level guards (Prisma does not model CHECK constraints; added manually).
ALTER TABLE "stored_files"
    ADD CONSTRAINT "stored_files_size_bytes_check" CHECK ("size_bytes" >= 0),
    ADD CONSTRAINT "stored_files_checksum_sha256_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "stored_files_deleted_at_check" CHECK (("status" = 'DELETED') = ("deleted_at" IS NOT NULL));
