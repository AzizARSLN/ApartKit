import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, pool, type DbTransaction } from "../../db/client.js";
import {
  cashAccounts,
  cashTransactions,
  chargeBatches,
  chargeTypes,
  charges,
  paymentAllocations,
  payments,
  receiptSequences,
  receipts,
  siteFinanceConfigs,
  units,
} from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { Money, MoneyStringSchema, money, moneyToString } from "../../shared/utils/money.js";
import { nextChargeStatus, planOldestFirst } from "../payments/allocation.js";
import { getAidatExemptUnitIds, isUnitAidatExempt } from "./aidat-exemption.js";
import { previewDistribution } from "./distribution.js";
import { calculateLateFee, isPastDue } from "./late-fee.js";
import { parseYakitExcel, type YakitExcelRow } from "./yakit-excel.js";

async function nextReceiptNo(
  tx: DbTransaction,
  tenantId: number,
  siteId: number,
  year: number,
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(receiptSequences)
    .where(and(eq(receiptSequences.siteId, siteId), eq(receiptSequences.year, year)))
    .for("update")
    .limit(1);

  if (!existing) {
    await tx.insert(receiptSequences).values({
      tenantId,
      siteId,
      year,
      lastValue: 1,
    });
    return `${year}-${String(1).padStart(8, "0")}`;
  }

  const next = existing.lastValue + 1;
  await tx
    .update(receiptSequences)
    .set({ lastValue: next })
    .where(eq(receiptSequences.id, existing.id));
  return `${year}-${String(next).padStart(8, "0")}`;
}

function fieldValue(
  fields: Record<string, { value?: unknown } | { value?: unknown }[] | undefined>,
  name: string,
): string | undefined {
  const raw = fields[name];
  if (!raw) return undefined;
  const item = Array.isArray(raw) ? raw[0] : raw;
  if (item?.value == null) return undefined;
  return String(item.value);
}

type YakitImportAction = "CREATE" | "UPDATE" | "SKIP";

type YakitImportPlanRow = {
  rowNumber: number;
  unitId: number | null;
  unitNo: string;
  amount: string;
  action: YakitImportAction;
  reason: string | null;
  existingChargeId: number | null;
  existingAmount: string | null;
};

const ChargeTypeSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  category: z.string().max(64).default("GENERAL"),
});

const BatchPreviewSchema = z.object({
  siteId: z.number().int().positive(),
  period: z.string().min(4).max(16),
  chargeTypeId: z.number().int().positive(),
  distributionMethod: z.enum([
    "EQUAL_PER_UNIT",
    "FIXED_PER_UNIT",
    "BY_GROSS_M2",
    "BY_NET_M2",
    "BY_LAND_SHARE",
    "CUSTOM",
  ]),
  amount: MoneyStringSchema.optional(),
  fixedPerUnit: MoneyStringSchema.optional(),
  dueDate: z.coerce.date(),
  unitIds: z.array(z.number().int().positive()).min(1),
  customAmounts: z.record(z.string(), MoneyStringSchema).optional(),
  description: z.string().max(1000).optional(),
});

const MonthlyBillingSchema = z.object({
  siteId: z.number().int().positive(),
  period: z.string().regex(/^\d{4}-\d{2}$/, "Dönem YYYY-MM olmalı"),
  publishDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  aidatPerUnit: MoneyStringSchema,
  yakitPerUnit: MoneyStringSchema.default("0.00"),
  digerPerUnit: MoneyStringSchema.default("0.00"),
  digerDescription: z.string().trim().max(200).optional(),
  lateFeeRatePercent: MoneyStringSchema.default("2.00"),
  unitIds: z.array(z.number().int().positive()).min(1),
  carryForwardFromPeriod: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  carryForwardDescription: z
    .string()
    .trim()
    .max(200)
    .default("Bir önceki dönemden devir"),
});

const PeriodQuerySchema = z.object({
  siteId: z.coerce.number().int().positive(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  asOf: z.coerce.date().optional(),
});

type ChargeTypeRow = typeof chargeTypes.$inferSelect;

async function buildYakitImportPlan(input: {
  tenantId: number;
  siteId: number;
  period: string;
  rows: YakitExcelRow[];
}): Promise<YakitImportPlanRow[]> {
  const unitRows = await db
    .select()
    .from(units)
    .where(and(eq(units.tenantId, input.tenantId), eq(units.siteId, input.siteId)));

  const unitByNo = new Map(unitRows.map((u) => [u.unitNo.toLocaleLowerCase("tr"), u]));

  const yakitType = await ensureChargeType(input.tenantId, "YAKIT", "Yakıt", "FUEL");

  const existingCharges = await db
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.tenantId, input.tenantId),
        eq(charges.siteId, input.siteId),
        eq(charges.period, input.period),
        eq(charges.chargeTypeId, yakitType.id),
      ),
    );

  const activeByUnit = new Map<number, (typeof existingCharges)[number]>();
  for (const c of existingCharges) {
    if (c.status === "CANCELLED") continue;
    activeByUnit.set(c.unitId, c);
  }

  const movement = await pool.query<{ unit_id: string; cnt: string }>(
    `
    SELECT c.unit_id::text, COUNT(*)::text AS cnt
    FROM payment_allocation pa
    JOIN charge c ON c.id = pa.charge_id
    WHERE c.tenant_id = $1
      AND c.site_id = $2
      AND c.period = $3
      AND c.charge_type_id = $4
      AND c.status <> 'CANCELLED'
    GROUP BY c.unit_id
    `,
    [input.tenantId, input.siteId, input.period, yakitType.id],
  );
  const movementByUnit = new Map(movement.rows.map((r) => [Number(r.unit_id), Number(r.cnt)]));

  return input.rows.map((row) => {
    const unit = unitByNo.get(row.unitNo.toLocaleLowerCase("tr"));
    if (!unit) {
      return {
        rowNumber: row.rowNumber,
        unitId: null,
        unitNo: row.unitNo,
        amount: row.amount,
        action: "SKIP" as const,
        reason: "Daire bulunamadı",
        existingChargeId: null,
        existingAmount: null,
      };
    }
    if (unit.unitNo === "KD") {
      return {
        rowNumber: row.rowNumber,
        unitId: unit.id,
        unitNo: unit.unitNo,
        amount: row.amount,
        action: "SKIP" as const,
        reason: "KD birimi atlandı",
        existingChargeId: null,
        existingAmount: null,
      };
    }

    const existing = activeByUnit.get(unit.id);
    if (!existing) {
      return {
        rowNumber: row.rowNumber,
        unitId: unit.id,
        unitNo: unit.unitNo,
        amount: row.amount,
        action: "CREATE" as const,
        reason: null,
        existingChargeId: null,
        existingAmount: null,
      };
    }

    const paid = money(existing.amount).minus(money(existing.openAmount));
    const hasAlloc = (movementByUnit.get(unit.id) ?? 0) > 0;
    if (!paid.isZero() || hasAlloc) {
      return {
        rowNumber: row.rowNumber,
        unitId: unit.id,
        unitNo: unit.unitNo,
        amount: row.amount,
        action: "SKIP" as const,
        reason: "Bu dönemde yakıt için ödeme hareketi var",
        existingChargeId: existing.id,
        existingAmount: existing.amount,
      };
    }

    if (existing.amount === row.amount) {
      return {
        rowNumber: row.rowNumber,
        unitId: unit.id,
        unitNo: unit.unitNo,
        amount: row.amount,
        action: "SKIP" as const,
        reason: "Tutar aynı, değişiklik yok",
        existingChargeId: existing.id,
        existingAmount: existing.amount,
      };
    }

    return {
      rowNumber: row.rowNumber,
      unitId: unit.id,
      unitNo: unit.unitNo,
      amount: row.amount,
      action: "UPDATE" as const,
      reason: null,
      existingChargeId: existing.id,
      existingAmount: existing.amount,
    };
  });
}

