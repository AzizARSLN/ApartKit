import { normalizeDescription } from "./fingerprint.js";
import { money } from "../../shared/utils/money.js";

export type MatchClassification = "AUTO_CONFIDENT" | "SUGGESTED" | "REVIEW_REQUIRED";
export type MatchStatusMapped = "SUGGESTED" | "REVIEW_REQUIRED" | "UNMATCHED";

export type UnitRefHint = {
  blockHint: string | null;
  unitNo: string;
};

export type UnitScoreCandidate = {
  unitId: number;
  blockCode: string | null;
  blockName: string | null;
  unitNo: string;
  /** Already normalized person full names */
  personNamesNormalized: string[];
  openChargeTotal: string;
  hasIbanMapping: boolean;
  hasIbanPaymentHistory: boolean;
  hasPaymentHistory: boolean;
};

export type ScoreResult = {
  unitId: number | null;
  score: number;
  classification: MatchClassification | null;
  reasons: string[];
  matchStatus: MatchStatusMapped;
};

export function classificationToMatchStatus(
  classification: MatchClassification | null,
): MatchStatusMapped {
  if (!classification) return "UNMATCHED";
  if (classification === "REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  return "SUGGESTED";
}

export function scoreToClassification(score: number): MatchClassification {
  if (score >= 90) return "AUTO_CONFIDENT";
  if (score >= 70) return "SUGGESTED";
  return "REVIEW_REQUIRED";
}

/** Extract block/unit hints from bank description (TR/EN patterns). */
export function extractUnitRefs(description: string | null | undefined): UnitRefHint[] {
  if (!description) return [];
  const text = description.toUpperCase();
  const found: UnitRefHint[] = [];

  const push = (blockHint: string | null, unitNo: string) => {
    const normalizedUnit = String(Number(unitNo) || unitNo).replace(/^0+/, "") || unitNo;
    const key = `${blockHint ?? ""}|${normalizedUnit}`;
    if (found.some((f) => `${f.blockHint ?? ""}|${f.unitNo}` === key)) return;
    found.push({ blockHint, unitNo: normalizedUnit });
  };

  for (const m of text.matchAll(/([A-Z0-9]+)\s*BLOK\s*(?:DAIRE\s*)?(\d+)/g)) {
    push(m[1], m[2]);
  }
  for (const m of text.matchAll(/\b([A-Z0-9]+)\s*[\/\-]\s*(\d+)\b/g)) {
    push(m[1], m[2]);
  }
  for (const m of text.matchAll(/\bDAIRE\s*(\d+)\b/g)) {
    push(null, m[1]);
  }
  for (const m of text.matchAll(/\bD[:\s](\d+)\b/g)) {
    push(null, m[1]);
  }
  for (const m of text.matchAll(/\bD(\d+)\b/g)) {
    push(null, m[1]);
  }

  // Also scan normalized form (punctuation collapsed)
  const normalized = normalizeDescription(description);
  for (const m of normalized.matchAll(/([A-Z0-9]+)\s+BLOK\s+(\d+)/g)) {
    push(m[1], m[2]);
  }
  for (const m of normalized.matchAll(/\bDAIRE\s+(\d+)\b/g)) {
    push(null, m[1]);
  }
  for (const m of normalized.matchAll(/\bD\s+(\d+)\b/g)) {
    push(null, m[1]);
  }

  return found;
}

function normalizeUnitNo(unitNo: string): string {
  return String(Number(unitNo) || unitNo).replace(/^0+/, "") || unitNo;
}

function normalizeBlockToken(value: string | null | undefined): string {
  if (!value) return "";
  return normalizeDescription(value).replace(/\s+/g, "");
}

function descriptionMatchesUnit(hints: UnitRefHint[], candidate: UnitScoreCandidate): boolean {
  const unitNo = normalizeUnitNo(candidate.unitNo);
  const blockCode = normalizeBlockToken(candidate.blockCode);
  const blockName = normalizeBlockToken(candidate.blockName);

  for (const hint of hints) {
    const hintUnit = normalizeUnitNo(hint.unitNo);
    if (hintUnit !== unitNo) continue;
    if (!hint.blockHint) return true;
    const hb = normalizeBlockToken(hint.blockHint);
    if (!hb) return true;
    if (hb === blockCode || hb === blockName) return true;
    if (blockCode.startsWith(hb) || hb.startsWith(blockCode)) return true;
  }
  return false;
}

function nameMatches(senderName: string | null | undefined, personNamesNormalized: string[]): boolean {
  if (!senderName || personNamesNormalized.length === 0) return false;
  const sender = normalizeDescription(senderName);
  if (!sender) return false;
  return personNamesNormalized.some((p) => {
    if (!p) return false;
    return sender.includes(p) || p.includes(sender);
  });
}

export function scoreUnitCandidate(
  tx: {
    amount: string;
    senderName?: string | null;
    description?: string | null;
  },
  candidate: UnitScoreCandidate,
  hints: UnitRefHint[],
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (candidate.hasIbanMapping || candidate.hasIbanPaymentHistory) {
    score += 50;
    reasons.push(candidate.hasIbanMapping ? "IBAN_MAPPING" : "IBAN_PAYMENT_HISTORY");
  }

  if (descriptionMatchesUnit(hints, candidate)) {
    score += 40;
    reasons.push("DESCRIPTION_UNIT");
  }

  try {
    if (money(tx.amount).eq(money(candidate.openChargeTotal)) && !money(tx.amount).isZero()) {
      score += 30;
      reasons.push("AMOUNT_EQUALS_OPEN_TOTAL");
    }
  } catch {
    // ignore invalid amounts in scoring
  }

  if (nameMatches(tx.senderName, candidate.personNamesNormalized)) {
    score += 20;
    reasons.push("NAME_MATCH");
  }

  if (candidate.hasPaymentHistory) {
    score += 20;
    reasons.push("PAYMENT_HISTORY");
  }

  return { score, reasons };
}

export function scoreBankTransaction(
  tx: {
    amount: string;
    senderName?: string | null;
    description?: string | null;
  },
  candidates: UnitScoreCandidate[],
): ScoreResult {
  const hints = extractUnitRefs(tx.description);
  let best: { unitId: number; score: number; reasons: string[] } | null = null;

  for (const candidate of candidates) {
    const { score, reasons } = scoreUnitCandidate(tx, candidate, hints);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { unitId: candidate.unitId, score, reasons };
    }
  }

  if (!best) {
    return {
      unitId: null,
      score: 0,
      classification: null,
      reasons: [],
      matchStatus: "UNMATCHED",
    };
  }

  const classification = scoreToClassification(best.score);
  return {
    unitId: best.unitId,
    score: best.score,
    classification,
    reasons: best.reasons,
    matchStatus: classificationToMatchStatus(classification),
  };
}
