import * as XLSX from "xlsx";
import { AppError } from "../../shared/errors/app-error.js";
import { money, moneyToString } from "../../shared/utils/money.js";

export type YakitExcelRow = {
  rowNumber: number;
  unitNo: string;
  amount: string;
};

function normalizeHeader(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseExcelMoney(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return moneyToString(money(raw.toFixed(2)));
  }

  let s = String(raw)
    .trim()
    .replace(/\s/g, "")
    .replace(/₺/g, "")
    .replace(/TL/gi, "")
    .replace(/TRY/gi, "");
  if (!s) return null;

  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return moneyToString(money(n.toFixed(2)));
}

function normalizeUnitNo(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return String(Math.trunc(raw));
  }
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^(daire|unit|no|n[oö])\s*[:.\-]?\s*/i, "").trim();
  if (!s) return null;
  return s;
}

function pickColumns(headers: string[]): { unitIdx: number; amountIdx: number } {
  const normalized = headers.map((h) => normalizeHeader(String(h ?? "")));

  const unitAliases = ["daire", "daire no", "daire numarasi", "unit", "unit no", "unit number", "no"];
  const amountAliases = [
    "yakit",
    "yakit tutari",
    "yakit bedeli",
    "tutar",
    "amount",
    "bedel",
    "ucret",
  ];

  let unitIdx = normalized.findIndex((h) => unitAliases.includes(h));
  let amountIdx = normalized.findIndex((h) => amountAliases.includes(h) && !h.includes("daire"));

  if (unitIdx < 0) {
    unitIdx = normalized.findIndex((h) => h.includes("daire") || h.includes("unit"));
  }
  if (amountIdx < 0) {
    amountIdx = normalized.findIndex(
      (h) => h.includes("yakit") || h.includes("tutar") || h.includes("amount") || h.includes("bedel"),
    );
  }

  if (unitIdx < 0 || amountIdx < 0 || unitIdx === amountIdx) {
    throw new AppError(
      "INVALID_EXCEL",
      "Excel başlıkları bulunamadı. Beklenen kolonlar: Daire No, Yakıt Tutarı",
      400,
    );
  }

  return { unitIdx, amountIdx };
}

export function parseYakitExcel(buffer: Buffer): YakitExcelRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new AppError("INVALID_EXCEL", "Excel dosyasında sayfa yok.", 400);

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  if (matrix.length < 2) {
    throw new AppError("INVALID_EXCEL", "Excel'de başlık + en az bir satır olmalı.", 400);
  }

  const headerRow = (matrix[0] ?? []).map((c) => (c == null ? "" : String(c)));
  const { unitIdx, amountIdx } = pickColumns(headerRow);

  const rows: YakitExcelRow[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < matrix.length; i += 1) {
    const line = matrix[i] ?? [];
    const unitNo = normalizeUnitNo(line[unitIdx]);
    const amount = parseExcelMoney(line[amountIdx]);
    if (!unitNo && (amount == null || amount === "0.00")) continue;
    if (!unitNo) {
      throw new AppError("INVALID_EXCEL", `Satır ${i + 1}: daire numarası boş.`, 400);
    }
    if (amount == null) {
      throw new AppError("INVALID_EXCEL", `Satır ${i + 1} (${unitNo}): yakıt tutarı geçersiz.`, 400);
    }
    if (money(amount).isZero()) continue;

    const key = unitNo.toLocaleLowerCase("tr");
    if (seen.has(key)) {
      throw new AppError("DUPLICATE_UNIT", `Excel'de mükerrer daire: ${unitNo}`, 400);
    }
    seen.add(key);

    rows.push({ rowNumber: i + 1, unitNo, amount });
  }

  if (rows.length === 0) {
    throw new AppError("EMPTY_EXCEL", "Aktarılacak yakıt satırı bulunamadı.", 400);
  }

  return rows;
}
