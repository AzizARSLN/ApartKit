import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/** Kurum: tüm tanımlar ve hareketler bu kayda (tenant_id FK) bağlanır. */
export const kurums = pgTable(
  "kurum",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    address: text("address"),
    taxNumber: varchar("tax_number", { length: 32 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 255 }),
    status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("ux_kurum_code").on(t.code)],
);

/** Geriye dönük alias — kolon adı tenant_id olarak kaldı, tablo kurum. */
export const tenants = kurums;

export const users = pgTable(
  "user",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("ux_user_tenant_email").on(t.tenantId, t.email),
    index("ix_user_tenant").on(t.tenantId),
  ],
);

export const userRoles = pgTable(
  "user_role",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    role: varchar("role", { length: 64 }).notNull(),
    siteId: bigint("site_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_user_role_scope").on(t.userId, t.role, t.siteId),
    index("ix_user_role_tenant").on(t.tenantId),
  ],
);

export const refreshTokens = pgTable(
  "refresh_token",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_refresh_token_hash").on(t.tokenHash),
    index("ix_refresh_token_user").on(t.userId),
  ],
);

export const auditLogs = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    siteId: bigint("site_id", { mode: "number" }),
    userId: bigint("user_id", { mode: "number" }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    oldData: jsonb("old_data"),
    newData: jsonb("new_data"),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_audit_tenant_created").on(t.tenantId, t.createdAt),
    index("ix_audit_entity").on(t.entityType, t.entityId),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_key",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    userId: bigint("user_id", { mode: "number" }),
    key: varchar("key", { length: 128 }).notNull(),
    method: varchar("method", { length: 16 }).notNull(),
    path: varchar("path", { length: 512 }).notNull(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    responseStatus: bigint("response_status", { mode: "number" }).notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("ux_idempotency_tenant_key").on(t.tenantId, t.key)],
);

export const sites = pgTable(
  "site",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    address: text("address"),
    status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("ux_site_tenant_code").on(t.tenantId, t.code),
    index("ix_site_tenant").on(t.tenantId),
  ],
);

export const blocks = pgTable(
  "block",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    name: varchar("name", { length: 100 }).notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("ux_block_site_code").on(t.siteId, t.code),
    index("ix_block_tenant_site").on(t.tenantId, t.siteId),
  ],
);

export const units = pgTable(
  "unit",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    siteId: bigint("site_id", { mode: "number" })
      .notNull()
      .references(() => sites.id),
    blockId: bigint("block_id", { mode: "number" }).references(() => blocks.id),
    unitNo: varchar("unit_no", { length: 32 }).notNull(),
    floorNo: varchar("floor_no", { length: 32 }),
    grossM2: numeric("gross_m2", { precision: 12, scale: 2 }),
    netM2: numeric("net_m2", { precision: 12, scale: 2 }),
    landShare: numeric("land_share", { precision: 18, scale: 6 }),
    status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("ux_unit_site_block_no").on(t.siteId, t.blockId, t.unitNo),
    index("ix_unit_tenant_site").on(t.tenantId, t.siteId),
  ],
);

export const persons = pgTable(
  "person",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    identityNumber: varchar("identity_number", { length: 32 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 255 }),
    /** Site board role: MANAGER / ASSISTANT_MANAGER → monthly AIDAT = 0 */
    managementRole: varchar("management_role", { length: 32 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "number" }),
    updatedBy: bigint("updated_by", { mode: "number" }),
  },
  (t) => [index("ix_person_tenant").on(t.tenantId)],
);

export const unitOwnerships = pgTable(
  "unit_ownership",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => units.id),
    personId: bigint("person_id", { mode: "number" })
      .notNull()
      .references(() => persons.id),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    shareRate: numeric("share_rate", { precision: 8, scale: 4 }).notNull().default("1"),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [index("ix_ownership_unit").on(t.unitId), index("ix_ownership_person").on(t.personId)],
);

export const unitOccupancies = pgTable(
  "unit_occupancy",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => units.id),
    personId: bigint("person_id", { mode: "number" })
      .notNull()
      .references(() => persons.id),
    occupancyType: varchar("occupancy_type", { length: 32 }).notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: bigint("created_by", { mode: "number" }),
  },
  (t) => [index("ix_occupancy_unit").on(t.unitId)],
);
