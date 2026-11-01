import { AppError } from "../../shared/errors/app-error.js";
import { Money, money, moneyToString } from "../../shared/utils/money.js";

export type OpenCharge = {
  id: number;
  dueDate: Date;
  openAmount: string;
};

export type AllocationPlanLine = {
  chargeId: number;
  amount: string;
};

export function planOldestFirst(openCharges: OpenCharge[], paymentAmount: string): AllocationPlanLine[] {
  const amount = money(paymentAmount);
  const sorted = [...openCharges].sort((a, b) => {
    const da = a.dueDate.getTime() - b.dueDate.getTime();
    if (da !== 0) return da;
    return a.id - b.id;
  });

  const openTotal = sorted.reduce((acc, c) => acc.plus(money(c.openAmount)), Money.zero());
  if (amount.gt(openTotal)) {
    throw new AppError(
      "OVERPAYMENT_NOT_ALLOWED",
      "Ödeme tutarı açık borç toplamını aşıyor. Tutarı düşürün veya borç seçimini güncelleyin.",
      400,
      {
        paymentAmount: moneyToString(amount),
        openTotal: moneyToString(openTotal),
      },
    );
  }

  let remaining = amount;
  const lines: AllocationPlanLine[] = [];

  for (const charge of sorted) {
    if (remaining.lte(Money.zero())) break;
    const open = money(charge.openAmount);
    if (open.lte(Money.zero())) continue;
    const apply = Money.min(remaining, open);
    lines.push({ chargeId: charge.id, amount: moneyToString(apply) });
    remaining = remaining.minus(apply);
  }

  if (lines.length === 0) {
    throw new AppError("NO_OPEN_CHARGES", "Dağıtılacak açık borç yok.", 400);
  }

  return lines;
}

export function planUserSelected(
  selections: Array<{ chargeId: number; amount: string }>,
  openCharges: OpenCharge[],
  paymentAmount: string,
): AllocationPlanLine[] {
  const amount = money(paymentAmount);
  const openMap = new Map(openCharges.map((c) => [c.id, money(c.openAmount)]));
  const lines: AllocationPlanLine[] = [];
  let sum = Money.zero();

  for (const sel of selections) {
    const apply = money(sel.amount);
    const open = openMap.get(sel.chargeId);
    if (!open) {
      throw new AppError("CHARGE_NOT_OPEN", `Borç ${sel.chargeId} açık değil.`, 400);
    }
    if (apply.gt(open)) {
      throw new AppError("ALLOCATION_EXCEEDS_OPEN", `Borç ${sel.chargeId} için fazla dağıtım.`, 400);
    }
    lines.push({ chargeId: sel.chargeId, amount: moneyToString(apply) });
    sum = sum.plus(apply);
  }

  if (!sum.eq(amount)) {
    throw new AppError("ALLOCATION_SUM_MISMATCH", "Dağıtım toplamı ödeme tutarına eşit olmalı.", 400, {
      allocationSum: moneyToString(sum),
      paymentAmount: moneyToString(amount),
    });
  }

  return lines;
}

export function nextChargeStatus(amount: Money, openAmount: Money): "OPEN" | "PARTIAL" | "PAID" {
  if (openAmount.lte(Money.zero())) return "PAID";
  if (openAmount.lt(amount)) return "PARTIAL";
  return "OPEN";
}
