import { describe, expect, it } from "vitest";
import { Money } from "../../shared/utils/money.js";
import { previewDistribution } from "./distribution.js";

describe("previewDistribution", () => {
  it("33 daireye 4000 TL FIXED = 132000 TL", () => {
    const units = Array.from({ length: 33 }, (_, i) => ({
      id: i + 1,
      grossM2: "100",
      netM2: "90",
      landShare: "1",
    }));

    const lines = previewDistribution({
      method: "FIXED_PER_UNIT",
      units,
      fixedPerUnit: "4000.00",
    });

    expect(lines).toHaveLength(33);
    const total = lines.reduce((acc, l) => acc.plus(Money.from(l.amount)), Money.zero());
    expect(total.toFixed()).toBe("132000.00");
    expect(lines.every((l) => l.amount === "4000.00")).toBe(true);
  });
});
