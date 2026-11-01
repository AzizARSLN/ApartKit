import { createHash } from "node:crypto";

export type FingerprintInput = {
  bankAccountId: number;
  transactionDate: string;
  valueDate: string | null;
  amount: string;
  direction: string;
  senderIban: string | null;
  bankReference: string | null;
  normalizedDescription: string | null;
};

export function normalizeDescription(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/Ş/g, "S")
    .replace(/İ/g, "I")
    .replace(/İ/g, "I")
    .replace(/Ç/g, "C")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/\b(A\.?S\.?|LTD\.?\s*STI\.?|HAVALE|FAST|EFT)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildBankFingerprint(input: FingerprintInput): string {
  if (input.bankReference && input.bankReference.trim() !== "") {
    return createHash("sha256")
      .update(`REF|${input.bankAccountId}|${input.bankReference.trim()}`)
      .digest("hex");
  }

  const payload = [
    String(input.bankAccountId),
    input.transactionDate,
    input.valueDate ?? "",
    input.amount,
    input.direction,
    input.senderIban ?? "",
    input.bankReference ?? "",
    input.normalizedDescription ?? "",
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}
