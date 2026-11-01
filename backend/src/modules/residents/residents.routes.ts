import { and, count, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, pool } from "../../db/client.js";
import { persons, sites, unitOccupancies, unitOwnerships, units } from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  PaginationQuerySchema,
  paginatedResult,
  paginationOffset,
} from "../../shared/pagination/pagination.js";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => {
      const trimmed = v?.trim();
      return trimmed ? trimmed : undefined;
    });

const CreatePersonSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  identityNumber: z.string().max(32).optional(),
  phone: z.string().max(32).optional(),
  email: z.string().email().optional(),
});

const ManagementRoleSchema = z.enum(["MANAGER", "ASSISTANT_MANAGER"]).nullable().optional();

const CreateResidentSchema = z.object({
  siteId: z.number().int().positive(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  floorNo: z.string().trim().min(1).max(32),
  unitNo: z.string().trim().min(1).max(32),
  phone: optionalText(32),
  email: z
    .string()
    .optional()
    .transform((v) => {
      const trimmed = v?.trim();
      return trimmed ? trimmed : undefined;
    })
    .pipe(z.string().email().optional()),
  residentType: z.enum(["OWNER", "TENANT"]),
  managementRole: ManagementRoleSchema,
});

const OwnershipSchema = z.object({
  personId: z.number().int().positive(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  shareRate: z.string().default("1"),
  isPrimary: z.boolean().default(true),
});

const OccupancySchema = z.object({
  personId: z.number().int().positive(),
  occupancyType: z.enum(["OWNER_OCCUPIED", "TENANT", "OTHER"]),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
});

export async function residentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/persons",
    { preHandler: [authenticate, requirePermission(Permission.PERSON_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = PaginationQuerySchema.parse(request.query);
      const { limit, offset } = paginationOffset(query);
      const where = and(eq(persons.tenantId, tenantId), isNull(persons.deletedAt));
      const [totalRow] = await db.select({ value: count() }).from(persons).where(where);
      const items = await db
        .select()
        .from(persons)
        .where(where)
        .limit(limit)
        .offset(offset)
        .orderBy(persons.lastName, persons.firstName);
      return paginatedResult(items, Number(totalRow?.value ?? 0), query);
    },
  );

  app.get(
    "/residents",
    { preHandler: [authenticate, requirePermission(Permission.PERSON_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = PaginationQuerySchema.extend({
        siteId: z.coerce.number().int().positive().optional(),
        q: z.string().trim().max(100).optional(),
        unitNo: z.string().trim().max(32).optional(),
        residentType: z.enum(["OWNER", "TENANT", "OTHER"]).optional(),
      }).parse(request.query);
      const { limit, offset } = paginationOffset(query);
      const search = query.q?.trim() ? `%${query.q.trim()}%` : null;
      const unitNo = query.unitNo?.trim() || null;
      const residentType = query.residentType ?? null;

      const countResult = await pool.query<{ value: string }>(
        `
        SELECT COUNT(*)::text AS value
        FROM person p
        LEFT JOIN LATERAL (
          SELECT u.floor_no, u.unit_no, u.site_id
          FROM (
            SELECT unit_id, start_date FROM unit_occupancy
            WHERE person_id = p.id AND tenant_id = $1
            UNION ALL
            SELECT unit_id, start_date FROM unit_ownership
            WHERE person_id = p.id AND tenant_id = $1
          ) links
          JOIN unit u ON u.id = links.unit_id AND u.tenant_id = $1
          WHERE ($2::bigint IS NULL OR u.site_id = $2)
          ORDER BY links.start_date DESC
          LIMIT 1
        ) u ON TRUE
        WHERE p.tenant_id = $1
          AND p.deleted_at IS NULL
          AND (
            $3::text IS NULL
            OR (p.first_name || ' ' || p.last_name) ILIKE $3
            OR COALESCE(p.phone, '') ILIKE $3
            OR COALESCE(p.email, '') ILIKE $3
            OR COALESCE(u.unit_no, '') ILIKE $3
          )
          AND ($4::text IS NULL OR u.unit_no = $4)
          AND (
            $5::text IS NULL
            OR COALESCE(
              (
                SELECT CASE o.occupancy_type
                  WHEN 'TENANT' THEN 'TENANT'
                  WHEN 'OWNER_OCCUPIED' THEN 'OWNER'
                  ELSE 'OTHER'
                END
                FROM unit_occupancy o
                WHERE o.person_id = p.id AND o.tenant_id = $1
                ORDER BY o.start_date DESC
                LIMIT 1
              ),
              (
                SELECT 'OWNER'
                FROM unit_ownership ow
                WHERE ow.person_id = p.id AND ow.tenant_id = $1
                ORDER BY ow.start_date DESC
                LIMIT 1
              )
            ) = $5
          )
        `,
        [tenantId, query.siteId ?? null, search, unitNo, residentType],
      );
      const total = Number(countResult.rows[0]?.value ?? 0);

      const result = await pool.query<{
        id: string;
        first_name: string;
        last_name: string;
        phone: string | null;
        email: string | null;
        floor_no: string | null;
        unit_no: string | null;
        resident_type: string | null;
        management_role: string | null;
      }>(
        `
        SELECT
          p.id,
          p.first_name,
          p.last_name,
          p.phone,
          p.email,
          p.management_role,
          u.floor_no,
          u.unit_no,
          COALESCE(
            (
              SELECT CASE o.occupancy_type
                WHEN 'TENANT' THEN 'TENANT'
                WHEN 'OWNER_OCCUPIED' THEN 'OWNER'
                ELSE 'OTHER'
              END
              FROM unit_occupancy o
              WHERE o.person_id = p.id AND o.tenant_id = $1
              ORDER BY o.start_date DESC
              LIMIT 1
            ),
            (
              SELECT 'OWNER'
              FROM unit_ownership ow
              WHERE ow.person_id = p.id AND ow.tenant_id = $1
              ORDER BY ow.start_date DESC
              LIMIT 1
            )
          ) AS resident_type
        FROM person p
        LEFT JOIN LATERAL (
          SELECT u.floor_no, u.unit_no, u.site_id
          FROM (
            SELECT unit_id, start_date FROM unit_occupancy
            WHERE person_id = p.id AND tenant_id = $1
            UNION ALL
            SELECT unit_id, start_date FROM unit_ownership
            WHERE person_id = p.id AND tenant_id = $1
          ) links
          JOIN unit u ON u.id = links.unit_id AND u.tenant_id = $1
          WHERE ($2::bigint IS NULL OR u.site_id = $2)
          ORDER BY links.start_date DESC
          LIMIT 1
        ) u ON TRUE
        WHERE p.tenant_id = $1
          AND p.deleted_at IS NULL
          AND (
            $3::text IS NULL
            OR (p.first_name || ' ' || p.last_name) ILIKE $3
            OR COALESCE(p.phone, '') ILIKE $3
            OR COALESCE(p.email, '') ILIKE $3
            OR COALESCE(u.unit_no, '') ILIKE $3
          )
          AND ($4::text IS NULL OR u.unit_no = $4)
          AND (
            $5::text IS NULL
            OR COALESCE(
              (
                SELECT CASE o.occupancy_type
                  WHEN 'TENANT' THEN 'TENANT'
                  WHEN 'OWNER_OCCUPIED' THEN 'OWNER'
                  ELSE 'OTHER'
                END
                FROM unit_occupancy o
                WHERE o.person_id = p.id AND o.tenant_id = $1
                ORDER BY o.start_date DESC
                LIMIT 1
              ),
              (
                SELECT 'OWNER'
                FROM unit_ownership ow
                WHERE ow.person_id = p.id AND ow.tenant_id = $1
                ORDER BY ow.start_date DESC
                LIMIT 1
              )
            ) = $5
          )
        ORDER BY p.last_name, p.first_name
        LIMIT $6
        OFFSET $7
        `,
        [tenantId, query.siteId ?? null, search, unitNo, residentType, limit, offset],
      );

      const items = result.rows.map((row) => ({
        id: Number(row.id),
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone,
        email: row.email,
        floorNo: row.floor_no,
        unitNo: row.unit_no,
        residentType: row.resident_type,
        managementRole: row.management_role,
      }));

      return paginatedResult(items, total, query);
    },
  );

  app.patch(
    "/residents/:id",
    { preHandler: [authenticate, requirePermission(Permission.PERSON_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = z
        .object({
          firstName: z.string().trim().min(1).max(100).optional(),
          lastName: z.string().trim().min(1).max(100).optional(),
          phone: optionalText(32).nullable().optional(),
          email: z
            .string()
            .optional()
            .nullable()
            .transform((v) => {
              if (v == null) return v;
              const trimmed = v.trim();
              return trimmed ? trimmed : null;
            })
            .pipe(z.string().email().nullable().optional()),
          floorNo: z.string().trim().min(1).max(32).optional(),
          unitNo: z.string().trim().min(1).max(32).optional(),
          managementRole: z.enum(["MANAGER", "ASSISTANT_MANAGER"]).nullable().optional(),
        })
        .parse(request.body);

      const [existing] = await db
        .select()
        .from(persons)
        .where(and(eq(persons.id, id), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
        .limit(1);
      if (!existing) throw new AppError("NOT_FOUND", "Sakin bulunamadı.", 404);

      const [updated] = await db
        .update(persons)
        .set({
          firstName: body.firstName ?? existing.firstName,
          lastName: body.lastName ?? existing.lastName,
          phone: body.phone === undefined ? existing.phone : body.phone,
          email: body.email === undefined ? existing.email : body.email,
          managementRole:
            body.managementRole === undefined ? existing.managementRole : body.managementRole,
          updatedAt: new Date(),
          updatedBy: request.authUser.id,
        })
        .where(eq(persons.id, id))
        .returning();

      const link = await pool.query<{ unit_id: string; site_id: string }>(
        `
        SELECT u.id AS unit_id, u.site_id
        FROM (
          SELECT unit_id, start_date FROM unit_occupancy WHERE person_id = $1 AND tenant_id = $2
          UNION ALL
          SELECT unit_id, start_date FROM unit_ownership WHERE person_id = $1 AND tenant_id = $2
        ) links
        JOIN unit u ON u.id = links.unit_id
        ORDER BY links.start_date DESC
        LIMIT 1
        `,
        [id, tenantId],
      );

      let floorNo: string | null = null;
      let unitNo: string | null = null;

      if (link.rows[0] && (body.floorNo || body.unitNo)) {
        const unitId = Number(link.rows[0].unit_id);
        const [unit] = await db.select().from(units).where(eq(units.id, unitId)).limit(1);
        if (unit) {
          const nextUnitNo = body.unitNo ?? unit.unitNo;
          const nextFloor = body.floorNo ?? unit.floorNo;
          if (nextUnitNo !== unit.unitNo) {
            const [target] = await db
              .select()
              .from(units)
              .where(
                and(
                  eq(units.tenantId, tenantId),
                  eq(units.siteId, unit.siteId),
                  eq(units.unitNo, nextUnitNo),
                ),
              )
              .limit(1);
            const destination =
              target ??
              (
                await db
                  .insert(units)
                  .values({
                    tenantId,
                    siteId: unit.siteId,
                    unitNo: nextUnitNo,
                    floorNo: nextFloor,
                    createdBy: request.authUser.id,
                  })
                  .returning()
              )[0];

            await db
              .update(unitOccupancies)
              .set({ unitId: destination.id })
              .where(and(eq(unitOccupancies.personId, id), eq(unitOccupancies.unitId, unitId)));
            await db
              .update(unitOwnerships)
              .set({ unitId: destination.id })
              .where(and(eq(unitOwnerships.personId, id), eq(unitOwnerships.unitId, unitId)));
            if (body.floorNo && destination.floorNo !== body.floorNo) {
              await db
                .update(units)
                .set({ floorNo: body.floorNo, updatedAt: new Date(), updatedBy: request.authUser.id })
                .where(eq(units.id, destination.id));
            }
            floorNo = body.floorNo ?? destination.floorNo;
            unitNo = destination.unitNo;
          } else {
            const [u2] = await db
              .update(units)
              .set({
                floorNo: nextFloor,
                updatedAt: new Date(),
                updatedBy: request.authUser.id,
              })
              .where(eq(units.id, unitId))
              .returning();
            floorNo = u2.floorNo;
            unitNo = u2.unitNo;
          }
        }
      } else if (link.rows[0]) {
        const [unit] = await db
          .select()
          .from(units)
          .where(eq(units.id, Number(link.rows[0].unit_id)))
          .limit(1);
        floorNo = unit?.floorNo ?? null;
        unitNo = unit?.unitNo ?? null;
      }

      await writeAudit(db, {
        tenantId,
        userId: request.authUser.id,
        action: "RESIDENT_UPDATE",
        entityType: "person",
        entityId: updated.id,
        oldData: existing,
        newData: updated,
      });

      return {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone,
        email: updated.email,
        floorNo,
        unitNo,
        managementRole: updated.managementRole,
      };
    },
  );

  app.get(
    "/residents/:id/profile",
    { preHandler: [authenticate, requirePermission(Permission.PERSON_READ)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

      const [person] = await db
        .select()
        .from(persons)
        .where(and(eq(persons.id, id), eq(persons.tenantId, tenantId), isNull(persons.deletedAt)))
        .limit(1);
      if (!person) throw new AppError("NOT_FOUND", "Sakin bulunamadı.", 404);

      const unitsResult = await pool.query<{
        unit_id: string;
        unit_no: string;
        floor_no: string | null;
        role: string;
      }>(
        `
        SELECT DISTINCT ON (u.id)
          u.id AS unit_id,
          u.unit_no,
          u.floor_no,
          CASE
            WHEN occ.occupancy_type = 'TENANT' THEN 'Kiracı'
            WHEN occ.occupancy_type = 'OWNER_OCCUPIED' THEN 'Ev Sahibi'
            WHEN occ.occupancy_type = 'OTHER' THEN 'Diğer'
            WHEN ow.id IS NOT NULL THEN 'Malik'
            ELSE 'Sakin'
          END AS role
        FROM unit u
        LEFT JOIN unit_occupancy occ
          ON occ.unit_id = u.id AND occ.person_id = $1 AND occ.tenant_id = $2
        LEFT JOIN unit_ownership ow
          ON ow.unit_id = u.id AND ow.person_id = $1 AND ow.tenant_id = $2
        WHERE u.tenant_id = $2
          AND (occ.id IS NOT NULL OR ow.id IS NOT NULL)
        ORDER BY u.id, CASE WHEN occ.id IS NOT NULL THEN 0 ELSE 1 END
        `,
        [id, tenantId],
      );

      const unitIds = unitsResult.rows.map((r) => Number(r.unit_id));
      if (unitIds.length === 0) {
        return {
          person: {
            id: person.id,
            firstName: person.firstName,
            lastName: person.lastName,
            phone: person.phone,
            email: person.email,
          },
          units: [],
          periodSummaries: [],
          charges: [],
          payments: [],
          totals: {
            charged: "0.00",
            paid: "0.00",
            open: "0.00",
          },
        };
      }

      const periods = await pool.query<{
        period: string;
        charged: string;
        open_amount: string;
        paid: string;
      }>(
        `
        SELECT
          c.period,
          COALESCE(SUM(c.amount), 0)::text AS charged,
          COALESCE(SUM(c.open_amount), 0)::text AS open_amount,
          COALESCE(SUM(c.amount - c.open_amount), 0)::text AS paid
        FROM charge c
        JOIN charge_type ct ON ct.id = c.charge_type_id
        WHERE c.tenant_id = $1
          AND c.unit_id = ANY($2::bigint[])
          AND c.period IS NOT NULL
          AND c.period ~ '^[0-9]{4}-[0-9]{2}$'
          AND c.status NOT IN ('CANCELLED', 'CARRIED_FORWARD')
          AND ct.code IN ('AIDAT', 'YAKIT', 'DIGER', 'DEVIR')
        GROUP BY c.period
        HAVING COALESCE(SUM(c.amount), 0) > 0
        ORDER BY c.period DESC
        `,
        [tenantId, unitIds],
      );

      const charges = await pool.query<{
        id: string;
        period: string;
        unit_no: string;
        type_name: string;
        type_code: string;
        amount: string;
        open_amount: string;
        due_date: Date;
        status: string;
        description: string | null;
      }>(
        `
        SELECT
          c.id,
          c.period,
          u.unit_no,
          ct.name AS type_name,
          ct.code AS type_code,
          c.amount::text,
          c.open_amount::text,
          c.due_date,
          c.status,
          c.description
        FROM charge c
        JOIN unit u ON u.id = c.unit_id
        JOIN charge_type ct ON ct.id = c.charge_type_id
        WHERE c.tenant_id = $1
          AND c.unit_id = ANY($2::bigint[])
          AND c.period IS NOT NULL
          AND c.period ~ '^[0-9]{4}-[0-9]{2}$'
          AND c.status NOT IN ('CANCELLED', 'CARRIED_FORWARD')
          AND ct.code IN ('AIDAT', 'YAKIT', 'DIGER', 'DEVIR')
        ORDER BY c.period DESC, c.due_date DESC, c.id DESC
        `,
        [tenantId, unitIds],
      );

      const payments = await pool.query<{
        id: string;
        payment_date: Date;
        unit_no: string;
        amount: string;
        payment_method: string;
        status: string;
        description: string | null;
        period: string | null;
      }>(
        `
        SELECT
          p.id,
          p.payment_date,
          u.unit_no,
          p.amount::text,
          p.payment_method,
          p.status,
          p.description,
          (
            SELECT c.period
            FROM payment_allocation pa
            JOIN charge c ON c.id = pa.charge_id
            WHERE pa.payment_id = p.id
            ORDER BY pa.id
            LIMIT 1
          ) AS period
        FROM payment p
        JOIN unit u ON u.id = p.unit_id
        WHERE p.tenant_id = $1
          AND p.unit_id = ANY($2::bigint[])
          AND p.status <> 'REVERSED'
        ORDER BY p.payment_date DESC, p.id DESC
        `,
        [tenantId, unitIds],
      );

      const charged = periods.rows.reduce((s, r) => s + Number(r.charged), 0);
      const open = periods.rows.reduce((s, r) => s + Number(r.open_amount), 0);
      const paid = periods.rows.reduce((s, r) => s + Number(r.paid), 0);

      return {
        person: {
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          phone: person.phone,
          email: person.email,
        },
        units: unitsResult.rows.map((r) => ({
          unitId: Number(r.unit_id),
          unitNo: r.unit_no,
          floorNo: r.floor_no,
          role: r.role,
        })),
        periodSummaries: periods.rows.map((r) => ({
          period: r.period,
          charged: Number(r.charged).toFixed(2),
          paid: Number(r.paid).toFixed(2),
          open: Number(r.open_amount).toFixed(2),
        })),
        charges: charges.rows.map((r) => ({
          id: Number(r.id),
          period: r.period,
          unitNo: r.unit_no,
          typeName: r.type_name,
          typeCode: r.type_code,
          amount: Number(r.amount).toFixed(2),
          openAmount: Number(r.open_amount).toFixed(2),
          dueDate: r.due_date,
          status: r.status,
          description: r.description,
        })),
        payments: payments.rows.map((r) => ({
          id: Number(r.id),
          paymentDate: r.payment_date,
          unitNo: r.unit_no,
          amount: Number(r.amount).toFixed(2),
          paymentMethod: r.payment_method,
          status: r.status,
          description: r.description,
          period: r.period,
        })),
        totals: {
          charged: charged.toFixed(2),
          paid: paid.toFixed(2),
          open: open.toFixed(2),
        },
      };
    },
  );

  app.post(
    "/persons",
    { preHandler: [authenticate, requirePermission(Permission.PERSON_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreatePersonSchema.parse(request.body);
      const [created] = await db
        .insert(persons)
        .values({
          tenantId,
          firstName: body.firstName,
          lastName: body.lastName,
          identityNumber: body.identityNumber,
          phone: body.phone,
          email: body.email,
          createdBy: request.authUser.id,
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        userId: request.authUser.id,
        action: "PERSON_CREATE",
        entityType: "person",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );

  app.post(
    "/residents",
    { preHandler: [authenticate, requirePermission(Permission.PERSON_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreateResidentSchema.parse(request.body);
      const startDate = new Date();

      const [site] = await db
        .select()
        .from(sites)
        .where(and(eq(sites.id, body.siteId), eq(sites.tenantId, tenantId)))
        .limit(1);
      if (!site) throw new AppError("NOT_FOUND", "Site bulunamadı.", 404);

      const created = await db.transaction(async (tx) => {
        let [unit] = await tx
          .select()
          .from(units)
          .where(
            and(
              eq(units.tenantId, tenantId),
              eq(units.siteId, body.siteId),
              eq(units.unitNo, body.unitNo),
            ),
          )
          .limit(1);

        if (!unit) {
          [unit] = await tx
            .insert(units)
            .values({
              tenantId,
              siteId: body.siteId,
              unitNo: body.unitNo,
              floorNo: body.floorNo,
              createdBy: request.authUser.id,
            })
            .returning();
        } else if (unit.floorNo !== body.floorNo) {
          [unit] = await tx
            .update(units)
            .set({ floorNo: body.floorNo, updatedAt: new Date(), updatedBy: request.authUser.id })
            .where(eq(units.id, unit.id))
            .returning();
        }

        const [person] = await tx
          .insert(persons)
          .values({
            tenantId,
            firstName: body.firstName,
            lastName: body.lastName,
            phone: body.phone,
            email: body.email,
            managementRole: body.managementRole ?? null,
            createdBy: request.authUser.id,
          })
          .returning();

        if (body.residentType === "OWNER") {
          await tx.insert(unitOwnerships).values({
            tenantId,
            unitId: unit.id,
            personId: person.id,
            startDate,
            shareRate: "1",
            isPrimary: true,
            createdBy: request.authUser.id,
          });
          await tx.insert(unitOccupancies).values({
            tenantId,
            unitId: unit.id,
            personId: person.id,
            occupancyType: "OWNER_OCCUPIED",
            startDate,
            createdBy: request.authUser.id,
          });
        } else {
          await tx.insert(unitOccupancies).values({
            tenantId,
            unitId: unit.id,
            personId: person.id,
            occupancyType: "TENANT",
            startDate,
            createdBy: request.authUser.id,
          });
        }

        await writeAudit(tx, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "RESIDENT_CREATE",
          entityType: "person",
          entityId: person.id,
          newData: {
            person,
            unitId: unit.id,
            unitNo: unit.unitNo,
            floorNo: unit.floorNo,
            residentType: body.residentType,
            managementRole: body.managementRole ?? null,
          },
        });

        return {
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          phone: person.phone,
          email: person.email,
          floorNo: unit.floorNo,
          unitNo: unit.unitNo,
          residentType: body.residentType,
          managementRole: person.managementRole,
        };
      });

      return created;
    },
  );

  app.post(
    "/units/:unitId/ownerships",
    { preHandler: [authenticate, requirePermission(Permission.PERSON_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { unitId } = z.object({ unitId: z.coerce.number().int().positive() }).parse(request.params);
      const body = OwnershipSchema.parse(request.body);

      const [unit] = await db
        .select()
        .from(units)
        .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)))
        .limit(1);
      if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

      const [person] = await db
        .select()
        .from(persons)
        .where(and(eq(persons.id, body.personId), eq(persons.tenantId, tenantId)))
        .limit(1);
      if (!person) throw new AppError("NOT_FOUND", "Kişi bulunamadı.", 404);

      const [created] = await db
        .insert(unitOwnerships)
        .values({
          tenantId,
          unitId,
          personId: body.personId,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          shareRate: body.shareRate,
          isPrimary: body.isPrimary,
          createdBy: request.authUser.id,
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: unit.siteId,
        userId: request.authUser.id,
        action: "OWNERSHIP_CREATE",
        entityType: "unit_ownership",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );

  app.post(
    "/units/:unitId/occupancies",
    { preHandler: [authenticate, requirePermission(Permission.PERSON_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { unitId } = z.object({ unitId: z.coerce.number().int().positive() }).parse(request.params);
      const body = OccupancySchema.parse(request.body);

      const [unit] = await db
        .select()
        .from(units)
        .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)))
        .limit(1);
      if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

      const [created] = await db
        .insert(unitOccupancies)
        .values({
          tenantId,
          unitId,
          personId: body.personId,
          occupancyType: body.occupancyType,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          createdBy: request.authUser.id,
        })
        .returning();

      return created;
    },
  );
}
