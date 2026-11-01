import { and, count, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { auditLogs, users } from "../../db/schema/index.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import {
  paginatedResult,
  paginationOffset,
  PaginationQuerySchema,
} from "../../shared/pagination/pagination.js";

const AuditQuerySchema = PaginationQuerySchema.extend({
  siteId: z.coerce.number().int().positive().optional(),
  action: z.string().max(100).optional(),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/audit-logs",
    { preHandler: [authenticate, requirePermission(Permission.AUDIT_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = AuditQuerySchema.parse(request.query);
      const { limit, offset } = paginationOffset(query);

      const filters = [eq(auditLogs.tenantId, tenantId)];
      if (query.siteId) filters.push(eq(auditLogs.siteId, query.siteId));
      if (query.action) filters.push(eq(auditLogs.action, query.action));
      const where = and(...filters);

      const [totalRow] = await db.select({ value: count() }).from(auditLogs).where(where);
      const items = await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          createdAt: auditLogs.createdAt,
          userName: users.fullName,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit)
        .offset(offset);

      return paginatedResult(items, Number(totalRow?.value ?? 0), query);
    },
  );
}
