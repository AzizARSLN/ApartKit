import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, pool, type DbTransaction } from "../../db/client.js";
import {
  bankAccountPeriodBalances,
  bankAccounts,
  bankImportBatches,
  bankSenderMappings,
  bankTransactions,
  blocks,
  charges,
  expenseCategories,
  expenses,
  paymentAllocations,
  payments,
  persons,
  receiptSequences,
  receipts,
  unitOccupancies,
  unitOwnerships,
  units,
} from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  PaginationQuerySchema,
  paginatedResult,
  paginationOffset,
} from "../../shared/pagination/pagination.js";
import { MoneyStringSchema, money, moneyToString } from "../../shared/utils/money.js";
import { nextChargeStatus, planOldestFirst, planUserSelected } from "../payments/allocation.js";
import { buildBankFingerprint, normalizeDescription } from "./fingerprint.js";
import { findIdempotency, hashRequestBody, storeIdempotency } from "./idempotency.js";
import {
  parseBankFileWithMeta,
  suggestExpenseCategoryCode,
  type NormalizedBankTransaction,
} from "./parsers.js";
import { scoreBankTransaction, type UnitScoreCandidate } from "./scoring.js";

const CreateBankAccountSchema = z.object({
  siteId: z.number().int().positive(),
  bankName: z.string().min(1).max(200),
  iban: z.string().min(10).max(34),
  accountName: z.string().min(1).max(200),
  currencyCode: z.string().min(3).max(8).default("TRY"),
});

const PeriodBalanceUpsertSchema = z.object({
  siteId: z.number().int().positive(),
  period: z.string().regex(/^\d{4}-\d{2}$/, "Dönem YYYY-MM olmalı"),
  balanceAmount: MoneyStringSchema,
  note: z.string().trim().max(500).optional().nullable(),
});

const CollectSchema = z.object({
  unitId: z.number().int().positive().optional(),
  strategy: z.enum(["OLDEST_FIRST", "USER_SELECTED"]).default("OLDEST_FIRST"),
  selections: z
    .array(
      z.object({
        chargeId: z.number().int().positive(),
        amount: z.string(),
      }),
    )
    .optional(),
  paymentDate: z.coerce.date().optional(),
});

const BulkCollectSchema = z.object({
  transactionIds: z.array(z.number().int().positive()).min(1).max(500),
  strategy: z.enum(["OLDEST_FIRST"]).default("OLDEST_FIRST"),
});

const SenderMappingSchema = z.object({
  siteId: z.number().int().positive(),
  senderIban: z.string().min(10).max(34),
  unitId: z.number().int().positive(),
});

const ReconcileSchema = z.object({
  siteId: z.number().int().positive(),
  bankAccountId: z.number().int().positive().optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const PeriodParamSchema = z.string().regex(/^\d{4}-\d{2}$/, "Dönem YYYY-MM olmalı");

type ScoringContext = {
  candidates: UnitScoreCandidate[];
  mappingByIban: Map<string, number>;
  ibanHistoryByUnit: Map<number, Set<string>>;
};

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

function parseDateAtUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
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

async function loadScoringContext(tenantId: number, siteId: number): Promise<ScoringContext> {
  const unitRows = await db
    .select({
      unitId: units.id,
      unitNo: units.unitNo,
      blockCode: blocks.code,
      blockName: blocks.name,
    })
    .from(units)
    .leftJoin(blocks, eq(units.blockId, blocks.id))
    .where(and(eq(units.tenantId, tenantId), eq(units.siteId, siteId), eq(units.status, "ACTIVE")));

  if (unitRows.length === 0) {
    return {
      candidates: [],
      mappingByIban: new Map(),
      ibanHistoryByUnit: new Map(),
    };
  }

  const unitIds = unitRows.map((u) => u.unitId);

  const openChargeRows = await db
    .select({
      unitId: charges.unitId,
      openAmount: charges.openAmount,
    })
    .from(charges)
    .where(
      and(
        eq(charges.tenantId, tenantId),
        eq(charges.siteId, siteId),
        inArray(charges.unitId, unitIds),
        inArray(charges.status, ["OPEN", "PARTIAL"]),
      ),
    );

  const openTotals = new Map<number, ReturnType<typeof money>>();
  for (const row of openChargeRows) {
    const prev = openTotals.get(row.unitId) ?? money("0");
    openTotals.set(row.unitId, prev.plus(money(row.openAmount)));
  }

  const ownershipNames = await db
    .select({
      unitId: unitOwnerships.unitId,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(unitOwnerships)
    .innerJoin(persons, eq(unitOwnerships.personId, persons.id))
    .where(
      and(
        eq(unitOwnerships.tenantId, tenantId),
        inArray(unitOwnerships.unitId, unitIds),
        sql`${unitOwnerships.endDate} IS NULL`,
      ),
    );

  const occupancyNames = await db
    .select({
      unitId: unitOccupancies.unitId,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(unitOccupancies)
    .innerJoin(persons, eq(unitOccupancies.personId, persons.id))
    .where(
      and(
        eq(unitOccupancies.tenantId, tenantId),
        inArray(unitOccupancies.unitId, unitIds),
        sql`${unitOccupancies.endDate} IS NULL`,
      ),
    );

  const namesByUnit = new Map<number, Set<string>>();
  for (const row of [...ownershipNames, ...occupancyNames]) {
    const set = namesByUnit.get(row.unitId) ?? new Set<string>();
    set.add(normalizeDescription(`${row.firstName} ${row.lastName}`));
    namesByUnit.set(row.unitId, set);
  }

  const paidUnits = await db
    .selectDistinct({ unitId: payments.unitId })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.siteId, siteId),
        eq(payments.status, "POSTED"),
        inArray(payments.unitId, unitIds),
      ),
    );
  const paidSet = new Set(paidUnits.map((p) => p.unitId));

  const mappings = await db
    .select()
    .from(bankSenderMappings)
    .where(and(eq(bankSenderMappings.tenantId, tenantId), eq(bankSenderMappings.siteId, siteId)));

  const mappingByIban = new Map(mappings.map((m) => [m.senderIban.toUpperCase(), m.unitId]));

  const priorIbanPayments = await db
    .select({
      unitId: payments.unitId,
      senderIban: bankTransactions.senderIban,
    })
    .from(payments)
    .innerJoin(bankTransactions, eq(payments.bankTransactionId, bankTransactions.id))
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.siteId, siteId),
        eq(payments.status, "POSTED"),
        eq(bankTransactions.direction, "IN"),
        isNotNull(bankTransactions.senderIban),
      ),
    );

  const ibanHistoryByUnit = new Map<number, Set<string>>();
  for (const row of priorIbanPayments) {
    if (!row.senderIban) continue;
    const set = ibanHistoryByUnit.get(row.unitId) ?? new Set<string>();
    set.add(row.senderIban.toUpperCase());
    ibanHistoryByUnit.set(row.unitId, set);
  }

  const candidates: UnitScoreCandidate[] = unitRows.map((u) => {
    const openTotal = openTotals.get(u.unitId) ?? money("0");
    return {
      unitId: u.unitId,
      blockCode: u.blockCode,
      blockName: u.blockName,
      unitNo: u.unitNo,
      personNamesNormalized: [...(namesByUnit.get(u.unitId) ?? [])],
      openChargeTotal: moneyToString(openTotal),
      hasIbanMapping: false,
      hasIbanPaymentHistory: false,
      hasPaymentHistory: paidSet.has(u.unitId),
    };
  });

  return { candidates, mappingByIban, ibanHistoryByUnit };
}