async function ensureChargeType(
  tenantId: number,
  code: string,
  name: string,
  category: string,
): Promise<ChargeTypeRow> {
  const [existing] = await db
    .select()
    .from(chargeTypes)
    .where(and(eq(chargeTypes.tenantId, tenantId), eq(chargeTypes.code, code)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(chargeTypes)
    .values({ tenantId, code, name, category })
    .returning();
  return created;
}

async function upsertLateFeeConfig(
  tenantId: number,
  siteId: number,
  ratePercent: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(siteFinanceConfigs)
    .where(and(eq(siteFinanceConfigs.tenantId, tenantId), eq(siteFinanceConfigs.siteId, siteId)))
    .limit(1);

  if (existing) {
    await db
      .update(siteFinanceConfigs)
      .set({
        lateFeeEnabled: "true",
        lateFeeMonthlyRate: ratePercent,
        lateFeeCalculationMethod: "FLAT_PERCENT",
        updatedAt: new Date(),
      })
      .where(eq(siteFinanceConfigs.id, existing.id));
    return;
  }

  await db.insert(siteFinanceConfigs).values({
    tenantId,
    siteId,
    lateFeeEnabled: "true",
    lateFeeMonthlyRate: ratePercent,
    lateFeeGraceDays: 0,
    lateFeeCalculationMethod: "FLAT_PERCENT",
  });
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/charge-types",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_PREVIEW)] },
    async (request) => {
      const tenantId = getTenantId(request);
      return db.select().from(chargeTypes).where(eq(chargeTypes.tenantId, tenantId));
    },
  );

  app.post(
    "/charge-types",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = ChargeTypeSchema.parse(request.body);
      const [created] = await db
        .insert(chargeTypes)
        .values({
          tenantId,
          code: body.code.toUpperCase(),
          name: body.name,
          category: body.category,
        })
        .returning();
      return created;
    },
  );

  app.post(
    "/billing/charge-batches/preview",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_PREVIEW)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = BatchPreviewSchema.parse(request.body);
      const unitRows = await db
        .select()
        .from(units)
        .where(
          and(
            eq(units.tenantId, tenantId),
            eq(units.siteId, body.siteId),
            inArray(units.id, body.unitIds),
          ),
        );

      if (unitRows.length !== body.unitIds.length) {
        throw new AppError("UNITS_NOT_FOUND", "Bazı daireler bulunamadı veya site/tenant uyumsuz.", 400);
      }

      const lines = previewDistribution({
        method: body.distributionMethod,
        units: unitRows.map((u) => ({
          id: u.id,
          grossM2: u.grossM2,
          netM2: u.netM2,
          landShare: u.landShare,
        })),
        amount: body.amount,
        fixedPerUnit: body.fixedPerUnit,
        customAmounts: body.customAmounts,
      });

      const total = lines.reduce((acc, line) => acc.plus(money(line.amount)), Money.zero());

      return {
        siteId: body.siteId,
        period: body.period,
        chargeTypeId: body.chargeTypeId,
        distributionMethod: body.distributionMethod,
        dueDate: body.dueDate,
        unitCount: lines.length,
        totalAmount: moneyToString(total),
        lines,
      };
    },
  );

  app.post(
    "/billing/charge-batches",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = BatchPreviewSchema.parse(request.body);

      const result = await db.transaction(async (tx) => {
        const unitRows = await tx
          .select()
          .from(units)
          .where(
            and(
              eq(units.tenantId, tenantId),
              eq(units.siteId, body.siteId),
              inArray(units.id, body.unitIds),
            ),
          );

        if (unitRows.length !== body.unitIds.length) {
          throw new AppError("UNITS_NOT_FOUND", "Bazı daireler bulunamadı veya site/tenant uyumsuz.", 400);
        }

        const [chargeType] = await tx
          .select()
          .from(chargeTypes)
          .where(and(eq(chargeTypes.id, body.chargeTypeId), eq(chargeTypes.tenantId, tenantId)))
          .limit(1);
        if (!chargeType) throw new AppError("NOT_FOUND", "Borç türü bulunamadı.", 404);

        const lines = previewDistribution({
          method: body.distributionMethod,
          units: unitRows.map((u) => ({
            id: u.id,
            grossM2: u.grossM2,
            netM2: u.netM2,
            landShare: u.landShare,
          })),
          amount: body.amount,
          fixedPerUnit: body.fixedPerUnit,
          customAmounts: body.customAmounts,
        });

        const total = lines.reduce((acc, line) => acc.plus(money(line.amount)), Money.zero());

        const [batch] = await tx
          .insert(chargeBatches)
          .values({
            tenantId,
            siteId: body.siteId,
            period: body.period,
            chargeTypeId: body.chargeTypeId,
            distributionMethod: body.distributionMethod,
            totalAmount: moneyToString(total),
            dueDate: body.dueDate,
            status: "POSTED",
            description: body.description,
            createdBy: request.authUser.id,
          })
          .returning();

        const chargeRows = lines.map((line) => ({
          tenantId,
          siteId: body.siteId,
          unitId: line.unitId,
          chargeBatchId: batch.id,
          chargeTypeId: body.chargeTypeId,
          period: body.period,
          amount: line.amount,
          openAmount: line.amount,
          dueDate: body.dueDate,
          status: "OPEN",
          description: body.description,
          createdBy: request.authUser.id,
        }));

        const inserted = await tx.insert(charges).values(chargeRows).returning();

        await writeAudit(tx, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "CHARGE_BATCH_CREATE",
          entityType: "charge_batch",
          entityId: batch.id,
          newData: { batch, chargeCount: inserted.length, totalAmount: moneyToString(total) },
        });

        return { batch, charges: inserted, totalAmount: moneyToString(total) };
      });

      return result;
    },
  );

  app.post(
    "/billing/monthly/preview",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_PREVIEW)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = MonthlyBillingSchema.parse(request.body);

      if (body.dueDate.getTime() < body.publishDate.getTime()) {
        throw new AppError("INVALID_DATES", "Son ödeme tarihi yayın tarihinden önce olamaz.", 400);
      }

      const unitRows = await db
        .select()
        .from(units)
        .where(
          and(
            eq(units.tenantId, tenantId),
            eq(units.siteId, body.siteId),
            inArray(units.id, body.unitIds),
          ),
        );
      if (unitRows.length !== body.unitIds.length) {
        throw new AppError("UNITS_NOT_FOUND", "Bazı daireler bulunamadı veya site/tenant uyumsuz.", 400);
      }

      const aidatExemptUnitIds = await getAidatExemptUnitIds({
        tenantId,
        siteId: body.siteId,
        unitIds: body.unitIds,
      });
      const aidatExemptUnitCount = aidatExemptUnitIds.size;
      const billableAidatUnitCount = Math.max(unitRows.length - aidatExemptUnitCount, 0);

      const components = [
        { code: "AIDAT", label: "Aidat", amount: body.aidatPerUnit },
        { code: "YAKIT", label: "Yakıt", amount: body.yakitPerUnit },
        {
          code: "DIGER",
          label: body.digerDescription?.trim() || "Site işi / diğer",
          amount: body.digerPerUnit,
        },
      ].filter((c) => !money(c.amount).isZero());

      let carryForwardTotal = Money.zero();
      let carryForwardUnitCount = 0;
      if (body.carryForwardFromPeriod) {
        const carry = await pool.query<{ unit_count: string; total_open: string }>(
          `
          SELECT
            COUNT(DISTINCT c.unit_id)::text AS unit_count,
            COALESCE(SUM(c.open_amount), 0)::text AS total_open
          FROM charge c
          JOIN charge_type ct ON ct.id = c.charge_type_id
          WHERE c.tenant_id = $1
            AND c.site_id = $2
            AND c.period = $3
            AND c.status <> 'CANCELLED'
            AND c.status <> 'CARRIED_FORWARD'
            AND ct.code IN ('AIDAT', 'YAKIT', 'DIGER', 'DEVIR')
            AND c.open_amount::numeric > 0
            AND c.unit_id = ANY($4::bigint[])
          `,
          [tenantId, body.siteId, body.carryForwardFromPeriod, body.unitIds],
        );
        carryForwardTotal = money(Number(carry.rows[0]?.total_open ?? 0).toFixed(2));
        carryForwardUnitCount = Number(carry.rows[0]?.unit_count ?? 0);
      }

      if (components.length === 0 && carryForwardTotal.isZero()) {
        throw new AppError("NO_AMOUNTS", "En az bir tutar (aidat/yakıt/diğer/devir) girilmelidir.", 400);
      }

      const componentTotals = components.map((c) => {
        const unitCount = c.code === "AIDAT" ? billableAidatUnitCount : unitRows.length;
        const total = money(c.amount).mulRatio(money(String(unitCount)), money("1.00"));
        return {
          code: c.code,
          label: c.label,
          perUnit: c.amount,
          total: moneyToString(total),
          billableUnitCount: unitCount,
        };
      });

      const fixedGrand = componentTotals.reduce(
        (acc, c) => acc.plus(money(c.total)),
        Money.zero(),
      );
      const grand = fixedGrand.plus(carryForwardTotal);
      const perUnit = components.reduce((acc, c) => acc.plus(money(c.amount)), Money.zero());

      return {
        siteId: body.siteId,
        period: body.period,
        publishDate: body.publishDate,
        dueDate: body.dueDate,
        lateFeeRatePercent: body.lateFeeRatePercent,
        unitCount: unitRows.length,
        aidatExemptUnitCount,
        components: [
          ...componentTotals.map((c) => ({
            code: c.code,
            label: c.label,
            perUnit: c.perUnit,
            total: c.total,
          })),
          ...(carryForwardTotal.isZero()
            ? []
            : [
                {
                  code: "DEVIR",
                  label: body.carryForwardDescription,
                  perUnit: "değişken",
                  total: moneyToString(carryForwardTotal),
                },
              ]),
        ],
        carryForwardFromPeriod: body.carryForwardFromPeriod ?? null,
        carryForwardUnitCount,
        carryForwardTotal: moneyToString(carryForwardTotal),
        perUnitTotal: moneyToString(perUnit),
        grandTotal: moneyToString(grand),
        lateFeeNote: `Son ödeme (${body.dueDate.toISOString().slice(0, 10)}) sonrası açık bakiyeye %${body.lateFeeRatePercent} faiz uygulanır.`,
        aidatExemptNote:
          aidatExemptUnitCount > 0
            ? `${aidatExemptUnitCount} daire yönetici/yardımcı olduğu için aidat 0 TL.`
            : null,
      };
    },
  );

  app.post(
    "/billing/monthly",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = MonthlyBillingSchema.parse(request.body);

      if (body.dueDate.getTime() < body.publishDate.getTime()) {
        throw new AppError("INVALID_DATES", "Son ödeme tarihi yayın tarihinden önce olamaz.", 400);
      }
      if (body.carryForwardFromPeriod === body.period) {
        throw new AppError(
          "INVALID_CARRY_FORWARD",
          "Devir kaynağı, oluşturulan dönemle aynı olamaz.",
          400,
        );
      }

      const existingPeriod = await pool.query<{ value: string }>(
        `
        SELECT COUNT(*)::text AS value
        FROM charge
        WHERE tenant_id = $1
          AND site_id = $2
          AND period = $3
          AND status NOT IN ('CANCELLED', 'CARRIED_FORWARD')
        `,
        [tenantId, body.siteId, body.period],
      );
      if (Number(existingPeriod.rows[0]?.value ?? 0) > 0) {
        throw new AppError(
          "PERIOD_EXISTS",
          "Bu dönem zaten mevcut. Yeniden oluşturmak için önce dönemi silin.",
          409,
        );
      }

      // Önceki soft-iptal artıkları varsa (hareket yoksa) temizle; yeniden oluşturma bozulmasın.
      const leftoverMovement = await pool.query<{ value: string }>(
        `
        SELECT COUNT(*)::text AS value
        FROM payment_allocation pa
        JOIN charge c ON c.id = pa.charge_id
        WHERE c.tenant_id = $1
          AND c.site_id = $2
          AND c.period = $3
        `,
        [tenantId, body.siteId, body.period],
      );
      if (Number(leftoverMovement.rows[0]?.value ?? 0) === 0) {
        await db.transaction(async (tx) => {
          const leftoverCharges = await tx
            .select({ id: charges.id })
            .from(charges)
            .where(
              and(
                eq(charges.tenantId, tenantId),
                eq(charges.siteId, body.siteId),
                eq(charges.period, body.period),
                inArray(charges.status, ["CANCELLED"]),
              ),
            );
          if (leftoverCharges.length > 0) {
            await tx
              .delete(charges)
              .where(inArray(charges.id, leftoverCharges.map((c) => c.id)));
          }
          const leftoverBatches = await tx
            .select({ id: chargeBatches.id })
            .from(chargeBatches)
            .where(
              and(
                eq(chargeBatches.tenantId, tenantId),
                eq(chargeBatches.siteId, body.siteId),
                eq(chargeBatches.period, body.period),
                eq(chargeBatches.status, "CANCELLED"),
              ),
            );
          if (leftoverBatches.length > 0) {
            await tx
              .delete(chargeBatches)
              .where(inArray(chargeBatches.id, leftoverBatches.map((b) => b.id)));
          }
        });
      }

      const aidatType = await ensureChargeType(tenantId, "AIDAT", "Aidat", "DUES");
      const yakitType = await ensureChargeType(tenantId, "YAKIT", "Yakıt", "FUEL");
      const digerType = await ensureChargeType(tenantId, "DIGER", "Site İşi / Diğer", "EXTRA");
      const devirType = await ensureChargeType(
        tenantId,
        "DEVIR",
        "Önceki dönemden devir",
        "CARRY",
      );

      const components = [
        {
          type: aidatType,
          amount: body.aidatPerUnit,
          description: `${body.period} Aidat`,
        },
        {
          type: yakitType,
          amount: body.yakitPerUnit,
          description: `${body.period} Yakıt`,
        },
        {
          type: digerType,
          amount: body.digerPerUnit,
          description: body.digerDescription?.trim()
            ? `${body.period} ${body.digerDescription.trim()}`
            : `${body.period} Site işi / diğer`,
        },
      ].filter((c) => !money(c.amount).isZero());

      const carryRows =
        body.carryForwardFromPeriod != null
          ? await pool.query<{ unit_id: string; open_amount: string }>(
              `
              SELECT c.unit_id::text, COALESCE(SUM(c.open_amount), 0)::text AS open_amount
              FROM charge c
              JOIN charge_type ct ON ct.id = c.charge_type_id
              WHERE c.tenant_id = $1
                AND c.site_id = $2
                AND c.period = $3
                AND c.status <> 'CANCELLED'
                AND c.status <> 'CARRIED_FORWARD'
                AND ct.code IN ('AIDAT', 'YAKIT', 'DIGER', 'DEVIR')
                AND c.unit_id = ANY($4::bigint[])
              GROUP BY c.unit_id
              HAVING COALESCE(SUM(c.open_amount), 0) > 0
              `,
              [tenantId, body.siteId, body.carryForwardFromPeriod, body.unitIds],
            )
          : { rows: [] as Array<{ unit_id: string; open_amount: string }> };

      if (components.length === 0 && carryRows.rows.length === 0) {
        throw new AppError(
          "NO_AMOUNTS",
          "En az bir tutar (aidat/yakıt/diğer/devir) girilmelidir.",
          400,
        );
      }

      const result = await db.transaction(async (tx) => {
        const unitRows = await tx
          .select()
          .from(units)
          .where(
            and(
              eq(units.tenantId, tenantId),
              eq(units.siteId, body.siteId),
              inArray(units.id, body.unitIds),
            ),
          );
        if (unitRows.length !== body.unitIds.length) {
          throw new AppError("UNITS_NOT_FOUND", "Bazı daireler bulunamadı veya site/tenant uyumsuz.", 400);
        }

        const aidatExemptUnitIds = await getAidatExemptUnitIds({
          tenantId,
          siteId: body.siteId,
          unitIds: body.unitIds,
        });

        const createdBatches: Array<{
          batchId: number;
          chargeTypeCode: string;
          totalAmount: string;
          chargeCount: number;
          carryForwardFromPeriod?: string;
        }> = [];
        let chargeCount = 0;
        let grand = Money.zero();

        for (const component of components) {
          const rawLines = previewDistribution({
            method: "FIXED_PER_UNIT",
            units: unitRows.map((u) => ({
              id: u.id,
              grossM2: u.grossM2,
              netM2: u.netM2,
              landShare: u.landShare,
            })),
            fixedPerUnit: component.amount,
          });
          const lines =
            component.type.code === "AIDAT"
              ? rawLines.map((line) =>
                  aidatExemptUnitIds.has(line.unitId)
                    ? { ...line, amount: "0.00" }
                    : line,
                )
              : rawLines;
          const chargeLines = lines.filter((line) => !money(line.amount).isZero());
          if (chargeLines.length === 0) continue;

          const total = chargeLines.reduce((acc, line) => acc.plus(money(line.amount)), Money.zero());
          grand = grand.plus(total);

          const [batch] = await tx
            .insert(chargeBatches)
            .values({
              tenantId,
              siteId: body.siteId,
              period: body.period,
              chargeTypeId: component.type.id,
              distributionMethod: "FIXED_PER_UNIT",
              totalAmount: moneyToString(total),
              dueDate: body.dueDate,
              status: "POSTED",
              description: `${component.description} (yayın: ${body.publishDate.toISOString().slice(0, 10)})`,
              createdBy: request.authUser.id,
            })
            .returning();

          const inserted = await tx
            .insert(charges)
            .values(
              chargeLines.map((line) => ({
                tenantId,
                siteId: body.siteId,
                unitId: line.unitId,
                chargeBatchId: batch.id,
                chargeTypeId: component.type.id,
                period: body.period,
                amount: line.amount,
                openAmount: line.amount,
                dueDate: body.dueDate,
                status: "OPEN" as const,
                description: component.description,
                createdBy: request.authUser.id,
              })),
            )
            .returning();

          chargeCount += inserted.length;
          createdBatches.push({
            batchId: batch.id,
            chargeTypeCode: component.type.code,
            totalAmount: moneyToString(total),
            chargeCount: inserted.length,
          });
        }

        if (carryRows.rows.length > 0 && body.carryForwardFromPeriod) {
          const carryLines = carryRows.rows.map((r) => ({
            unitId: Number(r.unit_id),
            amount: money(Number(r.open_amount).toFixed(2)),
          }));
          const carryTotal = carryLines.reduce((acc, l) => acc.plus(l.amount), Money.zero());
          grand = grand.plus(carryTotal);
          const carryDesc = `${body.period} ${body.carryForwardDescription}`;

          const [batch] = await tx
            .insert(chargeBatches)
            .values({
              tenantId,
              siteId: body.siteId,
              period: body.period,
              chargeTypeId: devirType.id,
              distributionMethod: "CUSTOM",
              totalAmount: moneyToString(carryTotal),
              dueDate: body.dueDate,
              status: "POSTED",
              description: `${carryDesc} ← ${body.carryForwardFromPeriod}`,
              createdBy: request.authUser.id,
            })
            .returning();

          const inserted = await tx
            .insert(charges)
            .values(
              carryLines.map((line) => ({
                tenantId,
                siteId: body.siteId,
                unitId: line.unitId,
                chargeBatchId: batch.id,
                chargeTypeId: devirType.id,
                period: body.period,
                amount: moneyToString(line.amount),
                openAmount: moneyToString(line.amount),
                dueDate: body.dueDate,
                status: "OPEN" as const,
                description: carryDesc,
                createdBy: request.authUser.id,
              })),
            )
            .returning();

          const previousOpen = await tx
            .select({ id: charges.id, status: charges.status, openAmount: charges.openAmount })
            .from(charges)
            .innerJoin(chargeTypes, eq(chargeTypes.id, charges.chargeTypeId))
            .where(
              and(
                eq(charges.tenantId, tenantId),
                eq(charges.siteId, body.siteId),
                eq(charges.period, body.carryForwardFromPeriod),
                inArray(charges.unitId, body.unitIds),
                inArray(chargeTypes.code, ["AIDAT", "YAKIT", "DIGER", "DEVIR"]),
                notInArray(charges.status, ["CANCELLED", "CARRIED_FORWARD"]),
              ),
            );

          for (const row of previousOpen) {
            if (money(row.openAmount).isZero()) continue;
            await tx
              .update(charges)
              .set({
                openAmount: "0.00",
                status: "CARRIED_FORWARD",
                updatedAt: new Date(),
                updatedBy: request.authUser.id,
              })
              .where(eq(charges.id, row.id));
          }

          chargeCount += inserted.length;
          createdBatches.push({
            batchId: batch.id,
            chargeTypeCode: "DEVIR",
            totalAmount: moneyToString(carryTotal),
            chargeCount: inserted.length,
            carryForwardFromPeriod: body.carryForwardFromPeriod,
          });
        }

        await writeAudit(tx, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "MONTHLY_BILLING_CREATE",
          entityType: "charge_batch",
          entityId: createdBatches[0]?.batchId,
          newData: {
            period: body.period,
            publishDate: body.publishDate,
            dueDate: body.dueDate,
            lateFeeRatePercent: body.lateFeeRatePercent,
            carryForwardFromPeriod: body.carryForwardFromPeriod ?? null,
            batches: createdBatches,
            grandTotal: moneyToString(grand),
          },
        });

        return {
          period: body.period,
          publishDate: body.publishDate,
          dueDate: body.dueDate,
          lateFeeRatePercent: body.lateFeeRatePercent,
          batches: createdBatches,
          chargeCount,
          grandTotal: moneyToString(grand),
        };
      });

      await upsertLateFeeConfig(tenantId, body.siteId, body.lateFeeRatePercent);
      return result;
    },
  );

  app.get(
    "/billing/periods",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_PREVIEW)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { siteId } = z
        .object({ siteId: z.coerce.number().int().positive() })
        .parse(request.query);

      const result = await pool.query<{
        period: string;
        due_date: Date | null;
        charge_count: string;
        unit_count: string;
        principal_total: string;
        principal_open: string;
        collectible_paid: string;
      }>(
        `
        SELECT
          c.period,
          MIN(c.due_date) AS due_date,
          COUNT(*)::text AS charge_count,
          COUNT(DISTINCT c.unit_id)::text AS unit_count,
          COALESCE(SUM(c.amount), 0)::text AS principal_total,
          COALESCE(SUM(c.open_amount), 0)::text AS principal_open,
          COALESCE(
            SUM(c.amount - c.open_amount) FILTER (
              WHERE c.status NOT IN ('CARRIED_FORWARD')
            ),
            0
          )::text AS collectible_paid
        FROM charge c
        JOIN charge_type ct ON ct.id = c.charge_type_id
        WHERE c.tenant_id = $1
          AND c.site_id = $2
          AND c.status NOT IN ('CANCELLED', 'CARRIED_FORWARD')
          AND ct.code IN ('AIDAT', 'YAKIT', 'DIGER', 'DEVIR')
        GROUP BY c.period
        ORDER BY c.period DESC
        `,
        [tenantId, siteId],
      );

      const movementByPeriod = await pool.query<{ period: string; cnt: string }>(
        `
        SELECT c.period, COUNT(*)::text AS cnt
        FROM payment_allocation pa
        JOIN charge c ON c.id = pa.charge_id
        WHERE c.tenant_id = $1
          AND c.site_id = $2
        GROUP BY c.period
        `,
        [tenantId, siteId],
      );
      const movementSet = new Set(
        movementByPeriod.rows.filter((r) => Number(r.cnt) > 0).map((r) => r.period),
      );

      const items = result.rows.map((row) => {
        const total = money(Number(row.principal_total).toFixed(2));
        const open = money(Number(row.principal_open).toFixed(2));
        const collectiblePaid = money(Number(row.collectible_paid).toFixed(2));
        return {
          period: row.period,
          dueDate: row.due_date,
          chargeCount: Number(row.charge_count),
          unitCount: Number(row.unit_count),
          principalTotal: moneyToString(total),
          paidAmount: moneyToString(total.minus(open)),
          principalOpen: moneyToString(open),
          canDelete: collectiblePaid.isZero() && !movementSet.has(row.period),
        };
      });

      return { items };
    },
  );

  app.get(
    "/billing/period-statement",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_PREVIEW)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = PeriodQuerySchema.parse(request.query);
      const asOf = query.asOf ?? new Date();

      const [config] = await db
        .select()
        .from(siteFinanceConfigs)
        .where(
          and(
            eq(siteFinanceConfigs.tenantId, tenantId),
            eq(siteFinanceConfigs.siteId, query.siteId),
          ),
        )
        .limit(1);

      const lateFeeRate =
        config?.lateFeeEnabled === "true" ? (config.lateFeeMonthlyRate ?? "0.00") : "0.00";

      const result = await pool.query<{
        unit_id: string;
        unit_no: string;
        person_id: string | null;
        resident_name: string | null;
        management_role: string | null;
        due_date: Date | null;
        aidat_due_date: Date | null;
        yakit_due_date: Date | null;
        diger_due_date: Date | null;
        note: string | null;
        aidat_amount: string;
        aidat_open: string;
        yakit_amount: string;
        yakit_open: string;
        diger_amount: string;
        diger_open: string;
        devir_amount: string;
        devir_open: string;
        principal_total: string;
        principal_open: string;
        movement_count: string;
      }>(
        `
        SELECT
          u.id AS unit_id,
          u.unit_no,
          (
            SELECT links.person_id::text
            FROM (
              SELECT person_id, start_date FROM unit_occupancy
              WHERE unit_id = u.id AND tenant_id = $1
              UNION ALL
              SELECT person_id, start_date FROM unit_ownership
              WHERE unit_id = u.id AND tenant_id = $1
            ) links
            ORDER BY links.start_date DESC
            LIMIT 1
          ) AS person_id,
          (
            SELECT p.first_name || ' ' || p.last_name
            FROM (
              SELECT person_id, start_date FROM unit_occupancy
              WHERE unit_id = u.id AND tenant_id = $1
              UNION ALL
              SELECT person_id, start_date FROM unit_ownership
              WHERE unit_id = u.id AND tenant_id = $1
            ) links
            JOIN person p ON p.id = links.person_id
            ORDER BY links.start_date DESC
            LIMIT 1
          ) AS resident_name,
          (
            SELECT p.management_role
            FROM (
              SELECT person_id, start_date FROM unit_occupancy
              WHERE unit_id = u.id AND tenant_id = $1
              UNION ALL
              SELECT person_id, start_date FROM unit_ownership
              WHERE unit_id = u.id AND tenant_id = $1
            ) links
            JOIN person p ON p.id = links.person_id
            ORDER BY links.start_date DESC
            LIMIT 1
          ) AS management_role,
          MIN(c.due_date) AS due_date,
          MIN(c.due_date) FILTER (WHERE ct.code = 'AIDAT') AS aidat_due_date,
          MIN(c.due_date) FILTER (WHERE ct.code = 'YAKIT') AS yakit_due_date,
          MIN(c.due_date) FILTER (
            WHERE ct.code = 'DIGER'
              AND NOT (
                COALESCE(c.description, '') ILIKE '%devir%'
                OR COALESCE(cb.description, '') LIKE '%←%'
              )
          ) AS diger_due_date,
          (
            SELECT c3.note
            FROM charge c3
            WHERE c3.tenant_id = $1
              AND c3.site_id = $2
              AND c3.period = $3
              AND c3.unit_id = u.id
              AND c3.status <> 'CANCELLED'
              AND c3.note IS NOT NULL
              AND TRIM(c3.note) <> ''
            ORDER BY c3.id
            LIMIT 1
          ) AS note,
          COALESCE(SUM(c.amount) FILTER (WHERE ct.code = 'AIDAT'), 0)::text AS aidat_amount,
          COALESCE(SUM(c.open_amount) FILTER (WHERE ct.code = 'AIDAT'), 0)::text AS aidat_open,
          COALESCE(SUM(c.amount) FILTER (WHERE ct.code = 'YAKIT'), 0)::text AS yakit_amount,
          COALESCE(SUM(c.open_amount) FILTER (WHERE ct.code = 'YAKIT'), 0)::text AS yakit_open,
          COALESCE(SUM(c.amount) FILTER (
            WHERE ct.code = 'DIGER'
              AND NOT (
                COALESCE(c.description, '') ILIKE '%devir%'
                OR COALESCE(cb.description, '') LIKE '%←%'
              )
          ), 0)::text AS diger_amount,
          COALESCE(SUM(c.open_amount) FILTER (
            WHERE ct.code = 'DIGER'
              AND NOT (
                COALESCE(c.description, '') ILIKE '%devir%'
                OR COALESCE(cb.description, '') LIKE '%←%'
              )
          ), 0)::text AS diger_open,
          COALESCE(SUM(c.amount) FILTER (
            WHERE ct.code = 'DEVIR'
               OR (
                 ct.code = 'DIGER'
                 AND (
                   COALESCE(c.description, '') ILIKE '%devir%'
                   OR COALESCE(cb.description, '') LIKE '%←%'
                 )
               )
          ), 0)::text AS devir_amount,
          COALESCE(SUM(c.open_amount) FILTER (
            WHERE ct.code = 'DEVIR'
               OR (
                 ct.code = 'DIGER'
                 AND (
                   COALESCE(c.description, '') ILIKE '%devir%'
                   OR COALESCE(cb.description, '') LIKE '%←%'
                 )
               )
          ), 0)::text AS devir_open,
          COALESCE(SUM(c.amount) FILTER (WHERE ct.code IN ('AIDAT','YAKIT','DIGER','DEVIR')), 0)::text AS principal_total,
          COALESCE(SUM(c.open_amount) FILTER (WHERE ct.code IN ('AIDAT','YAKIT','DIGER','DEVIR')), 0)::text AS principal_open,
          COALESCE((
            SELECT COUNT(*)::text
            FROM payment_allocation pa
            JOIN charge c2 ON c2.id = pa.charge_id
            WHERE c2.tenant_id = $1
              AND c2.site_id = $2
              AND c2.period = $3
              AND c2.unit_id = u.id
              AND c2.status <> 'CANCELLED'
          ), '0') AS movement_count
        FROM unit u
        LEFT JOIN charge c
          ON c.unit_id = u.id
         AND c.tenant_id = $1
         AND c.site_id = $2
         AND c.period = $3
         AND c.status <> 'CANCELLED'
        LEFT JOIN charge_type ct ON ct.id = c.charge_type_id
        LEFT JOIN charge_batch cb ON cb.id = c.charge_batch_id
        WHERE u.tenant_id = $1
          AND u.site_id = $2
        GROUP BY u.id, u.unit_no
        HAVING COALESCE(SUM(c.amount), 0) <> 0
        ORDER BY CASE WHEN u.unit_no ~ '^[0-9]+$' THEN u.unit_no::int ELSE 999 END
        `,
        [tenantId, query.siteId, query.period],
      );

      const rows = result.rows.map((row) => {
        const dueDate = row.due_date ? new Date(row.due_date) : null;
        const overdue = dueDate ? isPastDue(dueDate, asOf) : false;
        const principalTotal = money(Number(row.principal_total).toFixed(2));
        const principalOpen = money(Number(row.principal_open).toFixed(2));
        const paidAmountMoney = principalTotal.minus(principalOpen);
        const paidAmount = moneyToString(paidAmountMoney);
        const movementCount = Number(row.movement_count ?? 0);
        const canRemove = paidAmountMoney.isZero() && movementCount === 0;
        const faiz =
          overdue && config?.lateFeeEnabled === "true" && !principalOpen.isZero()
            ? calculateLateFee(moneyToString(principalOpen), String(lateFeeRate))
            : "0.00";
        const remaining = moneyToString(principalOpen.plus(money(faiz)));

        let paymentStatus: "PAID" | "PARTIAL" | "OPEN" = "OPEN";
        if (principalOpen.isZero()) paymentStatus = "PAID";
        else if (principalOpen.lt(principalTotal)) paymentStatus = "PARTIAL";

        return {
          unitId: Number(row.unit_id),
          unitNo: row.unit_no,
          personId: row.person_id ? Number(row.person_id) : null,
          residentName: row.resident_name,
          managementRole: row.management_role,
          note: row.note,
          dueDate,
          aidatDueDate: row.aidat_due_date ? new Date(row.aidat_due_date) : null,
          yakitDueDate: row.yakit_due_date ? new Date(row.yakit_due_date) : null,
          digerDueDate: row.diger_due_date ? new Date(row.diger_due_date) : null,
          aidatAmount: Number(row.aidat_amount).toFixed(2),
          aidatOpen: Number(row.aidat_open).toFixed(2),
          yakitAmount: Number(row.yakit_amount).toFixed(2),
          yakitOpen: Number(row.yakit_open).toFixed(2),
          digerAmount: Number(row.diger_amount).toFixed(2),
          digerOpen: Number(row.diger_open).toFixed(2),
          devirAmount: Number(row.devir_amount).toFixed(2),
          devirOpen: Number(row.devir_open).toFixed(2),
          principalTotal: moneyToString(principalTotal),
          paidAmount,
          principalOpen: moneyToString(principalOpen),
          lateFeeRatePercent: String(lateFeeRate),
          faiz,
          isOverdue: overdue,
          remaining,
          totalDue: remaining,
          paymentStatus,
          canRemove,
          hasMovement: !canRemove,
          canCollect: !principalOpen.isZero(),
        };
      });

      const totals = rows.reduce(
        (acc, r) => ({
          aidat: acc.aidat.plus(money(r.aidatAmount)),
          yakit: acc.yakit.plus(money(r.yakitAmount)),
          diger: acc.diger.plus(money(r.digerAmount)),
          devir: acc.devir.plus(money(r.devirAmount)),
          principalTotal: acc.principalTotal.plus(money(r.principalTotal)),
          paidAmount: acc.paidAmount.plus(money(r.paidAmount)),
          principalOpen: acc.principalOpen.plus(money(r.principalOpen)),
          faiz: acc.faiz.plus(money(r.faiz)),
          remaining: acc.remaining.plus(money(r.remaining)),
        }),
        {
          aidat: Money.zero(),
          yakit: Money.zero(),
          diger: Money.zero(),
          devir: Money.zero(),
          principalTotal: Money.zero(),
          paidAmount: Money.zero(),
          principalOpen: Money.zero(),
          faiz: Money.zero(),
          remaining: Money.zero(),
        },
      );

      return {
        siteId: query.siteId,
        period: query.period,
        asOf,
        lateFeeEnabled: config?.lateFeeEnabled === "true",
        lateFeeRatePercent: String(lateFeeRate),
        rows,
        totals: {
          aidat: moneyToString(totals.aidat),
          yakit: moneyToString(totals.yakit),
          diger: moneyToString(totals.diger),
          devir: moneyToString(totals.devir),
          principalTotal: moneyToString(totals.principalTotal),
          paidAmount: moneyToString(totals.paidAmount),
          principalOpen: moneyToString(totals.principalOpen),
          faiz: moneyToString(totals.faiz),
          remaining: moneyToString(totals.remaining),
          totalDue: moneyToString(totals.remaining),
        },
      };
    },
  );

  app.delete(
    "/billing/periods/:period",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_CANCEL)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { period } = z
        .object({ period: z.string().regex(/^\d{4}-\d{2}$/) })
        .parse(request.params);
      const query = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.query);

      const movement = await pool.query<{ value: string }>(
        `
        SELECT COUNT(*)::text AS value
        FROM payment_allocation pa
        JOIN charge c ON c.id = pa.charge_id
        WHERE c.tenant_id = $1
          AND c.site_id = $2
          AND c.period = $3
        `,
        [tenantId, query.siteId, period],
      );
      if (Number(movement.rows[0]?.value ?? 0) > 0) {
        throw new AppError(
          "HAS_MOVEMENT",
          "Bu dönemde ödeme hareketi var. Dönem silinemez.",
          409,
        );
      }

      const paidCheck = await pool.query<{ paid: string }>(
        `
        SELECT COALESCE(SUM(amount - open_amount), 0)::text AS paid
        FROM charge
        WHERE tenant_id = $1
          AND site_id = $2
          AND period = $3
          AND status NOT IN ('CANCELLED', 'CARRIED_FORWARD')
        `,
        [tenantId, query.siteId, period],
      );
      if (Number(paidCheck.rows[0]?.paid ?? 0) > 0) {
        throw new AppError(
          "HAS_PAYMENT",
          "Bu dönemde tahsilat/ödeme kaydı var. Dönem silinemez.",
          409,
        );
      }

      const result = await db.transaction(async (tx) => {
        const periodCharges = await tx
          .select()
          .from(charges)
          .where(
            and(
              eq(charges.tenantId, tenantId),
              eq(charges.siteId, query.siteId),
              eq(charges.period, period),
            ),
          );

        const periodBatches = await tx
          .select()
          .from(chargeBatches)
          .where(
            and(
              eq(chargeBatches.tenantId, tenantId),
              eq(chargeBatches.siteId, query.siteId),
              eq(chargeBatches.period, period),
            ),
          );

        if (periodCharges.length === 0 && periodBatches.length === 0) {
          throw new AppError("NOT_FOUND", "Bu dönemde silinecek kayıt yok.", 404);
        }

        const chargeIds = periodCharges.map((c) => c.id);
        if (chargeIds.length > 0) {
          await tx.delete(charges).where(inArray(charges.id, chargeIds));
        }

        const batchIds = periodBatches.map((b) => b.id);
        if (batchIds.length > 0) {
          await tx.delete(chargeBatches).where(inArray(chargeBatches.id, batchIds));
        }

        await writeAudit(tx, {
          tenantId,
          siteId: query.siteId,
          userId: request.authUser.id,
          action: "PERIOD_DELETE",
          entityType: "period",
          entityId: period,
          oldData: {
            period,
            charges: periodCharges.map((c) => ({
              id: c.id,
              unitId: c.unitId,
              amount: c.amount,
              openAmount: c.openAmount,
              status: c.status,
              chargeTypeId: c.chargeTypeId,
            })),
            batches: periodBatches.map((b) => ({
              id: b.id,
              status: b.status,
              totalAmount: b.totalAmount,
              chargeTypeId: b.chargeTypeId,
            })),
          },
          newData: {
            period,
            deletedChargeCount: periodCharges.length,
            deletedBatchCount: periodBatches.length,
          },
        });

        return {
          deletedChargeCount: periodCharges.length,
          deletedBatchCount: periodBatches.length,
          cancelledChargeCount: periodCharges.length,
          cancelledBatchCount: periodBatches.length,
        };
      });

      return { ok: true, period, ...result };
    },
  );

  app.delete(
    "/billing/periods/:period/units/:unitId",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_CANCEL)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const params = z
        .object({
          period: z.string().regex(/^\d{4}-\d{2}$/),
          unitId: z.coerce.number().int().positive(),
        })
        .parse(request.params);
      const query = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.query);

      const [unit] = await db
        .select()
        .from(units)
        .where(
          and(
            eq(units.id, params.unitId),
            eq(units.tenantId, tenantId),
            eq(units.siteId, query.siteId),
          ),
        )
        .limit(1);
      if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

      const movement = await pool.query<{ value: string }>(
        `
        SELECT COUNT(*)::text AS value
        FROM payment_allocation pa
        JOIN charge c ON c.id = pa.charge_id
        WHERE c.tenant_id = $1
          AND c.site_id = $2
          AND c.period = $3
          AND c.unit_id = $4
          AND c.status <> 'CANCELLED'
        `,
        [tenantId, query.siteId, params.period, params.unitId],
      );
      if (Number(movement.rows[0]?.value ?? 0) > 0) {
        throw new AppError(
          "HAS_MOVEMENT",
          "Bu daire/sakin için dönemde ödeme hareketi var. Dönemden çıkarılamaz.",
          409,
        );
      }

      const openCheck = await pool.query<{ paid: string }>(
        `
        SELECT COALESCE(SUM(amount - open_amount), 0)::text AS paid
        FROM charge
        WHERE tenant_id = $1
          AND site_id = $2
          AND period = $3
          AND unit_id = $4
          AND status <> 'CANCELLED'
        `,
        [tenantId, query.siteId, params.period, params.unitId],
      );
      if (Number(openCheck.rows[0]?.paid ?? 0) > 0) {
        throw new AppError(
          "HAS_PAYMENT",
          "Bu daire için dönemde kısmi/tam ödeme var. Dönemden çıkarılamaz.",
          409,
        );
      }

      const cancelled = await db.transaction(async (tx) => {
        const active = await tx
          .select()
          .from(charges)
          .where(
            and(
              eq(charges.tenantId, tenantId),
              eq(charges.siteId, query.siteId),
              eq(charges.period, params.period),
              eq(charges.unitId, params.unitId),
            ),
          );

        const toCancel = active.filter((c) => c.status !== "CANCELLED");
        if (toCancel.length === 0) {
          throw new AppError("NOT_FOUND", "Bu dönemde daireye ait tahakkuk yok.", 404);
        }

        for (const charge of toCancel) {
          await tx
            .update(charges)
            .set({
              status: "CANCELLED",
              openAmount: "0.00",
              updatedAt: new Date(),
              updatedBy: request.authUser.id,
            })
            .where(eq(charges.id, charge.id));
        }

        await writeAudit(tx, {
          tenantId,
          siteId: query.siteId,
          userId: request.authUser.id,
          action: "PERIOD_UNIT_REMOVE",
          entityType: "unit",
          entityId: params.unitId,
          newData: {
            period: params.period,
            unitId: params.unitId,
            cancelledChargeIds: toCancel.map((c) => c.id),
          },
        });

        return toCancel.length;
      });

      return { ok: true, cancelledChargeCount: cancelled, period: params.period, unitId: params.unitId };
    },
  );

  app.patch(
    "/billing/periods/:period/units/:unitId/note",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const params = z
        .object({
          period: z.string().regex(/^\d{4}-\d{2}$/),
          unitId: z.coerce.number().int().positive(),
        })
        .parse(request.params);
      const body = z
        .object({
          siteId: z.number().int().positive(),
          note: z.string().trim().max(1000),
        })
        .parse(request.body);

      const noteValue = body.note.length > 0 ? body.note : null;

      const updated = await db.transaction(async (tx) => {
        const active = await tx
          .select()
          .from(charges)
          .where(
            and(
              eq(charges.tenantId, tenantId),
              eq(charges.siteId, body.siteId),
              eq(charges.period, params.period),
              eq(charges.unitId, params.unitId),
              notInArray(charges.status, ["CANCELLED"]),
            ),
          );

        if (active.length === 0) {
          throw new AppError("NOT_FOUND", "Bu dönemde daireye ait tahakkuk yok.", 404);
        }

        for (const charge of active) {
          await tx
            .update(charges)
            .set({
              note: noteValue,
              updatedAt: new Date(),
              updatedBy: request.authUser.id,
            })
            .where(eq(charges.id, charge.id));
        }

        await writeAudit(tx, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "PERIOD_UNIT_NOTE",
          entityType: "unit",
          entityId: params.unitId,
          newData: { period: params.period, unitId: params.unitId, note: noteValue },
        });

        return active.length;
      });

      return { ok: true, period: params.period, unitId: params.unitId, note: noteValue, updatedCount: updated };
    },
  );

  app.post(
    "/billing/periods/:period/units/:unitId/collect",
    { preHandler: [authenticate, requirePermission(Permission.PAYMENT_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const params = z
        .object({
          period: z.string().regex(/^\d{4}-\d{2}$/),
          unitId: z.coerce.number().int().positive(),
        })
        .parse(request.params);
      const body = z
        .object({
          siteId: z.number().int().positive(),
          amount: MoneyStringSchema.optional(),
          paymentDate: z.coerce.date().default(() => new Date()),
          paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD"]).default("CASH"),
          description: z.string().trim().max(1000).optional(),
          cashAccountId: z.number().int().positive().optional(),
        })
        .parse(request.body);

      const result = await db.transaction(async (tx) => {
        const [unit] = await tx
          .select()
          .from(units)
          .where(
            and(
              eq(units.id, params.unitId),
              eq(units.tenantId, tenantId),
              eq(units.siteId, body.siteId),
            ),
          )
          .limit(1);
        if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

        const open = await tx
          .select()
          .from(charges)
          .where(
            and(
              eq(charges.tenantId, tenantId),
              eq(charges.siteId, body.siteId),
              eq(charges.unitId, params.unitId),
              eq(charges.period, params.period),
              inArray(charges.status, ["OPEN", "PARTIAL"]),
            ),
          )
          .orderBy(asc(charges.dueDate), asc(charges.id))
          .for("update");

        if (open.length === 0) {
          throw new AppError("NO_OPEN_CHARGES", "Bu dönemde açık borç yok.", 400);
        }

        const openTotal = open.reduce((acc, c) => acc.plus(money(c.openAmount)), Money.zero());
        const payAmount = body.amount ? money(body.amount) : openTotal;
        if (payAmount.isZero()) {
          throw new AppError("INVALID_AMOUNT", "Ödeme tutarı 0 olamaz.", 400);
        }

        const plan = planOldestFirst(
          open.map((c) => ({ id: c.id, dueDate: c.dueDate, openAmount: c.openAmount })),
          moneyToString(payAmount),
        );

        const [payment] = await tx
          .insert(payments)
          .values({
            tenantId,
            siteId: body.siteId,
            unitId: params.unitId,
            paymentDate: body.paymentDate,
            amount: moneyToString(payAmount),
            paymentMethod: body.paymentMethod,
            description:
              body.description?.trim() ||
              `${params.period} dönem tahsilatı — Daire ${unit.unitNo}`,
            status: "POSTED",
            createdBy: request.authUser.id,
          })
          .returning();

        for (const line of plan) {
          const charge = open.find((c) => c.id === line.chargeId);
          if (!charge) throw new AppError("CHARGE_NOT_FOUND", "Borç bulunamadı.", 400);
          const openAmt = money(charge.openAmount);
          const apply = money(line.amount);
          const nextOpen = openAmt.minus(apply);
          if (nextOpen.isNegative()) {
            throw new AppError("ALLOCATION_EXCEEDS_OPEN", "Dağıtım açık tutarı aşıyor.", 400);
          }

          await tx.insert(paymentAllocations).values({
            tenantId,
            paymentId: payment.id,
            chargeId: charge.id,
            amount: moneyToString(apply),
          });

          await tx
            .update(charges)
            .set({
              openAmount: moneyToString(nextOpen),
              status: nextChargeStatus(money(charge.amount), nextOpen),
              updatedAt: new Date(),
              updatedBy: request.authUser.id,
            })
            .where(eq(charges.id, charge.id));
        }

        const year = body.paymentDate.getUTCFullYear();
        const receiptNo = await nextReceiptNo(tx, tenantId, body.siteId, year);
        const [receipt] = await tx
          .insert(receipts)
          .values({
            tenantId,
            siteId: body.siteId,
            paymentId: payment.id,
            receiptNo,
            status: "ISSUED",
          })
          .returning();

        if (body.paymentMethod === "CASH") {
          let cashAccountId = body.cashAccountId;
          if (!cashAccountId) {
            const [cash] = await tx
              .select()
              .from(cashAccounts)
              .where(and(eq(cashAccounts.tenantId, tenantId), eq(cashAccounts.siteId, body.siteId)))
              .limit(1);
            if (!cash) {
              const [createdCash] = await tx
                .insert(cashAccounts)
                .values({
                  tenantId,
                  siteId: body.siteId,
                  name: "Ana Kasa",
                  currencyCode: "TRY",
                })
                .returning();
              cashAccountId = createdCash.id;
            } else {
              cashAccountId = cash.id;
            }
          }

          await tx.insert(cashTransactions).values({
            tenantId,
            cashAccountId,
            transactionDate: body.paymentDate,
            type: "IN",
            amount: moneyToString(payAmount),
            referenceType: "payment",
            referenceId: payment.id,
            description: body.description ?? `Tahsilat #${payment.id}`,
            createdBy: request.authUser.id,
          });
        }

        await writeAudit(tx, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "PERIOD_UNIT_COLLECT",
          entityType: "payment",
          entityId: payment.id,
          newData: { period: params.period, unitId: params.unitId, payment, plan, receipt },
        });

        return { payment, allocations: plan, receipt };
      });

      return result;
    },
  );

  app.get(
    "/billing/periods/:period/units/:unitId/payments",
    { preHandler: [authenticate, requirePermission(Permission.PAYMENT_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const params = z
        .object({
          period: z.string().regex(/^\d{4}-\d{2}$/),
          unitId: z.coerce.number().int().positive(),
        })
        .parse(request.params);
      const query = z
        .object({ siteId: z.coerce.number().int().positive() })
        .parse(request.query);

      const result = await pool.query<{
        id: string;
        payment_date: Date;
        amount: string;
        payment_method: string;
        description: string | null;
        status: string;
        receipt_no: string | null;
      }>(
        `
        SELECT DISTINCT ON (p.id)
          p.id,
          p.payment_date,
          p.amount::text,
          p.payment_method,
          p.description,
          p.status,
          r.receipt_no
        FROM payment p
        JOIN payment_allocation pa ON pa.payment_id = p.id
        JOIN charge c ON c.id = pa.charge_id
        LEFT JOIN receipt r ON r.payment_id = p.id
        WHERE p.tenant_id = $1
          AND p.site_id = $2
          AND p.unit_id = $3
          AND c.period = $4
          AND p.status = 'POSTED'
        ORDER BY p.id DESC, p.payment_date DESC
        `,
        [tenantId, query.siteId, params.unitId, params.period],
      );

      return {
        items: result.rows.map((row) => ({
          id: Number(row.id),
          paymentDate: row.payment_date,
          amount: Number(row.amount).toFixed(2),
          paymentMethod: row.payment_method,
          description: row.description,
          status: row.status,
          receiptNo: row.receipt_no,
        })),
      };
    },
  );

  app.post(
    "/billing/periods/:period/units",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { period } = z
        .object({ period: z.string().regex(/^\d{4}-\d{2}$/) })
        .parse(request.params);
      const body = z
        .object({
          siteId: z.number().int().positive(),
          unitId: z.number().int().positive(),
          aidatPerUnit: MoneyStringSchema.optional(),
          yakitPerUnit: MoneyStringSchema.optional(),
          digerPerUnit: MoneyStringSchema.optional(),
          digerDescription: z.string().trim().max(200).optional(),
        })
        .parse(request.body);

      const [unit] = await db
        .select()
        .from(units)
        .where(
          and(
            eq(units.id, body.unitId),
            eq(units.tenantId, tenantId),
            eq(units.siteId, body.siteId),
          ),
        )
        .limit(1);
      if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

      const existing = await pool.query<{ value: string }>(
        `
        SELECT COUNT(*)::text AS value
        FROM charge
        WHERE tenant_id = $1 AND site_id = $2 AND period = $3 AND unit_id = $4 AND status <> 'CANCELLED'
        `,
        [tenantId, body.siteId, period, body.unitId],
      );
      if (Number(existing.rows[0]?.value ?? 0) > 0) {
        throw new AppError("ALREADY_IN_PERIOD", "Bu daire zaten dönemde tahakkuklu.", 409);
      }

      const template = await pool.query<{
        code: string;
        amount: string;
        due_date: Date;
        charge_type_id: string;
        description: string | null;
        charge_batch_id: string | null;
      }>(
        `
        SELECT DISTINCT ON (ct.code)
          ct.code,
          c.amount::text,
          c.due_date,
          c.charge_type_id::text,
          c.description,
          c.charge_batch_id::text
        FROM charge c
        JOIN charge_type ct ON ct.id = c.charge_type_id
        WHERE c.tenant_id = $1
          AND c.site_id = $2
          AND c.period = $3
          AND c.status <> 'CANCELLED'
          AND ct.code IN ('AIDAT', 'YAKIT', 'DIGER', 'DEVIR')
        ORDER BY ct.code, c.id
        `,
        [tenantId, body.siteId, period],
      );

      if (template.rows.length === 0 && !body.aidatPerUnit && !body.yakitPerUnit && !body.digerPerUnit) {
        throw new AppError(
          "NO_PERIOD_TEMPLATE",
          "Dönemde örnek tahakkuk yok. Aidat/yakıt/diğer tutarlarını gönderin.",
          400,
        );
      }

      const amountByCode = new Map(template.rows.map((r) => [r.code, r.amount]));
      if (body.aidatPerUnit) amountByCode.set("AIDAT", body.aidatPerUnit);
      if (body.yakitPerUnit) amountByCode.set("YAKIT", body.yakitPerUnit);
      if (body.digerPerUnit) amountByCode.set("DIGER", body.digerPerUnit);

      if (await isUnitAidatExempt({ tenantId, siteId: body.siteId, unitId: body.unitId })) {
        amountByCode.set("AIDAT", "0.00");
      }

      const dueDate = template.rows[0]?.due_date ?? new Date();
      const aidatType = await ensureChargeType(tenantId, "AIDAT", "Aidat", "DUES");
      const yakitType = await ensureChargeType(tenantId, "YAKIT", "Yakıt", "FUEL");
      const digerType = await ensureChargeType(tenantId, "DIGER", "Site İşi / Diğer", "EXTRA");
      const devirType = await ensureChargeType(
        tenantId,
        "DEVIR",
        "Önceki dönemden devir",
        "CARRY",
      );
      const typeByCode = new Map([
        ["AIDAT", aidatType],
        ["YAKIT", yakitType],
        ["DIGER", digerType],
        ["DEVIR", devirType],
      ]);

      const created = await db.transaction(async (tx) => {
        const insertedIds: number[] = [];
        for (const [code, amount] of amountByCode.entries()) {
          if (money(amount).isZero()) continue;
          const chargeType = typeByCode.get(code);
          if (!chargeType) continue;
          const tmpl = template.rows.find((r) => r.code === code);
          const [row] = await tx
            .insert(charges)
            .values({
              tenantId,
              siteId: body.siteId,
              unitId: body.unitId,
              chargeBatchId: tmpl?.charge_batch_id ? Number(tmpl.charge_batch_id) : null,
              chargeTypeId: chargeType.id,
              period,
              amount,
              openAmount: amount,
              dueDate: tmpl?.due_date ?? dueDate,
              status: "OPEN",
              description:
                code === "DIGER" && body.digerDescription
                  ? `${period} ${body.digerDescription}`
                  : (tmpl?.description ?? `${period} ${chargeType.name}`),
              createdBy: request.authUser.id,
            })
            .returning();
          insertedIds.push(row.id);
        }

        if (insertedIds.length === 0) {
          throw new AppError("NO_AMOUNTS", "Eklenecek tutar yok.", 400);
        }

        await writeAudit(tx, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "PERIOD_UNIT_ADD",
          entityType: "unit",
          entityId: body.unitId,
          newData: { period, unitId: body.unitId, chargeIds: insertedIds },
        });

        return insertedIds;
      });

      return { ok: true, period, unitId: body.unitId, chargeIds: created };
    },
  );

  app.get(
    "/billing/periods/:period/available-units",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_PREVIEW)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { period } = z
        .object({ period: z.string().regex(/^\d{4}-\d{2}$/) })
        .parse(request.params);
      const query = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.query);

      const result = await pool.query<{
        id: string;
        unit_no: string;
        floor_no: string | null;
        resident_name: string | null;
      }>(
        `
        SELECT
          u.id,
          u.unit_no,
          u.floor_no,
          (
            SELECT p.first_name || ' ' || p.last_name
            FROM (
              SELECT person_id, start_date FROM unit_occupancy
              WHERE unit_id = u.id AND tenant_id = $1
              UNION ALL
              SELECT person_id, start_date FROM unit_ownership
              WHERE unit_id = u.id AND tenant_id = $1
            ) links
            JOIN person p ON p.id = links.person_id
            ORDER BY links.start_date DESC
            LIMIT 1
          ) AS resident_name
        FROM unit u
        WHERE u.tenant_id = $1
          AND u.site_id = $2
          AND u.unit_no <> 'KD'
          AND NOT EXISTS (
            SELECT 1 FROM charge c
            WHERE c.unit_id = u.id
              AND c.tenant_id = $1
              AND c.site_id = $2
              AND c.period = $3
              AND c.status <> 'CANCELLED'
          )
        ORDER BY CASE WHEN u.unit_no ~ '^[0-9]+$' THEN u.unit_no::int ELSE 999 END
        `,
        [tenantId, query.siteId, period],
      );

      return {
        items: result.rows.map((r) => ({
          id: Number(r.id),
          unitNo: r.unit_no,
          floorNo: r.floor_no,
          residentName: r.resident_name,
        })),
      };
    },
  );

  app.post(
    "/billing/yakit/import/preview",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_PREVIEW)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const file = await request.file();
      if (!file) throw new AppError("FILE_REQUIRED", "Excel dosyası gerekli.", 400);

      const fields = file.fields as Record<
        string,
        { value?: unknown } | { value?: unknown }[] | undefined
      >;
      const siteId = Number(fieldValue(fields, "siteId"));
      const period = fieldValue(fields, "period") ?? "";
      if (!Number.isInteger(siteId) || siteId <= 0) {
        throw new AppError("VALIDATION_ERROR", "siteId gerekli.", 400);
      }
      if (!/^\d{4}-\d{2}$/.test(period)) {
        throw new AppError("VALIDATION_ERROR", "Dönem YYYY-MM olmalı.", 400);
      }

      const buffer = await file.toBuffer();
      const parsed = parseYakitExcel(buffer);
      const plan = await buildYakitImportPlan({ tenantId, siteId, period, rows: parsed });

      const createCount = plan.filter((r) => r.action === "CREATE").length;
      const updateCount = plan.filter((r) => r.action === "UPDATE").length;
      const skipCount = plan.filter((r) => r.action === "SKIP").length;
      const applyTotal = plan
        .filter((r) => r.action === "CREATE" || r.action === "UPDATE")
        .reduce((acc, r) => acc.plus(money(r.amount)), Money.zero());

      return {
        siteId,
        period,
        fileName: file.filename,
        totalRows: plan.length,
        createCount,
        updateCount,
        skipCount,
        applyTotal: moneyToString(applyTotal),
        rows: plan,
      };
    },
  );

  app.post(
    "/billing/yakit/import",
    { preHandler: [authenticate, requirePermission(Permission.CHARGE_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const file = await request.file();
      if (!file) throw new AppError("FILE_REQUIRED", "Excel dosyası gerekli.", 400);

      const fields = file.fields as Record<
        string,
        { value?: unknown } | { value?: unknown }[] | undefined
      >;
      const siteId = Number(fieldValue(fields, "siteId"));
      const period = fieldValue(fields, "period") ?? "";
      const dueDateRaw = fieldValue(fields, "dueDate");
      if (!Number.isInteger(siteId) || siteId <= 0) {
        throw new AppError("VALIDATION_ERROR", "siteId gerekli.", 400);
      }
      if (!/^\d{4}-\d{2}$/.test(period)) {
        throw new AppError("VALIDATION_ERROR", "Dönem YYYY-MM olmalı.", 400);
      }

      const buffer = await file.toBuffer();
      const parsed = parseYakitExcel(buffer);
      const plan = await buildYakitImportPlan({ tenantId, siteId, period, rows: parsed });
      const actionable = plan.filter((r) => r.action === "CREATE" || r.action === "UPDATE");
      if (actionable.length === 0) {
        throw new AppError("NOTHING_TO_APPLY", "Uygulanacak yakıt satırı yok.", 400);
      }

      const yakitType = await ensureChargeType(tenantId, "YAKIT", "Yakıt", "FUEL");

      let dueDate: Date;
      if (dueDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw)) {
        dueDate = new Date(`${dueDateRaw}T00:00:00.000Z`);
      } else {
        const existingDue = await pool.query<{ due_date: Date }>(
          `
          SELECT due_date
          FROM charge
          WHERE tenant_id = $1 AND site_id = $2 AND period = $3 AND status <> 'CANCELLED'
          ORDER BY id
          LIMIT 1
          `,
          [tenantId, siteId, period],
        );
        if (existingDue.rows[0]?.due_date) {
          dueDate = new Date(existingDue.rows[0].due_date);
        } else {
          const [y, m] = period.split("-").map(Number);
          const year = m === 12 ? y! + 1 : y!;
          const month = m === 12 ? 1 : m! + 1;
          dueDate = new Date(
            `${year}-${String(month).padStart(2, "0")}-10T00:00:00.000Z`,
          );
        }
      }

      const result = await db.transaction(async (tx) => {
        const createRows = actionable.filter((r) => r.action === "CREATE" && r.unitId != null);
        const updateRows = actionable.filter((r) => r.action === "UPDATE" && r.existingChargeId != null);

        let batchId: number | null = null;
        let createdCount = 0;
        let updatedCount = 0;
        let total = Money.zero();

        if (createRows.length > 0) {
          const createTotal = createRows.reduce(
            (acc, r) => acc.plus(money(r.amount)),
            Money.zero(),
          );
          const [batch] = await tx
            .insert(chargeBatches)
            .values({
              tenantId,
              siteId,
              period,
              chargeTypeId: yakitType.id,
              distributionMethod: "CUSTOM",
              totalAmount: moneyToString(createTotal),
              dueDate,
              status: "POSTED",
              description: `${period} Yakıt (Excel aktarım)`,
              createdBy: request.authUser.id,
            })
            .returning();
          batchId = batch.id;

          const inserted = await tx
            .insert(charges)
            .values(
              createRows.map((r) => ({
                tenantId,
                siteId,
                unitId: r.unitId!,
                chargeBatchId: batch.id,
                chargeTypeId: yakitType.id,
                period,
                amount: r.amount,
                openAmount: r.amount,
                dueDate,
                status: "OPEN" as const,
                description: `${period} Yakıt`,
                createdBy: request.authUser.id,
              })),
            )
            .returning();
          createdCount = inserted.length;
          total = total.plus(createTotal);
        }

        for (const row of updateRows) {
          await tx
            .update(charges)
            .set({
              amount: row.amount,
              openAmount: row.amount,
              dueDate,
              description: `${period} Yakıt`,
              updatedAt: new Date(),
              updatedBy: request.authUser.id,
            })
            .where(eq(charges.id, row.existingChargeId!));
          updatedCount += 1;
          total = total.plus(money(row.amount));
        }

        await writeAudit(tx, {
          tenantId,
          siteId,
          userId: request.authUser.id,
          action: "YAKIT_EXCEL_IMPORT",
          entityType: "charge_batch",
          entityId: batchId,
          newData: {
            period,
            fileName: file.filename,
            createdCount,
            updatedCount,
            skipCount: plan.filter((r) => r.action === "SKIP").length,
            totalAmount: moneyToString(total),
            rows: actionable,
          },
        });

        return {
          period,
          batchId,
          createdCount,
          updatedCount,
          skipCount: plan.filter((r) => r.action === "SKIP").length,
          totalAmount: moneyToString(total),
        };
      });

      return { ok: true, ...result };
    },
  );
}
