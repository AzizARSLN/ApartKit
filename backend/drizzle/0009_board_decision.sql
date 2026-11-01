CREATE TABLE IF NOT EXISTS "board_decision" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "tenant_id" bigint NOT NULL REFERENCES "kurum"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "decision_no" varchar(16) NOT NULL,
  "decision_date" timestamptz NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_board_decision_site_no" ON "board_decision" ("site_id", "decision_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_board_decision_tenant_site" ON "board_decision" ("tenant_id", "site_id", "decision_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_leave_request_employee" ON "leave_request" ("employee_id", "start_date");
