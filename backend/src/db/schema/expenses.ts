import {
  bigint,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sites, tenants } from "./core.js";
import { bankAccounts, cashAccounts } from "./finance.js";

export const suppliers = pgTable(
  "supplier",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: varchar("name", { length: 200 }).notNull(),
    taxNo: varchar("tax_no", { length: 32 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_supplier_tenant").on(t.tenantId),
    uniqueIndex("ux_supplier_tenant_name").on(t.tenantId, t.name),
  ],
);

export const expenseCategories = pgTable(
  "expense_category",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ux_expense_category_tenant_code").on(t.tenantId, t.code)],
);

export const expenses = pgTable(
  "expense",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    expenseDate: timestamp("expense_date", { withTimezone: true }).notNull(),
    categoryId: bigint("category_id", { mode: "number" })
      .notNull()
      .references(() => expenseCategories.id),
    supplierId: bigint("supplier_id", { mode: "number" }).references(() => suppliers.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    paymentStatus: varchar("payment_status", { length: 32 }).notNull().default("UNPAID"),
    bankAccountId: bigint("bank_account_id", { mode: "number" }).references(() => bankAccounts.id),
    cashAccountId: bigint("cash_account_id", { mode: "number" }).references(() => cashAccounts.id),
    bankTransactionId: bigint("bank_transaction_id", { mode: "number" }),
    period: varchar("period", { length: 7 }),
    invoiceNumber: varchar("invoice_number", { length: 64 }),
    description: text("description"),
    status: varchar("status", { length: 32 }).notNull().default("POSTED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [
    index("ix_expense_tenant_site").on(t.tenantId, t.siteId),
    index("ix_expense_site_date").on(t.siteId, t.expenseDate),
    index("ix_expense_status").on(t.siteId, t.status),
    index("ix_expense_period").on(t.siteId, t.period),
    uniqueIndex("ux_expense_bank_transaction").on(t.bankTransactionId),
  ],
);
