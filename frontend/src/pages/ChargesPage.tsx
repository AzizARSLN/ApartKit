import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiUpload, formatMoney } from "../lib/api";
import { printHtmlDocument } from "../lib/printHtml";

type Kurum = { id: number; name: string; siteId: number | null };
type Unit = { id: number; unitNo: string };

type MonthlyPreview = {
  unitCount: number;
  perUnitTotal: string;
  grandTotal: string;
  lateFeeNote: string;
  lateFeeRatePercent: string;
  dueDate: string;
  carryForwardFromPeriod: string | null;
  carryForwardUnitCount: number;
  carryForwardTotal: string;
  aidatExemptUnitCount?: number;
  aidatExemptNote?: string | null;
  components: Array<{ code: string; label: string; perUnit: string; total: string }>;
};

type StatementRow = {
  unitId: number;
  unitNo: string;
  personId: number | null;
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
  principalTotal: string;
  paidAmount: string;
  principalOpen: string;
  faiz: string;
  remaining: string;
  isOverdue: boolean;
  paymentStatus: "PAID" | "PARTIAL" | "OPEN";
  canRemove: boolean;
  hasMovement: boolean;
  canCollect: boolean;
};

type BankAccount = {
  id: number;
  bankName: string;
  accountName: string;
  iban: string;
};

type AvailableUnit = {
  id: number;
  unitNo: string;
  floorNo: string | null;
  residentName: string | null;
};

type PeriodStatement = {
  period: string;
  lateFeeRatePercent: string;
  lateFeeEnabled: boolean;
  rows: StatementRow[];
  totals: {
    aidat: string;
    yakit: string;
    diger: string;
    devir: string;
    principalTotal: string;
    paidAmount: string;
    principalOpen: string;
    faiz: string;
    remaining: string;
  };
};

type PeriodSummary = {
  period: string;
  dueDate: string | null;
  unitCount: number;
  principalTotal: string;
  paidAmount: string;
  principalOpen: string;
  canDelete: boolean;
};

type YakitImportPreview = {
  siteId: number;
  period: string;
  fileName: string;
  totalRows: number;
  createCount: number;
  updateCount: number;
  skipCount: number;
  applyTotal: string;
  rows: Array<{
    rowNumber: number;
    unitId: number | null;
    unitNo: string;
    amount: string;
    action: "CREATE" | "UPDATE" | "SKIP";
    reason: string | null;
    existingChargeId: number | null;
    existingAmount: string | null;
  }>;
};

function paymentStatusLabel(status: StatementRow["paymentStatus"]): string {
  if (status === "PAID") return "Ödendi";
  if (status === "PARTIAL") return "Kısmi";
  return "Açık";
}

function payMethodLabel(method: string): string {
  if (method === "BANK_TRANSFER") return "Havale / EFT";
  if (method === "CASH") return "Nakit";
  if (method === "CREDIT_CARD") return "Kredi kartı";
  return method;
}

type UnitPayment = {
  id: number;
  paymentDate: string;
  amount: string;
  paymentMethod: string;
  description: string | null;
  receiptNo: string | null;
};

function formatPeriodLabel(period: string): string {
  const [y, m] = period.split("-");
  const months = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ];
  const monthName = months[Number(m) - 1];
  return monthName ? `${monthName} ${y}` : period;
}

function toMoneyInput(value: string): string {
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return n.toFixed(2);
}

function defaultPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (m === 12) return `${y! + 1}-01`;
  return `${y}-${String(m! + 1).padStart(2, "0")}`;
}

