import { describe, expect, it } from "vitest";
import { buildBankFingerprint, normalizeDescription } from "./fingerprint.js";

describe("bank fingerprint", () => {
  it("is stable for same payload", () => {
    const a = buildBankFingerprint({
      bankAccountId: 1,
      transactionDate: "2026-09-01",
      valueDate: "2026-09-01",
      amount: "2500.00",
      direction: "IN",
      senderIban: "TR00",
      bankReference: null,
      normalizedDescription: normalizeDescription("A BLOK 12 aidat"),
    });
    const b = buildBankFingerprint({
      bankAccountId: 1,
      transactionDate: "2026-09-01",
      valueDate: "2026-09-01",
      amount: "2500.00",
      direction: "IN",
      senderIban: "TR00",
      bankReference: null,
      normalizedDescription: normalizeDescription("A BLOK 12 aidat"),
    });
    expect(a).toBe(b);
  });

  it("prefers bank reference when present", () => {
    const a = buildBankFingerprint({
      bankAccountId: 1,
      transactionDate: "2026-09-01",
      valueDate: null,
      amount: "1.00",
      direction: "IN",
      senderIban: null,
      bankReference: "ABC123",
      normalizedDescription: "x",
    });
    const b = buildBankFingerprint({
      bankAccountId: 1,
      transactionDate: "2099-01-01",
      valueDate: null,
      amount: "999.00",
      direction: "OUT",
      senderIban: null,
      bankReference: "ABC123",
      normalizedDescription: "y",
    });
    expect(a).toBe(b);
  });
});
