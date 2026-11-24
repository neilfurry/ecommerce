-- CreateEnum
CREATE TYPE "seller_status" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "business_type" AS ENUM ('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'CORPORATION', 'ONE_PERSON_CORPORATION', 'COOPERATIVE');

-- CreateEnum
CREATE TYPE "seller_document_type" AS ENUM ('BUSINESS_REGISTRATION', 'BIR_REGISTRATION', 'MAYORS_PERMIT', 'OWNER_ID', 'OTHER');

-- CreateEnum
CREATE TYPE "seller_event_type" AS ENUM ('REGISTERED', 'SUBMITTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REINSTATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "seller_member_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "store_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- AlterEnum
ALTER TYPE "file_purpose" ADD VALUE 'SELLER_DOCUMENT';
ALTER TYPE "file_purpose" ADD VALUE 'STORE_LOGO';
ALTER TYPE "file_purpose" ADD VALUE 'STORE_BANNER';

-- AlterEnum
ALTER TYPE "session_revoke_reason" ADD VALUE 'SELLER_MEMBERSHIP_ENDED';

-- AlterTable
ALTER TABLE "permissions" ADD COLUMN     "scope" VARCHAR(20) NOT NULL DEFAULT 'platform';

-- CreateTable
CREATE TABLE "user_mfa" (
    "user_id" UUID NOT NULL,
    "totp_secret_encrypted" VARCHAR(255) NOT NULL,
    "enabled_at" TIMESTAMPTZ(3),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellers" (
    "id" UUID NOT NULL,
    "status" "seller_status" NOT NULL DEFAULT 'PENDING',
    "business_name" VARCHAR(160) NOT NULL,
    "business_type" "business_type" NOT NULL,
    "owner_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "mobile" VARCHAR(16) NOT NULL,
    "address_line1" VARCHAR(160),
    "address_line2" VARCHAR(160),
    "barangay" VARCHAR(100),
    "city" VARCHAR(100),
    "province" VARCHAR(100),
    "postal_code" VARCHAR(4),
    "registration_number" VARCHAR(40),
    "tin" VARCHAR(14),
    "vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "status_note" VARCHAR(1000),
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "suspended_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_documents" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "type" "seller_document_type" NOT NULL,
    "file_id" UUID NOT NULL,
    "description" VARCHAR(200),
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_events" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "type" "seller_event_type" NOT NULL,
    "from_status" "seller_status",
    "to_status" "seller_status" NOT NULL,
    "note" VARCHAR(1000),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_members" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "seller_member_status" NOT NULL DEFAULT 'ACTIVE',
    "invited_by_id" UUID,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_member_permissions" (
    "member_id" UUID NOT NULL,
    "permission_code" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_member_permissions_pkey" PRIMARY KEY ("member_id","permission_code")
);

-- CreateTable
CREATE TABLE "seller_invitations" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "roles" VARCHAR(40)[],
    "permissions" VARCHAR(80)[],
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "description" VARCHAR(2000),
    "logo_file_id" UUID,
    "banner_file_id" UUID,
    "email" VARCHAR(254),
    "phone" VARCHAR(16),
    "address_line1" VARCHAR(160),
    "address_line2" VARCHAR(160),
    "barangay" VARCHAR(100),
    "city" VARCHAR(100),
    "province" VARCHAR(100),
    "postal_code" VARCHAR(4),
    "social_links" JSONB NOT NULL DEFAULT '{}',
    "status" "store_status" NOT NULL DEFAULT 'ACTIVE',
    "status_note" VARCHAR(1000),
    "custom_domain" VARCHAR(253),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_settings" (
    "store_id" UUID NOT NULL,
    "primary_color" CHAR(7) NOT NULL DEFAULT '#1d4ed8',
    "accent_color" CHAR(7),
    "announcement" VARCHAR(280),
    "shipping_policy" VARCHAR(5000),
    "return_policy" VARCHAR(5000),
    "vacation_mode" BOOLEAN NOT NULL DEFAULT false,
    "vacation_message" VARCHAR(280),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("store_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_user_id_code_hash_key" ON "mfa_recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_owner_id_key" ON "sellers"("owner_id");

-- CreateIndex
CREATE INDEX "sellers_status_submitted_at_idx" ON "sellers"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "sellers_reviewed_by_id_idx" ON "sellers"("reviewed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_documents_file_id_key" ON "seller_documents"("file_id");

-- CreateIndex
CREATE INDEX "seller_documents_seller_id_created_at_idx" ON "seller_documents"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "seller_documents_uploaded_by_id_idx" ON "seller_documents"("uploaded_by_id");

-- CreateIndex
CREATE INDEX "seller_events_seller_id_created_at_idx" ON "seller_events"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "seller_events_actor_id_idx" ON "seller_events"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_members_user_id_key" ON "seller_members"("user_id");

-- CreateIndex
CREATE INDEX "seller_members_seller_id_status_idx" ON "seller_members"("seller_id", "status");

-- CreateIndex
CREATE INDEX "seller_members_invited_by_id_idx" ON "seller_members"("invited_by_id");

-- CreateIndex
CREATE INDEX "seller_member_permissions_permission_code_idx" ON "seller_member_permissions"("permission_code");

-- CreateIndex
CREATE UNIQUE INDEX "seller_invitations_token_hash_key" ON "seller_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "seller_invitations_seller_id_email_idx" ON "seller_invitations"("seller_id", "email");

-- CreateIndex
CREATE INDEX "seller_invitations_invited_by_id_idx" ON "seller_invitations"("invited_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "stores_logo_file_id_key" ON "stores"("logo_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_banner_file_id_key" ON "stores"("banner_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_custom_domain_key" ON "stores"("custom_domain");

-- CreateIndex
CREATE INDEX "stores_seller_id_created_at_idx" ON "stores"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "stores_status_idx" ON "stores"("status");

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_events" ADD CONSTRAINT "seller_events_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_events" ADD CONSTRAINT "seller_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_members" ADD CONSTRAINT "seller_members_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_members" ADD CONSTRAINT "seller_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_members" ADD CONSTRAINT "seller_members_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_member_permissions" ADD CONSTRAINT "seller_member_permissions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "seller_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_member_permissions" ADD CONSTRAINT "seller_member_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_invitations" ADD CONSTRAINT "seller_invitations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_invitations" ADD CONSTRAINT "seller_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_banner_file_id_fkey" FOREIGN KEY ("banner_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Rules Prisma cannot express (ignored by `prisma migrate diff`).
-- -----------------------------------------------------------------------------

ALTER TABLE "permissions"
    ADD CONSTRAINT "permissions_scope_check" CHECK ("scope" IN ('platform', 'seller'));

ALTER TABLE "sellers"
    ADD CONSTRAINT "sellers_email_lowercase_check" CHECK ("email" = lower("email")),
    ADD CONSTRAINT "sellers_mobile_e164_check" CHECK ("mobile" ~ '^\+[1-9][0-9]{7,14}$'),
    ADD CONSTRAINT "sellers_postal_code_check" CHECK ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{4}$'),
    ADD CONSTRAINT "sellers_tin_check" CHECK ("tin" IS NULL OR "tin" ~ '^[0-9]{9}([0-9]{3,5})?$'),
    -- A seller is submitted before it is reviewed, and verified only with a verification time.
    ADD CONSTRAINT "sellers_submitted_check" CHECK ("status" IN ('PENDING') OR "submitted_at" IS NOT NULL),
    ADD CONSTRAINT "sellers_verified_check" CHECK ("status" NOT IN ('VERIFIED', 'SUSPENDED') OR "verified_at" IS NOT NULL),
    ADD CONSTRAINT "sellers_suspended_check" CHECK ("status" <> 'SUSPENDED' OR "suspended_at" IS NOT NULL),
    ADD CONSTRAINT "sellers_closed_check" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL));

ALTER TABLE "seller_invitations"
    ADD CONSTRAINT "seller_invitations_email_lowercase_check" CHECK ("email" = lower("email")),
    ADD CONSTRAINT "seller_invitations_roles_check" CHECK (cardinality("roles") >= 1),
    ADD CONSTRAINT "seller_invitations_final_state_check" CHECK ("accepted_at" IS NULL OR "revoked_at" IS NULL);

ALTER TABLE "seller_members"
    ADD CONSTRAINT "seller_members_suspension_check" CHECK (("status" = 'SUSPENDED') = ("suspended_at" IS NOT NULL));

ALTER TABLE "stores"
    ADD CONSTRAINT "stores_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])$' AND "slug" NOT LIKE '%--%'),
    ADD CONSTRAINT "stores_email_lowercase_check" CHECK ("email" IS NULL OR "email" = lower("email")),
    ADD CONSTRAINT "stores_phone_e164_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$'),
    ADD CONSTRAINT "stores_postal_code_check" CHECK ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{4}$'),
    ADD CONSTRAINT "stores_custom_domain_lowercase_check" CHECK ("custom_domain" IS NULL OR "custom_domain" = lower("custom_domain")),
    ADD CONSTRAINT "stores_social_links_object_check" CHECK (jsonb_typeof("social_links") = 'object');

ALTER TABLE "store_settings"
    ADD CONSTRAINT "store_settings_primary_color_check" CHECK ("primary_color" ~ '^#[0-9a-f]{6}$'),
    ADD CONSTRAINT "store_settings_accent_color_check" CHECK ("accent_color" IS NULL OR "accent_color" ~ '^#[0-9a-f]{6}$');

ALTER TABLE "user_mfa"
    ADD CONSTRAINT "user_mfa_last_used_step_check" CHECK ("last_used_step" IS NULL OR "last_used_step" >= 0);
