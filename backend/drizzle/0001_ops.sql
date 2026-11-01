CREATE TABLE IF NOT EXISTS "supplier" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "name" varchar(200) NOT NULL,
  "tax_no" varchar(32),
  "phone" varchar(32),
  "email" varchar(255),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_supplier_tenant" ON "supplier" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_supplier_tenant_name" ON "supplier" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_category" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "code" varchar(64) NOT NULL,
  "name" varchar(200) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_expense_category_tenant_code" ON "expense_category" ("tenant_id", "code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "expense_date" timestamptz NOT NULL,
  "category_id" bigint NOT NULL REFERENCES "expense_category"("id"),
  "supplier_id" bigint REFERENCES "supplier"("id"),
  "amount" numeric(18,2) NOT NULL,
  "tax_amount" numeric(18,2) NOT NULL DEFAULT '0',
  "payment_status" varchar(32) NOT NULL DEFAULT 'UNPAID',
  "bank_account_id" bigint REFERENCES "bank_account"("id"),
  "cash_account_id" bigint REFERENCES "cash_account"("id"),
  "invoice_number" varchar(64),
  "description" text,
  "status" varchar(32) NOT NULL DEFAULT 'POSTED',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_expense_tenant_site" ON "expense" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_expense_site_date" ON "expense" ("site_id", "expense_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_expense_status" ON "expense" ("site_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "person_id" bigint NOT NULL REFERENCES "person"("id"),
  "position" varchar(128) NOT NULL,
  "hire_date" timestamptz NOT NULL,
  "leave_date" timestamptz,
  "salary" numeric(18,2),
  "iban" varchar(34),
  "status" varchar(32) NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_employee_site_person" ON "employee" ("site_id", "person_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_employee_tenant_site" ON "employee" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_request" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "employee_id" bigint NOT NULL REFERENCES "employee"("id"),
  "leave_type" varchar(64) NOT NULL,
  "start_date" timestamptz NOT NULL,
  "end_date" timestamptz NOT NULL,
  "day_count" numeric(8,2) NOT NULL,
  "reason" text,
  "status" varchar(32) NOT NULL DEFAULT 'PENDING',
  "approved_by" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_leave_request_employee" ON "leave_request" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_leave_request_status" ON "leave_request" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "unit_id" bigint REFERENCES "unit"("id"),
  "title" varchar(255) NOT NULL,
  "category" varchar(64) NOT NULL DEFAULT 'GENERAL',
  "description" text,
  "status" varchar(32) NOT NULL DEFAULT 'OPEN',
  "priority" varchar(32) NOT NULL DEFAULT 'NORMAL',
  "assigned_employee_id" bigint REFERENCES "employee"("id"),
  "created_by_user_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ticket_tenant_site" ON "ticket" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ticket_status" ON "ticket" ("site_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_comment" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "ticket_id" bigint NOT NULL REFERENCES "ticket"("id"),
  "body" text NOT NULL,
  "created_by" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_ticket_comment_ticket" ON "ticket_comment" ("ticket_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_tank" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "fuel_type" varchar(64) NOT NULL,
  "capacity" numeric(18,3) NOT NULL,
  "unit" varchar(16) NOT NULL DEFAULT 'LT',
  "minimum_stock" numeric(18,3) NOT NULL DEFAULT '0',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_fuel_tank_tenant_site" ON "fuel_tank" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_purchase" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "fuel_tank_id" bigint NOT NULL REFERENCES "fuel_tank"("id"),
  "supplier_id" bigint REFERENCES "supplier"("id"),
  "purchase_date" timestamptz NOT NULL,
  "quantity" numeric(18,3) NOT NULL,
  "unit_price" numeric(18,4) NOT NULL,
  "total_amount" numeric(18,2) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_fuel_purchase_tank_date" ON "fuel_purchase" ("fuel_tank_id", "purchase_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_consumption" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "fuel_tank_id" bigint NOT NULL REFERENCES "fuel_tank"("id"),
  "consumption_date" timestamptz NOT NULL,
  "quantity" numeric(18,3) NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_fuel_consumption_tank_date" ON "fuel_consumption" ("fuel_tank_id", "consumption_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcement" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "tenant_id" bigint NOT NULL REFERENCES "tenant"("id"),
  "site_id" bigint NOT NULL REFERENCES "site"("id"),
  "title" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "published_at" timestamptz,
  "status" varchar(32) NOT NULL DEFAULT 'DRAFT',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_announcement_tenant_site" ON "announcement" ("tenant_id", "site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_announcement_status" ON "announcement" ("site_id", "status");
