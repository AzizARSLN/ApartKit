import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  announcements,
  employees,
  fuelConsumptions,
  fuelPurchases,
  fuelTanks,
  ticketComments,
  tickets,
} from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { MoneyStringSchema } from "../../shared/utils/money.js";

const CreateTicketSchema = z.object({
  siteId: z.number().int().positive(),
  unitId: z.number().int().positive().optional().nullable(),
  title: z.string().min(1).max(255),
  category: z.string().max(64).default("GENERAL"),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  assignedEmployeeId: z.number().int().positive().optional().nullable(),
});

const PatchTicketSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedEmployeeId: z.number().int().positive().optional().nullable(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional().nullable(),
});

const CommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

const AnnouncementSchema = z.object({
  siteId: z.number().int().positive(),
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(20000),
  publishedAt: z.coerce.date().optional().nullable(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
});

const FuelTankSchema = z.object({
  siteId: z.number().int().positive(),
  fuelType: z.string().min(1).max(64),
  capacity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unit: z.string().max(16).default("LT"),
  minimumStock: z.string().regex(/^\d+(\.\d{1,3})?$/).default("0"),
});

const FuelPurchaseSchema = z.object({
  fuelTankId: z.number().int().positive(),
  supplierId: z.number().int().positive().optional().nullable(),
  purchaseDate: z.coerce.date(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/),
  totalAmount: MoneyStringSchema,
});

const FuelConsumptionSchema = z.object({
  fuelTankId: z.number().int().positive(),
  consumptionDate: z.coerce.date(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  note: z.string().max(2000).optional().nullable(),
});

export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/tickets",
    { preHandler: [authenticate, requirePermission(Permission.TICKET_MANAGE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = z
        .object({
          siteId: z.coerce.number().int().positive().optional(),
          status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
        })
        .parse(request.query);

      const filters = [eq(tickets.tenantId, tenantId)];
      if (query.siteId) filters.push(eq(tickets.siteId, query.siteId));
      if (query.status) filters.push(eq(tickets.status, query.status));

      return db
        .select()
        .from(tickets)
        .where(and(...filters))
        .orderBy(desc(tickets.createdAt));
    },
  );

  app.post(
    "/tickets",
    { preHandler: [authenticate, requirePermission(Permission.TICKET_MANAGE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreateTicketSchema.parse(request.body);

      if (body.assignedEmployeeId != null) {
        const [employee] = await db
          .select()
          .from(employees)
          .where(
            and(eq(employees.id, body.assignedEmployeeId), eq(employees.tenantId, tenantId)),
          )
          .limit(1);
        if (!employee) throw new AppError("NOT_FOUND", "Atanan personel bulunamadı.", 404);
      }

      const [created] = await db
        .insert(tickets)
        .values({
          tenantId,
          siteId: body.siteId,
          unitId: body.unitId ?? null,
          title: body.title,
          category: body.category,
          description: body.description ?? null,
          priority: body.priority,
          assignedEmployeeId: body.assignedEmployeeId ?? null,
          status: "OPEN",
          createdByUserId: request.authUser.id,
        })
        .returning();

      return created;
    },
  );

  app.patch(
    "/tickets/:id",
    { preHandler: [authenticate, requirePermission(Permission.TICKET_MANAGE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = PatchTicketSchema.parse(request.body);

      const [existing] = await db
        .select()
        .from(tickets)
        .where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId)))
        .limit(1);
      if (!existing) throw new AppError("NOT_FOUND", "Ticket bulunamadı.", 404);

      const [updated] = await db
        .update(tickets)
        .set({
          status: body.status ?? existing.status,
          priority: body.priority ?? existing.priority,
          assignedEmployeeId:
            body.assignedEmployeeId === undefined
              ? existing.assignedEmployeeId
              : body.assignedEmployeeId,
          title: body.title ?? existing.title,
          description:
            body.description === undefined ? existing.description : body.description,
        })
        .where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId)))
        .returning();

      return updated;
    },
  );

  app.post(
    "/tickets/:id/comments",
    { preHandler: [authenticate, requirePermission(Permission.TICKET_MANAGE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = CommentSchema.parse(request.body);

      const [ticket] = await db
        .select()
        .from(tickets)
        .where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId)))
        .limit(1);
      if (!ticket) throw new AppError("NOT_FOUND", "Ticket bulunamadı.", 404);

      const [created] = await db
        .insert(ticketComments)
        .values({
          ticketId: id,
          body: body.body,
          createdBy: request.authUser.id,
        })
        .returning();

      return created;
    },
  );

  app.get(
    "/announcements",
    { preHandler: [authenticate, requirePermission(Permission.SITE_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = z
        .object({
          siteId: z.coerce.number().int().positive().optional(),
        })
        .parse(request.query);

      const where = query.siteId
        ? and(eq(announcements.tenantId, tenantId), eq(announcements.siteId, query.siteId))
        : eq(announcements.tenantId, tenantId);

      return db
        .select()
        .from(announcements)
        .where(where)
        .orderBy(desc(announcements.createdAt));
    },
  );

  app.post(
    "/announcements",
    { preHandler: [authenticate, requirePermission(Permission.ANNOUNCEMENT_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = AnnouncementSchema.parse(request.body);

      const [created] = await db
        .insert(announcements)
        .values({
          tenantId,
          siteId: body.siteId,
          title: body.title,
          body: body.body,
          publishedAt:
            body.status === "PUBLISHED"
              ? (body.publishedAt ?? new Date())
              : (body.publishedAt ?? null),
          status: body.status,
          createdBy: request.authUser.id,
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: body.siteId,
        userId: request.authUser.id,
        action: "ANNOUNCEMENT_CREATE",
        entityType: "announcement",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );

  app.get(
    "/fuel/tanks",
    { preHandler: [authenticate, requirePermission(Permission.SITE_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = z
        .object({
          siteId: z.coerce.number().int().positive().optional(),
        })
        .parse(request.query);

      const where = query.siteId
        ? and(eq(fuelTanks.tenantId, tenantId), eq(fuelTanks.siteId, query.siteId))
        : eq(fuelTanks.tenantId, tenantId);

      return db.select().from(fuelTanks).where(where).orderBy(fuelTanks.fuelType);
    },
  );

  app.post(
    "/fuel/tanks",
    { preHandler: [authenticate, requirePermission(Permission.SITE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = FuelTankSchema.parse(request.body);

      const [created] = await db
        .insert(fuelTanks)
        .values({
          tenantId,
          siteId: body.siteId,
          fuelType: body.fuelType,
          capacity: body.capacity,
          unit: body.unit,
          minimumStock: body.minimumStock,
        })
        .returning();

      return created;
    },
  );

  app.post(
    "/fuel/purchases",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = FuelPurchaseSchema.parse(request.body);

      const [tank] = await db
        .select()
        .from(fuelTanks)
        .where(and(eq(fuelTanks.id, body.fuelTankId), eq(fuelTanks.tenantId, tenantId)))
        .limit(1);
      if (!tank) throw new AppError("NOT_FOUND", "Yakıt tankı bulunamadı.", 404);

      const [created] = await db
        .insert(fuelPurchases)
        .values({
          fuelTankId: body.fuelTankId,
          supplierId: body.supplierId ?? null,
          purchaseDate: body.purchaseDate,
          quantity: body.quantity,
          unitPrice: body.unitPrice,
          totalAmount: body.totalAmount,
          createdBy: request.authUser.id,
        })
        .returning();

      return created;
    },
  );

  app.post(
    "/fuel/consumptions",
    { preHandler: [authenticate, requirePermission(Permission.SITE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = FuelConsumptionSchema.parse(request.body);

      const [tank] = await db
        .select()
        .from(fuelTanks)
        .where(and(eq(fuelTanks.id, body.fuelTankId), eq(fuelTanks.tenantId, tenantId)))
        .limit(1);
      if (!tank) throw new AppError("NOT_FOUND", "Yakıt tankı bulunamadı.", 404);

      const [created] = await db
        .insert(fuelConsumptions)
        .values({
          fuelTankId: body.fuelTankId,
          consumptionDate: body.consumptionDate,
          quantity: body.quantity,
          note: body.note ?? null,
          createdBy: request.authUser.id,
        })
        .returning();

      return created;
    },
  );

  app.get(
    "/fuel/tanks/:id/forecast",
    { preHandler: [authenticate, requirePermission(Permission.SITE_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

      const [tank] = await db
        .select()
        .from(fuelTanks)
        .where(and(eq(fuelTanks.id, id), eq(fuelTanks.tenantId, tenantId)))
        .limit(1);
      if (!tank) throw new AppError("NOT_FOUND", "Yakıt tankı bulunamadı.", 404);

      const [purchaseAgg] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${fuelPurchases.quantity}), 0)::text`,
        })
        .from(fuelPurchases)
        .where(eq(fuelPurchases.fuelTankId, id));

      const [consumptionAgg] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${fuelConsumptions.quantity}), 0)::text`,
        })
        .from(fuelConsumptions)
        .where(eq(fuelConsumptions.fuelTankId, id));

      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 30);

      const [avgAgg] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${fuelConsumptions.quantity}), 0)::text`,
        })
        .from(fuelConsumptions)
        .where(
          and(
            eq(fuelConsumptions.fuelTankId, id),
            gte(fuelConsumptions.consumptionDate, since),
          ),
        );

      const purchased = Number(purchaseAgg?.total ?? 0);
      const consumed = Number(consumptionAgg?.total ?? 0);
      const remainingStock = Math.max(0, purchased - consumed);
      const last30Consumption = Number(avgAgg?.total ?? 0);
      const avg30 = last30Consumption / 30;

      return {
        fuelTankId: id,
        capacity: tank.capacity,
        minimumStock: tank.minimumStock,
        remainingStock: remainingStock.toFixed(3),
        avg30: avg30.toFixed(3),
        daysRemaining: avg30 > 0 ? Number((remainingStock / avg30).toFixed(1)) : null,
      };
    },
  );
}
