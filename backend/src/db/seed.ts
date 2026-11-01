import { and, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import {
  chargeTypes,
  expenseCategories,
  kurums,
  sites,
  userRoles,
  users,
} from "./schema/index.js";
import { hashPassword } from "../shared/utils/crypto.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} ortam değişkeni zorunlu. backend/.env içine ekleyin.`);
  }
  return value;
}

async function seed(): Promise<void> {
  const kurumName = requiredEnv("KURUM_NAME");
  const kurumCode = requiredEnv("KURUM_CODE").toUpperCase();
  const adminEmail = requiredEnv("ADMIN_EMAIL").toLowerCase();
  const adminPassword = requiredEnv("ADMIN_PASSWORD");
  const adminFullName = process.env.ADMIN_FULL_NAME?.trim() || "Yönetici";

  let [kurum] = await db.select().from(kurums).where(eq(kurums.code, kurumCode)).limit(1);
  if (!kurum) {
    [kurum] = await db
      .insert(kurums)
      .values({
        name: kurumName,
        code: kurumCode,
        address: process.env.KURUM_ADDRESS?.trim() || null,
        taxNumber: process.env.KURUM_TAX_NUMBER?.trim() || null,
        phone: process.env.KURUM_PHONE?.trim() || null,
        email: process.env.KURUM_EMAIL?.trim() || null,
        status: "ACTIVE",
      })
      .returning();
  }

  let [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, kurum.id), eq(users.email, adminEmail)))
    .limit(1);

  if (!admin) {
    const passwordHash = await hashPassword(adminPassword);
    [admin] = await db
      .insert(users)
      .values({
        tenantId: kurum.id,
        email: adminEmail,
        passwordHash,
        fullName: adminFullName,
        status: "ACTIVE",
      })
      .returning();

    await db.insert(userRoles).values({
      tenantId: kurum.id,
      userId: admin.id,
      role: "TENANT_ADMIN",
      siteId: null,
    });
  }

  // Operasyonel site kaydı: finans API'leri site_id beklediği için kurumla 1:1 tutulur.
  let [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, kurum.id), eq(sites.code, kurum.code)))
    .limit(1);

  if (!site) {
    [site] = await db
      .insert(sites)
      .values({
        tenantId: kurum.id,
        name: kurum.name,
        code: kurum.code,
        address: kurum.address,
        createdBy: admin.id,
      })
      .returning();
  }

  const typeDefs = [
    { code: "AIDAT", name: "Aidat", category: "DUES" },
    { code: "YAKIT", name: "Yakıt", category: "FUEL" },
    { code: "DIGER", name: "Site İşi / Diğer", category: "EXTRA" },
    { code: "EK", name: "Ek Ödeme", category: "EXTRA" },
  ] as const;

  for (const def of typeDefs) {
    const [existing] = await db
      .select()
      .from(chargeTypes)
      .where(and(eq(chargeTypes.tenantId, kurum.id), eq(chargeTypes.code, def.code)))
      .limit(1);
    if (!existing) {
      await db.insert(chargeTypes).values({
        tenantId: kurum.id,
        code: def.code,
        name: def.name,
        category: def.category,
      });
    }
  }

  const categoryDefs = [
    { code: "GENEL", name: "Genel Gider" },
    { code: "SU", name: "Su (ASKİ)" },
    { code: "ELEKTRIK", name: "Elektrik" },
    { code: "SGK", name: "SGK / Personel" },
    { code: "INTERNET", name: "İnternet / Telekom" },
    { code: "BANKA_MASRAF", name: "Banka Masrafı" },
    { code: "BAKIM", name: "Bakım / Onarım" },
  ] as const;

  for (const def of categoryDefs) {
    const [existing] = await db
      .select()
      .from(expenseCategories)
      .where(and(eq(expenseCategories.tenantId, kurum.id), eq(expenseCategories.code, def.code)))
      .limit(1);
    if (!existing) {
      await db.insert(expenseCategories).values({
        tenantId: kurum.id,
        code: def.code,
        name: def.name,
      });
    }
  }

  console.log("Seed completed (no dummy units/residents).");
  console.log(`Kurum: ${kurum.name} (${kurum.code}) id=${kurum.id}`);
  console.log(`Site (kurum operasyon kaydı): id=${site.id}`);
  console.log(`Login: ${adminEmail}`);
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
