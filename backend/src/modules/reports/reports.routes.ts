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
        pending_bank_count: string;
        open_ticket_count: string;
      }>(
        `
        SELECT
          COALESCE((
            SELECT SUM(c.amount)::text
            FROM charge c
            WHERE c.tenant_id = $1
              AND c.site_id = $2
              AND c.status NOT IN ('CANCELLED', 'CARRIED_FORWARD')
              AND c.period = to_char(now(), 'YYYY-MM')
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
          ), '0') AS unit_count,
          (
            SELECT COUNT(*)::text
            FROM bank_transaction b
            WHERE b.tenant_id = $1
              AND b.site_id = $2
              AND b.direction = 'IN'
              AND b.match_status IN ('UNMATCHED', 'SUGGESTED', 'REVIEW_REQUIRED')
          ) AS pending_bank_count,
          (
            SELECT COUNT(*)::text
            FROM ticket t
            WHERE t.tenant_id = $1
              AND t.site_id = $2
              AND t.status IN ('OPEN', 'IN_PROGRESS')
          ) AS open_ticket_count
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
        pendingBankCount: Number(row.pending_bank_count ?? 0),
        openTicketCount: Number(row.open_ticket_count ?? 0),
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

  app.get(
    "/reports/debtors",
    { preHandler: [authenticate, requirePermission(Permission.REPORT_FINANCE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = SiteQuerySchema.parse(request.query);

      const result = await pool.query<{
        unit_id: string;
        unit_no: string;
        resident_name: string | null;
        open_amount: string;
        overdue_amount: string;
        oldest_due_date: Date;
      }>(
        `
        SELECT
          u.id AS unit_id,
          u.unit_no,
          resident.name AS resident_name,
          SUM(c.open_amount)::text AS open_amount,
          COALESCE(SUM(c.open_amount) FILTER (WHERE c.due_date < now()), 0)::text AS overdue_amount,
          MIN(c.due_date) AS oldest_due_date
        FROM charge c
        JOIN unit u ON u.id = c.unit_id
        LEFT JOIN LATERAL (
          SELECT p.first_name || ' ' || p.last_name AS name
          FROM (
            SELECT person_id, start_date FROM unit_occupancy
            WHERE unit_id = u.id AND tenant_id = $1 AND end_date IS NULL
            UNION ALL
            SELECT person_id, start_date FROM unit_ownership
            WHERE unit_id = u.id AND tenant_id = $1 AND end_date IS NULL
          ) links
          JOIN person p ON p.id = links.person_id
          ORDER BY links.start_date DESC
          LIMIT 1
        ) resident ON true
        WHERE c.tenant_id = $1
          AND c.site_id = $2
          AND c.status IN ('OPEN', 'PARTIAL')
          AND c.open_amount > 0
        GROUP BY u.id, u.unit_no, resident.name
        ORDER BY SUM(c.open_amount) DESC
        LIMIT 200
        `,
        [tenantId, siteId],
      );

      return result.rows.map((row) => ({
        unitId: Number(row.unit_id),
        unitNo: row.unit_no,
        residentName: row.resident_name,
        openAmount: row.open_amount,
        overdueAmount: row.overdue_amount,
        oldestDueDate: row.oldest_due_date,
      }));
    },
  );

  app.get(
    "/reports/monthly",
    { preHandler: [authenticate, requirePermission(Permission.REPORT_FINANCE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = SiteQuerySchema.parse(request.query);

      const result = await pool.query<{
        period: string;
        charged: string;
        collected: string;
        spent: string;
      }>(
        `
        WITH months AS (
          SELECT to_char(m, 'YYYY-MM') AS period
          FROM generate_series(
            date_trunc('month', now()) - interval '11 months',
            date_trunc('month', now()),
            interval '1 month'
          ) m
        ),
        charged AS (
          SELECT period, SUM(amount) AS total FROM charge
          WHERE tenant_id = $1 AND site_id = $2
            AND status NOT IN ('CANCELLED', 'CARRIED_FORWARD')
          GROUP BY period
        ),
        collected AS (
          SELECT to_char(payment_date, 'YYYY-MM') AS period, SUM(amount) AS total FROM payment
          WHERE tenant_id = $1 AND site_id = $2 AND status = 'POSTED'
          GROUP BY 1
        ),
        spent AS (
          SELECT to_char(expense_date, 'YYYY-MM') AS period, SUM(amount) AS total FROM expense
          WHERE tenant_id = $1 AND site_id = $2 AND status <> 'CANCELLED'
          GROUP BY 1
        )
        SELECT
          m.period,
          COALESCE(ch.total, 0)::text AS charged,
          COALESCE(co.total, 0)::text AS collected,
          COALESCE(sp.total, 0)::text AS spent
        FROM months m
        LEFT JOIN charged ch ON ch.period = m.period
        LEFT JOIN collected co ON co.period = m.period
        LEFT JOIN spent sp ON sp.period = m.period
        ORDER BY m.period
        `,
        [tenantId, siteId],
      );

      return result.rows;
    },
  );
}
