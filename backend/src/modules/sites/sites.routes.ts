import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, pool } from "../../db/client.js";
import { blocks, sites, units } from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  PaginationQuerySchema,
  paginatedResult,
  paginationOffset,
} from "../../shared/pagination/pagination.js";

const CreateSiteSchema = z.object({
  name: z.string().min(2).max(200),
  code: z.string().min(1).max(64),
  address: z.string().max(1000).optional(),
});

const CreateBlockSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(64),
});

const CreateUnitSchema = z.object({
  blockId: z.number().int().positive().optional().nullable(),
  unitNo: z.string().min(1).max(32),
  floorNo: z.string().max(32).optional(),
  grossM2: z.string().optional(),
  netM2: z.string().optional(),
  landShare: z.string().optional(),
});

const UpdateUnitSchema = z.object({
  unitNo: z.string().trim().min(1).max(32).optional(),
  floorNo: z.string().trim().max(32).nullable().optional(),
  grossM2: z.string().trim().max(32).nullable().optional(),
  netM2: z.string().trim().max(32).nullable().optional(),
  landShare: z.string().trim().max(32).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

function optionalMoneyField(value: string | null | undefined, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new AppError("INVALID_AMOUNT", `${label} geçersiz.`, 400);
  }
  return trimmed;
}

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/sites",
    { preHandler: [authenticate, requirePermission(Permission.SITE_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = PaginationQuerySchema.parse(request.query);
      const { limit, offset } = paginationOffset(query);

      const where = eq(sites.tenantId, tenantId);
      const [totalRow] = await db.select({ value: count() }).from(sites).where(where);
      const items = await db
        .select()
        .from(sites)
        .where(where)
        .limit(limit)
        .offset(offset)
        .orderBy(sites.id);

      return paginatedResult(items, Number(totalRow?.value ?? 0), query);
    },
  );

  app.post(
    "/sites",
    { preHandler: [authenticate, requirePermission(Permission.SITE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreateSiteSchema.parse(request.body);
      const [created] = await db
        .insert(sites)
        .values({
          tenantId,
          name: body.name,
          code: body.code.toUpperCase(),
          address: body.address,
          createdBy: request.authUser.id,
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: created.id,
        userId: request.authUser.id,
        action: "SITE_CREATE",
        entityType: "site",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );

  app.get(
    "/sites/:siteId",
    { preHandler: [authenticate, requirePermission(Permission.SITE_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.params);
      const [site] = await db
        .select()
        .from(sites)
        .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
        .limit(1);
      if (!site) throw new AppError("NOT_FOUND", "Site bulunamadı.", 404);
      return site;
    },
  );

  app.get(
    "/sites/:siteId/blocks",
    { preHandler: [authenticate, requirePermission(Permission.SITE_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.params);
      return db
        .select()
        .from(blocks)
        .where(and(eq(blocks.siteId, siteId), eq(blocks.tenantId, tenantId)))
        .orderBy(blocks.code);
    },
  );

  app.post(
    "/sites/:siteId/blocks",
    { preHandler: [authenticate, requirePermission(Permission.SITE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.params);
      const body = CreateBlockSchema.parse(request.body);

      const [site] = await db
        .select()
        .from(sites)
        .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
        .limit(1);
      if (!site) throw new AppError("NOT_FOUND", "Site bulunamadı.", 404);

      const [created] = await db
        .insert(blocks)
        .values({
          tenantId,
          siteId,
          name: body.name,
          code: body.code.toUpperCase(),
          createdBy: request.authUser.id,
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId,
        userId: request.authUser.id,
        action: "BLOCK_CREATE",
        entityType: "block",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );

  app.get(
    "/sites/:siteId/units",
    { preHandler: [authenticate, requirePermission(Permission.UNIT_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.params);
      const query = PaginationQuerySchema.extend({
        q: z.string().trim().max(100).optional(),
      }).parse(request.query);
      const { limit, offset } = paginationOffset(query);
      const search = query.q?.trim() ? `%${query.q.trim()}%` : null;

      const countResult = await pool.query<{ value: string }>(
        `
        SELECT COUNT(*)::text AS value
        FROM unit u
        WHERE u.tenant_id = $1
          AND u.site_id = $2
          AND (
            $3::text IS NULL
            OR u.unit_no ILIKE $3
            OR COALESCE(u.floor_no, '') ILIKE $3
            OR EXISTS (
              SELECT 1
              FROM (
                SELECT person_id FROM unit_occupancy
                WHERE unit_id = u.id AND tenant_id = $1
                  AND (end_date IS NULL OR end_date > now())
                UNION
                SELECT person_id FROM unit_ownership
                WHERE unit_id = u.id AND tenant_id = $1
                  AND (end_date IS NULL OR end_date > now())
              ) links
              JOIN person p ON p.id = links.person_id AND p.deleted_at IS NULL
              WHERE (p.first_name || ' ' || p.last_name) ILIKE $3
                 OR COALESCE(p.phone, '') ILIKE $3
                 OR COALESCE(p.email, '') ILIKE $3
            )
          )
        `,
        [tenantId, siteId, search],
      );

      const result = await pool.query<{
        id: string;
        unit_no: string;
        floor_no: string | null;
        gross_m2: string | null;
        net_m2: string | null;
        land_share: string | null;
        status: string;
        residents: Array<{
          personId: number;
          firstName: string;
          lastName: string;
          phone: string | null;
          email: string | null;
          role: string;
        }> | null;
      }>(
        `
        SELECT
          u.id,
          u.unit_no,
          u.floor_no,
          u.gross_m2,
          u.net_m2,
          u.land_share,
          u.status,
          COALESCE((
            SELECT json_agg(
              json_build_object(
                'personId', r."personId",
                'firstName', r."firstName",
                'lastName', r."lastName",
                'phone', r.phone,
                'email', r.email,
                'role', r.role
              )
              ORDER BY r.role_order, r."lastName", r."firstName"
            )
            FROM (
              SELECT DISTINCT ON (p.id)
                p.id AS "personId",
                p.first_name AS "firstName",
                p.last_name AS "lastName",
                p.phone,
                p.email,
                CASE
                  WHEN occ.occupancy_type = 'TENANT' THEN 'Kiracı'
                  WHEN occ.occupancy_type = 'OWNER_OCCUPIED' THEN 'Ev Sahibi'
                  WHEN occ.occupancy_type = 'OTHER' THEN 'Diğer'
                  WHEN ow.id IS NOT NULL THEN 'Malik'
                  ELSE 'Sakin'
                END AS role,
                CASE
                  WHEN occ.occupancy_type = 'TENANT' THEN 1
                  WHEN occ.occupancy_type = 'OWNER_OCCUPIED' THEN 2
                  WHEN occ.occupancy_type = 'OTHER' THEN 3
                  WHEN ow.id IS NOT NULL THEN 4
                  ELSE 5
                END AS role_order
              FROM person p
              LEFT JOIN unit_occupancy occ
                ON occ.person_id = p.id
               AND occ.unit_id = u.id
               AND occ.tenant_id = $1
               AND (occ.end_date IS NULL OR occ.end_date > now())
              LEFT JOIN unit_ownership ow
                ON ow.person_id = p.id
               AND ow.unit_id = u.id
               AND ow.tenant_id = $1
               AND (ow.end_date IS NULL OR ow.end_date > now())
              WHERE p.deleted_at IS NULL
                AND (occ.id IS NOT NULL OR ow.id IS NOT NULL)
              ORDER BY p.id, role_order
            ) r
          ), '[]'::json) AS residents
        FROM unit u
        WHERE u.tenant_id = $1
          AND u.site_id = $2
          AND (
            $3::text IS NULL
            OR u.unit_no ILIKE $3
            OR COALESCE(u.floor_no, '') ILIKE $3
            OR EXISTS (
              SELECT 1
              FROM (
                SELECT person_id FROM unit_occupancy
                WHERE unit_id = u.id AND tenant_id = $1
                  AND (end_date IS NULL OR end_date > now())
                UNION
                SELECT person_id FROM unit_ownership
                WHERE unit_id = u.id AND tenant_id = $1
                  AND (end_date IS NULL OR end_date > now())
              ) links
              JOIN person p ON p.id = links.person_id AND p.deleted_at IS NULL
              WHERE (p.first_name || ' ' || p.last_name) ILIKE $3
                 OR COALESCE(p.phone, '') ILIKE $3
                 OR COALESCE(p.email, '') ILIKE $3
            )
          )
        ORDER BY CASE WHEN u.unit_no ~ '^[0-9]+$' THEN u.unit_no::int ELSE 999 END, u.unit_no
        LIMIT $4 OFFSET $5
        `,
        [tenantId, siteId, search, limit, offset],
      );

      const items = result.rows.map((row) => ({
        id: Number(row.id),
        unitNo: row.unit_no,
        floorNo: row.floor_no,
        grossM2: row.gross_m2,
        netM2: row.net_m2,
        landShare: row.land_share,
        status: row.status,
        residents: Array.isArray(row.residents) ? row.residents : [],
      }));

      return paginatedResult(items, Number(countResult.rows[0]?.value ?? 0), query);
    },
  );

  app.patch(
    "/sites/:siteId/units/:unitId",
    { preHandler: [authenticate, requirePermission(Permission.UNIT_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const params = z
        .object({
          siteId: z.coerce.number().int().positive(),
          unitId: z.coerce.number().int().positive(),
        })
        .parse(request.params);
      const body = UpdateUnitSchema.parse(request.body);

      const [existing] = await db
        .select()
        .from(units)
        .where(
          and(
            eq(units.id, params.unitId),
            eq(units.siteId, params.siteId),
            eq(units.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!existing) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

      const nextUnitNo = body.unitNo ?? existing.unitNo;
      if (nextUnitNo !== existing.unitNo) {
        const [dup] = await db
          .select({ id: units.id })
          .from(units)
          .where(
            and(
              eq(units.tenantId, tenantId),
              eq(units.siteId, params.siteId),
              eq(units.unitNo, nextUnitNo),
            ),
          )
          .limit(1);
        if (dup && dup.id !== existing.id) {
          throw new AppError("UNIT_NO_EXISTS", "Bu daire numarası zaten kayıtlı.", 409);
        }
      }

      const grossM2 = optionalMoneyField(body.grossM2, "Brüt m²");
      const netM2 = optionalMoneyField(body.netM2, "Net m²");
      const landShare = optionalMoneyField(body.landShare, "Arsa payı");

      const [updated] = await db
        .update(units)
        .set({
          unitNo: nextUnitNo,
          floorNo:
            body.floorNo === undefined
              ? existing.floorNo
              : body.floorNo?.trim()
                ? body.floorNo.trim()
                : null,
          grossM2: grossM2 === undefined ? existing.grossM2 : grossM2,
          netM2: netM2 === undefined ? existing.netM2 : netM2,
          landShare: landShare === undefined ? existing.landShare : landShare,
          status: body.status ?? existing.status,
          updatedAt: new Date(),
          updatedBy: request.authUser.id,
        })
        .where(eq(units.id, existing.id))
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: params.siteId,
        userId: request.authUser.id,
        action: "UNIT_UPDATE",
        entityType: "unit",
        entityId: updated.id,
        oldData: existing,
        newData: updated,
      });

      return {
        id: updated.id,
        unitNo: updated.unitNo,
        floorNo: updated.floorNo,
        grossM2: updated.grossM2,
        netM2: updated.netM2,
        landShare: updated.landShare,
        status: updated.status,
      };
    },
  );

  app.post(
    "/sites/:siteId/units",
    { preHandler: [authenticate, requirePermission(Permission.UNIT_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.params);
      const body = CreateUnitSchema.parse(request.body);

      const [site] = await db
        .select()
        .from(sites)
        .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
        .limit(1);
      if (!site) throw new AppError("NOT_FOUND", "Site bulunamadı.", 404);

      if (body.blockId) {
        const [block] = await db
          .select()
          .from(blocks)
          .where(
            and(eq(blocks.id, body.blockId), eq(blocks.siteId, siteId), eq(blocks.tenantId, tenantId)),
          )
          .limit(1);
        if (!block) throw new AppError("NOT_FOUND", "Blok bulunamadı.", 404);
      }

      const [created] = await db
        .insert(units)
        .values({
          tenantId,
          siteId,
          blockId: body.blockId ?? null,
          unitNo: body.unitNo,
          floorNo: body.floorNo,
          grossM2: body.grossM2,
          netM2: body.netM2,
          landShare: body.landShare,
          createdBy: request.authUser.id,
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId,
        userId: request.authUser.id,
        action: "UNIT_CREATE",
        entityType: "unit",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );
}
