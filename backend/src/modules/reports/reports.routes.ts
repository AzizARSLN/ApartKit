import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../db/client.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";

const SiteQuerySchema = z.object({
  siteId: z.coerce.number().int().positive(),
});

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/reports/dashboard",
    { preHandler: [authenticate, requirePermission(Permission.REPORT_FINANCE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = SiteQuerySchema.parse(request.query);

      const result = await pool.query<{
        charge_total_this_month: string;
        payment_total_this_month: string;
        open_debt: string;
        overdue: string;
        unit_count: string;
      }>(
        `
        SELECT
          COALESCE((
            SELECT SUM(c.amount)::text
            FROM charge c
            WHERE c.tenant_id = $1
              AND c.site_id = $2
              AND c.status <> 'CANCELLED'
              AND date_trunc('month', c.created_at) = date_trunc('month', now())
          ), '0') AS charge_total_this_month,
          COALESCE((
            SELECT SUM(p.amount)::text
            FROM payment p
            WHERE p.tenant_id = $1
              AND p.site_id = $2
              AND p.status = 'POSTED'
              AND date_trunc('month', p.payment_date) = date_trunc('month', now())
          ), '0') AS payment_total_this_month,
          COALESCE((
            SELECT SUM(c.open_amount)::text
            FROM charge c
            WHERE c.tenant_id = $1
              AND c.site_id = $2
              AND c.status IN ('OPEN', 'PARTIAL')
          ), '0') AS open_debt,
          COALESCE((
            SELECT SUM(c.open_amount)::text
            FROM charge c
            WHERE c.tenant_id = $1
              AND c.site_id = $2
              AND c.status IN ('OPEN', 'PARTIAL')
              AND c.due_date < now()
          ), '0') AS overdue,
          COALESCE((
            SELECT COUNT(*)::text
            FROM unit u
            WHERE u.tenant_id = $1
              AND u.site_id = $2
              AND u.status = 'ACTIVE'
          ), '0') AS unit_count
        `,
        [tenantId, siteId],
      );

      const row = result.rows[0];
      if (!row) throw new AppError("INTERNAL_ERROR", "Dashboard sorgusu başarısız.", 500);

      return {
        siteId,
        chargeTotalThisMonth: row.charge_total_this_month ?? "0",
        paymentTotalThisMonth: row.payment_total_this_month ?? "0",
        openDebt: row.open_debt ?? "0",
        overdue: row.overdue ?? "0",
        unitCount: Number(row.unit_count ?? 0),
      };
    },
  );

  app.get(
    "/reports/debt-aging",
    { preHandler: [authenticate, requirePermission(Permission.REPORT_FINANCE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = SiteQuerySchema.parse(request.query);

      const result = await pool.query<{
        bucket_0_30: string;
        bucket_31_60: string;
        bucket_61_90: string;
        bucket_91_180: string;
        bucket_180_plus: string;
      }>(
        `
        SELECT
          COALESCE(SUM(CASE
            WHEN age_days BETWEEN 0 AND 30 THEN open_amount ELSE 0 END)::text, '0') AS bucket_0_30,
          COALESCE(SUM(CASE
            WHEN age_days BETWEEN 31 AND 60 THEN open_amount ELSE 0 END)::text, '0') AS bucket_31_60,
          COALESCE(SUM(CASE
            WHEN age_days BETWEEN 61 AND 90 THEN open_amount ELSE 0 END)::text, '0') AS bucket_61_90,
          COALESCE(SUM(CASE
            WHEN age_days BETWEEN 91 AND 180 THEN open_amount ELSE 0 END)::text, '0') AS bucket_91_180,
          COALESCE(SUM(CASE
            WHEN age_days > 180 THEN open_amount ELSE 0 END)::text, '0') AS bucket_180_plus
        FROM (
          SELECT
            c.open_amount::numeric AS open_amount,
            GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - c.due_date)) / 86400))::int AS age_days
          FROM charge c
          WHERE c.tenant_id = $1
            AND c.site_id = $2
            AND c.status IN ('OPEN', 'PARTIAL')
            AND c.open_amount::numeric > 0
        ) aging
        `,
        [tenantId, siteId],
      );

      const row = result.rows[0] ?? {
        bucket_0_30: "0",
        bucket_31_60: "0",
        bucket_61_90: "0",
        bucket_91_180: "0",
        bucket_180_plus: "0",
      };

      return {
        siteId,
        buckets: {
          "0-30": row.bucket_0_30 ?? "0",
          "31-60": row.bucket_31_60 ?? "0",
          "61-90": row.bucket_61_90 ?? "0",
          "91-180": row.bucket_91_180 ?? "0",
          "180+": row.bucket_180_plus ?? "0",
        },
      };
    },
  );
}
