export type ReportRow = {
  unitNo: string;
  residentName: string | null;
  managementRole?: string | null;
  note: string | null;
  dueDate: string | null;
  aidatDueDate?: string | null;
  yakitDueDate?: string | null;
  digerDueDate?: string | null;
  aidatAmount: string;
  yakitAmount: string;
  digerAmount: string;
  devirAmount: string;
  paidAmount: string;
  faiz: string;
  remaining: string;
};

export type ColumnSource =
  | "unitNo"
  | "residentName"
  | "aidat"
  | "adjustment"
  | "yakit"
  | "diger"
  | "total"
  | "paid"
  | "remaining"
  | "note"
  | "signature"
  | "blank";

export type ReportColumn = {
  id: string;
  source: ColumnSource;
  header: string;
  visible: boolean;
  width: number;
};

export type ReportLayout = {
  title: string;
  subtitle: string;
  notes: string;
  showNotes: boolean;
  showTotals: boolean;
  columns: ReportColumn[];
};

export type ReportInput = {
  kurumName: string;
  period: string;
  periodLabel: string;
  lateFeeRatePercent: string;
  rows: ReportRow[];
  bankAccount: { bankName: string; iban: string } | null;
};

const SUMMED: ReadonlySet<ColumnSource> = new Set([
  "aidat",
  "adjustment",
  "yakit",
  "diger",
  "total",
  "paid",
  "remaining",
]);

export const REPORT_TOKENS = ["{kurum}", "{donem}", "{aidatSon}", "{yakitSon}", "{digerSon}", "{gecikme}", "{banka}"];

export function defaultReportLayout(): ReportLayout {
  return {
    title: "{kurum} AİDAT ÖDEME LİSTESİ",
    subtitle: "{donem}",
    showNotes: true,
    showTotals: true,
    notes: [
      "AÇIKLAMA: 1- Ödemelerin {kurum} banka hesabına ({banka}) yatırılması önemle rica olunur. Elden ödeme yapılmaması muhasebenin takibi açısından önem arz etmektedir.",
      "2- Aidatların son ödeme tarihi {aidatSon} olarak belirlenmiştir. Bu tarihe kadar ödeme yapmayan site sakinlerinden, 634 sayılı Kat Mülkiyeti Kanunu 20. maddesi c bendine istinaden {gecikme} gecikme tazminatı hesaplanıp yukarıda belirtilmiştir.",
      "3- Gecikme zammı uygulanan site sakinleri, bir sonraki devam eden ayda da ödenmeyen her gün için gecikme zammı uygulaması ilgili mevzuat hükmü gereğince devam edecektir.",
      "4- Yakıt ödemesini zamanında yapmayan site sakinlerinden dolayı, site aboneliğine gaz dağıtım şirketi tarafından uygulanacak maddi cezai müeyyideler, ödemeyi zamanında yapmayan site sakinlerine aynen yansıtılacaktır.",
    ].join("\n"),
    columns: [
      { id: "unitNo", source: "unitNo", header: "DAİRE\nNO", visible: true, width: 5 },
      { id: "residentName", source: "residentName", header: "SAKİN", visible: false, width: 18 },
      { id: "aidat", source: "aidat", header: "AİDAT\nSON ÖDEME TARİHİ\n{aidatSon}", visible: true, width: 11 },
      {
        id: "adjustment",
        source: "adjustment",
        header: "{gecikme} GECİKME\nTAZMİNATLARI\nVEYA EKSİK/FAZLA\nÖDEMELER",
        visible: true,
        width: 14,
      },
      { id: "yakit", source: "yakit", header: "YAKIT\nSON ÖDEME TARİHİ\n{yakitSon}", visible: true, width: 12 },
      {
        id: "diger",
        source: "diger",
        header: "Asansör Borç Kapatma+\nDiğer Bakımlar\n{digerSon}",
        visible: true,
        width: 14,
      },
      { id: "total", source: "total", header: "TOPLAM\nÖDENECEK\nTUTAR", visible: true, width: 12 },
      { id: "paid", source: "paid", header: "ÖDENEN", visible: false, width: 11 },
      { id: "remaining", source: "remaining", header: "KALAN", visible: false, width: 11 },
      { id: "note", source: "note", header: "AÇIKLAMA", visible: true, width: 32 },
      { id: "signature", source: "signature", header: "İMZA", visible: false, width: 12 },
    ],
  };
}

