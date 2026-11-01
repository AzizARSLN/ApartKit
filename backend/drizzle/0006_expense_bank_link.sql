ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "period" varchar(7);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "bank_transaction_id" bigint;
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN IF NOT EXISTS "matched_expense_id" bigint;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_expense_period" ON "expense" ("site_id", "period");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_expense_bank_transaction"
  ON "expense" ("bank_transaction_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_bank_tx_matched_expense"
  ON "bank_transaction" ("matched_expense_id");
