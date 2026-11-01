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
import { persons, sites, tenants } from "./core.js";

export const employees = pgTable(
  "employee",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    personId: bigint("person_id", { mode: "number" })
      .notNull()
      .references(() => persons.id),
    position: varchar("position", { length: 128 }).notNull(),
    hireDate: timestamp("hire_date", { withTimezone: true }).notNull(),
    leaveDate: timestamp("leave_date", { withTimezone: true }),
    salary: numeric("salary", { precision: 18, scale: 2 }),
    iban: varchar("iban", { length: 34 }),
    status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("ux_employee_site_person").on(t.siteId, t.personId),
    index("ix_employee_tenant_site").on(t.tenantId, t.siteId),
  ],
);

export const leaveRequests = pgTable(
  "leave_request",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id),
    leaveType: varchar("leave_type", { length: 64 }).notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    dayCount: numeric("day_count", { precision: 8, scale: 2 }).notNull(),
    reason: text("reason"),
    status: varchar("status", { length: 32 }).notNull().default("PENDING"),
    approvedBy: bigint("approved_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_leave_request_employee").on(t.employeeId),
    index("ix_leave_request_status").on(t.status),
  ],
);
