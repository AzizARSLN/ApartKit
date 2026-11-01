import { describe, expect, it } from "vitest";
import { planOldestFirst, planUserSelected } from "./allocation.js";

describe("allocation", () => {
  const charges = [
    { id: 2, dueDate: new Date("2026-08-01"), openAmount: "2500.00" },
    { id: 1, dueDate: new Date("2026-07-01"), openAmount: "2500.00" },
    { id: 3, dueDate: new Date("2026-09-01"), openAmount: "4000.00" },
  ];

  it("partial payment on oldest charge", () => {
    const plan = planOldestFirst(charges, "1500.00");
    expect(plan).toEqual([{ chargeId: 1, amount: "1500.00" }]);
  });

  it("allocates across multiple charges oldest-first", () => {
    const plan = planOldestFirst(charges, "6000.00");
    expect(plan).toEqual([
      { chargeId: 1, amount: "2500.00" },
      { chargeId: 2, amount: "2500.00" },
      { chargeId: 3, amount: "1000.00" },
    ]);
  });

  it("rejects overpayment", () => {
    expect(() => planOldestFirst(charges, "10000.00")).toThrow(/OVERPAYMENT|açık borç/i);
  });

  it("user selected must sum to payment", () => {
    const plan = planUserSelected(
      [
        { chargeId: 1, amount: "2500.00" },
        { chargeId: 2, amount: "1500.00" },
      ],
      charges,
      "4000.00",
    );
    expect(plan).toHaveLength(2);
  });
});
