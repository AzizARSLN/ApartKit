import * as XLSX from "xlsx";

export type NormalizedBankTransaction = {
  transactionDate: string;
  valueDate: string | null;
  amount: string;
  direction: "IN" | "OUT";
  senderName: string | null;
  senderIban: string | null;
  description: string | null;
  bankReference: string | null;
  operationType: string | null;
  channel: string | null;
  runningBalance: string | null;
  currency: string;
};

type ColumnRole =
  | "transactionDate"
  | "valueDate"
  | "amount"
  | "direction"
  | "senderName"
  | "senderIban"
  | "description"
  | "bankReference"
  | "operationType"
  | "channel"
  | "runningBalance"
  | "currency"
  | "credit"
  | "debit";

const HEADER_ALIASES: Record<ColumnRole, string[]> = {
  transactionDate: [
    "tarih",
    "islem tarihi",
    "işlem tarihi",
    "transaction date",
    "date",
    "trx date",
    "hareket tarihi",
  ],
  valueDate: ["valor", "valör", "value date", "valuta", "valor tarihi"],
  amount: [
    "tutar",
    "amount",
    "meblağ",
    "meblag",
    "işlem tutarı",
    "islem tutari",
    "tutar tl",
  ],
  direction: ["yon", "yön", "direction", "tip", "type", "islem tipi", "işlem tipi"],
  senderName: [
    "gonderen",
    "gönderen",
    "sender",
    "sender name",
    "karsi taraf",
    "karşı taraf",
    "unvan",
    "ünvan",
    "aciklama gonderen",
  ],
  senderIban: ["iban", "gonderen iban", "gönderen iban", "sender iban", "karsi iban", "karşı iban"],
  description: [
    "aciklama",
    "açıklama",
    "description",
    "detay",
    "islem aciklamasi",
    "işlem açıklaması",
    "aciklama1",
  ],
  bankReference: [
    "referans",
    "ref",
    "reference",
    "bank reference",
    "fis no",
    "fiş no",
    "dekont",
    "dekont numarasi",
    "dekont numarası",
    "islem no",
    "işlem no",
    "transaction id",
  ],
  operationType: ["islem", "işlem", "islem turu", "işlem türü", "transaction type"],
  channel: ["kanal", "channel", "kaynak"],
  runningBalance: [
    "guncel bakiye",
    "güncel bakiye",
    "guncel bakiye tl",
    "güncel bakiye tl",
    "running balance",
  ],
  currency: ["para birimi", "currency", "doviz", "döviz", "ccy"],
  credit: ["alacak", "credit", "giren", "yatırılan", "yatirilan"],
  debit: ["borc", "borç", "debit", "cikan", "çıkan", "cekilen", "çekilen"],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function detectColumns(headers: string[]): Partial<Record<ColumnRole, number>> {
  const map: Partial<Record<ColumnRole, number>> = {};
  const normalized = headers.map((h) => normalizeHeader(String(h ?? "")));

  // Prefer exact header matches first (e.g. "İşlem" vs "İşlem Tarihi")
  for (const [role, aliases] of Object.entries(HEADER_ALIASES) as Array<[ColumnRole, string[]]>) {
    const exactIdx = normalized.findIndex((h) =>
      aliases.some((a) => h === normalizeHeader(a)),
    );
    if (exactIdx >= 0 && map[role] === undefined) {
      map[role] = exactIdx;
    }
  }

  for (const [role, aliases] of Object.entries(HEADER_ALIASES) as Array<[ColumnRole, string[]]>) {
    if (map[role] !== undefined) continue;
    const idx = normalized.findIndex((h) =>
      aliases.some((a) => {
        const alias = normalizeHeader(a);
        return h === alias || (alias.length > 3 && h.includes(alias));
      }),
    );
    if (idx >= 0) map[role] = idx;
  }

  return map;
}

function cell(row: unknown[], index: number | undefined): string {
  if (index === undefined) return "";
  const v = row[index];
  if (v == null) return "";
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

function parseDateFlexible(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmY = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmY) {
    const d = dmY[1].padStart(2, "0");
    const m = dmY[2].padStart(2, "0");
    let y = dmY[3];
    if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`;
    return `${y}-${m}-${d}`;
  }
  const excelSerial = Number(s);
  if (Number.isFinite(excelSerial) && excelSerial > 20000 && excelSerial < 80000) {
    // Excel serial date (days since 1899-12-30)
    const epoch = Date.UTC(1899, 11, 30) + Math.round(excelSerial) * 86400000;
    return new Date(epoch).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function formatMoney(abs: number): string {
  return abs.toFixed(2);
}

/** Parse money that may use TR (1.234,56) or EN (1,234.56) separators and optional sign. */
export function parseSignedAmount(raw: string): { amount: string; negative: boolean } | null {
  let s = raw.trim().replace(/\s/g, "").replace(/₺|TL|TRY/gi, "");
  if (!s) return null;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (n < 0) negative = true;
  return { amount: formatMoney(abs), negative };
}

function parseDirection(raw: string): "IN" | "OUT" | null {
  const n = normalizeHeader(raw);
  if (!n) return null;
  if (["in", "giren", "alacak", "credit", "cr", "yatirim", "yatirim", "+"].includes(n)) return "IN";
  if (["out", "cikan", "borc", "debit", "dr", "odeme", "-"].includes(n)) return "OUT";
  if (n.includes("alacak") || n.includes("giren") || n.includes("credit")) return "IN";
  if (n.includes("borc") || n.includes("cikan") || n.includes("debit")) return "OUT";
  return null;
}

function normalizeIban(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  if (!cleaned) return null;
  return cleaned;
}

function rowToTransaction(
  row: unknown[],
  cols: Partial<Record<ColumnRole, number>>,
): NormalizedBankTransaction | null {
  const dateRaw = cell(row, cols.transactionDate);
  const transactionDate = parseDateFlexible(dateRaw);
  if (!transactionDate) return null;

  const valueDate = parseDateFlexible(cell(row, cols.valueDate));

  let amount: string | null = null;
  let direction: "IN" | "OUT" | null = parseDirection(cell(row, cols.direction));

  const amountCell = cell(row, cols.amount);
  if (amountCell) {
    const parsed = parseSignedAmount(amountCell);
    if (parsed) {
      amount = parsed.amount;
      if (!direction) direction = parsed.negative ? "OUT" : "IN";
    }
  }

  if (!amount && (cols.credit !== undefined || cols.debit !== undefined)) {
    const credit = parseSignedAmount(cell(row, cols.credit));
    const debit = parseSignedAmount(cell(row, cols.debit));
    if (credit && Number(credit.amount) > 0) {
      amount = credit.amount;
      direction = "IN";
    } else if (debit && Number(debit.amount) > 0) {
      amount = debit.amount;
      direction = "OUT";
    }
  }

  if (!amount || !direction) return null;

  const description = cell(row, cols.description) || null;
  const senderName = cell(row, cols.senderName) || null;
  const senderIban = normalizeIban(cell(row, cols.senderIban));
  const bankReference = cell(row, cols.bankReference) || null;
  const operationType = cell(row, cols.operationType) || null;
  const channel = cell(row, cols.channel) || null;
  const runningRaw = cell(row, cols.runningBalance);
  const runningParsed = runningRaw ? parseSignedAmount(runningRaw) : null;
  const runningBalance = runningParsed ? runningParsed.amount : null;
  const currency = (cell(row, cols.currency) || "TRY").toUpperCase().slice(0, 8);

  return {
    transactionDate,
    valueDate,
    amount,
    direction,
    senderName,
    senderIban,
    description,
    bankReference,
    operationType,
    channel,
    runningBalance,
    currency,
  };
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // skip
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function detectDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return "\t";
  if (semis > commas) return ";";
  return ",";
}

export function parseCsv(input: Buffer | string): NormalizedBankTransaction[] {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  const cleaned = text.replace(/^\uFEFF/, "");
  const firstLine = cleaned.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const delimiter = detectDelimiter(firstLine);
  const matrix = parseDelimited(cleaned, delimiter);
  return parseMatrix(matrix);
}

function findHeaderRowIndex(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 50);
  for (let i = 0; i < limit; i++) {
    const headers = (matrix[i] ?? []).map((h) => String(h ?? ""));
    const cols = detectColumns(headers);
    if (cols.transactionDate !== undefined && cols.amount !== undefined) {
      return i;
    }
  }
  return -1;
}

function parseMatrix(matrix: unknown[][]): NormalizedBankTransaction[] {
  if (matrix.length < 2) return [];
  const headerIdx = findHeaderRowIndex(matrix);
  if (headerIdx < 0) {
    throw new Error("Dosya başlıkları tanınamadı (Tarih / Tutar satırı gerekli).");
  }
  const headers = (matrix[headerIdx] ?? []).map((h) => String(h ?? ""));
  const cols = detectColumns(headers);
  const out: NormalizedBankTransaction[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const tx = rowToTransaction(matrix[i] ?? [], cols);
    if (tx) out.push(tx);
  }
  return out;
}

/** Denizbank vb. ekstre üst bilgisinden kapanış bakiyesini okur. */
export function extractClosingBalance(matrix: unknown[][]): string | null {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const label = normalizeHeader(String(matrix[i]?.[0] ?? ""));
    if (!label.includes("bakiye")) continue;
    const raw = String(matrix[i]?.[1] ?? "");
    const first = raw.split("/")[0] ?? raw;
    const parsed = parseSignedAmount(first);
    if (parsed) return parsed.amount;
  }
  return null;
}

export function parseXlsx(buffer: Buffer): NormalizedBankTransaction[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  return parseMatrix(matrix);
}

export function parseXlsxWithMeta(buffer: Buffer): {
  rows: NormalizedBankTransaction[];
  suggestedClosingBalance: string | null;
} {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], suggestedClosingBalance: null };
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  return {
    rows: parseMatrix(matrix),
    suggestedClosingBalance: extractClosingBalance(matrix),
  };
}

export function suggestExpenseCategoryCode(description: string | null | undefined): string {
  const d = normalizeHeader(description ?? "");
  if (!d) return "GENEL";
  if (d.includes("aski") || (d.includes(" su") && d.includes("fatura")) || d.includes("ankara su")) {
    return "SU";
  }
  if (d.includes("enerjisa") || d.includes("elektrik")) return "ELEKTRIK";
  if (d.includes("sgk") || d.includes("prim odeme") || d.includes("prim ödem")) return "SGK";
  if (d.includes("telekom") || d.includes("ttnet") || d.includes("internet")) return "INTERNET";
  if (d.includes("masraf") || d.includes("havale") || d.includes("mkk")) return "BANKA_MASRAF";
  if (d.includes("jenerator") || d.includes("jeneratör") || d.includes("yangin") || d.includes("yangın")) {
    return "BAKIM";
  }
  if (d.includes("kanal") || d.includes("tadilat") || d.includes("tamir")) return "BAKIM";
  return "GENEL";
}

export function parseBankFile(buffer: Buffer, fileName: string): NormalizedBankTransaction[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseXlsx(buffer);
  }
  return parseCsv(buffer);
}

export function parseBankFileWithMeta(
  buffer: Buffer,
  fileName: string,
): { rows: NormalizedBankTransaction[]; suggestedClosingBalance: string | null } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseXlsxWithMeta(buffer);
  }
  return { rows: parseCsv(buffer), suggestedClosingBalance: null };
}
