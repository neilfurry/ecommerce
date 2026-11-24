-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "symbol" VARCHAR(8) NOT NULL,
    "minor_units" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- Database-level guards (Prisma does not model CHECK constraints; added manually).
ALTER TABLE "currencies"
    ADD CONSTRAINT "currencies_code_iso4217_check" CHECK ("code" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "currencies_minor_units_check" CHECK ("minor_units" BETWEEN 0 AND 4);
