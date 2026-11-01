import { describe, expect, it } from "vitest";
import { Money, money, moneyToString } from "./money.js";

describe("money utils", () => {
  it("formats to 2 decimals", () => {
    expect(moneyToString(money("4000"))).toBe("4000.00");
  });

  it("rejects negative", () => {
    expect(() => money("-1")).toThrow();
  });

  it("adds and subtracts exactly", () => {
    expect(Money.from("10.10").plus(Money.from("0.05")).toFixed()).toBe("10.15");
    expect(Money.from("10.10").minus(Money.from("0.10")).toFixed()).toBe("10.00");
  });
});
