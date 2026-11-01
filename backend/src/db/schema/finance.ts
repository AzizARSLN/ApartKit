import {
  bigint,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sites, tenants, units } from "./core.js";

export const chargeTypes = pgTable(
  "charge_type",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    category: varchar("category", { length: 64 }).notNull().default("GENERAL"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ux_charge_type_tenant_code").on(t.tenantId, t.code)],
);

export const siteFinanceConfigs = pgTable(
  "site_finance_config",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    lateFeeEnabled: varchar("late_fee_enabled", { length: 8 }).notNull().default("false"),
    lateFeeMonthlyRate: numeric("late_fee_monthly_rate", { precision: 8, scale: 4 }).default("0"),
    lateFeeGraceDays: bigint("late_fee_grace_days", { mode: "number" }).notNull().default(0),
    lateFeeCalculationMethod: varchar("late_fee_calculation_method", { length: 64 })
      .notNull()
      .default("SIMPLE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("ux_site_finance_config_site").on(t.siteId)],
);

export const chargeBatches = pgTable(
  "charge_batch",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    period: varchar("period", { length: 16 }).notNull(),
    chargeTypeId: bigint("charge_type_id", { mode: "number" })
      .notNull()
      .references(() => chargeTypes.id),
    distributionMethod: varchar("distribution_method", { length: 32 }).notNull(),
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("POSTED"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [index("ix_charge_batch_site_period").on(t.siteId, t.period)],
);

export const charges = pgTable(
  "charge",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => units.id),
    chargeBatchId: bigint("charge_batch_id", { mode: "number" }).references(() => chargeBatches.id),
    chargeTypeId: bigint("charge_type_id", { mode: "number" })
      .notNull()
      .references(() => chargeTypes.id),
    period: varchar("period", { length: 16 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    openAmount: numeric("open_amount", { precision: 18, scale: 2 }).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("OPEN"),
    description: text("description"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [
    index("ix_charge_unit_status").on(t.unitId, t.status),
    index("ix_charge_due_date").on(t.siteId, t.dueDate, t.status),
    index("ix_charge_tenant_site").on(t.tenantId, t.siteId),
  ],
);

export const cashAccounts = pgTable(
  "cash_account",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    name: varchar("name", { length: 200 }).notNull(),
    currencyCode: varchar("currency_code", { length: 8 }).notNull().default("TRY"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_cash_account_site").on(t.tenantId, t.siteId)],
);

export const cashTransactions = pgTable(
  "cash_transaction",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    cashAccountId: bigint("cash_account_id", { mode: "number" })
      .notNull()
      .references(() => cashAccounts.id),
    transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
    type: varchar("type", { length: 16 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    referenceType: varchar("reference_type", { length: 64 }),
    referenceId: bigint("reference_id", { mode: "number" }),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [index("ix_cash_tx_account_date").on(t.cashAccountId, t.transactionDate)],
);

export const bankAccounts = pgTable(
  "bank_account",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    bankName: varchar("bank_name", { length: 200 }).notNull(),
    iban: varchar("iban", { length: 34 }).notNull(),
    accountName: varchar("account_name", { length: 200 }).notNull(),
    currencyCode: varchar("currency_code", { length: 8 }).notNull().default("TRY"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_bank_account_iban_site").on(t.siteId, t.iban),
    index("ix_bank_account_tenant_site").on(t.tenantId, t.siteId),
  ],
);

/** Site banka hesabının dönem sonu / dönem bakiye kaydı (manuel). */
export const bankAccountPeriodBalances = pgTable(
  "bank_account_period_balance",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    bankAccountId: bigint("bank_account_id", { mode: "number" })
      .notNull()
      .references(() => bankAccounts.id),
    period: varchar("period", { length: 7 }).notNull(),
    balanceAmount: numeric("balance_amount", { precision: 18, scale: 2 }).notNull(),
    note: text("note"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("ux_bank_account_period_balance").on(t.bankAccountId, t.period),
    index("ix_bank_period_balance_site").on(t.tenantId, t.siteId, t.period),
  ],
);

export const bankImportBatches = pgTable(
  "bank_import_batch",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    bankAccountId: bigint("bank_account_id", { mode: "number" })
      .notNull()
      .references(() => bankAccounts.id),
    period: varchar("period", { length: 7 }),
    fileName: varchar("file_name", { length: 512 }).notNull(),
    fileHash: varchar("file_hash", { length: 128 }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    rowCount: bigint("row_count", { mode: "number" }).notNull().default(0),
    status: varchar("status", { length: 32 }).notNull().default("COMPLETED"),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("ux_bank_import_file_hash").on(t.tenantId, t.bankAccountId, t.fileHash),
    index("ix_bank_import_period").on(t.bankAccountId, t.period),
  ],
);

export const bankTransactions = pgTable(
  "bank_transaction",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    bankAccountId: bigint("bank_account_id", { mode: "number" })
      .notNull()
      .references(() => bankAccounts.id),
    importBatchId: bigint("import_batch_id", { mode: "number" }).references(() => bankImportBatches.id),
    period: varchar("period", { length: 7 }),
    transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
    valueDate: timestamp("value_date", { withTimezone: true }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    direction: varchar("direction", { length: 8 }).notNull(),
    senderName: varchar("sender_name", { length: 255 }),
    senderIban: varchar("sender_iban", { length: 34 }),
    description: text("description"),
    bankReference: varchar("bank_reference", { length: 128 }),
    operationType: varchar("operation_type", { length: 128 }),
    channel: varchar("channel", { length: 64 }),
    runningBalance: numeric("running_balance", { precision: 18, scale: 2 }),
    rawJson: jsonb("raw_json"),
    fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
    matchStatus: varchar("match_status", { length: 32 }).notNull().default("UNMATCHED"),
    matchedUnitId: bigint("matched_unit_id", { mode: "number" }).references(() => units.id),
    matchedPaymentId: bigint("matched_payment_id", { mode: "number" }),
    matchedExpenseId: bigint("matched_expense_id", { mode: "number" }),
    matchScore: bigint("match_score", { mode: "number" }),
    matchClassification: varchar("match_classification", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_bank_tx_fingerprint").on(t.bankAccountId, t.fingerprint),
    uniqueIndex("ux_bank_tx_matched_payment").on(t.matchedPaymentId),
    uniqueIndex("ux_bank_tx_matched_expense").on(t.matchedExpenseId),
    index("ix_bank_tx_match_status").on(t.siteId, t.matchStatus),
    index("ix_bank_tx_sender_iban").on(t.senderIban),
    index("ix_bank_tx_amount_date").on(t.amount, t.transactionDate),
    index("ix_bank_tx_period").on(t.bankAccountId, t.period),
  ],
);

export const bankSenderMappings = pgTable(
  "bank_sender_mapping",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    senderIban: varchar("sender_iban", { length: 34 }).notNull(),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => units.id),
    confidence: bigint("confidence", { mode: "number" }).notNull().default(100),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_bank_sender_mapping").on(t.siteId, t.senderIban),
  ],
);

export const receiptSequences = pgTable(
  "receipt_sequence",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    year: bigint("year", { mode: "number" }).notNull(),
    lastValue: bigint("last_value", { mode: "number" }).notNull().default(0),
  },
  (t) => [uniqueIndex("ux_receipt_sequence_site_year").on(t.siteId, t.year)],
);

export const payments = pgTable(
  "payment",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => units.id),
    paymentDate: timestamp("payment_date", { withTimezone: true }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    paymentMethod: varchar("payment_method", { length: 32 }).notNull(),
    bankTransactionId: bigint("bank_transaction_id", { mode: "number" }),
    description: text("description"),
    status: varchar("status", { length: 32 }).notNull().default("POSTED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("ux_payment_bank_transaction").on(t.bankTransactionId),
    index("ix_payment_unit_date").on(t.unitId, t.paymentDate),
    index("ix_payment_tenant_site").on(t.tenantId, t.siteId),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocation",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    paymentId: bigint("payment_id", { mode: "number" })
      .notNull()
      .references(() => payments.id),
    chargeId: bigint("charge_id", { mode: "number" })
      .notNull()
      .references(() => charges.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_allocation_payment").on(t.paymentId),
    index("ix_allocation_charge").on(t.chargeId),
  ],
);

export const receipts = pgTable(
  "receipt",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    siteId: bigint("site_id", { mode: "number" }).notNull(),
    paymentId: bigint("payment_id", { mode: "number" })
      .notNull()
      .references(() => payments.id),
    receiptNo: varchar("receipt_no", { length: 64 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 32 }).notNull().default("ISSUED"),
  },
  (t) => [
    uniqueIndex("ux_receipt_payment").on(t.paymentId),
    uniqueIndex("ux_receipt_site_no").on(t.siteId, t.receiptNo),
  ],
);
