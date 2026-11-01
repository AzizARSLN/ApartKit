import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees, leaveRequests, persons } from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { MoneyStringSchema } from "../../shared/utils/money.js";

const CreateEmployeeSchema = z.object({
  siteId: z.number().int().positive(),
  personId: z.number().int().positive(),
  position: z.string().min(1).max(128),
  hireDate: z.coerce.date(),
  leaveDate: z.coerce.date().optional().nullable(),
  salary: MoneyStringSchema.optional().nullable(),
  iban: z.string().max(34).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "LEFT"]).default("ACTIVE"),
});

const CreateLeaveSchema = z.object({
  employeeId: z.number().int().positive(),
  leaveType: z.enum(["ANNUAL", "SICK", "UNPAID", "OTHER"]),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  dayCount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  reason: z.string().max(2000).optional().nullable(),
});

export async function personnelRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/employees",
    { preHandler: [authenticate, requirePermission(Permission.EMPLOYEE_MANAGE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = z
        .object({
          siteId: z.coerce.number().int().positive().optional(),
        })
        .parse(request.query);

      const where = query.siteId
        ? and(eq(employees.tenantId, tenantId), eq(employees.siteId, query.siteId))
        : eq(employees.tenantId, tenantId);

      return db.select().from(employees).where(where).orderBy(desc(employees.hireDate));
    },
  );

  app.post(
    "/employees",
    { preHandler: [authenticate, requirePermission(Permission.EMPLOYEE_MANAGE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreateEmployeeSchema.parse(request.body);

      const [person] = await db
        .select()
        .from(persons)
        .where(and(eq(persons.id, body.personId), eq(persons.tenantId, tenantId)))
        .limit(1);
      if (!person) throw new AppError("NOT_FOUND", "Kişi bulunamadı.", 404);

      const [created] = await db
        .insert(employees)
        .values({
          tenantId,
          siteId: body.siteId,
          personId: body.personId,
          position: body.position,
          hireDate: body.hireDate,
          leaveDate: body.leaveDate ?? null,
          salary: body.salary ?? null,
          iban: body.iban ?? null,
          status: body.status,
          createdBy: request.authUser.id,
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: body.siteId,
        userId: request.authUser.id,
        action: "EMPLOYEE_CREATE",
        entityType: "employee",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );

  app.post(
    "/leave-requests",
    { preHandler: [authenticate, requirePermission(Permission.EMPLOYEE_MANAGE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreateLeaveSchema.parse(request.body);

      const [employee] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.id, body.employeeId), eq(employees.tenantId, tenantId)))
        .limit(1);
      if (!employee) throw new AppError("NOT_FOUND", "Personel bulunamadı.", 404);

      if (body.endDate < body.startDate) {
        throw new AppError("INVALID_DATE_RANGE", "Bitiş tarihi başlangıçtan önce olamaz.", 400);
      }

      const [created] = await db
        .insert(leaveRequests)
        .values({
          employeeId: body.employeeId,
          leaveType: body.leaveType,
          startDate: body.startDate,
          endDate: body.endDate,
          dayCount: body.dayCount,
          reason: body.reason ?? null,
          status: "PENDING",
        })
        .returning();

      return created;
    },
  );

  app.post(
    "/leave-requests/:id/approve",
    { preHandler: [authenticate, requirePermission(Permission.LEAVE_APPROVE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = z
        .object({
          decision: z.enum(["APPROVED", "REJECTED"]).default("APPROVED"),
        })
        .parse(request.body ?? {});

      const [existing] = await db
        .select({
          leave: leaveRequests,
          employee: employees,
        })
        .from(leaveRequests)
        .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
        .where(and(eq(leaveRequests.id, id), eq(employees.tenantId, tenantId)))
        .limit(1);

      if (!existing) throw new AppError("NOT_FOUND", "İzin talebi bulunamadı.", 404);
      if (existing.leave.status !== "PENDING") {
        throw new AppError("INVALID_STATUS", "Yalnızca bekleyen izinler onaylanabilir.", 409);
      }

      const [updated] = await db
        .update(leaveRequests)
        .set({
          status: body.decision,
          approvedBy: request.authUser.id,
        })
        .where(eq(leaveRequests.id, id))
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: existing.employee.siteId,
        userId: request.authUser.id,
        action: body.decision === "APPROVED" ? "LEAVE_APPROVE" : "LEAVE_REJECT",
        entityType: "leave_request",
        entityId: id,
        oldData: existing.leave,
        newData: updated,
      });

      return updated;
    },
  );
}