function candidatesForIban(ctx: ScoringContext, senderIban: string | null): UnitScoreCandidate[] {
  const iban = senderIban?.toUpperCase() ?? null;
  return ctx.candidates.map((c) => ({
    ...c,
    hasIbanMapping: Boolean(iban && ctx.mappingByIban.get(iban) === c.unitId),
    hasIbanPaymentHistory: Boolean(iban && ctx.ibanHistoryByUnit.get(c.unitId)?.has(iban)),
  }));
}

async function scoreAndUpdateTransaction(
  tenantId: number,
  txRow: typeof bankTransactions.$inferSelect,
  ctx: ScoringContext,
): Promise<void> {
  if (txRow.direction !== "IN") return;
  if (txRow.matchStatus === "MATCHED" || txRow.matchStatus === "IGNORED") return;

  const result = scoreBankTransaction(
    {
      amount: txRow.amount,
      senderName: txRow.senderName,
      description: txRow.description,
    },
    candidatesForIban(ctx, txRow.senderIban),
  );

  await db
    .update(bankTransactions)
    .set({
      matchedUnitId: result.unitId,
      matchScore: result.score,
      matchClassification: result.classification,
      matchStatus: result.matchStatus,
    })
    .where(and(eq(bankTransactions.id, txRow.id), eq(bankTransactions.tenantId, tenantId)));
}

async function collectBankTransactionInTx(
  tx: DbTransaction,
  input: {
    tenantId: number;
    userId: number;
    bankTxId: number;
    unitId?: number;
    strategy: "OLDEST_FIRST" | "USER_SELECTED";
    selections?: Array<{ chargeId: number; amount: string }>;
    paymentDate?: Date;
  },
): Promise<{ paymentId: number; receiptNo: string; unitId: number }> {
  const [bankTx] = await tx
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, input.bankTxId), eq(bankTransactions.tenantId, input.tenantId)))
    .limit(1)
    .for("update");

  if (!bankTx) throw new AppError("NOT_FOUND", "Banka hareketi bulunamadı.", 404);
  if (bankTx.direction !== "IN") {
    throw new AppError("INVALID_DIRECTION", "Yalnızca IN hareketlerinden tahsilat yapılır.", 400);
  }
  if (bankTx.matchStatus === "MATCHED" || bankTx.matchedPaymentId) {
    throw new AppError("ALREADY_MATCHED", "Hareket zaten tahsil edilmiş.", 409);
  }
  if (bankTx.matchStatus === "IGNORED") {
    throw new AppError("TX_IGNORED", "Yoksayılmış hareket tahsil edilemez.", 400);
  }

  const unitId = input.unitId ?? bankTx.matchedUnitId ?? undefined;
  if (!unitId) {
    throw new AppError("UNIT_REQUIRED", "Daire seçimi gerekli.", 400);
  }

  const [unit] = await tx
    .select()
    .from(units)
    .where(
      and(eq(units.id, unitId), eq(units.tenantId, input.tenantId), eq(units.siteId, bankTx.siteId)),
    )
    .limit(1);
  if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

  const open = await tx
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.tenantId, input.tenantId),
        eq(charges.unitId, unitId),
        inArray(charges.status, ["OPEN", "PARTIAL"]),
      ),
    )
    .orderBy(asc(charges.dueDate), asc(charges.id))
    .for("update");

  const openModel = open.map((c) => ({
    id: c.id,
    dueDate: c.dueDate,
    openAmount: c.openAmount,
  }));

  const plan =
    input.strategy === "USER_SELECTED"
      ? planUserSelected(input.selections ?? [], openModel, bankTx.amount)
      : planOldestFirst(openModel, bankTx.amount);

  const paymentDate = input.paymentDate ?? bankTx.transactionDate;

  const [payment] = await tx
    .insert(payments)
    .values({
      tenantId: input.tenantId,
      siteId: bankTx.siteId,
      unitId,
      paymentDate,
      amount: bankTx.amount,
      paymentMethod: "BANK_TRANSFER",
      bankTransactionId: bankTx.id,
      description: bankTx.description,
      status: "POSTED",
      createdBy: input.userId,
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
      tenantId: input.tenantId,
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
        updatedBy: input.userId,
      })
      .where(and(eq(charges.id, charge.id), eq(charges.tenantId, input.tenantId)));
  }

  const year = paymentDate.getUTCFullYear();
  const receiptNo = await nextReceiptNo(tx, input.tenantId, bankTx.siteId, year);
  await tx.insert(receipts).values({
    tenantId: input.tenantId,
    siteId: bankTx.siteId,
    paymentId: payment.id,
    receiptNo,
    status: "ISSUED",
  });

  await tx
    .update(bankTransactions)
    .set({
      matchStatus: "MATCHED",
      matchedPaymentId: payment.id,
      matchedUnitId: unitId,
      matchScore: bankTx.matchScore ?? 100,
      matchClassification: bankTx.matchClassification ?? "AUTO_CONFIDENT",
    })
    .where(eq(bankTransactions.id, bankTx.id));

  if (bankTx.senderIban) {
    const iban = bankTx.senderIban.toUpperCase();
    const [existing] = await tx
      .select()
      .from(bankSenderMappings)
      .where(
        and(eq(bankSenderMappings.siteId, bankTx.siteId), eq(bankSenderMappings.senderIban, iban)),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(bankSenderMappings)
        .set({
          unitId,
          lastUsedAt: new Date(),
          confidence: 100,
        })
        .where(eq(bankSenderMappings.id, existing.id));
    } else {
      await tx.insert(bankSenderMappings).values({
        tenantId: input.tenantId,
        siteId: bankTx.siteId,
        senderIban: iban,
        unitId,
        confidence: 100,
        lastUsedAt: new Date(),
      });
    }
  }

  await writeAudit(tx, {
    tenantId: input.tenantId,
    siteId: bankTx.siteId,
    userId: input.userId,
    action: "BANK_COLLECT",
    entityType: "bank_transaction",
    entityId: bankTx.id,
    newData: { paymentId: payment.id, unitId, plan, receiptNo },
  });

  return { paymentId: payment.id, receiptNo, unitId };
}

