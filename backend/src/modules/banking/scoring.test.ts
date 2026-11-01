import { describe, expect, it } from "vitest";
import { normalizeDescription } from "./fingerprint.js";
import {
  classificationToMatchStatus,
  extractUnitRefs,
  scoreBankTransaction,
  scoreToClassification,
  type UnitScoreCandidate,
} from "./scoring.js";

function candidate(partial: Partial<UnitScoreCandidate> & { unitId: number }): UnitScoreCandidate {
  return {
    blockCode: "A",
    blockName: "A BLOK",
    unitNo: "12",
    personNamesNormalized: [normalizeDescription("AHMET YILMAZ")],
    openChargeTotal: "2500.00",
    hasIbanMapping: false,
    hasIbanPaymentHistory: false,
    hasPaymentHistory: false,
    ...partial,
  };
}

describe("extractUnitRefs", () => {
  it("parses A BLOK 12", () => {
    expect(extractUnitRefs("A BLOK 12 EYLUL AIDAT")).toEqual([
      { blockHint: "A", unitNo: "12" },
    ]);
  });

  it("parses A/12 and A-12", () => {
    expect(extractUnitRefs("odeme A/12")).toContainEqual({ blockHint: "A", unitNo: "12" });
    expect(extractUnitRefs("odeme A-12")).toContainEqual({ blockHint: "A", unitNo: "12" });
  });

  it("parses DAIRE 12, D:12, D12", () => {
    expect(extractUnitRefs("DAIRE 12")).toContainEqual({ blockHint: null, unitNo: "12" });
    expect(extractUnitRefs("D:12")).toContainEqual({ blockHint: null, unitNo: "12" });
    expect(extractUnitRefs("AIDAT D12")).toContainEqual({ blockHint: null, unitNo: "12" });
  });
});

describe("score bands", () => {
  it("maps score to classification and match_status", () => {
    expect(scoreToClassification(90)).toBe("AUTO_CONFIDENT");
    expect(scoreToClassification(89)).toBe("SUGGESTED");
    expect(scoreToClassification(70)).toBe("SUGGESTED");
    expect(scoreToClassification(69)).toBe("REVIEW_REQUIRED");
    expect(classificationToMatchStatus("AUTO_CONFIDENT")).toBe("SUGGESTED");
    expect(classificationToMatchStatus("SUGGESTED")).toBe("SUGGESTED");
    expect(classificationToMatchStatus("REVIEW_REQUIRED")).toBe("REVIEW_REQUIRED");
    expect(classificationToMatchStatus(null)).toBe("UNMATCHED");
  });

  it("scores AUTO_CONFIDENT for IBAN + description + amount", () => {
    const result = scoreBankTransaction(
      {
        amount: "2500.00",
        senderName: "AHMET YILMAZ",
        description: "A BLOK 12 EYLUL AIDAT",
      },
      [
        candidate({
          unitId: 1,
          hasIbanMapping: true,
          hasPaymentHistory: true,
        }),
      ],
    );

    // 50 IBAN + 40 desc + 30 amount + 20 name + 20 history = 160
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.classification).toBe("AUTO_CONFIDENT");
    expect(result.matchStatus).toBe("SUGGESTED");
    expect(result.unitId).toBe(1);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["IBAN_MAPPING", "DESCRIPTION_UNIT", "AMOUNT_EQUALS_OPEN_TOTAL"]),
    );
  });

  it("scores SUGGESTED band for description + amount only", () => {
    const result = scoreBankTransaction(
      {
        amount: "2500.00",
        senderName: "UNKNOWN",
        description: "A BLOK 12",
      },
      [candidate({ unitId: 2 })],
    );
    // 40 + 30 = 70
    expect(result.score).toBe(70);
    expect(result.classification).toBe("SUGGESTED");
    expect(result.matchStatus).toBe("SUGGESTED");
  });

  it("scores REVIEW_REQUIRED below 70", () => {
    const result = scoreBankTransaction(
      {
        amount: "100.00",
        senderName: "AHMET YILMAZ",
        description: "AIDAT",
      },
      [candidate({ unitId: 3, openChargeTotal: "2500.00" })],
    );
    // name only +20
    expect(result.score).toBe(20);
    expect(result.classification).toBe("REVIEW_REQUIRED");
    expect(result.matchStatus).toBe("REVIEW_REQUIRED");
  });

  it("returns UNMATCHED when no signals", () => {
    const result = scoreBankTransaction(
      {
        amount: "100.00",
        senderName: "XYZ",
        description: "random",
      },
      [candidate({ unitId: 4, personNamesNormalized: [], openChargeTotal: "999.00" })],
    );
    expect(result.unitId).toBeNull();
    expect(result.matchStatus).toBe("UNMATCHED");
    expect(result.classification).toBeNull();
  });
});