export function addBlankColumn(layout: ReportLayout, header: string, id: string): ReportLayout {
  return {
    ...layout,
    columns: [...layout.columns, { id, source: "blank", header, visible: true, width: 12 }],
  };
}

export function removeColumn(layout: ReportLayout, id: string): ReportLayout {
  return {
    ...layout,
    columns: layout.columns.filter((c) => c.id !== id || c.source !== "blank"),
  };
}

export function moveColumn(layout: ReportLayout, id: string, delta: -1 | 1): ReportLayout {
  const from = layout.columns.findIndex((c) => c.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= layout.columns.length) return layout;
  const columns = [...layout.columns];
  const [moved] = columns.splice(from, 1);
  columns.splice(to, 0, moved!);
  return { ...layout, columns };
}

export function patchColumn(
  layout: ReportLayout,
  id: string,
  patch: Partial<Pick<ReportColumn, "header" | "visible">>,
): ReportLayout {
  return {
    ...layout,
    columns: layout.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

/** Kayıtlı düzeni okur; sonradan eklenen standart kolonları kaybetmeden birleştirir. */
export function parseReportLayout(raw: string | null): ReportLayout {
  const fallback = defaultReportLayout();
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw) as Partial<ReportLayout>;
    if (!Array.isArray(saved.columns)) return fallback;
    const known = new Set(saved.columns.map((c) => c.id));
    return {
      ...fallback,
      ...saved,
      columns: [...saved.columns, ...fallback.columns.filter((c) => !known.has(c.id))],
    };
  } catch {
    return fallback;
  }
}

