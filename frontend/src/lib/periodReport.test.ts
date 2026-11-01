import { describe, expect, it } from "vitest";
import {
  addBlankColumn,
  buildPeriodReportHtml,
  defaultReportLayout,
  moveColumn,
  parseReportLayout,
  patchColumn,
  removeColumn,
  type ReportInput,
  type ReportRow,
} from "./periodReport";

const row = (overrides: Partial<ReportRow> = {}): ReportRow => ({
  unitNo: "1",
  residentName: "Ada Yılmaz",
  note: null,
  dueDate: "2026-09-10T00:00:00.000Z",
  aidatAmount: "0.10",
  yakitAmount: "0.20",
  digerAmount: "0.00",
  devirAmount: "0.00",
  paidAmount: "0.00",
  faiz: "0.00",
  remaining: "0.30",
  ...overrides,
});

const input = (rows: ReportRow[] = [row()]): ReportInput => ({
  kurumName: "Çınar & Sitesi",
  period: "2026-09",
  periodLabel: "Eylül 2026",
  lateFeeRatePercent: "5",
  rows,
  bankAccount: { bankName: "Banka", iban: "TR00 0000 0000 0000 0000 1234 56" },
});

const headers = (html: string) => [...html.matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1]);

describe("period report layout", () => {
  it("keeps the standard seven columns by default", () => {
    expect(headers(buildPeriodReportHtml(input(), defaultReportLayout()))).toHaveLength(7);
  });

  it("hides, renames and reorders columns", () => {
    let layout = patchColumn(defaultReportLayout(), "note", { visible: false });
    layout = patchColumn(layout, "unitNo", { header: "NO" });
    layout = moveColumn(layout, "total", -1);
    const result = headers(buildPeriodReportHtml(input(), layout));
    expect(result).toHaveLength(6);
    expect(result[0]).toBe("NO");
    expect(result.at(-1)).toContain("Asansör");
    expect(result.at(-2)).toContain("TOPLAM");
  });

  it("adds and removes blank columns but never built-in ones", () => {
    const added = addBlankColumn(defaultReportLayout(), "Teslim", "blank-1");
    expect(headers(buildPeriodReportHtml(input(), added))).toContain("Teslim");
    expect(removeColumn(added, "blank-1").columns.some((c) => c.id === "blank-1")).toBe(false);
    expect(removeColumn(added, "unitNo").columns.some((c) => c.id === "unitNo")).toBe(true);
  });

  it("sums in cents so totals do not drift", () => {
    const html = buildPeriodReportHtml(input([row(), row({ unitNo: "2" })]), defaultReportLayout());
    expect(html).toContain('<td class="r">0,60</td>');
  });

  it("keeps the row total independent of hidden columns", () => {
    const layout = patchColumn(defaultReportLayout(), "yakit", { visible: false });
    expect(buildPeriodReportHtml(input(), layout)).toContain('<td class="r b">0,30</td>');
  });

  it("escapes user text and does not uppercase html entities", () => {
    const layout = patchColumn(defaultReportLayout(), "unitNo", { header: "<b>X</b>" });
    const html = buildPeriodReportHtml(input(), layout);
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).toContain("ÇINAR &amp; SİTESİ");
    expect(html).not.toContain("&AMP;");
  });

  it("fills tokens in headers and notes", () => {
    const html = buildPeriodReportHtml(input(), defaultReportLayout());
    expect(html).toContain("%5 GECİKME");
    expect(html).toContain("IBAN: TR00 0000");
    expect(html).not.toContain("{banka}");
  });

  it("restores saved layouts and adds columns introduced later", () => {
    const saved = JSON.stringify({
      ...defaultReportLayout(),
      title: "Özel",
      columns: defaultReportLayout().columns.filter((c) => c.id !== "signature"),
    });
    const parsed = parseReportLayout(saved);
    expect(parsed.title).toBe("Özel");
    expect(parsed.columns.some((c) => c.id === "signature")).toBe(true);
    expect(parseReportLayout("{bozuk").title).toBe(defaultReportLayout().title);
  });
});
