import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { sites, units } from "../../db/schema/index.js";
import { AppError } from "../errors/app-error.js";

/** İstekle gelen siteId/unitId'nin oturumdaki kuruma ait olduğunu doğrular. */
export async function assertSiteInTenant(tenantId: number, siteId: number): Promise<void> {
  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .limit(1);
  if (!site) throw new AppError("NOT_FOUND", "Site bulunamadı.", 404);
}

export async function assertUnitInSite(
  tenantId: number,
  siteId: number,
  unitId: number,
): Promise<void> {
  const [unit] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId), eq(units.siteId, siteId)))
    .limit(1);
  if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);
}