function fingerprintForRow(bankAccountId: number, row: NormalizedBankTransaction): string {
  return buildBankFingerprint({
    bankAccountId,
    transactionDate: row.transactionDate,
    valueDate: row.valueDate,
    amount: row.amount,
    direction: row.direction,
    senderIban: row.senderIban,
    bankReference: row.bankReference,
    normalizedDescription: normalizeDescription(row.description),
  });
}

export async function bankingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/bank-accounts",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_IMPORT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = z
        .object({ siteId: z.coerce.number().int().positive().optional() })
        .parse(request.query);

      const conditions = [eq(bankAccounts.tenantId, tenantId)];
      if (query.siteId) conditions.push(eq(bankAccounts.siteId, query.siteId));

      return db
        .select()
        .from(bankAccounts)
        .where(and(...conditions))
        .orderBy(desc(bankAccounts.id));
    },
  );

  app.post(
    "/bank-accounts",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_IMPORT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CreateBankAccountSchema.parse(request.body);
      const iban = body.iban.replace(/\s+/g, "").toUpperCase();

      const [created] = await db
        .insert(bankAccounts)
        .values({
          tenantId,
          siteId: body.siteId,
          bankName: body.bankName,
          iban,
          accountName: body.accountName,
          currencyCode: body.currencyCode.toUpperCase(),
        })
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: body.siteId,
        userId: request.authUser.id,
        action: "BANK_ACCOUNT_CREATE",
        entityType: "bank_account",
        entityId: created.id,
        newData: created,
      });

      return created;
    },
  );

  app.get(
    "/bank-accounts/:id/period-balances",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_IMPORT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id: bankAccountId } = z
        .object({ id: z.coerce.number().int().positive() })
        .parse(request.params);
      const query = z.object({ siteId: z.coerce.number().int().positive() }).parse(request.query);

      const [account] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, bankAccountId),
            eq(bankAccounts.tenantId, tenantId),
            eq(bankAccounts.siteId, query.siteId),
          ),
        )
        .limit(1);
      if (!account) throw new AppError("NOT_FOUND", "Banka hesabı bulunamadı.", 404);

      const items = await db
        .select()
        .from(bankAccountPeriodBalances)
        .where(
          and(
            eq(bankAccountPeriodBalances.tenantId, tenantId),
            eq(bankAccountPeriodBalances.siteId, query.siteId),
            eq(bankAccountPeriodBalances.bankAccountId, bankAccountId),
          ),
        )
        .orderBy(desc(bankAccountPeriodBalances.period));

      return { items };
    },
  );

  app.put(
    "/bank-accounts/:id/period-balances",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_IMPORT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id: bankAccountId } = z
        .object({ id: z.coerce.number().int().positive() })
        .parse(request.params);
      const body = PeriodBalanceUpsertSchema.parse(request.body);
      const balanceAmount = moneyToString(money(body.balanceAmount));

      const [account] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, bankAccountId),
            eq(bankAccounts.tenantId, tenantId),
            eq(bankAccounts.siteId, body.siteId),
          ),
        )
        .limit(1);
      if (!account) throw new AppError("NOT_FOUND", "Banka hesabı bulunamadı.", 404);

      const [existing] = await db
        .select()
        .from(bankAccountPeriodBalances)
        .where(
          and(
            eq(bankAccountPeriodBalances.bankAccountId, bankAccountId),
            eq(bankAccountPeriodBalances.period, body.period),
          ),
        )
        .limit(1);

      const now = new Date();
      let saved;

      if (existing) {
        const [updated] = await db
          .update(bankAccountPeriodBalances)
          .set({
            balanceAmount,
            note: body.note?.trim() || null,
            recordedAt: now,
            updatedAt: now,
            updatedBy: request.authUser.id,
          })
          .where(eq(bankAccountPeriodBalances.id, existing.id))
          .returning();
        saved = updated;

        await writeAudit(db, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "BANK_PERIOD_BALANCE_UPDATE",
          entityType: "bank_account_period_balance",
          entityId: updated.id,
          oldData: existing,
          newData: updated,
        });
      } else {
        const [created] = await db
          .insert(bankAccountPeriodBalances)
          .values({
            tenantId,
            siteId: body.siteId,
            bankAccountId,
            period: body.period,
            balanceAmount,
            note: body.note?.trim() || null,
            recordedAt: now,
            createdBy: request.authUser.id,
          })
          .returning();
        saved = created;

        await writeAudit(db, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "BANK_PERIOD_BALANCE_CREATE",
          entityType: "bank_account_period_balance",
          entityId: created.id,
          newData: created,
        });
      }

      return saved;
    },
  );

  app.get(
    "/banking/periods",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_IMPORT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = z
        .object({
          siteId: z.coerce.number().int().positive(),
          bankAccountId: z.coerce.number().int().positive(),
        })
        .parse(request.query);

      const [account] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, query.bankAccountId),
            eq(bankAccounts.tenantId, tenantId),
            eq(bankAccounts.siteId, query.siteId),
          ),
        )
        .limit(1);
      if (!account) throw new AppError("NOT_FOUND", "Banka hesabı bulunamadı.", 404);

      const result = await pool.query<{
        period: string;
        balance_amount: string | null;
        balance_note: string | null;
        tx_count: string;
        unmatched_count: string;
        import_count: string;
        used_count: string;
      }>(
        `
        WITH periods AS (
          SELECT period FROM bank_account_period_balance
          WHERE tenant_id = $1 AND site_id = $2 AND bank_account_id = $3 AND period IS NOT NULL
          UNION
          SELECT period FROM bank_transaction
          WHERE tenant_id = $1 AND site_id = $2 AND bank_account_id = $3 AND period IS NOT NULL
          UNION
          SELECT period FROM bank_import_batch
          WHERE tenant_id = $1 AND site_id = $2 AND bank_account_id = $3 AND period IS NOT NULL
        )
        SELECT
          p.period,
          b.balance_amount::text AS balance_amount,
          b.note AS balance_note,
          COALESCE((
            SELECT COUNT(*)::text FROM bank_transaction t
            WHERE t.tenant_id = $1 AND t.site_id = $2 AND t.bank_account_id = $3 AND t.period = p.period
          ), '0') AS tx_count,
          COALESCE((
            SELECT COUNT(*)::text FROM bank_transaction t
            WHERE t.tenant_id = $1 AND t.site_id = $2 AND t.bank_account_id = $3 AND t.period = p.period
              AND t.match_status IN ('UNMATCHED', 'SUGGESTED', 'REVIEW_REQUIRED')
              AND t.direction = 'IN'
          ), '0') AS unmatched_count,
          COALESCE((
            SELECT COUNT(*)::text FROM bank_import_batch i
            WHERE i.tenant_id = $1 AND i.site_id = $2 AND i.bank_account_id = $3 AND i.period = p.period
          ), '0') AS import_count,
          COALESCE((
            SELECT COUNT(*)::text FROM bank_transaction t
            WHERE t.tenant_id = $1 AND t.site_id = $2 AND t.bank_account_id = $3 AND t.period = p.period
              AND (
                t.matched_payment_id IS NOT NULL
                OR t.matched_expense_id IS NOT NULL
                OR t.match_status IN ('MATCHED', 'EXPENSE')
              )
          ), '0') AS used_count
        FROM periods p
        LEFT JOIN bank_account_period_balance b
          ON b.bank_account_id = $3 AND b.period = p.period AND b.tenant_id = $1 AND b.site_id = $2
        ORDER BY p.period DESC
        `,
        [tenantId, query.siteId, query.bankAccountId],
      );

      return {
        items: result.rows.map((row) => ({
          period: row.period,
          balanceAmount: row.balance_amount,
          balanceNote: row.balance_note,
          txCount: Number(row.tx_count),
          unmatchedCount: Number(row.unmatched_count),
          importCount: Number(row.import_count),
          usedCount: Number(row.used_count),
          canDelete: Number(row.used_count) === 0,
        })),
      };
    },
  );

  app.delete(
    "/banking/periods/:period",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_IMPORT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { period } = z
        .object({ period: z.string().regex(/^\d{4}-\d{2}$/) })
        .parse(request.params);
      const query = z
        .object({
          siteId: z.coerce.number().int().positive(),
          bankAccountId: z.coerce.number().int().positive(),
        })
        .parse(request.query);

      const [account] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, query.bankAccountId),
            eq(bankAccounts.tenantId, tenantId),
            eq(bankAccounts.siteId, query.siteId),
          ),
        )
        .limit(1);
      if (!account) throw new AppError("NOT_FOUND", "Banka hesabı bulunamadı.", 404);

      const used = await pool.query<{ value: string }>(
        `
        SELECT COUNT(*)::text AS value
        FROM bank_transaction
        WHERE tenant_id = $1
          AND site_id = $2
          AND bank_account_id = $3
          AND period = $4
          AND (
            matched_payment_id IS NOT NULL
            OR matched_expense_id IS NOT NULL
            OR match_status IN ('MATCHED', 'EXPENSE')
          )
        `,
        [tenantId, query.siteId, query.bankAccountId, period],
      );
      if (Number(used.rows[0]?.value ?? 0) > 0) {
        throw new AppError(
          "PERIOD_IN_USE",
          "Bu dönemde tahsilat veya gider kaydı var. Dönem silinemez.",
          409,
        );
      }

      const result = await db.transaction(async (tx) => {
        const txs = await tx
          .select({ id: bankTransactions.id })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.tenantId, tenantId),
              eq(bankTransactions.siteId, query.siteId),
              eq(bankTransactions.bankAccountId, query.bankAccountId),
              eq(bankTransactions.period, period),
            ),
          );

        if (txs.length > 0) {
          await tx
            .delete(bankTransactions)
            .where(inArray(bankTransactions.id, txs.map((t) => t.id)));
        }

        const batches = await tx
          .select({ id: bankImportBatches.id })
          .from(bankImportBatches)
          .where(
            and(
              eq(bankImportBatches.tenantId, tenantId),
              eq(bankImportBatches.siteId, query.siteId),
              eq(bankImportBatches.bankAccountId, query.bankAccountId),
              eq(bankImportBatches.period, period),
            ),
          );
        if (batches.length > 0) {
          await tx
            .delete(bankImportBatches)
            .where(inArray(bankImportBatches.id, batches.map((b) => b.id)));
        }

        const balances = await tx
          .select({ id: bankAccountPeriodBalances.id })
          .from(bankAccountPeriodBalances)
          .where(
            and(
              eq(bankAccountPeriodBalances.tenantId, tenantId),
              eq(bankAccountPeriodBalances.siteId, query.siteId),
              eq(bankAccountPeriodBalances.bankAccountId, query.bankAccountId),
              eq(bankAccountPeriodBalances.period, period),
            ),
          );
        if (balances.length > 0) {
          await tx
            .delete(bankAccountPeriodBalances)
            .where(inArray(bankAccountPeriodBalances.id, balances.map((b) => b.id)));
        }

        await writeAudit(tx, {
          tenantId,
          siteId: query.siteId,
          userId: request.authUser.id,
          action: "BANK_PERIOD_DELETE",
          entityType: "bank_period",
          entityId: period,
          oldData: {
            period,
            deletedTxCount: txs.length,
            deletedBatchCount: batches.length,
            deletedBalanceCount: balances.length,
          },
        });

        return {
          deletedTxCount: txs.length,
          deletedBatchCount: batches.length,
          deletedBalanceCount: balances.length,
        };
      });

      return { ok: true, period, ...result };
    },
  );

  app.post(
    "/banking/import/preview",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_IMPORT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const file = await request.file();
      if (!file) throw new AppError("FILE_REQUIRED", "Dosya gerekli.", 400);

      const fields = file.fields as Record<
        string,
        { value?: unknown } | { value?: unknown }[] | undefined
      >;
      const bankAccountId = Number(fieldValue(fields, "bankAccountId"));
      const siteId = Number(fieldValue(fields, "siteId"));
      const periodRaw = String(fieldValue(fields, "period") ?? "");
      const period = PeriodParamSchema.parse(periodRaw);
      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) {
        throw new AppError("VALIDATION_ERROR", "bankAccountId gerekli.", 400);
      }
      if (!Number.isInteger(siteId) || siteId <= 0) {
        throw new AppError("VALIDATION_ERROR", "siteId gerekli.", 400);
      }

      const [account] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, bankAccountId),
            eq(bankAccounts.tenantId, tenantId),
            eq(bankAccounts.siteId, siteId),
          ),
        )
        .limit(1);
      if (!account) throw new AppError("NOT_FOUND", "Banka hesabı bulunamadı.", 404);

      const buffer = await file.toBuffer();
      const { rows, suggestedClosingBalance } = parseBankFileWithMeta(buffer, file.filename);
      const fingerprints = rows.map((r) => fingerprintForRow(bankAccountId, r));

      let duplicateCount = 0;
      const existingSet = new Set<string>();
      if (fingerprints.length > 0) {
        const existing = await db
          .select({ fingerprint: bankTransactions.fingerprint })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.bankAccountId, bankAccountId),
              inArray(bankTransactions.fingerprint, fingerprints),
            ),
          );
        for (const e of existing) existingSet.add(e.fingerprint);
        duplicateCount = fingerprints.filter((f) => existingSet.has(f)).length;
      }

      const preview = rows.slice(0, 100).map((r, i) => ({
        ...r,
        fingerprint: fingerprints[i],
        isDuplicate: existingSet.has(fingerprints[i]),
      }));

      return {
        fileName: file.filename,
        bankAccountId,
        siteId,
        period,
        totalRows: rows.length,
        duplicateCount,
        newCount: rows.length - duplicateCount,
        incomeCount: rows.filter((r) => r.direction === "IN").length,
        expenseCount: rows.filter((r) => r.direction === "OUT").length,
        suggestedClosingBalance,
        preview,
      };
    },
  );

  app.post(
    "/banking/import",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_IMPORT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const file = await request.file();
      if (!file) throw new AppError("FILE_REQUIRED", "Dosya gerekli.", 400);

      const fields = file.fields as Record<
        string,
        { value?: unknown } | { value?: unknown }[] | undefined
      >;
      const bankAccountId = Number(fieldValue(fields, "bankAccountId"));
      const siteId = Number(fieldValue(fields, "siteId"));
      const periodRaw = String(fieldValue(fields, "period") ?? "");
      const period = PeriodParamSchema.parse(periodRaw);
      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) {
        throw new AppError("VALIDATION_ERROR", "bankAccountId gerekli.", 400);
      }
      if (!Number.isInteger(siteId) || siteId <= 0) {
        throw new AppError("VALIDATION_ERROR", "siteId gerekli.", 400);
      }

      const [account] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, bankAccountId),
            eq(bankAccounts.tenantId, tenantId),
            eq(bankAccounts.siteId, siteId),
          ),
        )
        .limit(1);
      if (!account) throw new AppError("NOT_FOUND", "Banka hesabı bulunamadı.", 404);

      const buffer = await file.toBuffer();
      const fileHash = createHash("sha256").update(buffer).digest("hex");
      const { rows, suggestedClosingBalance } = parseBankFileWithMeta(buffer, file.filename);

      const [dupFile] = await db
        .select()
        .from(bankImportBatches)
        .where(
          and(
            eq(bankImportBatches.tenantId, tenantId),
            eq(bankImportBatches.bankAccountId, bankAccountId),
            eq(bankImportBatches.fileHash, fileHash),
          ),
        )
        .limit(1);

      if (dupFile) {
        throw new AppError("DUPLICATE_FILE", "Bu dosya daha önce içe aktarılmış.", 409, {
          batchId: dupFile.id,
        });
      }

      const result = await db.transaction(async (tx) => {
        const [batch] = await tx
          .insert(bankImportBatches)
          .values({
            tenantId,
            siteId,
            bankAccountId,
            period,
            fileName: file.filename,
            fileHash,
            rowCount: rows.length,
            status: "COMPLETED",
            createdBy: request.authUser.id,
          })
          .returning();

        const fingerprints = rows.map((r) => fingerprintForRow(bankAccountId, r));
        const existing =
          fingerprints.length === 0
            ? []
            : await tx
                .select({ fingerprint: bankTransactions.fingerprint })
                .from(bankTransactions)
                .where(
                  and(
                    eq(bankTransactions.bankAccountId, bankAccountId),
                    inArray(bankTransactions.fingerprint, fingerprints),
                  ),
                );
        const existingSet = new Set(existing.map((e) => e.fingerprint));

        let inserted = 0;
        let skipped = 0;
        const insertedIds: number[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const fp = fingerprints[i];
          if (existingSet.has(fp)) {
            skipped += 1;
            continue;
          }
          existingSet.add(fp);

          const [created] = await tx
            .insert(bankTransactions)
            .values({
              tenantId,
              siteId,
              bankAccountId,
              importBatchId: batch.id,
              period,
              transactionDate: parseDateAtUtc(row.transactionDate),
              valueDate: row.valueDate ? parseDateAtUtc(row.valueDate) : null,
              amount: row.amount,
              direction: row.direction,
              senderName: row.senderName,
              senderIban: row.senderIban,
              description: row.description,
              bankReference: row.bankReference,
              operationType: row.operationType,
              channel: row.channel,
              runningBalance: row.runningBalance,
              rawJson: row,
              fingerprint: fp,
              matchStatus: "UNMATCHED",
            })
            .returning({ id: bankTransactions.id });

          insertedIds.push(created.id);
          inserted += 1;
        }

        await writeAudit(tx, {
          tenantId,
          siteId,
          userId: request.authUser.id,
          action: "BANK_IMPORT",
          entityType: "bank_import_batch",
          entityId: batch.id,
          newData: { inserted, skipped, rowCount: rows.length, fileHash, period },
        });

        return { batch, inserted, skipped, insertedIds };
      });

      if (result.insertedIds.length > 0) {
        const ctx = await loadScoringContext(tenantId, siteId);
        const newTxs = await db
          .select()
          .from(bankTransactions)
          .where(inArray(bankTransactions.id, result.insertedIds));

        for (const txRow of newTxs) {
          await scoreAndUpdateTransaction(tenantId, txRow, ctx);
        }
      }

      return {
        batchId: result.batch.id,
        fileHash,
        period,
        rowCount: rows.length,
        inserted: result.inserted,
        skippedDuplicates: result.skipped,
        incomeCount: rows.filter((r) => r.direction === "IN").length,
        expenseCount: rows.filter((r) => r.direction === "OUT").length,
        suggestedClosingBalance,
      };
    },
  );

  app.get(
    "/banking/transactions",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_RECONCILE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const query = PaginationQuerySchema.extend({
        siteId: z.coerce.number().int().positive(),
        matchStatus: z.string().optional(),
        bankAccountId: z.coerce.number().int().positive().optional(),
        period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      }).parse(request.query);

      const { limit, offset } = paginationOffset(query);
      const conditions = [
        eq(bankTransactions.tenantId, tenantId),
        eq(bankTransactions.siteId, query.siteId),
      ];
      if (query.matchStatus) conditions.push(eq(bankTransactions.matchStatus, query.matchStatus));
      if (query.bankAccountId) {
        conditions.push(eq(bankTransactions.bankAccountId, query.bankAccountId));
      }
      if (query.period) {
        conditions.push(eq(bankTransactions.period, query.period));
      }

      const where = and(...conditions);
      const [totalRow] = await db.select({ value: count() }).from(bankTransactions).where(where);
      const items = await db
        .select()
        .from(bankTransactions)
        .where(where)
        .orderBy(desc(bankTransactions.transactionDate), desc(bankTransactions.id))
        .limit(limit)
        .offset(offset);

      return paginatedResult(
        items.map((row) => ({
          ...row,
          suggestedCategoryCode:
            row.direction === "OUT" ? suggestExpenseCategoryCode(row.description) : null,
        })),
        Number(totalRow?.value ?? 0),
        query,
      );
    },
  );

  app.get(
    "/banking/transactions/:id",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_RECONCILE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const [row] = await db
        .select()
        .from(bankTransactions)
        .where(and(eq(bankTransactions.id, id), eq(bankTransactions.tenantId, tenantId)))
        .limit(1);
      if (!row) throw new AppError("NOT_FOUND", "Banka hareketi bulunamadı.", 404);
      return row;
    },
  );

  app.post(
    "/banking/reconcile",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_RECONCILE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = ReconcileSchema.parse(request.body);

      const conditions = [
        eq(bankTransactions.tenantId, tenantId),
        eq(bankTransactions.siteId, body.siteId),
        eq(bankTransactions.direction, "IN"),
        inArray(bankTransactions.matchStatus, ["UNMATCHED", "SUGGESTED", "REVIEW_REQUIRED"]),
      ];
      if (body.bankAccountId) {
        conditions.push(eq(bankTransactions.bankAccountId, body.bankAccountId));
      }
      if (body.period) {
        conditions.push(eq(bankTransactions.period, body.period));
      }

      const txs = await db.select().from(bankTransactions).where(and(...conditions));
      const ctx = await loadScoringContext(tenantId, body.siteId);
      let updated = 0;
      for (const txRow of txs) {
        await scoreAndUpdateTransaction(tenantId, txRow, ctx);
        updated += 1;
      }

      return { updated };
    },
  );

  app.post(
    "/banking/expenses/from-transactions",
    { preHandler: [authenticate, requirePermission(Permission.EXPENSE_WRITE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = z
        .object({
          siteId: z.number().int().positive(),
          bankAccountId: z.number().int().positive(),
          period: z.string().regex(/^\d{4}-\d{2}$/),
          categoryId: z.number().int().positive().optional(),
          items: z
            .array(
              z.object({
                transactionId: z.number().int().positive(),
                categoryId: z.number().int().positive().optional(),
              }),
            )
            .min(1)
            .max(200),
        })
        .parse(request.body);

      const [account] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, body.bankAccountId),
            eq(bankAccounts.tenantId, tenantId),
            eq(bankAccounts.siteId, body.siteId),
          ),
        )
        .limit(1);
      if (!account) throw new AppError("NOT_FOUND", "Banka hesabı bulunamadı.", 404);

      const categories = await db
        .select()
        .from(expenseCategories)
        .where(eq(expenseCategories.tenantId, tenantId));
      const categoryById = new Map(categories.map((c) => [c.id, c]));
      const categoryByCode = new Map(categories.map((c) => [c.code, c]));

      const defaultCategory =
        (body.categoryId != null ? categoryById.get(body.categoryId) : undefined) ??
        categoryByCode.get("GENEL") ??
        categories[0];
      if (!defaultCategory) {
        throw new AppError("NO_CATEGORY", "Gider kategorisi tanımlı değil.", 400);
      }

      const txIds = body.items.map((i) => i.transactionId);
      const itemCategoryMap = new Map(
        body.items.map((i) => [i.transactionId, i.categoryId ?? null] as const),
      );

      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.tenantId, tenantId),
              eq(bankTransactions.siteId, body.siteId),
              eq(bankTransactions.bankAccountId, body.bankAccountId),
              eq(bankTransactions.period, body.period),
              inArray(bankTransactions.id, txIds),
            ),
          );

        const byId = new Map(rows.map((r) => [r.id, r]));
        const created: Array<{ expenseId: number; transactionId: number }> = [];
        const skipped: Array<{ transactionId: number; reason: string }> = [];

        for (const id of txIds) {
          const row = byId.get(id);
          if (!row) {
            skipped.push({ transactionId: id, reason: "NOT_FOUND" });
            continue;
          }
          if (row.direction !== "OUT") {
            skipped.push({ transactionId: id, reason: "NOT_EXPENSE" });
            continue;
          }
          if (row.matchedExpenseId != null || row.matchStatus === "EXPENSE") {
            skipped.push({ transactionId: id, reason: "ALREADY_EXPENSE" });
            continue;
          }

          const overrideId = itemCategoryMap.get(id);
          let category =
            overrideId != null ? categoryById.get(overrideId) : undefined;
          if (!category) {
            const code = suggestExpenseCategoryCode(row.description);
            category = categoryByCode.get(code) ?? defaultCategory;
          }

          const [expense] = await tx
            .insert(expenses)
            .values({
              tenantId,
              siteId: body.siteId,
              expenseDate: row.transactionDate,
              categoryId: category.id,
              amount: row.amount,
              taxAmount: "0.00",
              paymentStatus: "PAID",
              bankAccountId: body.bankAccountId,
              bankTransactionId: row.id,
              period: body.period,
              invoiceNumber: row.bankReference,
              description: row.description ?? `${body.period} banka gideri`,
              status: "POSTED",
              createdBy: request.authUser.id,
            })
            .returning();

          await tx
            .update(bankTransactions)
            .set({
              matchedExpenseId: expense.id,
              matchStatus: "EXPENSE",
              matchClassification: "EXPENSE",
            })
            .where(eq(bankTransactions.id, row.id));

          created.push({ expenseId: expense.id, transactionId: row.id });
        }

        await writeAudit(tx, {
          tenantId,
          siteId: body.siteId,
          userId: request.authUser.id,
          action: "BANK_EXPENSE_BULK_CREATE",
          entityType: "expense",
          entityId: body.period,
          newData: { created, skipped, period: body.period },
        });

        return { created, skipped };
      });

      return {
        ok: true,
        period: body.period,
        createdCount: result.created.length,
        skippedCount: result.skipped.length,
        ...result,
      };
    },
  );

  app.post(
    "/banking/transactions/:id/ignore",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_RECONCILE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);

      const [row] = await db
        .select()
        .from(bankTransactions)
        .where(and(eq(bankTransactions.id, id), eq(bankTransactions.tenantId, tenantId)))
        .limit(1);
      if (!row) throw new AppError("NOT_FOUND", "Banka hareketi bulunamadı.", 404);
      if (row.matchStatus === "MATCHED") {
        throw new AppError("ALREADY_MATCHED", "Eşleşmiş hareket yoksayılamaz.", 400);
      }

      const [updated] = await db
        .update(bankTransactions)
        .set({ matchStatus: "IGNORED" })
        .where(eq(bankTransactions.id, id))
        .returning();

      await writeAudit(db, {
        tenantId,
        siteId: row.siteId,
        userId: request.authUser.id,
        action: "BANK_TX_IGNORE",
        entityType: "bank_transaction",
        entityId: id,
      });

      return updated;
    },
  );

  app.post(
    "/banking/sender-mappings",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_RECONCILE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = SenderMappingSchema.parse(request.body);
      const iban = body.senderIban.replace(/\s+/g, "").toUpperCase();

      const [unit] = await db
        .select()
        .from(units)
        .where(
          and(eq(units.id, body.unitId), eq(units.tenantId, tenantId), eq(units.siteId, body.siteId)),
        )
        .limit(1);
      if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

      const [existing] = await db
        .select()
        .from(bankSenderMappings)
        .where(and(eq(bankSenderMappings.siteId, body.siteId), eq(bankSenderMappings.senderIban, iban)))
        .limit(1);

      if (existing) {
        const [mapping] = await db
          .update(bankSenderMappings)
          .set({ unitId: body.unitId, confidence: 100, lastUsedAt: new Date() })
          .where(eq(bankSenderMappings.id, existing.id))
          .returning();
        return mapping;
      }

      const [mapping] = await db
        .insert(bankSenderMappings)
        .values({
          tenantId,
          siteId: body.siteId,
          senderIban: iban,
          unitId: body.unitId,
          confidence: 100,
        })
        .returning();
      return mapping;
    },
  );

  app.post(
    "/banking/transactions/:id/collect",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_COLLECT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
      const body = CollectSchema.parse(request.body ?? {});

      const idempotencyKeyHeader = request.headers["idempotency-key"];
      const idempotencyKey =
        typeof idempotencyKeyHeader === "string" && idempotencyKeyHeader.trim()
          ? idempotencyKeyHeader.trim()
          : null;

      if (idempotencyKey) {
        const existing = await findIdempotency(db, tenantId, idempotencyKey);
        if (existing) {
          const reqHash = hashRequestBody({ id, ...body });
          if (existing.requestHash !== reqHash) {
            throw new AppError(
              "IDEMPOTENCY_KEY_REUSE",
              "Idempotency-Key farklı gövde ile kullanıldı.",
              409,
            );
          }
          return existing.responseBody;
        }
      }

      const collected = await db.transaction(async (tx) =>
        collectBankTransactionInTx(tx, {
          tenantId,
          userId: request.authUser.id,
          bankTxId: id,
          unitId: body.unitId,
          strategy: body.strategy,
          selections: body.selections,
          paymentDate: body.paymentDate,
        }),
      );

      const responseBody = { status: "SUCCESS" as const, ...collected };

      if (idempotencyKey) {
        await storeIdempotency(db, {
          tenantId,
          userId: request.authUser.id,
          key: idempotencyKey,
          method: "POST",
          path: `/banking/transactions/${id}/collect`,
          requestHash: hashRequestBody({ id, ...body }),
          responseStatus: 200,
          responseBody,
        });
      }

      return responseBody;
    },
  );

  app.post(
    "/banking/bulk-collect/preview",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_COLLECT)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = z
        .object({ transactionIds: z.array(z.number().int().positive()).min(1).max(500) })
        .parse(request.body);

      const txs = await db
        .select()
        .from(bankTransactions)
        .where(
          and(eq(bankTransactions.tenantId, tenantId), inArray(bankTransactions.id, body.transactionIds)),
        );

      const byId = new Map(txs.map((t) => [t.id, t]));
      let totalAmount = money("0");
      const rows: Array<{
        transactionId: number;
        status: "OK" | "PROBLEM";
        unitId: number | null;
        amount: string | null;
        reason?: string;
      }> = [];

      for (const id of body.transactionIds) {
        const txRow = byId.get(id);
        if (!txRow) {
          rows.push({
            transactionId: id,
            status: "PROBLEM",
            unitId: null,
            amount: null,
            reason: "NOT_FOUND",
          });
          continue;
        }
        if (txRow.direction !== "IN") {
          rows.push({
            transactionId: id,
            status: "PROBLEM",
            unitId: txRow.matchedUnitId,
            amount: txRow.amount,
            reason: "INVALID_DIRECTION",
          });
          continue;
        }
        if (txRow.matchStatus === "MATCHED") {
          rows.push({
            transactionId: id,
            status: "PROBLEM",
            unitId: txRow.matchedUnitId,
            amount: txRow.amount,
            reason: "ALREADY_MATCHED",
          });
          continue;
        }
        if (!txRow.matchedUnitId) {
          rows.push({
            transactionId: id,
            status: "PROBLEM",
            unitId: null,
            amount: txRow.amount,
            reason: "UNIT_REQUIRED",
          });
          continue;
        }

        try {
          const open = await db
            .select()
            .from(charges)
            .where(
              and(
                eq(charges.tenantId, tenantId),
                eq(charges.unitId, txRow.matchedUnitId),
                inArray(charges.status, ["OPEN", "PARTIAL"]),
              ),
            )
            .orderBy(asc(charges.dueDate), asc(charges.id));

          planOldestFirst(
            open.map((c) => ({ id: c.id, dueDate: c.dueDate, openAmount: c.openAmount })),
            txRow.amount,
          );

          totalAmount = totalAmount.plus(money(txRow.amount));
          rows.push({
            transactionId: id,
            status: "OK",
            unitId: txRow.matchedUnitId,
            amount: txRow.amount,
          });
        } catch (err) {
          const reason = err instanceof AppError ? err.code : "PLAN_FAILED";
          rows.push({
            transactionId: id,
            status: "PROBLEM",
            unitId: txRow.matchedUnitId,
            amount: txRow.amount,
            reason,
          });
        }
      }

      return {
        totalSelected: body.transactionIds.length,
        okCount: rows.filter((r) => r.status === "OK").length,
        problemCount: rows.filter((r) => r.status === "PROBLEM").length,
        totalAmount: moneyToString(totalAmount),
        rows,
      };
    },
  );

  app.post(
    "/banking/bulk-collect",
    { preHandler: [authenticate, requirePermission(Permission.BANKING_COLLECT)] },
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = BulkCollectSchema.parse(request.body);

      const idempotencyKeyHeader = request.headers["idempotency-key"];
      const idempotencyKey =
        typeof idempotencyKeyHeader === "string" && idempotencyKeyHeader.trim()
          ? idempotencyKeyHeader.trim()
          : null;

      if (idempotencyKey) {
        const existing = await findIdempotency(db, tenantId, idempotencyKey);
        if (existing) {
          const reqHash = hashRequestBody(body);
          if (existing.requestHash !== reqHash) {
            throw new AppError(
              "IDEMPOTENCY_KEY_REUSE",
              "Idempotency-Key farklı gövde ile kullanıldı.",
              409,
            );
          }
          return reply.status(existing.responseStatus).send(existing.responseBody);
        }
      }

      const results: Array<{
        transactionId: number;
        status: "SUCCESS" | "FAILED" | "SKIPPED";
        reason?: string;
        paymentId?: number;
      }> = [];

      for (const transactionId of body.transactionIds) {
        try {
          const collected = await db.transaction(async (tx) =>
            collectBankTransactionInTx(tx, {
              tenantId,
              userId: request.authUser.id,
              bankTxId: transactionId,
              strategy: body.strategy,
            }),
          );
          results.push({
            transactionId,
            status: "SUCCESS",
            paymentId: collected.paymentId,
          });
        } catch (err) {
          if (err instanceof AppError) {
            const skipped =
              err.code === "ALREADY_MATCHED" ||
              err.code === "INVALID_DIRECTION" ||
              err.code === "TX_IGNORED";
            results.push({
              transactionId,
              status: skipped ? "SKIPPED" : "FAILED",
              reason: err.code,
            });
          } else {
            results.push({
              transactionId,
              status: "FAILED",
              reason: "INTERNAL_ERROR",
            });
          }
        }
      }

      const responseBody = {
        results,
        successCount: results.filter((r) => r.status === "SUCCESS").length,
        failedCount: results.filter((r) => r.status === "FAILED").length,
        skippedCount: results.filter((r) => r.status === "SKIPPED").length,
      };

      if (idempotencyKey) {
        await storeIdempotency(db, {
          tenantId,
          userId: request.authUser.id,
          key: idempotencyKey,
          method: "POST",
          path: "/banking/bulk-collect",
          requestHash: hashRequestBody(body),
          responseStatus: 200,
          responseBody,
        });
      }

      return responseBody;
    },
  );
}
