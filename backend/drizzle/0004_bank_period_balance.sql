CREATE TABLE IF NOT EXISTS "bank_account_period_balance" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "kurum"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "bank_account_id" bigint NOT NULL REFERENCES "bank_account"("id"),
  "period" varchar(7) NOT NULL,
  "balance_amount" numeric(18, 2) NOT NULL,
  "note" text,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint,
  "updated_at" timestamptz,
  "updated_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_account_period_balance"
  ON "bank_account_period_balance" ("bank_account_id", "period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_period_balance_site"
  ON "bank_account_period_balance" ("tenant_id", "site_id", "period");
