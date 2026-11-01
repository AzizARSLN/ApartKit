import { AppError } from "../../shared/errors/app-error.js";
import { Money, money, moneyToString } from "../../shared/utils/money.js";

export type DistributionMethod =
  | "EQUAL_PER_UNIT"
  | "FIXED_PER_UNIT"
  | "BY_GROSS_M2"
  | "BY_NET_M2"
  | "BY_LAND_SHARE"
  | "CUSTOM";

export type DistUnit = {
  id: number;
  grossM2: string | null;
  netM2: string | null;
  landShare: string | null;
};

export type DistLine = {
  unitId: number;
  amount: string;
};

export function previewDistribution(input: {
  method: DistributionMethod;
  units: DistUnit[];
  amount?: string;
  fixedPerUnit?: string;
  customAmounts?: Record<string, string>;
}): DistLine[] {
  const { method, units } = input;
  if (units.length === 0) {
    throw new AppError("NO_UNITS", "Dağıtılacak daire yok.", 400);
  }

  if (method === "FIXED_PER_UNIT" || method === "EQUAL_PER_UNIT") {
    const per = money(input.fixedPerUnit ?? input.amount ?? "0");
    return units.map((u) => ({ unitId: u.id, amount: moneyToString(per) }));
  }

  if (method === "CUSTOM") {
    return units.map((u) => {
      const raw = input.customAmounts?.[String(u.id)];
      if (!raw) {
        throw new AppError("CUSTOM_AMOUNT_MISSING", `Daire ${u.id} için tutar yok.`, 400);
      }
      return { unitId: u.id, amount: moneyToString(money(raw)) };
    });
  }

  const total = money(input.amount ?? "0");
  const weights = units.map((u) => {
    const raw =
      method === "BY_GROSS_M2" ? u.grossM2 : method === "BY_NET_M2" ? u.netM2 : u.landShare;
    const w = money(raw ?? "0");
    if (w.lte(Money.zero())) {
      throw new AppError("INVALID_WEIGHT", `Daire ${u.id} için dağıtım ağırlığı geçersiz.`, 400);
    }
    return { unitId: u.id, weight: w };
  });

  const weightSum = weights.reduce((acc, w) => acc.plus(w.weight), Money.zero());
  const lines: DistLine[] = [];
  let allocated = Money.zero();

  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i]!;
    if (i === weights.length - 1) {
      const rest = total.minus(allocated);
      lines.push({ unitId: w.unitId, amount: moneyToString(rest) });
    } else {
      const share = total.mulRatio(w.weight, weightSum);
      allocated = allocated.plus(share);
      lines.push({ unitId: w.unitId, amount: moneyToString(share) });
    }
  }

  return lines;
}
