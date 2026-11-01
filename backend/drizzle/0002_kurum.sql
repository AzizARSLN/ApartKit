ALTER TABLE "tenant" RENAME TO "kurum";
--> statement-breakpoint
ALTER TABLE "kurum" ADD COLUMN IF NOT EXISTS "code" varchar(64);
--> statement-breakpoint
ALTER TABLE "kurum" ADD COLUMN IF NOT EXISTS "address" text;
--> statement-breakpoint
ALTER TABLE "kurum" ADD COLUMN IF NOT EXISTS "tax_number" varchar(32);
--> statement-breakpoint
ALTER TABLE "kurum" ADD COLUMN IF NOT EXISTS "phone" varchar(32);
--> statement-breakpoint
ALTER TABLE "kurum" ADD COLUMN IF NOT EXISTS "email" varchar(255);
--> statement-breakpoint
UPDATE "kurum" SET "code" = 'K' || "id"::text WHERE "code" IS NULL OR "code" = '';
--> statement-breakpoint
ALTER TABLE "kurum" ALTER COLUMN "code" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_kurum_code" ON "kurum" ("code");
