import { pool } from "../../db/client.js";

const AIDAT_EXEMPT_ROLES = ["MANAGER", "ASSISTANT_MANAGER"] as const;

export type ManagementRole = (typeof AIDAT_EXEMPT_ROLES)[number];

export function isAidatExemptManagementRole(
  role: string | null | undefined,
): role is ManagementRole {
  return role === "MANAGER" || role === "ASSISTANT_MANAGER";
}

/** Units linked to a Yönetici / Yönetici Yardımcısı resident → monthly AIDAT = 0. */
export async function getAidatExemptUnitIds(input: {
  tenantId: number;
  siteId: number;
  unitIds: number[];
}): Promise<Set<number>> {
  if (input.unitIds.length === 0) return new Set();

  const result = await pool.query<{ unit_id: string }>(
    `
    SELECT DISTINCT u.id::text AS unit_id
    FROM unit u
    JOIN (
      SELECT unit_id, person_id
      FROM unit_occupancy
      WHERE tenant_id = $1
        AND (end_date IS NULL OR end_date > NOW())
      UNION
      SELECT unit_id, person_id
      FROM unit_ownership
      WHERE tenant_id = $1
        AND (end_date IS NULL OR end_date > NOW())
    ) link ON link.unit_id = u.id
    JOIN person p
      ON p.id = link.person_id
     AND p.tenant_id = $1
     AND p.deleted_at IS NULL
    WHERE u.tenant_id = $1
      AND u.site_id = $2
      AND u.id = ANY($3::bigint[])
      AND p.management_role = ANY($4::text[])
    `,
    [input.tenantId, input.siteId, input.unitIds, [...AIDAT_EXEMPT_ROLES]],
  );

  return new Set(result.rows.map((r) => Number(r.unit_id)));
}

export async function isUnitAidatExempt(input: {
  tenantId: number;
  siteId: number;
  unitId: number;
}): Promise<boolean> {
  const ids = await getAidatExemptUnitIds({
    tenantId: input.tenantId,
    siteId: input.siteId,
    unitIds: [input.unitId],
  });
  return ids.has(input.unitId);
}
