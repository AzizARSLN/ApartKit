import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, type DbTransaction } from "../../db/client.js";
import {
  bankTransactions,
  cashAccounts,
  cashTransactions,
  charges,
  payments,
  paymentAllocations,
  receiptSequences,
  receipts,
  units,
} from "../../db/schema/index.js";
import { writeAudit } from "../../shared/audit/audit.js";
import { authenticate, getTenantId, requirePermission } from "../../shared/auth/auth-guards.js";
import { Permission } from "../../shared/auth/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { Money, MoneyStringSchema, money, moneyToString } from "../../shared/utils/money.js";
import { nextChargeStatus, planOldestFirst, planUserSelected } from "./allocation.js";

const PreviewSchema = z.object({
  siteId: z.number().int().positive(),
  unitId: z.number().int().positive(),
  amount: MoneyStringSchema,
  strategy: z.enum(["OLDEST_FIRST", "USER_SELECTED"]).default("OLDEST_FIRST"),
  selections: z
    .array(
      z.object({
        chargeId: z.number().int().positive(),
        amount: MoneyStringSchema,
      }),
    )
    .optional(),
});

const CollectSchema = PreviewSchema.extend({
  paymentDate: z.coerce.date(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CREDIT_CARD"]),
  description: z.string().max(1000).optional(),
  cashAccountId: z.number().int().positive().optional(),
});

async function loadOpenCharges(tenantId: number, unitId: number) {
  return db
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.tenantId, tenantId),
        eq(charges.unitId, unitId),
        inArray(charges.status, ["OPEN", "PARTIAL"]),
      ),
    )
    .orderBy(asc(charges.dueDate), asc(charges.id));
}

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

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/payments/preview",
    { preHandler: [authenticate, requirePermission(Permission.PAYMENT_PREVIEW)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = PreviewSchema.parse(request.body);
      const open = await loadOpenCharges(tenantId, body.unitId);
      const openModel = open.map((c) => ({
        id: c.id,
        dueDate: c.dueDate,
        openAmount: c.openAmount,
      }));

      const plan =
        body.strategy === "USER_SELECTED"
          ? planUserSelected(body.selections ?? [], openModel, body.amount)
          : planOldestFirst(openModel, body.amount);

      return {
        unitId: body.unitId,
        amount: body.amount,
        strategy: body.strategy,
        allocations: plan,
      };
    },
  );

  app.post(
    "/payments",
    { preHandler: [authenticate, requirePermission(Permission.PAYMENT_CREATE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const body = CollectSchema.parse(request.body);

      const result = await db.transaction(async (tx) => {
        const [unit] = await tx
          .select()
          .from(units)
          .where(
            and(eq(units.id, body.unitId), eq(units.tenantId, tenantId), eq(units.siteId, body.siteId)),
          )
          .limit(1);
        if (!unit) throw new AppError("NOT_FOUND", "Daire bulunamadı.", 404);

        const open = await tx
          .select()
          .from(charges)
          .where(
            and(
              eq(charges.tenantId, tenantId),
              eq(charges.unitId, body.unitId),
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
          body.strategy === "USER_SELECTED"
            ? planUserSelected(body.selections ?? [], openModel, body.amount)
            : planOldestFirst(openModel, body.amount);

        const [payment] = await tx
          .insert(payments)
          .values({
            tenantId,
            siteId: body.siteId,
            unitId: body.unitId,
            paymentDate: body.paymentDate,
            amount: body.amount,
            paymentMethod: body.paymentMethod,
            description: body.description,
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
            .where(and(eq(charges.id, charge.id), eq(charges.tenantId, tenantId)));
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
            amount: body.amount,
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
          action: "PAYMENT_CREATE",
          entityType: "payment",
          entityId: payment.id,
          newData: { payment, plan, receipt },
        });

        return { payment, allocations: plan, receipt };
      });

      return result;
    },
  );

  app.post(
    "/payments/:paymentId/reverse",
    { preHandler: [authenticate, requirePermission(Permission.PAYMENT_REVERSE)] },
    async (request) => {
      const tenantId = getTenantId(request);
      const { paymentId } = z
        .object({ paymentId: z.coerce.number().int().positive() })
        .parse(request.params);

      const result = await db.transaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)))
          .limit(1)
          .for("update");

        if (!payment) throw new AppError("NOT_FOUND", "Tahsilat bulunamadı.", 404);
        if (payment.status !== "POSTED") {
          throw new AppError("PAYMENT_NOT_POSTED", "Yalnızca POSTED tahsilat terslenebilir.", 400);
        }

        const allocs = await tx
          .select()
          .from(paymentAllocations)
          .where(eq(paymentAllocations.paymentId, payment.id));

        for (const alloc of allocs) {
          const [charge] = await tx
            .select()
            .from(charges)
            .where(and(eq(charges.id, alloc.chargeId), eq(charges.tenantId, tenantId)))
            .limit(1)
            .for("update");
          if (!charge) continue;

          const nextOpen = money(charge.openAmount).plus(money(alloc.amount));
          const capped = Money.min(nextOpen, money(charge.amount));
          await tx
            .update(charges)
            .set({
              openAmount: moneyToString(capped),
              status: nextChargeStatus(money(charge.amount), capped),
              updatedAt: new Date(),
              updatedBy: request.authUser.id,
            })
            .where(eq(charges.id, charge.id));
        }

        await tx
          .update(payments)
          .set({ status: "REVERSED", updatedAt: new Date(), updatedBy: request.authUser.id })
          .where(eq(payments.id, payment.id));

        await tx
          .update(receipts)
          .set({ status: "VOID" })
          .where(eq(receipts.paymentId, payment.id));

        await tx
          .update(bankTransactions)
          .set({
            matchedPaymentId: null,
            matchStatus: "UNMATCHED",
            matchScore: null,
            matchedUnitId: null,
            matchClassification: null,
          })
          .where(eq(bankTransactions.matchedPaymentId, payment.id));

        await writeAudit(tx, {
          tenantId,
          siteId: payment.siteId,
          userId: request.authUser.id,
          action: "PAYMENT_REVERSE",
          entityType: "payment",
          entityId: payment.id,
          oldData: payment,
        });

        return { id: payment.id, status: "REVERSED" };
      });

      return result;
    },
  );
}