function nextMonthDay(period: string, day: number): string {
  const [y, m] = period.split("-").map(Number);
  const year = m === 12 ? y! + 1 : y!;
  const month = m === 12 ? 1 : m! + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatMoneyTr(value: string | number, blankZero = true): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (blankZero && n === 0) return "";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTr(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatIbanSpaced(iban: string): string {
  return iban.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

function accountNoFromIban(iban: string): string {
  const digits = iban.replace(/\D/g, "");
  if (digits.length >= 7) return digits.slice(-7);
  return digits || "—";
}

function aidatCellLabel(row: StatementRow): string {
  if (row.managementRole === "MANAGER") return "YÖNETİCİ";
  if (row.managementRole === "ASSISTANT_MANAGER") return "YÖNETİCİ YRD";
  return formatMoneyTr(row.aidatAmount);
}

function firstDue(
  rows: StatementRow[],
  key: "aidatDueDate" | "yakitDueDate" | "digerDueDate" | "dueDate",
): string {
  for (const row of rows) {
    const v = row[key];
    if (v) return formatDateTr(v);
  }
  return "";
}

function printPeriodStatement(opts: {
  kurumName: string;
  period: string;
  statement: PeriodStatement;
  bankAccount: BankAccount | null;
}): void {
  const { kurumName, period, statement, bankAccount } = opts;
  const latePct = Number(statement.lateFeeRatePercent || 0);
  const lateLabel = Number.isFinite(latePct)
    ? `%${latePct % 1 === 0 ? latePct.toFixed(0) : latePct}`
    : "%5";

  const aidatDue = firstDue(statement.rows, "aidatDueDate") || firstDue(statement.rows, "dueDate");
  const yakitDue = firstDue(statement.rows, "yakitDueDate") || aidatDue;
  const digerDue = firstDue(statement.rows, "digerDueDate");

  let sumAidat = 0;
  let sumAdj = 0;
  let sumYakit = 0;
  let sumDiger = 0;
  let sumTotal = 0;

  const rowsHtml = statement.rows
    .map((row) => {
      const adj = Number(row.faiz) + Number(row.devirAmount);
      const diger = Number(row.digerAmount);
      const yakit = Number(row.yakitAmount);
      const aidatNum = Number(row.aidatAmount);
      const total = aidatNum + adj + yakit + diger;
      sumAidat += aidatNum;
      sumAdj += adj;
      sumYakit += yakit;
      sumDiger += diger;
      sumTotal += total;

      const aidatLabel = aidatCellLabel(row);
      const note = (row.note ?? "").trim();

      return `<tr>
        <td class="c">${escapeHtml(row.unitNo)}</td>
        <td class="r">${escapeHtml(aidatLabel)}</td>
        <td class="r">${formatMoneyTr(adj)}</td>
        <td class="r">${formatMoneyTr(yakit)}</td>
        <td class="r">${formatMoneyTr(diger)}</td>
        <td class="r b">${formatMoneyTr(total, false)}</td>
        <td class="note">${escapeHtml(note)}</td>
      </tr>`;
    })
    .join("");

  const bankLine = bankAccount
    ? `${escapeHtml(bankAccount.bankName)} hesap no :${accountNoFromIban(bankAccount.iban)} İban : ${formatIbanSpaced(bankAccount.iban)}`
    : "site banka hesabına";

  const siteTitle = escapeHtml(kurumName).toLocaleUpperCase("tr-TR");
  const periodTitle = escapeHtml(formatPeriodLabel(period).toLocaleUpperCase("tr-TR"));

  const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>${siteTitle} AİDAT ÖDEME LİSTESİ — ${periodTitle}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
      color: #111;
      margin: 0;
      padding: 8px 12px 16px;
      font-size: 11px;
    }
    h1 {
      margin: 0;
      text-align: center;
      font-size: 16px;
      letter-spacing: 0.02em;
    }
    h2 {
      margin: 2px 0 10px;
      text-align: center;
      font-size: 15px;
      font-weight: 700;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #222;
      padding: 3px 4px;
      vertical-align: middle;
    }
    th {
      background: #f3f3f3;
      font-size: 9px;
      line-height: 1.2;
      text-align: center;
      font-weight: 700;
    }
    td.c { text-align: center; font-weight: 600; width: 42px; }
    td.r { text-align: right; white-space: nowrap; }
    td.b { font-weight: 700; }
    td.note { font-size: 9px; text-align: left; }
    tfoot td { font-weight: 700; background: #f7f7f7; }
    .notes {
      margin-top: 10px;
      font-size: 9.5px;
      line-height: 1.35;
      text-align: justify;
    }
    .notes strong { font-weight: 700; }
    @media print {
      body { padding: 0; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <h1>${siteTitle} AİDAT ÖDEME LİSTESİ</h1>
  <h2>${periodTitle}</h2>
  <table>
    <colgroup>
      <col style="width:5%" />
      <col style="width:11%" />
      <col style="width:14%" />
      <col style="width:12%" />
      <col style="width:14%" />
      <col style="width:12%" />
      <col style="width:32%" />
    </colgroup>
    <thead>
      <tr>
        <th>DAİRE<br/>NO</th>
        <th>AİDAT<br/><span style="font-weight:600">SON ÖDEME TARİHİ</span><br/>${aidatDue || "—"}</th>
        <th>${lateLabel} GECİKME<br/>TAZMİNATLARI<br/>VEYA EKSİK/FAZLA<br/>ÖDEMELER</th>
        <th>YAKIT<br/><span style="font-weight:600">SON ÖDEME TARİHİ</span><br/>${yakitDue || "—"}</th>
        <th>Asansör Borç Kapatma+<br/>Diğer Bakımlar${digerDue ? `<br/>Son Ödeme (${digerDue})` : ""}</th>
        <th>TOPLAM<br/>ÖDENECEK<br/>TUTAR</th>
        <th>AÇIKLAMA</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr>
        <td class="c">Σ</td>
        <td class="r">${formatMoneyTr(sumAidat, false)}</td>
        <td class="r">${formatMoneyTr(sumAdj, false)}</td>
        <td class="r">${formatMoneyTr(sumYakit, false)}</td>
        <td class="r">${formatMoneyTr(sumDiger, false)}</td>
        <td class="r">${formatMoneyTr(sumTotal, false)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
  <div class="notes">
    <strong>AÇIKLAMA:</strong>
    1- Ödemelerin ${escapeHtml(kurumName)} banka hesabına (${bankLine}) yatırılması önemle rica olunur.
    Elden ödeme yapılmaması muhasebenin takibi açısından önem arz etmektedir.
    2- Aidatların son ödeme tarihi her ayın 10. günü olarak belirlenmiştir. Bu tarihe kadar ödeme yapmayan
    site sakinlerinden, 634 sayılı Kat Mülkiyeti Kanunu 20. maddesi c bendine istinaden ${lateLabel} gecikme tazminatı
    hesaplanıp yukarıda belirtilmiştir.
    3- Gecikme zammı uygulanan site sakinleri, bir sonraki devam eden ayda da ödenmeyen her gün için gecikme zammı
    uygulaması ilgili mevzuat hükmü gereğince devam edecektir.
    4- Yakıt ödemesini zamanında yapmayan site sakinlerinden dolayı, site aboneliğine gaz dağıtım şirketi tarafından
    uygulanacak maddi cezai müeyyideler, ödemeyi zamanında yapmayan site sakinlerine aynen yansıtılacaktır.
  </div>
</body>
</html>`;

  printHtmlDocument(html, `${period.replace("-", "_")}_aidat_listesi`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ChargesPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"create" | "detail">("create");
  const [period, setPeriod] = useState(defaultPeriod);
  const [publishDate, setPublishDate] = useState(`${defaultPeriod()}-01`);
  const [dueDate, setDueDate] = useState(nextMonthDay(defaultPeriod(), 10));
  const [aidat, setAidat] = useState("2500.00");
  const [diger, setDiger] = useState("0.00");
  const [digerDescription, setDigerDescription] = useState("");
  const [includeCarryForward, setIncludeCarryForward] = useState(true);
  const [carryForwardDescription, setCarryForwardDescription] = useState(
    "Bir önceki dönemden devir",
  );
  const [lateFeeRate, setLateFeeRate] = useState("2.00");
  const [preview, setPreview] = useState<MonthlyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [detailPeriod, setDetailPeriod] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState("all");
  const [residentSearch, setResidentSearch] = useState("");
  const [addUnitId, setAddUnitId] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [detailMessage, setDetailMessage] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rowNote, setRowNote] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "BANK_TRANSFER" | "CREDIT_CARD">(
    "BANK_TRANSFER",
  );
  const [payDescription, setPayDescription] = useState("");
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [reverseUnitId, setReverseUnitId] = useState<number | null>(null);
  const [residentEdit, setResidentEdit] = useState<{
    id: number;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
  } | null>(null);
  const [yakitFile, setYakitFile] = useState<File | null>(null);
  const [yakitPreview, setYakitPreview] = useState<YakitImportPreview | null>(null);
  const yakitFileRef = useRef<HTMLInputElement>(null);

  const kurumQuery = useQuery({
    queryKey: ["kurum"],
    queryFn: () => api<Kurum>("/kurum/me"),
  });
  const siteId = kurumQuery.data?.siteId ?? undefined;

  const unitsQuery = useQuery({
    queryKey: ["units-all", siteId],
    enabled: !!siteId,
    queryFn: () => api<{ items: Unit[] }>(`/sites/${siteId}/units?pageSize=200`),
  });

  const unitIds = useMemo(
    () => (unitsQuery.data?.items ?? []).filter((u) => u.unitNo !== "KD").map((u) => u.id),
    [unitsQuery.data],
  );

  const periodsQuery = useQuery({
    queryKey: ["billing-periods", siteId],
    enabled: !!siteId,
    queryFn: () => api<{ items: PeriodSummary[] }>(`/billing/periods?siteId=${siteId}`),
  });

  const bankAccountsQuery = useQuery({
    queryKey: ["bank-accounts", siteId],
    enabled: !!siteId,
    queryFn: () => api<BankAccount[]>(`/bank-accounts?siteId=${siteId}`),
  });

  const latestPeriod = periodsQuery.data?.items[0] ?? null;

  const statementQuery = useQuery({
    queryKey: ["period-statement", siteId, detailPeriod],
    enabled: !!siteId && mode === "detail" && !!detailPeriod && /^\d{4}-\d{2}$/.test(detailPeriod),
    queryFn: () =>
      api<PeriodStatement>(`/billing/period-statement?siteId=${siteId}&period=${detailPeriod}`),
  });

  const availableUnitsQuery = useQuery({
    queryKey: ["period-available-units", siteId, detailPeriod],
    enabled: !!siteId && mode === "detail" && !!detailPeriod && /^\d{4}-\d{2}$/.test(detailPeriod),
    queryFn: () =>
      api<{ items: AvailableUnit[] }>(
        `/billing/periods/${detailPeriod}/available-units?siteId=${siteId}`,
      ),
  });

  const yearOptions = useMemo(() => {
    const years = new Set((periodsQuery.data?.items ?? []).map((p) => p.period.slice(0, 4)));
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [periodsQuery.data]);

  const filteredPeriods = useMemo(() => {
    return (periodsQuery.data?.items ?? []).filter((p) => {
      if (yearFilter !== "all" && p.period.slice(0, 4) !== yearFilter) return false;
      return true;
    });
  }, [periodsQuery.data, yearFilter]);

  const filteredStatementRows = useMemo(() => {
    const rows = statementQuery.data?.rows ?? [];
    const q = residentSearch.trim().toLocaleLowerCase("tr");
    if (!q) return rows;
    return rows.filter((row) => (row.residentName ?? "").toLocaleLowerCase("tr").includes(q));
  }, [statementQuery.data, residentSearch]);

  function buildBody() {
    if (!siteId) throw new Error("Kurum operasyon kaydı yok");
    return {
      siteId,
      period,
      publishDate,
      dueDate,
      aidatPerUnit: toMoneyInput(aidat),
      yakitPerUnit: "0.00",
      digerPerUnit: toMoneyInput(diger),
      digerDescription: digerDescription.trim() || undefined,
      lateFeeRatePercent: toMoneyInput(lateFeeRate),
      unitIds,
      ...(includeCarryForward && latestPeriod && latestPeriod.period !== period
        ? {
            carryForwardFromPeriod: latestPeriod.period,
            carryForwardDescription: carryForwardDescription.trim() || "Bir önceki dönemden devir",
          }
        : {}),
    };
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      api<MonthlyPreview>("/billing/monthly/preview", {
        method: "POST",
        body: JSON.stringify(buildBody()),
      }),
    onSuccess: (res) => {
      setPreview(res);
      setError(null);
      setSuccess(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Önizleme hatası"),
  });

  const commitMutation = useMutation({
    mutationFn: () =>
      api("/billing/monthly", {
        method: "POST",
        body: JSON.stringify(buildBody()),
      }),
    onSuccess: async () => {
      setPreview(null);
      setError(null);
      setSuccess("Yeni dönem tahakkuku oluşturuldu.");
      await qc.invalidateQueries({ queryKey: ["period-statement"] });
      await qc.invalidateQueries({ queryKey: ["billing-periods"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      openDetail(period);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kayıt hatası"),
  });

  const removeFromPeriodMutation = useMutation({
    mutationFn: (unitId: number) => {
      if (!detailPeriod || !siteId) throw new Error("Dönem veya site seçili değil");
      return api(`/billing/periods/${detailPeriod}/units/${unitId}?siteId=${siteId}`, {
        method: "DELETE",
      });
    },
    onSuccess: async (_res, unitId) => {
      setDetailMessage({ type: "ok", text: `Daire #${unitId} dönemden çıkarıldı.` });
      setSelectedUnitId(null);
      await qc.invalidateQueries({ queryKey: ["period-statement"] });
      await qc.invalidateQueries({ queryKey: ["period-available-units"] });
      await qc.invalidateQueries({ queryKey: ["billing-periods"] });
    },
    onError: (err) => {
      setDetailMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Çıkarma hatası",
      });
    },
  });

  const deletePeriodMutation = useMutation({
    mutationFn: () => {
      if (!detailPeriod || !siteId) throw new Error("Dönem veya site seçili değil");
      return api<{
        ok: boolean;
        deletedChargeCount?: number;
        cancelledChargeCount: number;
      }>(`/billing/periods/${detailPeriod}?siteId=${siteId}`, { method: "DELETE" });
    },
    onSuccess: async (res) => {
      const removedPeriod = detailPeriod;
      const removedCount = res.deletedChargeCount ?? res.cancelledChargeCount;
      setDeleteConfirmOpen(false);
      setSuccess(
        `${removedPeriod ? formatPeriodLabel(removedPeriod) : "Dönem"} silindi (${removedCount} kayıt kaldırıldı).`,
      );
      setDetailMessage(null);
      setError(null);
      setDetailPeriod(null);
      setMode("create");
      setSelectedUnitId(null);

      if (removedPeriod && siteId) {
        qc.setQueryData<{ items: PeriodSummary[] }>(["billing-periods", siteId], (old) => {
          if (!old) return old;
          return { ...old, items: old.items.filter((p) => p.period !== removedPeriod) };
        });
      }

      await qc.invalidateQueries({ queryKey: ["period-statement"] });
      await qc.invalidateQueries({ queryKey: ["period-available-units"] });
      await qc.refetchQueries({ queryKey: ["billing-periods", siteId] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      setDeleteConfirmOpen(false);
      const text = err instanceof Error ? err.message : "Dönem silinemedi";
      setDetailMessage({ type: "err", text });
      setError(text);
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: () => {
      if (!detailPeriod || !siteId || !selectedUnitId) throw new Error("Satır seçili değil");
      return api(`/billing/periods/${detailPeriod}/units/${selectedUnitId}/note`, {
        method: "PATCH",
        body: JSON.stringify({ siteId, note: rowNote.trim() }),
      });
    },
    onSuccess: async () => {
      setDetailMessage({ type: "ok", text: "Açıklama kaydedildi." });
      await qc.invalidateQueries({ queryKey: ["period-statement"] });
    },
    onError: (err) => {
      setDetailMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Açıklama kaydedilemedi",
      });
    },
  });

  const collectMutation = useMutation({
    mutationFn: () => {
      if (!detailPeriod || !siteId || !selectedUnitId) throw new Error("Satır seçili değil");
      return api(`/billing/periods/${detailPeriod}/units/${selectedUnitId}/collect`, {
        method: "POST",
        body: JSON.stringify({
          siteId,
          amount: toMoneyInput(payAmount),
          paymentMethod: payMethod,
          paymentDate: new Date().toISOString().slice(0, 10),
          description: payDescription.trim() || undefined,
        }),
      });
    },
    onSuccess: async () => {
      setDetailMessage({ type: "ok", text: "Ödeme kaydedildi." });
      setPayDescription("");
      setPayModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["period-statement"] });
      await qc.invalidateQueries({ queryKey: ["billing-periods"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      setDetailMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Ödeme alınamadı",
      });
    },
  });

  function openPayModal(row: StatementRow) {
    setSelectedUnitId(row.unitId);
    setPayAmount(row.principalOpen);
    setPayMethod("BANK_TRANSFER");
    setPayDescription("");
    setPayModalOpen(true);
    setDetailMessage(null);
  }

  function openReverseModal(row: StatementRow) {
    setSelectedUnitId(row.unitId);
    setReverseUnitId(row.unitId);
    setReverseModalOpen(true);
    setDetailMessage(null);
  }

  const unitPaymentsQuery = useQuery({
    queryKey: ["unit-period-payments", siteId, detailPeriod, reverseUnitId],
    enabled: reverseModalOpen && !!siteId && !!detailPeriod && reverseUnitId != null,
    queryFn: () =>
      api<{ items: UnitPayment[] }>(
        `/billing/periods/${detailPeriod}/units/${reverseUnitId}/payments?siteId=${siteId}`,
      ),
  });

  const reverseMutation = useMutation({
    mutationFn: (paymentId: number) =>
      api(`/payments/${paymentId}/reverse`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: async () => {
      setDetailMessage({ type: "ok", text: "Tahsilat iptal edildi." });
      await qc.invalidateQueries({ queryKey: ["period-statement"] });
      await qc.invalidateQueries({ queryKey: ["billing-periods"] });
      await qc.invalidateQueries({ queryKey: ["unit-period-payments"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      setDetailMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Tahsilat iptal edilemedi",
      });
    },
  });

  const saveResidentMutation = useMutation({
    mutationFn: () => {
      if (!residentEdit) throw new Error("Sakin seçilmedi");
      return api(`/residents/${residentEdit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: residentEdit.firstName.trim(),
          lastName: residentEdit.lastName.trim(),
          phone: residentEdit.phone.trim() || null,
          email: residentEdit.email.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      setDetailMessage({ type: "ok", text: "Sakin bilgileri güncellendi." });
      setResidentEdit(null);
      await qc.invalidateQueries({ queryKey: ["period-statement"] });
      await qc.invalidateQueries({ queryKey: ["residents"] });
      await qc.invalidateQueries({ queryKey: ["resident-profile"] });
    },
    onError: (err) => {
      setDetailMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Sakin güncellenemedi",
      });
    },
  });

  async function openResidentCard(personId: number) {
    try {
      const profile = await api<{
        person: {
          id: number;
          firstName: string;
          lastName: string;
          phone: string | null;
          email: string | null;
        };
      }>(`/residents/${personId}/profile`);
      setResidentEdit({
        id: profile.person.id,
        firstName: profile.person.firstName,
        lastName: profile.person.lastName,
        phone: profile.person.phone ?? "",
        email: profile.person.email ?? "",
      });
    } catch (err) {
      setDetailMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Sakin kartı açılamadı",
      });
    }
  }

  const addToPeriodMutation = useMutation({
    mutationFn: (unitId: number) => {
      if (!detailPeriod || !siteId) throw new Error("Dönem veya site seçili değil");
      return api(`/billing/periods/${detailPeriod}/units`, {
        method: "POST",
        body: JSON.stringify({ siteId, unitId }),
      });
    },
    onSuccess: async (_res, unitId) => {
      setDetailMessage({ type: "ok", text: `Daire #${unitId} döneme eklendi.` });
      setAddUnitId("");
      setSelectedUnitId(unitId);
      await qc.invalidateQueries({ queryKey: ["period-statement"] });
      await qc.invalidateQueries({ queryKey: ["period-available-units"] });
      await qc.invalidateQueries({ queryKey: ["billing-periods"] });
    },
    onError: (err) => {
      setDetailMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Ekleme hatası",
      });
    },
  });

  const yakitPreviewMutation = useMutation({
    mutationFn: async () => {
      if (!siteId) throw new Error("Kurum operasyon kaydı yok");
      if (!yakitFile) throw new Error("Excel dosyası seçin");
      const form = new FormData();
      form.append("file", yakitFile);
      form.append("siteId", String(siteId));
      form.append("period", mode === "detail" && detailPeriod ? detailPeriod : period);
      return apiUpload<YakitImportPreview>("/billing/yakit/import/preview", form);
    },
    onSuccess: (res) => {
      setYakitPreview(res);
      setError(null);
      setSuccess(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Yakıt önizleme hatası"),
  });

  const yakitImportMutation = useMutation({
    mutationFn: async () => {
      if (!siteId) throw new Error("Kurum operasyon kaydı yok");
      if (!yakitFile) throw new Error("Excel dosyası seçin");
      const targetPeriod = mode === "detail" && detailPeriod ? detailPeriod : period;
      const form = new FormData();
      form.append("file", yakitFile);
      form.append("siteId", String(siteId));
      form.append("period", targetPeriod);
      form.append("dueDate", dueDate);
      return apiUpload<{
        ok: boolean;
        createdCount: number;
        updatedCount: number;
        skipCount: number;
        totalAmount: string;
      }>("/billing/yakit/import", form);
    },
    onSuccess: async (res) => {
      setError(null);
      setSuccess(
        `Yakıt aktarıldı: ${res.createdCount} yeni, ${res.updatedCount} güncelleme, ${res.skipCount} atlandı. Toplam ${formatMoney(res.totalAmount)}.`,
      );
      setYakitPreview(null);
      setYakitFile(null);
      if (yakitFileRef.current) yakitFileRef.current.value = "";
      await qc.invalidateQueries({ queryKey: ["period-statement"] });
      await qc.invalidateQueries({ queryKey: ["billing-periods"] });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Yakıt aktarım hatası"),
  });

  function onPeriodChange(value: string) {
    setPeriod(value);
    setYakitPreview(null);
    setPreview(null);
    if (/^\d{4}-\d{2}$/.test(value)) {
      setPublishDate(`${value}-01`);
      setDueDate(nextMonthDay(value, 10));
    }
  }

  function startNewPeriod() {
    const base = latestPeriod?.period ?? defaultPeriod();
    const next = latestPeriod ? nextPeriod(latestPeriod.period) : base;
    setMode("create");
    setDetailPeriod(null);
    setSelectedUnitId(null);
    setDetailMessage(null);
    setPreview(null);
    setYakitPreview(null);
    setIncludeCarryForward(!!latestPeriod && Number(latestPeriod.principalOpen) > 0);
    setCarryForwardDescription("Bir önceki dönemden devir");
    setDiger("0.00");
    setDigerDescription("");
    onPeriodChange(next);
    setSuccess(null);
    setError(null);
  }

  function openDetail(p: string) {
    setMode("detail");
    setDetailPeriod(p);
    setResidentSearch("");
    setAddUnitId("");
    setSelectedUnitId(null);
    setDetailMessage(null);
    setDeleteConfirmOpen(false);
    setPreview(null);
  }

  function requestDeletePeriod() {
    if (!detailPeriod || !siteId) {
      setDetailMessage({ type: "err", text: "Dönem veya site seçili değil." });
      setError("Dönem veya site seçili değil.");
      return;
    }
    if (selectedPeriodSummary?.canDelete === false) {
      const text =
        "Bu dönemde ödeme / tahsilat hareketi var. Dönem silinemez. Önce ilgili ödemeleri kontrol edin.";
      setDetailMessage({ type: "err", text });
      setError(text);
      setDeleteConfirmOpen(false);
      return;
    }
    setError(null);
    setDetailMessage(null);
    setDeleteConfirmOpen(true);
  }

  const statement = statementQuery.data;
  const availableUnits = availableUnitsQuery.data?.items ?? [];
  const selectedPeriodSummary = useMemo(
    () => (periodsQuery.data?.items ?? []).find((p) => p.period === detailPeriod) ?? null,
    [periodsQuery.data, detailPeriod],
  );
  const selectedRow = useMemo(
    () => (statement?.rows ?? []).find((r) => r.unitId === selectedUnitId) ?? null,
    [statement, selectedUnitId],
  );

  useEffect(() => {
    if (!selectedRow) {
      setRowNote("");
      setPayAmount("");
      setPayDescription("");
      return;
    }
    setRowNote(selectedRow.note ?? "");
    setPayAmount(selectedRow.principalOpen);
    setPayDescription("");
  }, [selectedRow?.unitId, selectedRow?.note, selectedRow?.principalOpen]);

  const yakitTargetPeriod = mode === "detail" && detailPeriod ? detailPeriod : period;

  return (
    <div className="space-y-4">
      <header className="rise flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="badge mb-3">Tahakkuk</p>
          <h1 className="text-3xl md:text-4xl">Dönem tahakkukları</h1>
          <p className="muted mt-2 max-w-2xl">
            Soldan dönem seçin. Yeni dönemde önceki kalan borç, daire bazında “Diğer” kalemine
            devredilir.
          </p>
        </div>
        <button className="btn btn-warm" type="button" onClick={startNewPeriod}>
          Yeni dönem başlat
        </button>
      </header>

      {error ? <p className="text-[var(--danger)]">{error}</p> : null}
      {success ? <p className="text-[var(--accent-strong)]">{success}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
        <aside className="surface p-3 space-y-3 rise lg:sticky lg:top-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Geçmiş dönemler</h2>
            <select
              className="select py-1 px-2 text-xs w-auto"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
            >
              <option value="all">Tüm yıllar</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className={`w-full text-left rounded-[12px] border px-3 py-2 text-sm transition ${
              mode === "create"
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] hover:bg-[var(--accent-soft)]"
            }`}
            onClick={startNewPeriod}
          >
            <span className="font-semibold">+ Yeni dönem</span>
            <span className="muted block text-xs mt-0.5">
              {latestPeriod
                ? `${formatPeriodLabel(latestPeriod.period)} kalanından devir`
                : "İlk tahakkuku oluştur"}
            </span>
          </button>

          <div className="max-h-[70vh] overflow-auto space-y-1 pr-1">
            {filteredPeriods.map((p) => {
              const selected = mode === "detail" && detailPeriod === p.period;
              return (
                <button
                  key={p.period}
                  type="button"
                  className={`w-full text-left rounded-[12px] border px-3 py-2.5 transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[inset_3px_0_0_var(--accent)]"
                      : "border-transparent hover:bg-[rgba(15,122,108,0.06)]"
                  }`}
                  onClick={() => openDetail(p.period)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{formatPeriodLabel(p.period)}</span>
                    <span className="badge">{p.unitCount} daire</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                    <span className="muted">Borç {formatMoney(p.principalTotal)}</span>
                    <span className="muted text-right">Kalan {formatMoney(p.principalOpen)}</span>
                  </div>
                </button>
              );
            })}
            {filteredPeriods.length === 0 ? (
              <p className="muted text-sm px-1 py-4">Henüz dönem yok.</p>
            ) : null}
          </div>
        </aside>

        <main className="space-y-4 min-w-0">
          {mode === "create" ? (
            <section className="surface p-5 space-y-4 rise">
              <div>
                <h2 className="text-xl font-semibold">Yeni dönem başlat</h2>
                <p className="muted text-sm mt-1">
                  Aidat daire başı; site işi ayrı. Önceki dönem kalanı daire bazında Diğer’e
                  aktarılır.
                </p>
              </div>

              {latestPeriod && includeCarryForward ? (
                <div className="rounded-[14px] bg-[var(--accent-soft)] p-3 text-sm space-y-1">
                  <p className="font-semibold">
                    Devir kaynağı: {formatPeriodLabel(latestPeriod.period)}
                  </p>
                  <p>
                    Kalan toplam <strong>{formatMoney(latestPeriod.principalOpen)}</strong> → daire
                    bazında Diğer kalemine eklenecek.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="text-sm space-y-1">
                  <span className="muted">Dönem (YYYY-MM)</span>
                  <input
                    className="input"
                    value={period}
                    onChange={(e) => onPeriodChange(e.target.value)}
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="muted">Yayın tarihi</span>
                  <input
                    className="input"
                    type="date"
                    value={publishDate}
                    onChange={(e) => setPublishDate(e.target.value)}
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="muted">Son ödeme tarihi</span>
                  <input
                    className="input"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="muted">Aidat (daire başı)</span>
                  <input className="input" value={aidat} onChange={(e) => setAidat(e.target.value)} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="muted">Site işi / diğer (daire başı)</span>
                  <input className="input" value={diger} onChange={(e) => setDiger(e.target.value)} />
                </label>
                <label className="text-sm space-y-1">
                  <span className="muted">Faiz oranı (%)</span>
                  <input
                    className="input"
                    value={lateFeeRate}
                    onChange={(e) => setLateFeeRate(e.target.value)}
                  />
                </label>
                <label className="text-sm space-y-1 md:col-span-2 xl:col-span-3">
                  <span className="muted">Site işi / diğer açıklama</span>
                  <input
                    className="input"
                    value={digerDescription}
                    onChange={(e) => setDigerDescription(e.target.value)}
                    placeholder="Asansör bakımı, boya, genel gider…"
                  />
                </label>
              </div>

              <div className="border border-[var(--line)] rounded-[14px] p-4 space-y-3">
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={includeCarryForward}
                    disabled={!latestPeriod || Number(latestPeriod.principalOpen) <= 0}
                    onChange={(e) => setIncludeCarryForward(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold block">Önceki dönemden devir</span>
                    <span className="muted text-xs">
                      {!latestPeriod
                        ? "Henüz devredilecek dönem yok."
                        : Number(latestPeriod.principalOpen) <= 0
                          ? `${formatPeriodLabel(latestPeriod.period)} için kalan yok.`
                          : `${formatPeriodLabel(latestPeriod.period)} açık bakiyesi daire bazında Diğer’e yazılır; eski dönem kapanır.`}
                    </span>
                  </span>
                </label>
                <label className="text-sm space-y-1">
                  <span className="muted">Devir açıklaması</span>
                  <input
                    className="input"
                    value={carryForwardDescription}
                    disabled={!includeCarryForward}
                    onChange={(e) => setCarryForwardDescription(e.target.value)}
                    placeholder="Bir önceki dönemden devir"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="btn"
                  type="button"
                  disabled={!siteId || unitIds.length === 0 || previewMutation.isPending}
                  onClick={() => previewMutation.mutate()}
                >
                  Önizle ({unitIds.length} daire)
                </button>
                <button
                  className="btn btn-warm"
                  type="button"
                  disabled={!preview || commitMutation.isPending}
                  onClick={() => commitMutation.mutate()}
                >
                  Onayla ve oluştur
                </button>
              </div>

              {preview ? (
                <div className="rounded-[14px] bg-[var(--accent-soft)] p-3 space-y-2">
                  <p className="text-sm font-semibold">Önizleme</p>
                  <p className="muted text-xs">{preview.lateFeeNote}</p>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Kalem</th>
                          <th className="money">Daire başı</th>
                          <th className="money">Toplam</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.components.map((c) => (
                          <tr key={c.code}>
                            <td>{c.label}</td>
                            <td className="money">
                              {c.perUnit === "değişken" ? "değişken" : formatMoney(c.perUnit)}
                            </td>
                            <td className="money">{formatMoney(c.total)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="font-semibold">Genel toplam</td>
                          <td className="money font-semibold">
                            {formatMoney(preview.perUnitTotal)}
                          </td>
                          <td className="money font-semibold">
                            {formatMoney(preview.grandTotal)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {preview.aidatExemptNote ? (
                    <p className="text-xs text-[var(--warm)]">{preview.aidatExemptNote}</p>
                  ) : null}
                  {preview.carryForwardFromPeriod ? (
                    <p className="text-xs">
                      Devir: {formatPeriodLabel(preview.carryForwardFromPeriod)} ·{" "}
                      {preview.carryForwardUnitCount} daire ·{" "}
                      {formatMoney(preview.carryForwardTotal)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="border-t border-[var(--line)] pt-4 space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <p className="text-sm font-semibold">Yakıt — Excel aktar</p>
                  <p className="muted text-xs">
                    Daire No, Yakıt Tutarı · Dönem: {formatPeriodLabel(yakitTargetPeriod)}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                  <label className="text-sm space-y-1">
                    <span className="muted">Excel (.xlsx / .xls)</span>
                    <input
                      ref={yakitFileRef}
                      className="input"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        setYakitFile(e.target.files?.[0] ?? null);
                        setYakitPreview(null);
                      }}
                    />
                  </label>
                  <button
                    className="btn btn-sm"
                    type="button"
                    disabled={!siteId || !yakitFile || yakitPreviewMutation.isPending}
                    onClick={() => yakitPreviewMutation.mutate()}
                  >
                    Önizle
                  </button>
                  <button
                    className="btn btn-warm btn-sm"
                    type="button"
                    disabled={!yakitPreview || yakitImportMutation.isPending}
                    onClick={() => yakitImportMutation.mutate()}
                  >
                    Aktar
                  </button>
                </div>
                {yakitPreview ? (
                  <div className="rounded-[14px] bg-[var(--accent-soft)] p-3 space-y-2">
                    <p className="text-xs">
                      {yakitPreview.totalRows} satır · Yeni {yakitPreview.createCount} · Güncelle{" "}
                      {yakitPreview.updateCount} · Atla {yakitPreview.skipCount} · Toplam{" "}
                      <strong>{formatMoney(yakitPreview.applyTotal)}</strong>
                    </p>
                    <div className="table-wrap max-h-48 overflow-auto">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>Daire</th>
                            <th className="money">Yakıt</th>
                            <th>İşlem</th>
                            <th>Not</th>
                          </tr>
                        </thead>
                        <tbody>
                          {yakitPreview.rows.map((row) => (
                            <tr key={`${row.rowNumber}-${row.unitNo}`}>
                              <td className="font-semibold">{row.unitNo}</td>
                              <td className="money">{formatMoney(row.amount)}</td>
                              <td>
                                <span className="badge">
                                  {row.action === "CREATE"
                                    ? "Yeni"
                                    : row.action === "UPDATE"
                                      ? "Güncelle"
                                      : "Atla"}
                                </span>
                              </td>
                              <td className="muted text-xs">{row.reason ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="space-y-3 rise">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">
                    {detailPeriod ? formatPeriodLabel(detailPeriod) : "Dönem"} — detay
                  </h2>
                  <p className="muted text-sm">
                    Satır seçerek dönemden çıkarın / tekrar ekleyin. Faiz %
                    {statement?.lateFeeRatePercent ?? lateFeeRate}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="text-sm space-y-1 min-w-[200px]">
                    <span className="muted">Sakin ara</span>
                    <input
                      className="input"
                      value={residentSearch}
                      onChange={(e) => setResidentSearch(e.target.value)}
                      placeholder="Ad soyad…"
                    />
                  </label>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => {
                      void statementQuery.refetch();
                      void availableUnitsQuery.refetch();
                    }}
                  >
                    Yenile
                  </button>
                  <button
                    className="btn btn-warm btn-sm"
                    type="button"
                    disabled={!statement || statement.rows.length === 0 || !detailPeriod}
                    title="Dönem aidat listesini PDF olarak yazdır"
                    onClick={() => {
                      if (!statement || !detailPeriod) return;
                      printPeriodStatement({
                        kurumName: kurumQuery.data?.name ?? "Site",
                        period: detailPeriod,
                        statement,
                        bankAccount: bankAccountsQuery.data?.[0] ?? null,
                      });
                    }}
                  >
                    Dönem Yazdır
                  </button>
                  <button
                    className="btn btn-sm"
                    type="button"
                    disabled={!siteId || !detailPeriod || deletePeriodMutation.isPending}
                    title={
                      selectedPeriodSummary?.canDelete === false
                        ? "Ödeme hareketi olan dönem silinemez"
                        : "Dönemdeki tüm tahakkukları sil"
                    }
                    onClick={requestDeletePeriod}
                  >
                    {deletePeriodMutation.isPending ? "Siliniyor…" : "Dönemi sil"}
                  </button>
                </div>
              </div>

              {deleteConfirmOpen ? (
                <div className="surface-solid p-4 border border-[var(--danger)] space-y-3 rise">
                  <p className="font-semibold text-[var(--danger)]">Dönemi silme onayı</p>
                  <p className="text-sm">
                    <strong>{detailPeriod ? formatPeriodLabel(detailPeriod) : "Dönem"}</strong>{" "}
                    döneminin tüm tahakkuk kayıtları kalıcı silinecek ve sol listeden kalkacak. Aynı
                    dönemi sonra yeniden oluşturabilirsiniz.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={deletePeriodMutation.isPending}
                      onClick={() => deletePeriodMutation.mutate()}
                    >
                      {deletePeriodMutation.isPending ? "Siliniyor…" : "Evet, dönemi sil"}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={deletePeriodMutation.isPending}
                      onClick={() => setDeleteConfirmOpen(false)}
                    >
                      Vazgeç
                    </button>
                  </div>
                </div>
              ) : null}

              {detailMessage ? (
                <p
                  className={
                    detailMessage.type === "ok"
                      ? "text-[var(--accent-strong)] text-sm"
                      : "text-[var(--danger)] text-sm font-medium"
                  }
                >
                  {detailMessage.text}
                </p>
              ) : null}

              <div className="surface p-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_auto] md:items-end">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Seçili daire</p>
                    {selectedRow ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="badge">Daire {selectedRow.unitNo}</span>
                        <span>{selectedRow.residentName ?? "Sakin yok"}</span>
                        <span className="muted">{paymentStatusLabel(selectedRow.paymentStatus)}</span>
                        {selectedRow.personId ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => void openResidentCard(selectedRow.personId!)}
                          >
                            Sakin kartı
                          </button>
                        ) : null}
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={
                            !selectedRow.canRemove || removeFromPeriodMutation.isPending || !siteId
                          }
                          onClick={() => removeFromPeriodMutation.mutate(selectedRow.unitId)}
                        >
                          {removeFromPeriodMutation.isPending ? "Çıkarılıyor…" : "Dönemden çıkar"}
                        </button>
                      </div>
                    ) : (
                      <p className="muted text-sm">Listeden bir daire satırına tıklayın.</p>
                    )}
                  </div>

                  <label className="text-sm space-y-1">
                    <span className="muted">Döneme tekrar ekle</span>
                    <select
                      className="select"
                      value={addUnitId}
                      onChange={(e) => setAddUnitId(e.target.value)}
                    >
                      <option value="">
                        {availableUnits.length === 0
                          ? "Eklenecek daire yok"
                          : "Daire / sakin seçin…"}
                      </option>
                      {availableUnits.map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          {u.unitNo}
                          {u.residentName ? ` — ${u.residentName}` : " — sakin yok"}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    className="btn btn-warm btn-sm"
                    type="button"
                    disabled={!addUnitId || addToPeriodMutation.isPending || !siteId}
                    onClick={() => addToPeriodMutation.mutate(Number(addUnitId))}
                  >
                    {addToPeriodMutation.isPending ? "Ekleniyor…" : "Ekle"}
                  </button>
                </div>

                {selectedRow ? (
                  <div className="grid gap-4 lg:grid-cols-2 border-t border-[var(--line)] pt-4">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Satır açıklaması</p>
                      <textarea
                        className="input min-h-[72px]"
                        value={rowNote}
                        onChange={(e) => setRowNote(e.target.value)}
                        placeholder="Bu daire/dönem için not…"
                      />
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={saveNoteMutation.isPending || !siteId}
                        onClick={() => saveNoteMutation.mutate()}
                      >
                        {saveNoteMutation.isPending ? "Kaydediliyor…" : "Açıklamayı kaydet"}
                      </button>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Ödeme alındı</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-sm space-y-1">
                          <span className="muted">Tutar</span>
                          <input
                            className="input"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            disabled={!selectedRow.canCollect}
                          />
                        </label>
                        <label className="text-sm space-y-1">
                          <span className="muted">Yöntem</span>
                          <select
                            className="select"
                            value={payMethod}
                            onChange={(e) =>
                              setPayMethod(e.target.value as "CASH" | "BANK_TRANSFER" | "CREDIT_CARD")
                            }
                            disabled={!selectedRow.canCollect}
                          >
                            <option value="BANK_TRANSFER">Havale / EFT</option>
                            <option value="CASH">Nakit</option>
                            <option value="CREDIT_CARD">Kredi kartı</option>
                          </select>
                        </label>
                      </div>
                      <label className="text-sm space-y-1 block">
                        <span className="muted">Ödeme açıklaması</span>
                        <input
                          className="input"
                          value={payDescription}
                          onChange={(e) => setPayDescription(e.target.value)}
                          placeholder="Opsiyonel"
                          disabled={!selectedRow.canCollect}
                        />
                      </label>
                      <div className="flex flex-wrap gap-2 items-center">
                        <button
                          className="btn btn-warm btn-sm"
                          type="button"
                          disabled={
                            !selectedRow.canCollect || collectMutation.isPending || !siteId || !payAmount
                          }
                          onClick={() => {
                            if (
                              confirm(
                                `Daire ${selectedRow.unitNo} için ${formatMoney(toMoneyInput(payAmount))} tahsil edilsin mi?`,
                              )
                            ) {
                              collectMutation.mutate();
                            }
                          }}
                        >
                          {collectMutation.isPending ? "Kaydediliyor…" : "Ödeme alındı"}
                        </button>
                        {!selectedRow.canCollect ? (
                          <span className="muted text-xs">Bu dönemde açık borç yok</span>
                        ) : (
                          <span className="muted text-xs">
                            Açık anapara {formatMoney(selectedRow.principalOpen)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {residentEdit ? (
                <div className="surface p-4 space-y-3 border border-[var(--accent)]">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">Sakin kartı</h3>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => setResidentEdit(null)}
                    >
                      Kapat
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm space-y-1">
                      <span className="muted">Ad</span>
                      <input
                        className="input"
                        value={residentEdit.firstName}
                        onChange={(e) =>
                          setResidentEdit({ ...residentEdit, firstName: e.target.value })
                        }
                      />
                    </label>
                    <label className="text-sm space-y-1">
                      <span className="muted">Soyad</span>
                      <input
                        className="input"
                        value={residentEdit.lastName}
                        onChange={(e) =>
                          setResidentEdit({ ...residentEdit, lastName: e.target.value })
                        }
                      />
                    </label>
                    <label className="text-sm space-y-1">
                      <span className="muted">Telefon</span>
                      <input
                        className="input"
                        value={residentEdit.phone}
                        onChange={(e) => setResidentEdit({ ...residentEdit, phone: e.target.value })}
                      />
                    </label>
                    <label className="text-sm space-y-1">
                      <span className="muted">E-posta</span>
                      <input
                        className="input"
                        value={residentEdit.email}
                        onChange={(e) => setResidentEdit({ ...residentEdit, email: e.target.value })}
                      />
                    </label>
                  </div>
                  <button
                    className="btn btn-sm"
                    type="button"
                    disabled={saveResidentMutation.isPending}
                    onClick={() => saveResidentMutation.mutate()}
                  >
                    {saveResidentMutation.isPending ? "Kaydediliyor…" : "Sakini kaydet"}
                  </button>
                </div>
              ) : null}

              <div className="border-t border-[var(--line)] pt-3 space-y-2">
                <p className="text-sm font-semibold">
                  Yakıt Excel · {detailPeriod ? formatPeriodLabel(detailPeriod) : ""}
                </p>
                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                  <input
                    ref={yakitFileRef}
                    className="input"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      setYakitFile(e.target.files?.[0] ?? null);
                      setYakitPreview(null);
                    }}
                  />
                  <button
                    className="btn btn-sm"
                    type="button"
                    disabled={!yakitFile || yakitPreviewMutation.isPending}
                    onClick={() => yakitPreviewMutation.mutate()}
                  >
                    Önizle
                  </button>
                  <button
                    className="btn btn-warm btn-sm"
                    type="button"
                    disabled={!yakitPreview || yakitImportMutation.isPending}
                    onClick={() => yakitImportMutation.mutate()}
                  >
                    Aktar
                  </button>
                </div>
              </div>

              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Daire</th>
                      <th>Sakin</th>
                      <th>Açıklama</th>
                      <th className="money">Aidat</th>
                      <th className="money">Yakıt</th>
                      <th className="money">Diğer</th>
                      <th className="money">Devir</th>
                      <th className="money">Toplam borç</th>
                      <th className="money">Ödenen</th>
                      <th className="money">Kalan anapara</th>
                      <th className="money">Faiz</th>
                      <th className="money">Kalan toplam</th>
                      <th>Ödeme</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStatementRows.map((row) => (
                      <tr
                        key={row.unitId}
                        className={`is-clickable${selectedUnitId === row.unitId ? " is-selected" : ""}`}
                        onClick={() => setSelectedUnitId(row.unitId)}
                      >
                        <td className="font-semibold">{row.unitNo}</td>
                        <td>{row.residentName ?? "—"}</td>
                        <td className="max-w-[180px] truncate" title={row.note ?? undefined}>
                          {row.note?.trim() ? row.note : <span className="muted">—</span>}
                        </td>
                        <td className="money">{formatMoney(row.aidatAmount)}</td>
                        <td className="money">{formatMoney(row.yakitAmount)}</td>
                        <td className="money">{formatMoney(row.digerAmount)}</td>
                        <td className="money">{formatMoney(row.devirAmount)}</td>
                        <td className="money">{formatMoney(row.principalTotal)}</td>
                        <td className="money">{formatMoney(row.paidAmount)}</td>
                        <td className="money">{formatMoney(row.principalOpen)}</td>
                        <td className="money">{formatMoney(row.faiz)}</td>
                        <td className="money font-semibold">{formatMoney(row.remaining)}</td>
                        <td>
                          <span className="badge">{paymentStatusLabel(row.paymentStatus)}</span>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <button
                              className="btn btn-warm btn-sm"
                              type="button"
                              disabled={!row.canCollect}
                              title={row.canCollect ? "Ödeme al" : "Açık borç yok"}
                              onClick={(e) => {
                                e.stopPropagation();
                                openPayModal(row);
                              }}
                            >
                              Ödeme Al
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={Number(row.paidAmount) <= 0}
                              title={
                                Number(row.paidAmount) > 0
                                  ? "Tahsilat iptal"
                                  : "İptal edilecek tahsilat yok"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                openReverseModal(row);
                              }}
                            >
                              İptal
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredStatementRows.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="muted text-center py-8">
                          {statementQuery.isLoading
                            ? "Yükleniyor…"
                            : residentSearch.trim()
                              ? "Kayıt bulunamadı."
                              : "Bu dönem için tahakkuk yok."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  {statement && filteredStatementRows.length > 0 && !residentSearch.trim() ? (
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="font-semibold">
                          Toplam
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.aidat)}
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.yakit)}
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.diger)}
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.devir)}
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.principalTotal)}
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.paidAmount)}
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.principalOpen)}
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.faiz)}
                        </td>
                        <td className="money font-semibold">
                          {formatMoney(statement.totals.remaining)}
                        </td>
                        <td />
                        <td />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>

              {payModalOpen && selectedRow ? (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4"
                  style={{ background: "rgba(18, 24, 22, 0.45)" }}
                  onClick={() => {
                    if (!collectMutation.isPending) setPayModalOpen(false);
                  }}
                >
                  <div
                    className="surface p-5 w-full max-w-md space-y-4 rise"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="pay-modal-title"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 id="pay-modal-title" className="text-lg font-semibold">
                          Ödeme Al
                        </h3>
                        <p className="muted text-sm mt-1">
                          Daire {selectedRow.unitNo}
                          {selectedRow.residentName ? ` · ${selectedRow.residentName}` : ""}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={collectMutation.isPending}
                        onClick={() => setPayModalOpen(false)}
                      >
                        Kapat
                      </button>
                    </div>

                    <p className="text-sm">
                      Açık anapara:{" "}
                      <span className="font-semibold">{formatMoney(selectedRow.principalOpen)}</span>
                    </p>

                    <label className="text-sm space-y-1 block">
                      <span className="muted">Tutar</span>
                      <input
                        className="input"
                        inputMode="decimal"
                        autoFocus
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                      />
                    </label>

                    <label className="text-sm space-y-1 block">
                      <span className="muted">Yöntem</span>
                      <select
                        className="select"
                        value={payMethod}
                        onChange={(e) =>
                          setPayMethod(e.target.value as "CASH" | "BANK_TRANSFER" | "CREDIT_CARD")
                        }
                      >
                        <option value="BANK_TRANSFER">Havale / EFT</option>
                        <option value="CASH">Nakit</option>
                        <option value="CREDIT_CARD">Kredi kartı</option>
                      </select>
                    </label>

                    <div className="flex flex-wrap gap-2 justify-end">
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={collectMutation.isPending}
                        onClick={() => setPayModalOpen(false)}
                      >
                        Vazgeç
                      </button>
                      <button
                        className="btn btn-warm btn-sm"
                        type="button"
                        disabled={
                          collectMutation.isPending ||
                          !siteId ||
                          !payAmount.trim() ||
                          !selectedRow.canCollect
                        }
                        onClick={() => collectMutation.mutate()}
                      >
                        {collectMutation.isPending ? "Kaydediliyor…" : "Tahsil et"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {reverseModalOpen && selectedRow && reverseUnitId === selectedRow.unitId ? (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4"
                  style={{ background: "rgba(18, 24, 22, 0.45)" }}
                  onClick={() => {
                    if (!reverseMutation.isPending) {
                      setReverseModalOpen(false);
                      setReverseUnitId(null);
                    }
                  }}
                >
                  <div
                    className="surface p-5 w-full max-w-lg space-y-4 rise"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="reverse-modal-title"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 id="reverse-modal-title" className="text-lg font-semibold">
                          Tahsilat İptal
                        </h3>
                        <p className="muted text-sm mt-1">
                          Daire {selectedRow.unitNo}
                          {selectedRow.residentName ? ` · ${selectedRow.residentName}` : ""}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={reverseMutation.isPending}
                        onClick={() => {
                          setReverseModalOpen(false);
                          setReverseUnitId(null);
                        }}
                      >
                        Kapat
                      </button>
                    </div>

                    {unitPaymentsQuery.isLoading ? (
                      <p className="muted text-sm">Tahsilatlar yükleniyor…</p>
                    ) : null}

                    <div className="space-y-2 max-h-[360px] overflow-auto">
                      {(unitPaymentsQuery.data?.items ?? []).map((p) => (
                        <div
                          key={p.id}
                          className="surface-solid rounded-[14px] p-3 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="text-sm">
                            <p className="font-semibold">{formatMoney(p.amount)}</p>
                            <p className="muted text-xs mt-0.5">
                              {new Date(p.paymentDate).toLocaleDateString("tr-TR")} ·{" "}
                              {payMethodLabel(p.paymentMethod)}
                              {p.receiptNo ? ` · Makbuz ${p.receiptNo}` : ""}
                            </p>
                            {p.description ? (
                              <p className="muted text-xs mt-0.5 truncate max-w-[280px]">
                                {p.description}
                              </p>
                            ) : null}
                          </div>
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={reverseMutation.isPending}
                            onClick={() => {
                              if (
                                confirm(
                                  `${formatMoney(p.amount)} tutarındaki tahsilat iptal edilsin mi?`,
                                )
                              ) {
                                reverseMutation.mutate(p.id);
                              }
                            }}
                          >
                            {reverseMutation.isPending ? "…" : "İptal et"}
                          </button>
                        </div>
                      ))}
                      {!unitPaymentsQuery.isLoading &&
                      (unitPaymentsQuery.data?.items.length ?? 0) === 0 ? (
                        <p className="muted text-sm text-center py-4">
                          Bu dönem için iptal edilebilir tahsilat yok.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
