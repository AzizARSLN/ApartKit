CREATE TABLE IF NOT EXISTS "tenant" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "name" varchar(200) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "email" varchar(255) NOT NULL,
  "password_hash" text NOT NULL,
  "full_name" varchar(200) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz,
  "created_by" bigint,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_user_tenant_email" ON "user" ("tenant_id", "email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_user_tenant" ON "user" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_role" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "user_id" bigint NOT NULL REFERENCES "user"("id"),
  "role" varchar(64) NOT NULL,
  "site_id" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_user_role_scope" ON "user_role" ("user_id", "role", "site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_user_role_tenant" ON "user_role" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_token" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "user_id" bigint NOT NULL REFERENCES "user"("id"),
  "token_hash" varchar(128) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_refresh_token_hash" ON "refresh_token" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_refresh_token_user" ON "refresh_token" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL,
  "site_id" bigint,
  "user_id" bigint,
  "action" varchar(100) NOT NULL,
  "entity_type" varchar(100) NOT NULL,
  "entity_id" varchar(64),
  "old_data" jsonb,
  "new_data" jsonb,
  "ip_address" varchar(64),
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_tenant_created" ON "audit_log" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_audit_entity" ON "audit_log" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_key" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL,
  "user_id" bigint,
  "key" varchar(128) NOT NULL,
  "method" varchar(16) NOT NULL,
  "path" varchar(512) NOT NULL,
  "request_hash" varchar(128) NOT NULL,
  "response_status" bigint NOT NULL,
  "response_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_idempotency_tenant_key" ON "idempotency_key" ("tenant_id", "key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "name" varchar(200) NOT NULL,
  "code" varchar(64) NOT NULL,
  "address" text,
  "status" varchar(32) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz,
  "created_by" bigint,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_site_tenant_code" ON "site" ("tenant_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_site_tenant" ON "site" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "block" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "name" varchar(100) NOT NULL,
  "code" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz,
  "created_by" bigint,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_block_site_code" ON "block" ("site_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_block_tenant_site" ON "block" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "block_id" bigint REFERENCES "block"("id"),
  "unit_no" varchar(32) NOT NULL,
  "floor_no" varchar(32),
  "gross_m2" numeric(12,2),
  "net_m2" numeric(12,2),
  "land_share" numeric(18,6),
  "status" varchar(32) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz,
  "created_by" bigint,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_unit_site_block_no" ON "unit" ("site_id", "block_id", "unit_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_unit_tenant_site" ON "unit" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "first_name" varchar(100) NOT NULL,
  "last_name" varchar(100) NOT NULL,
  "identity_number" varchar(32),
  "phone" varchar(32),
  "email" varchar(255),
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz,
  "created_by" bigint,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_person_tenant" ON "person" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit_ownership" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "unit_id" bigint NOT NULL REFERENCES "unit"("id"),
  "person_id" bigint NOT NULL REFERENCES "person"("id"),
  "start_date" timestamptz NOT NULL,
  "end_date" timestamptz,
  "share_rate" numeric(8,4) NOT NULL DEFAULT '1',
  "is_primary" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ownership_unit" ON "unit_ownership" ("unit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ownership_person" ON "unit_ownership" ("person_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit_occupancy" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "unit_id" bigint NOT NULL REFERENCES "unit"("id"),
  "person_id" bigint NOT NULL REFERENCES "person"("id"),
  "occupancy_type" varchar(32) NOT NULL,
  "start_date" timestamptz NOT NULL,
  "end_date" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_occupancy_unit" ON "unit_occupancy" ("unit_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "charge_type" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "code" varchar(64) NOT NULL,
  "name" varchar(200) NOT NULL,
  "category" varchar(64) NOT NULL DEFAULT 'GENERAL',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_charge_type_tenant_code" ON "charge_type" ("tenant_id", "code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_finance_config" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "late_fee_enabled" varchar(8) NOT NULL DEFAULT 'false',
  "late_fee_monthly_rate" numeric(8,4) DEFAULT '0',
  "late_fee_grace_days" bigint NOT NULL DEFAULT 0,
  "late_fee_calculation_method" varchar(64) NOT NULL DEFAULT 'SIMPLE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_site_finance_config_site" ON "site_finance_config" ("site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "charge_batch" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "period" varchar(16) NOT NULL,
  "charge_type_id" bigint NOT NULL REFERENCES "charge_type"("id"),
  "distribution_method" varchar(32) NOT NULL,
  "total_amount" numeric(18,2) NOT NULL,
  "due_date" timestamptz NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'POSTED',
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint,
  "updated_at" timestamptz,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_charge_batch_site_period" ON "charge_batch" ("site_id", "period");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "charge" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "unit_id" bigint NOT NULL REFERENCES "unit"("id"),
  "charge_batch_id" bigint REFERENCES "charge_batch"("id"),
  "charge_type_id" bigint NOT NULL REFERENCES "charge_type"("id"),
  "period" varchar(16) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "open_amount" numeric(18,2) NOT NULL,
  "due_date" timestamptz NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'OPEN',
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint,
  "updated_at" timestamptz,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_charge_unit_status" ON "charge" ("unit_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_charge_due_date" ON "charge" ("site_id", "due_date", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_charge_tenant_site" ON "charge" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_account" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "name" varchar(200) NOT NULL,
  "currency_code" varchar(8) NOT NULL DEFAULT 'TRY',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_cash_account_site" ON "cash_account" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_transaction" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL,
  "cash_account_id" bigint NOT NULL REFERENCES "cash_account"("id"),
  "transaction_date" timestamptz NOT NULL,
  "type" varchar(16) NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "reference_type" varchar(64),
  "reference_id" bigint,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_cash_tx_account_date" ON "cash_transaction" ("cash_account_id", "transaction_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_account" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "bank_name" varchar(200) NOT NULL,
  "iban" varchar(34) NOT NULL,
  "account_name" varchar(200) NOT NULL,
  "currency_code" varchar(8) NOT NULL DEFAULT 'TRY',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_account_iban_site" ON "bank_account" ("site_id", "iban");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_account_tenant_site" ON "bank_account" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_import_batch" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "bank_account_id" bigint NOT NULL REFERENCES "bank_account"("id"),
  "file_name" varchar(512) NOT NULL,
  "file_hash" varchar(128) NOT NULL,
  "imported_at" timestamptz NOT NULL DEFAULT now(),
  "row_count" bigint NOT NULL DEFAULT 0,
  "status" varchar(32) NOT NULL DEFAULT 'COMPLETED',
  "created_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_import_file_hash" ON "bank_import_batch" ("tenant_id", "bank_account_id", "file_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_transaction" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "bank_account_id" bigint NOT NULL REFERENCES "bank_account"("id"),
  "import_batch_id" bigint REFERENCES "bank_import_batch"("id"),
  "transaction_date" timestamptz NOT NULL,
  "value_date" timestamptz,
  "amount" numeric(18,2) NOT NULL,
  "direction" varchar(8) NOT NULL,
  "sender_name" varchar(255),
  "sender_iban" varchar(34),
  "description" text,
  "bank_reference" varchar(128),
  "raw_json" jsonb,
  "fingerprint" varchar(128) NOT NULL,
  "match_status" varchar(32) NOT NULL DEFAULT 'UNMATCHED',
  "matched_unit_id" bigint REFERENCES "unit"("id"),
  "matched_payment_id" bigint,
  "match_score" bigint,
  "match_classification" varchar(32),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_tx_fingerprint" ON "bank_transaction" ("bank_account_id", "fingerprint");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_tx_matched_payment" ON "bank_transaction" ("matched_payment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_tx_match_status" ON "bank_transaction" ("site_id", "match_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_tx_sender_iban" ON "bank_transaction" ("sender_iban");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_tx_amount_date" ON "bank_transaction" ("amount", "transaction_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_sender_mapping" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "sender_iban" varchar(34) NOT NULL,
  "unit_id" bigint NOT NULL REFERENCES "unit"("id"),
  "confidence" bigint NOT NULL DEFAULT 100,
  "last_used_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_sender_mapping" ON "bank_sender_mapping" ("site_id", "sender_iban");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_sequence" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL,
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "year" bigint NOT NULL,
  "last_value" bigint NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_receipt_sequence_site_year" ON "receipt_sequence" ("site_id", "year");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "unit_id" bigint NOT NULL REFERENCES "unit"("id"),
  "payment_date" timestamptz NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "payment_method" varchar(32) NOT NULL,
  "bank_transaction_id" bigint,
  "description" text,
  "status" varchar(32) NOT NULL DEFAULT 'POSTED',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint,
  "updated_at" timestamptz,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_payment_bank_transaction" ON "payment" ("bank_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_payment_unit_date" ON "payment" ("unit_id", "payment_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_payment_tenant_site" ON "payment" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_allocation" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL,
  "payment_id" bigint NOT NULL REFERENCES "payment"("id"),
  "charge_id" bigint NOT NULL REFERENCES "charge"("id"),
  "amount" numeric(18,2) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_allocation_payment" ON "payment_allocation" ("payment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_allocation_charge" ON "payment_allocation" ("charge_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL,
  "site_id" bigint NOT NULL,
  "payment_id" bigint NOT NULL REFERENCES "payment"("id"),
  "receipt_no" varchar(64) NOT NULL,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "status" varchar(32) NOT NULL DEFAULT 'ISSUED'
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_receipt_payment" ON "receipt" ("payment_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_receipt_site_no" ON "receipt" ("site_id", "receipt_no");
--> statement-breakpoint
ALTER TABLE "bank_transaction"
  ADD CONSTRAINT "fk_bank_tx_matched_payment"
  FOREIGN KEY ("matched_payment_id") REFERENCES "payment"("id");
--> statement-breakpoint
ALTER TABLE "payment"
  ADD CONSTRAINT "fk_payment_bank_transaction"
  FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transaction"("id");
