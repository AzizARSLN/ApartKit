import { and, desc, eq, like, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { boardDecisions } from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { assertSiteInTenant } from "../../shared/auth/site-scope.js";
import { AppError } from "../../shared/errors/app-error.js";

const CreateDecisionSchema = z.object({
  siteId: z.number().int().positive(),
  decisionDate: z.coerce.date(),
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(20000),
});

export async function decisionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/decisions",
    { preHandler: [authenticate, requirePermission(Permission.SITE_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = z
        .object({ siteId: z.coerce.number().int().positive() })
        .parse(request.query);

      return db
        .select()
        .from(boardDecisions)
        .where(and(eq(boardDecisions.tenantId, tenantId), eq(boardDecisions.siteId, siteId)))
        .orderBy(desc(boardDecisions.decisionDate), desc(boardDecisions.id));
    },
  );

  app.post(
    "/decisions",
    { preHandler: [authenticate, requirePermission(Permission.ANNOUNCEMENT_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreateDecisionSchema.parse(request.body);
      await assertSiteInTenant(tenantId, body.siteId);

      return db.transaction(async (tx) => {
        // Aynı site için numara üretimini sıraya alır; numaralar boşluksuz ilerler.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${body.siteId})`);
        const year = body.decisionDate.getUTCFullYear();
        const [row] = await tx
          .select({ value: sql<string>`COUNT(*)::text` })
          .from(boardDecisions)
          .where(
            and(
              eq(boardDecisions.siteId, body.siteId),
              like(boardDecisions.decisionNo, `${year}/%`),
            ),
          );
        const decisionNo = `${year}/${String(Number(row?.value ?? 0) + 1).padStart(3, "0")}`;

        const [created] = await tx
          .insert(boardDecisions)
          .values({
            tenantId,
            siteId: body.siteId,
            decisionNo,
            decisionDate: body.decisionDate,
            title: body.title,
            body: body.body,
            createdBy: request.authUser.id,
          })
          .returning();

        await writeAudit(tx, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "DECISION_CREATE",
          entityType: "board_decision",
          entityId: created.id,
          newData: created,
        });
        return created;
      });
    },
  );

  app.post(
    "/decisions/:id/cancel",
    { preHandler: [authenticate, requirePermission(Permission.ANNOUNCEMENT_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(boardDecisions)
          .where(and(eq(boardDecisions.id, id), eq(boardDecisions.tenantId, tenantId)))
          .limit(1);
        if (!existing) throw new AppError("NOT_FOUND", "Karar bulunamadı.", 404);
        if (existing.status === "CANCELLED") {
          throw new AppError("INVALID_STATUS", "Karar zaten iptal edilmiş.", 409);
        }

        const [updated] = await tx
          .update(boardDecisions)
          .set({ status: "CANCELLED" })
          .where(eq(boardDecisions.id, id))
          .returning();

        await writeAudit(tx, {
          tenantId,
          siteId: existing.siteId,
          userId: request.authUser.id,
          action: "DECISION_CANCEL",
          entityType: "board_decision",
          entityId: id,
          oldData: existing,
          newData: updated,
        });
        return updated;
      });
    },
  );
}
