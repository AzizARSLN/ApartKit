import {
  bigint,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sites, tenants, units } from "./core.js";
import { employees } from "./personnel.js";
import { suppliers } from "./expenses.js";

export const tickets = pgTable(
  "ticket",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    unitId: bigint("unit_id", { mode: "number" }).references(() => units.id),
    title: varchar("title", { length: 255 }).notNull(),
    category: varchar("category", { length: 64 }).notNull().default("GENERAL"),
    description: text("description"),
    status: varchar("status", { length: 32 }).notNull().default("OPEN"),
    priority: varchar("priority", { length: 32 }).notNull().default("NORMAL"),
    assignedEmployeeId: bigint("assigned_employee_id", { mode: "number" }).references(
      () => employees.id,
    ),
    createdByUserId: bigint("created_by_user_id", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_ticket_tenant_site").on(t.tenantId, t.siteId),
    index("ix_ticket_status").on(t.siteId, t.status),
  ],
);

export const ticketComments = pgTable(
  "ticket_comment",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    ticketId: bigint("ticket_id", { mode: "number" })
      .notNull()
      .references(() => tickets.id),
    body: text("body").notNull(),
    createdBy: bigint("created_by", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_ticket_comment_ticket").on(t.ticketId)],
);

export const fuelTanks = pgTable(
  "fuel_tank",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    fuelType: varchar("fuel_type", { length: 64 }).notNull(),
    capacity: numeric("capacity", { precision: 18, scale: 3 }).notNull(),
    unit: varchar("unit", { length: 16 }).notNull().default("LT"),
    minimumStock: numeric("minimum_stock", { precision: 18, scale: 3 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_fuel_tank_tenant_site").on(t.tenantId, t.siteId)],
);

export const fuelPurchases = pgTable(
  "fuel_purchase",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    fuelTankId: bigint("fuel_tank_id", { mode: "number" })
      .notNull()
      .references(() => fuelTanks.id),
    supplierId: bigint("supplier_id", { mode: "number" }).references(() => suppliers.id),
    purchaseDate: timestamp("purchase_date", { withTimezone: true }).notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
    totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [index("ix_fuel_purchase_tank_date").on(t.fuelTankId, t.purchaseDate)],
);

export const fuelConsumptions = pgTable(
  "fuel_consumption",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    fuelTankId: bigint("fuel_tank_id", { mode: "number" })
      .notNull()
      .references(() => fuelTanks.id),
    consumptionDate: timestamp("consumption_date", { withTimezone: true }).notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [index("ix_fuel_consumption_tank_date").on(t.fuelTankId, t.consumptionDate)],
);

export const announcements = pgTable(
  "announcement",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    status: varchar("status", { length: 32 }).notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [
    index("ix_announcement_tenant_site").on(t.tenantId, t.siteId),
    index("ix_announcement_status").on(t.siteId, t.status),
  ],
);
