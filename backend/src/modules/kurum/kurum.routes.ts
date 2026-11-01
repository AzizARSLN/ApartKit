import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { kurums, sites } from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";

const UpdateKurumSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  code: z.string().trim().min(1).max(64).optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  taxNumber: z.string().trim().max(32).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
});

async function loadKurumBundle(kurumId: number) {
  const [kurum] = await db.select().from(kurums).where(eq(kurums.id, kurumId)).limit(1);
  if (!kurum) throw new AppError("NOT_FOUND", "Kurum bulunamadı.", 404);

  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.tenantId, kurumId))
    .orderBy(sites.id)
    .limit(1);

  return {
    id: kurum.id,
    name: kurum.name,
    code: kurum.code,
    address: kurum.address,
    taxNumber: kurum.taxNumber,
    phone: kurum.phone,
    email: kurum.email,
    status: kurum.status,
    createdAt: kurum.createdAt,
    updatedAt: kurum.updatedAt,
    siteId: site?.id ?? null,
    siteName: site?.name ?? null,
  };
}

export async function kurumRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/kurum/me",
    { preHandler: [authenticate, requirePermission(Permission.TENANT_READ)] },
    async (request) => loadKurumBundle(getTenantId(request)),
  );

  // Geriye dönük uyumluluk
  app.get(
    "/tenants/me",
    { preHandler: [authenticate, requirePermission(Permission.TENANT_READ)] },
    async (request) => loadKurumBundle(getTenantId(request)),
  );

  app.patch(
    "/kurum/me",
    { preHandler: [authenticate, requirePermission(Permission.TENANT_WRITE)] },
    async (request) => {
      const kurumId = getTenantId(request);
      const body = UpdateKurumSchema.parse(request.body);

      const [existing] = await db.select().from(kurums).where(eq(kurums.id, kurumId)).limit(1);
      if (!existing) throw new AppError("NOT_FOUND", "Kurum bulunamadı.", 404);

      const nextCode = body.code ? body.code.toUpperCase() : undefined;
      const [updated] = await db
        .update(kurums)
        .set({
          name: body.name ?? existing.name,
          code: nextCode ?? existing.code,
          address: body.address === undefined ? existing.address : body.address,
          taxNumber: body.taxNumber === undefined ? existing.taxNumber : body.taxNumber,
          phone: body.phone === undefined ? existing.phone : body.phone,
          email: body.email === undefined ? existing.email : body.email,
          updatedAt: new Date(),
        })
        .where(eq(kurums.id, kurumId))
        .returning();

      // Kurumla 1:1 operasyon sitesini senkron tut
      const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.tenantId, kurumId))
        .orderBy(sites.id)
        .limit(1);

      if (site) {
        await db
          .update(sites)
          .set({
            name: updated.name,
            code: updated.code,
            address: updated.address,
            updatedAt: new Date(),
            updatedBy: request.authUser.id,
          })
          .where(eq(sites.id, site.id));
      }

      await writeAudit(db, {
        tenantId: kurumId,
        siteId: site?.id ?? null,
        userId: request.authUser.id,
        action: "KURUM_UPDATE",
        entityType: "kurum",
        entityId: updated.id,
        oldData: existing,
        newData: updated,
      });

      return loadKurumBundle(kurumId);
    },
  );
}
