ALTER TABLE "bank_import_batch" ADD COLUMN IF NOT EXISTS "period" varchar(7);
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN IF NOT EXISTS "period" varchar(7);
--> statement-breakpoint
UPDATE "bank_transaction"
SET "period" = to_char(("transaction_date" AT TIME ZONE 'UTC'), 'YYYY-MM')
WHERE "period" IS NULL;
--> statement-breakpoint
UPDATE "bank_import_batch" b
SET "period" = sub.period
FROM (
  SELECT "import_batch_id" AS id, MIN("period") AS period
  FROM "bank_transaction"
  WHERE "import_batch_id" IS NOT NULL AND "period" IS NOT NULL
  GROUP BY "import_batch_id"
) sub
WHERE b."id" = sub.id AND b."period" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_import_period" ON "bank_import_batch" ("bank_account_id", "period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bank_tx_period" ON "bank_transaction" ("bank_account_id", "period");
