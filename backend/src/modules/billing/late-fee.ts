import { Money, money, moneyToString } from "../../shared/utils/money.js";

/** Flat percent late fee: amount * ratePercent / 100 (2 decimal). */
export function calculateLateFee(openAmount: string, ratePercent: string): string {
  const open = money(openAmount);
  if (open.isZero()) return moneyToString(Money.zero());
  const rate = money(ratePercent);
  if (rate.isZero()) return moneyToString(Money.zero());
  return moneyToString(open.mulRatio(rate, money("100.00")));
}

export function isPastDue(dueDate: Date, asOf: Date): boolean {
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const ref = new Date(asOf);
  ref.setHours(0, 0, 0, 0);
  return ref.getTime() > due.getTime();
}