function toCents(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function formatCents(cents: number, blankZero: boolean): string {
  if (blankZero && cents === 0) return "";
  return (cents / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function firstDue(rows: ReportRow[], ...keys: Array<"aidatDueDate" | "yakitDueDate" | "digerDueDate" | "dueDate">): string {
  for (const key of keys) {
    for (const row of rows) {
      const formatted = formatDate(row[key]);
      if (formatted) return formatted;
    }
  }
  return "";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTokens(input: ReportInput): Record<string, string> {
  const rate = Number(input.lateFeeRatePercent || 0);
  const aidatDue = firstDue(input.rows, "aidatDueDate", "dueDate");
  const account = input.bankAccount;
  const iban = account?.iban.replace(/\s+/g, "") ?? "";
  const digits = iban.replace(/\D/g, "");
  return {
    "{kurum}": input.kurumName,
    "{donem}": input.periodLabel,
    "{aidatSon}": aidatDue || "—",
    "{yakitSon}": firstDue(input.rows, "yakitDueDate") || aidatDue || "—",
    "{digerSon}": firstDue(input.rows, "digerDueDate"),
    "{gecikme}": `%${Number.isFinite(rate) ? rate : 0}`,
    "{banka}": account
      ? `${account.bankName} hesap no: ${digits.slice(-7) || "—"} IBAN: ${iban.replace(/(.{4})/g, "$1 ").trim()}`
      : "site banka hesabı",
  };
}

function fill(template: string, tokens: Record<string, string>): string {
  return Object.entries(tokens).reduce((text, [token, value]) => text.split(token).join(value), template);
}

function cellCents(source: ColumnSource, row: ReportRow): number {
  const aidat = toCents(row.aidatAmount);
  const adjustment = toCents(row.faiz) + toCents(row.devirAmount);
  const yakit = toCents(row.yakitAmount);
  const diger = toCents(row.digerAmount);
  switch (source) {
    case "aidat":
      return aidat;
    case "adjustment":
      return adjustment;
    case "yakit":
      return yakit;
    case "diger":
      return diger;
    case "total":
      return aidat + adjustment + yakit + diger;
    case "paid":
      return toCents(row.paidAmount);
    case "remaining":
      return toCents(row.remaining);
    default:
      return 0;
  }
}

function aidatLabel(row: ReportRow): string | null {
  if (row.managementRole === "MANAGER") return "YÖNETİCİ";
  if (row.managementRole === "ASSISTANT_MANAGER") return "YÖNETİCİ YRD";
  return null;
}

function renderCell(column: ReportColumn, row: ReportRow): string {
  switch (column.source) {
    case "unitNo":
      return `<td class="c">${escapeHtml(row.unitNo)}</td>`;
    case "residentName":
      return `<td>${escapeHtml(row.residentName ?? "")}</td>`;
    case "note":
      return `<td class="note">${escapeHtml((row.note ?? "").trim())}</td>`;
    case "signature":
    case "blank":
      return "<td></td>";
    case "aidat":
      return `<td class="r">${escapeHtml(aidatLabel(row) ?? formatCents(cellCents("aidat", row), true))}</td>`;
    case "total":
      return `<td class="r b">${formatCents(cellCents("total", row), false)}</td>`;
    default:
      return `<td class="r">${formatCents(cellCents(column.source, row), true)}</td>`;
  }
}

function renderTotal(column: ReportColumn, rows: ReportRow[], isFirst: boolean): string {
  if (!SUMMED.has(column.source)) return `<td class="c">${isFirst ? "Σ" : ""}</td>`;
  const sum = rows.reduce((acc, row) => acc + cellCents(column.source, row), 0);
  return `<td class="r">${formatCents(sum, false)}</td>`;
}

export function buildPeriodReportHtml(input: ReportInput, layout: ReportLayout): string {
  const tokens = buildTokens(input);
  const columns = layout.columns.filter((c) => c.visible);
  const totalWidth = columns.reduce((acc, c) => acc + c.width, 0) || 1;
  const title = escapeHtml(fill(layout.title, tokens).toLocaleUpperCase("tr-TR"));
  const subtitle = escapeHtml(fill(layout.subtitle, tokens).toLocaleUpperCase("tr-TR"));

  const headerHtml = columns
    .map((c) => {
      const lines = fill(c.header, tokens)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(escapeHtml);
      return `<th>${lines.join("<br/>")}</th>`;
    })
    .join("");
  const bodyHtml = input.rows
    .map((row) => `<tr>${columns.map((c) => renderCell(c, row)).join("")}</tr>`)
    .join("");
  const footerHtml = layout.showTotals
    ? `<tfoot><tr>${columns.map((c, i) => renderTotal(c, input.rows, i === 0)).join("")}</tr></tfoot>`
    : "";
  const notesHtml = layout.showNotes
    ? `<div class="notes">${fill(layout.notes, tokens)
        .split("\n")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")}</div>`
    : "";

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>${title} — ${subtitle}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #111; background: #fff; margin: 0; padding: 8px 12px 16px; font-size: 11px; }
    h1 { margin: 0; text-align: center; font-size: 16px; letter-spacing: 0.02em; }
    h2 { margin: 2px 0 10px; text-align: center; font-size: 15px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #222; padding: 3px 4px; vertical-align: middle; overflow-wrap: anywhere; }
    th { background: #f3f3f3; font-size: 9px; line-height: 1.2; text-align: center; font-weight: 700; }
    td.c { text-align: center; font-weight: 600; }
    td.r { text-align: right; white-space: nowrap; }
    td.b { font-weight: 700; }
    td.note { font-size: 9px; text-align: left; }
    tfoot td { font-weight: 700; background: #f7f7f7; }
    .notes { margin-top: 10px; font-size: 9.5px; line-height: 1.35; text-align: justify; }
    .notes p { margin: 0 0 2px; }
    @media print { body { padding: 0; } thead { display: table-header-group; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <h2>${subtitle}</h2>
  <table>
    <colgroup>${columns.map((c) => `<col style="width:${((c.width / totalWidth) * 100).toFixed(2)}%" />`).join("")}</colgroup>
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
    ${footerHtml}
  </table>
  ${notesHtml}
</body>
</html>`;
}
