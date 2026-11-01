ALTER TABLE "bank_transaction" ADD COLUMN IF NOT EXISTS "operation_type" varchar(128);
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN IF NOT EXISTS "channel" varchar(64);
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN IF NOT EXISTS "running_balance" numeric(18, 2);
