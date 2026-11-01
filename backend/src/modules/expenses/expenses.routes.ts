import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, pool } from "../../db/client.js";
import { expenseCategories, expenses, suppliers } from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { MoneyStringSchema } from "../../shared/utils/money.js";

const SupplierSchema = z.object({
  name: z.string().min(1).max(200),
  taxNo: z.string().max(32).optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
});

const ExpenseCategorySchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
});

const CreateExpenseSchema = z.object({
  siteId: z.number().int().positive(),
  expenseDate: z.coerce.date(),
  categoryId: z.number().int().positive(),
  supplierId: z.number().int().positive().optional().nullable(),
  amount: MoneyStringSchema,
  taxAmount: MoneyStringSchema.optional().default("0"),
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]).default("UNPAID"),
  bankAccountId: z.number().int().positive().optional().nullable(),
  cashAccountId: z.number().int().positive().optional().nullable(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  invoiceNumber: z.string().max(64).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
});

const UpdateExpenseSchema = z.object({
  categoryId: z.number().int().positive(),
  amount: MoneyStringSchema,
  description: z.string().max(2000).optional().nullable(),
});

export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/suppliers",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      return db
        .select()
        .from(suppliers)
        .where(eq(suppliers.tenantId, tenantId))
        .orderBy(suppliers.name);
    },
  );

  app.post(
    "/suppliers",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = SupplierSchema.parse(request.body);
      const [created] = await db
        .insert(suppliers)
        .values({
          tenantId,
          name: body.name,
          taxNo: body.taxNo ?? null,
          phone: body.phone ?? null,
          email: body.email ?? null,
        })
        .returning();
      return created;
    },
  );

  app.get(
    "/expense-categories",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      return db
        .select()
        .from(expenseCategories)
        .where(eq(expenseCategories.tenantId, tenantId))
        .orderBy(expenseCategories.code);
    },
  );

  app.post(
    "/expense-categories",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = ExpenseCategorySchema.parse(request.body);
      const [created] = await db
        .insert(expenseCategories)
        .values({
          tenantId,
          code: body.code.toUpperCase(),
          name: body.name,
        })
        .returning();
      return created;
    },
  );

  app.get(
    "/expenses",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = z
        .object({
          siteId: z.coerce.number().int().positive().optional(),
          period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        })
        .parse(request.query);

      const conditions = [eq(expenses.tenantId, tenantId)];
      if (query.siteId) conditions.push(eq(expenses.siteId, query.siteId));
      if (query.period) conditions.push(eq(expenses.period, query.period));

      const rows = await db
        .select({
          id: expenses.id,
          siteId: expenses.siteId,
          expenseDate: expenses.expenseDate,
          categoryId: expenses.categoryId,
          categoryCode: expenseCategories.code,
          categoryName: expenseCategories.name,
          amount: expenses.amount,
          paymentStatus: expenses.paymentStatus,
          bankTransactionId: expenses.bankTransactionId,
          period: expenses.period,
          description: expenses.description,
          status: expenses.status,
          createdAt: expenses.createdAt,
        })
        .from(expenses)
        .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .where(and(...conditions))
        .orderBy(desc(expenses.expenseDate), desc(expenses.id));

      return rows;
    },
  );

  app.get(
    "/expenses/periods",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = z
        .object({ siteId: z.coerce.number().int().positive() })
        .parse(request.query);

      const result = await pool.query<{
        period: string;
        expense_count: string;
        total_amount: string;
      }>(
        `
        SELECT
          period,
          COUNT(*)::text AS expense_count,
          COALESCE(SUM(amount), 0)::text AS total_amount
        FROM expense
        WHERE tenant_id = $1
          AND site_id = $2
          AND status <> 'CANCELLED'
          AND period IS NOT NULL
        GROUP BY period
        ORDER BY period DESC
        `,
        [tenantId, query.siteId],
      );

      return {
        items: result.rows.map((row) => ({
          period: row.period,
          expenseCount: Number(row.expense_count),
          totalAmount: row.total_amount,
        })),
      };
    },
  );

  app.post(
    "/expenses",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreateExpenseSchema.parse(request.body);

      const [category] = await db
        .select()
        .from(expenseCategories)
        .where(and(eq(expenseCategories.id, body.categoryId), eq(expenseCategories.tenantId, tenantId)))
        .limit(1);
      if (!category) throw new AppError("NOT_FOUND", "Gider kategorisi bulunamadı.", 404);

      if (body.supplierId != null) {
        const [supplier] = await db
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.id, body.supplierId), eq(suppliers.tenantId, tenantId)))
          .limit(1);
        if (!supplier) throw new AppError("NOT_FOUND", "Tedarikçi bulunamadı.", 404);
      }

      const [created] = await db
        .insert(expenses)
        .values({
          tenantId,
          siteId: body.siteId,
          expenseDate: body.expenseDate,
          categoryId: body.categoryId,
          supplierId: body.supplierId ?? null,
          amount: body.amount,
          taxAmount: body.taxAmount,
          paymentStatus: body.paymentStatus,
          bankAccountId: body.bankAccountId ?? null,
          cashAccountId: body.cashAccountId ?? null,
          period: body.period ?? null,
          invoiceNumber: body.invoiceNumber ?? null,
          description: body.description ?? null,
          status: "POSTED",
          createdBy: request.authUser.id,
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: body.siteId,
        userId: request.authUser.id,
        action: "EXPENSE_CREATE",
        entityType: "expense",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );

  app.patch(
    "/expenses/:id",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = UpdateExpenseSchema.parse(request.body);

      const [existing] = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)))
        .limit(1);
      if (!existing) throw new AppError("NOT_FOUND", "Gider bulunamadı.", 404);
      if (existing.status === "CANCELLED") {
        throw new AppError("ALREADY_CANCELLED", "İptal edilmiş gider güncellenemez.", 409);
      }

      const [category] = await db
        .select()
        .from(expenseCategories)
        .where(
          and(eq(expenseCategories.id, body.categoryId), eq(expenseCategories.tenantId, tenantId)),
        )
        .limit(1);
      if (!category) throw new AppError("NOT_FOUND", "Gider kategorisi bulunamadı.", 404);

      const [updated] = await db
        .update(expenses)
        .set({
          categoryId: body.categoryId,
          amount: body.amount,
          description: body.description ?? null,
        })
        .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)))
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: existing.siteId,
        userId: request.authUser.id,
        action: "EXPENSE_UPDATE",
        entityType: "expense",
        entityId: id,
        oldData: existing,
        newData: updated,
      });

      return updated;
    },
  );

  app.post(
    "/expenses/:id/cancel",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

      const [existing] = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)))
        .limit(1);
      if (!existing) throw new AppError("NOT_FOUND", "Gider bulunamadı.", 404);
      if (existing.status === "CANCELLED") {
        throw new AppError("ALREADY_CANCELLED", "Gider zaten iptal edilmiş.", 409);
      }

      const [updated] = await db
        .update(expenses)
        .set({ status: "CANCELLED" })
        .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)))
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: existing.siteId,
        userId: request.authUser.id,
        action: "EXPENSE_CANCEL",
        entityType: "expense",
        entityId: id,
        oldData: existing,
        newData: updated,
      });

      return updated;
    },
  );
}
