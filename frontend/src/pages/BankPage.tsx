import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ListDetailLayout, ListItemButton } from "../components/ListDetailLayout";
import { api, apiUpload, formatMoney } from "../lib/api";
import { bankMatchStatusLabel } from "../lib/statusLabels";

type Kurum = { id: number; name: string; siteId: number | null };
type BankAccount = {
  id: number;
  siteId: number;
  bankName: string;
  iban: string;
  accountName: string;
  currencyCode: string;
};
type BankPeriodSummary = {
  period: string;
  balanceAmount: string | null;
  balanceNote: string | null;
  txCount: number;
  unmatchedCount: number;
  importCount: number;
  usedCount?: number;
  canDelete?: boolean;
};
type BankTx = {
  id: number;
  transactionDate: string;
  senderName: string | null;
  description: string | null;
  amount: string;
  direction: string;
  matchStatus: string;
  matchScore: number | null;
  matchedUnitId: number | null;
  matchedExpenseId: number | null;
  suggestedCategoryCode: string | null;
  operationType: string | null;
  channel: string | null;
  bankReference: string | null;
  runningBalance: string | null;
};
type ExpenseCategory = { id: number; code: string; name: string };

function statusBadge(status: string) {
  if (status === "MATCHED") return "badge badge-ok";
  if (status === "EXPENSE") return "badge badge-ok";
  if (status === "SUGGESTED") return "badge";
  if (status === "REVIEW_REQUIRED") return "badge badge-warn";
  if (status === "IGNORED") return "badge";
  return "badge badge-danger";
}

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
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return "0.00";
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return n.toFixed(2);
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

export function BankPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"account" | "create-period" | "detail">("create-period");
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [detailPeriod, setDetailPeriod] = useState<string | null>(null);
  const [newPeriod, setNewPeriod] = useState(currentPeriod());
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [accountForm, setAccountForm] = useState({
    bankName: "",
    accountName: "",
    iban: "",
  });
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceNote, setBalanceNote] = useState("");
  const [flowTab, setFlowTab] = useState<"income" | "expense">("income");
  const [filter, setFilter] = useState("");
  const [gridSearch, setGridSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [expenseCategoryId, setExpenseCategoryId] = useState<number | "">("");
  const [rowCategories, setRowCategories] = useState<Record<number, number>>({});
  const [file, setFile] = useState<File | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    totalRows: number;
    duplicateCount: number;
    newCount: number;
    incomeCount?: number;
    expenseCount?: number;
    suggestedClosingBalance?: string | null;
  } | null>(null);
  const [bulkPreview, setBulkPreview] = useState<{
    totalSelected: number;
    okCount: number;
    problemCount: number;
    totalAmount: string;
  } | null>(null);

  const kurumQuery = useQuery({
    queryKey: ["kurum-me"],
    queryFn: () => api<Kurum>("/kurum/me"),
  });
  const siteId = kurumQuery.data?.siteId ?? undefined;

  const accountsQuery = useQuery({
    queryKey: ["bank-accounts", siteId],
    enabled: !!siteId,
    queryFn: () => api<BankAccount[]>(`/bank-accounts?siteId=${siteId}`),
  });

  const categoriesQuery = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api<ExpenseCategory[]>("/expense-categories"),
  });
  const categories = categoriesQuery.data ?? [];

  useEffect(() => {
    if (expenseCategoryId === "" && categories[0]) {
      setExpenseCategoryId(categories[0].id);
    }
  }, [categories, expenseCategoryId]);

  const accounts = accountsQuery.data ?? [];
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  useEffect(() => {
    if (selectedAccountId == null && accounts[0]) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const periodsQuery = useQuery({
    queryKey: ["bank-periods", siteId, selectedAccountId],
    enabled: !!siteId && !!selectedAccountId,
    queryFn: () =>
      api<{ items: BankPeriodSummary[] }>(
        `/banking/periods?siteId=${siteId}&bankAccountId=${selectedAccountId}`,
      ),
  });

  const periods = periodsQuery.data?.items ?? [];
  const yearOptions = useMemo(() => {
    const years = new Set(periods.map((p) => p.period.slice(0, 4)));
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [periods]);

  const filteredPeriods = useMemo(() => {
    return periods.filter((p) => {
      if (yearFilter !== "all" && p.period.slice(0, 4) !== yearFilter) return false;
      return true;
    });
  }, [periods, yearFilter]);

  const selectedPeriodSummary = useMemo(
    () => periods.find((p) => p.period === detailPeriod) ?? null,
    [periods, detailPeriod],
  );

  useEffect(() => {
    if (mode === "detail" && selectedPeriodSummary) {
      setBalanceAmount(selectedPeriodSummary.balanceAmount ?? "");
      setBalanceNote(selectedPeriodSummary.balanceNote ?? "");
    }
  }, [mode, selectedPeriodSummary?.period, selectedPeriodSummary?.balanceAmount, selectedPeriodSummary?.balanceNote]);

  const txQuery = useQuery({
    queryKey: ["bank-tx", siteId, selectedAccountId, detailPeriod, filter],
    enabled: !!siteId && !!selectedAccountId && mode === "detail" && !!detailPeriod,
    queryFn: () => {
      const params = new URLSearchParams({
        siteId: String(siteId),
        bankAccountId: String(selectedAccountId),
        period: String(detailPeriod),
        pageSize: "200",
      });
      if (filter) params.set("matchStatus", filter);
      return api<{ items: BankTx[]; total: number }>(`/banking/transactions?${params}`);
    },
  });

  const createAccount = useMutation({
    mutationFn: () => {
      if (!siteId) throw new Error("Kurum operasyon kaydı (site) bulunamadı");
      const iban = accountForm.iban.replace(/\s+/g, "").toUpperCase();
      if (!accountForm.accountName.trim() || !accountForm.bankName.trim() || iban.length < 10) {
        throw new Error("Hesap ünvanı, banka adı ve geçerli IBAN zorunlu");
      }
      return api<BankAccount>("/bank-accounts", {
        method: "POST",
        body: JSON.stringify({
          siteId,
          bankName: accountForm.bankName.trim(),
          accountName: accountForm.accountName.trim(),
          iban,
          currencyCode: "TRY",
        }),
      });
    },
    onSuccess: async (created) => {
      setAccountForm({ bankName: "", accountName: "", iban: "" });
      setError(null);
      setMessage("Banka hesabı tanımlandı.");
      await qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      setSelectedAccountId(created.id);
      setMode("create-period");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Hesap oluşturulamadı"),
  });

  const saveBalance = useMutation({
    mutationFn: () => {
      if (!siteId || !selectedAccountId || !detailPeriod) throw new Error("Dönem seçili değil");
      return api(`/bank-accounts/${selectedAccountId}/period-balances`, {
        method: "PUT",
        body: JSON.stringify({
          siteId,
          period: detailPeriod,
          balanceAmount: toMoneyInput(balanceAmount),
          note: balanceNote.trim() || null,
        }),
      });
    },
    onSuccess: async () => {
      setMessage(`${formatPeriodLabel(detailPeriod!)} bakiyesi kaydedildi.`);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["bank-periods"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Bakiye kaydedilemedi"),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file || !siteId || !selectedAccountId || !detailPeriod) {
        throw new Error("Dosya, hesap ve dönem seçin");
      }
      const form = new FormData();
      form.append("file", file);
      form.append("siteId", String(siteId));
      form.append("bankAccountId", String(selectedAccountId));
      form.append("period", detailPeriod);
      return apiUpload<{
        inserted: number;
        skippedDuplicates: number;
        rowCount: number;
        suggestedClosingBalance?: string | null;
      }>("/banking/import", form);
    },
    onSuccess: async (res) => {
      setMessage(
        `${formatPeriodLabel(detailPeriod!)}: ${res.inserted} yeni · gelir/gider ayrıldı.`,
      );
      setPreview(null);
      setFile(null);
      setError(null);
      if (res.suggestedClosingBalance) {
        setBalanceAmount(res.suggestedClosingBalance);
      }
      await qc.invalidateQueries({ queryKey: ["bank-tx"] });
      await qc.invalidateQueries({ queryKey: ["bank-periods"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Import hatası"),
  });

  const reconcileMutation = useMutation({
    mutationFn: () =>
      api("/banking/reconcile", {
        method: "POST",
        body: JSON.stringify({
          siteId,
          bankAccountId: selectedAccountId,
          period: detailPeriod,
        }),
      }),
    onSuccess: async () => {
      setMessage("Eşleştirme motoru bu dönem için yeniden çalıştırıldı.");
      await qc.invalidateQueries({ queryKey: ["bank-tx"] });
      await qc.invalidateQueries({ queryKey: ["bank-periods"] });
    },
  });

  const bulkCollect = useMutation({
    mutationFn: async () => {
      const key = crypto.randomUUID();
      return api<{
        results: Array<{ transactionId: number; status: string; reason?: string }>;
      }>("/banking/bulk-collect", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ transactionIds: selected, strategy: "OLDEST_FIRST" }),
      });
    },
    onSuccess: async (res) => {
      const ok = res.results.filter((r) => r.status === "SUCCESS").length;
      const fail = res.results.filter((r) => r.status !== "SUCCESS").length;
      setMessage(`Toplu tahsilat: ${ok} başarılı, ${fail} atlandı/hata.`);
      setSelected([]);
      setBulkPreview(null);
      await qc.invalidateQueries({ queryKey: ["bank-tx"] });
      await qc.invalidateQueries({ queryKey: ["bank-periods"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Toplu tahsilat hatası"),
  });

  const saveExpensesMutation = useMutation({
    mutationFn: () => {
      if (!siteId || !selectedAccountId || !detailPeriod) throw new Error("Dönem seçili değil");
      if (selected.length === 0) throw new Error("Gider satırı seçin");
      const fallbackCategoryId =
        typeof expenseCategoryId === "number"
          ? expenseCategoryId
          : categories[0]?.id;
      if (!fallbackCategoryId) throw new Error("Gider kategorisi yok");
      return api<{ createdCount: number; skippedCount: number }>(
        "/banking/expenses/from-transactions",
        {
          method: "POST",
          body: JSON.stringify({
            siteId,
            bankAccountId: selectedAccountId,
            period: detailPeriod,
            categoryId: fallbackCategoryId,
            items: selected.map((transactionId) => ({
              transactionId,
              categoryId: rowCategories[transactionId] ?? fallbackCategoryId,
            })),
          }),
        },
      );
    },
    onSuccess: async (res) => {
      setMessage(
        `${res.createdCount} gider harcaması kaydedildi${res.skippedCount ? `, ${res.skippedCount} atlandı` : ""}.`,
      );
      setSelected([]);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["bank-tx"] });
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      await qc.invalidateQueries({ queryKey: ["expense-periods"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Gider kaydı başarısız"),
  });

  const deletePeriodMutation = useMutation({
    mutationFn: () => {
      if (!siteId || !selectedAccountId || !detailPeriod) {
        throw new Error("Dönem veya hesap seçili değil");
      }
      return api<{ deletedTxCount: number }>(
        `/banking/periods/${detailPeriod}?siteId=${siteId}&bankAccountId=${selectedAccountId}`,
        { method: "DELETE" },
      );
    },
    onSuccess: async (res) => {
      const removed = detailPeriod;
      setDeleteConfirmOpen(false);
      setMessage(
        `${removed ? formatPeriodLabel(removed) : "Dönem"} silindi (${res.deletedTxCount} hareket).`,
      );
      setError(null);
      setDetailPeriod(null);
      setMode("create-period");
      if (removed && siteId && selectedAccountId) {
        qc.setQueryData<{ items: BankPeriodSummary[] }>(
          ["bank-periods", siteId, selectedAccountId],
          (old) => {
            if (!old) return old;
            return { ...old, items: old.items.filter((p) => p.period !== removed) };
          },
        );
      }
      await qc.invalidateQueries({ queryKey: ["bank-periods"] });
      await qc.invalidateQueries({ queryKey: ["bank-tx"] });
    },
    onError: (err) => {
      setDeleteConfirmOpen(false);
      setError(err instanceof Error ? err.message : "Dönem silinemedi");
    },
  });

  const items = txQuery.data?.items ?? [];
  const visibleItems = useMemo(() => {
    const byFlow = items.filter((t) =>
      flowTab === "income" ? t.direction === "IN" : t.direction === "OUT",
    );
    const q = gridSearch.trim().toLocaleLowerCase("tr-TR");
    if (!q) return byFlow;
    return byFlow.filter((t) => {
      const dateLabel = new Date(t.transactionDate).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const haystack = [
        dateLabel,
        t.operationType,
        t.description,
        t.senderName,
        t.bankReference,
        t.channel,
        t.amount,
        t.runningBalance,
        t.matchStatus,
        t.matchScore != null ? String(t.matchScore) : null,
        t.matchedUnitId != null ? String(t.matchedUnitId) : null,
        t.suggestedCategoryCode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return haystack.includes(q);
    });
  }, [items, flowTab, gridSearch]);
  const selectableIncome = useMemo(
    () =>
      visibleItems.filter(
        (t) =>
          t.matchStatus === "SUGGESTED" ||
          (t.matchStatus === "REVIEW_REQUIRED" && t.matchedUnitId),
      ),
    [visibleItems],
  );
  const selectableExpenses = useMemo(
    () => visibleItems.filter((t) => t.matchStatus !== "EXPENSE" && !t.matchedExpenseId),
    [visibleItems],
  );

  function openPeriod(period: string) {
    setDetailPeriod(period);
    setMode("detail");
    setMessage(null);
    setError(null);
    setSelected([]);
    setBulkPreview(null);
    setPreview(null);
    setFile(null);
    setFilter("");
    setGridSearch("");
    setFlowTab("income");
    setRowCategories({});
    setDeleteConfirmOpen(false);

    if (siteId && selectedAccountId) {
      qc.setQueryData<{ items: BankPeriodSummary[] }>(
        ["bank-periods", siteId, selectedAccountId],
        (old) => {
          const items = old?.items ?? [];
          if (items.some((p) => p.period === period)) return old ?? { items };
          return {
            items: [
              {
                period,
                balanceAmount: null,
                balanceNote: null,
                txCount: 0,
                unmatchedCount: 0,
                importCount: 0,
                usedCount: 0,
                canDelete: true,
              },
              ...items,
            ].sort((a, b) => b.period.localeCompare(a.period)),
          };
        },
      );
    }
  }

  function startCreatePeriod() {
    setMode("create-period");
    setDetailPeriod(null);
    setNewPeriod(currentPeriod());
    setMessage(null);
    setError(null);
  }

  function startCreateAccount() {
    setMode("account");
    setDetailPeriod(null);
    setMessage(null);
    setError(null);
  }

  function openCreatedPeriod(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(newPeriod)) {
      setError("Geçerli bir dönem seçin.");
      return;
    }
    openPeriod(newPeriod);
  }

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function runPreviewFile() {
    if (!file || !siteId || !selectedAccountId || !detailPeriod) return;
    const form = new FormData();
    form.append("file", file);
    form.append("siteId", String(siteId));
    form.append("bankAccountId", String(selectedAccountId));
    form.append("period", detailPeriod);
    try {
      const res = await apiUpload<{
        totalRows: number;
        duplicateCount: number;
        newCount: number;
      }>("/banking/import/preview", form);
      setPreview(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Önizleme hatası");
    }
  }

  async function runBulkPreview() {
    try {
      const res = await api<{
        totalSelected: number;
        okCount: number;
        problemCount: number;
        totalAmount: string;
      }>("/banking/bulk-collect/preview", {
        method: "POST",
        body: JSON.stringify({ transactionIds: selected }),
      });
      setBulkPreview(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toplu önizleme hatası");
    }
  }

  return (
    <ListDetailLayout
      badge="Banka"
      title="Aylık banka mutabakatı"
      subtitle="Soldan dönemi seçin. Her ay için bakiye kaydedin ve Excel/CSV yükleyin."
      headerActions={
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-sm space-y-1 min-w-[220px]">
            <span className="muted">Banka hesabı</span>
            <select
              className="select"
              value={selectedAccountId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelectedAccountId(Number.isFinite(id) ? id : null);
                setMode("create-period");
                setDetailPeriod(null);
              }}
            >
              {accounts.length === 0 ? <option value="">Hesap yok</option> : null}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName} · …{a.iban.slice(-8)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-ghost" type="button" onClick={startCreateAccount}>
            + Hesap tanımla
          </button>
          <button
            className="btn"
            type="button"
            disabled={!selectedAccountId}
            onClick={startCreatePeriod}
          >
            + Yeni dönem
          </button>
        </div>
      }
      listTitle="Dönemler"
      detailTitle={
        mode === "account"
          ? "Banka hesabı"
          : mode === "create-period"
            ? "Yeni dönem"
            : detailPeriod
              ? formatPeriodLabel(detailPeriod)
              : "Dönem"
      }
      filters={
        <label className="text-sm space-y-1 block">
          <span className="muted">Yıl</span>
          <select className="select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">Tüm yıllar</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      }
      list={
        <>
          {filteredPeriods.map((p) => (
            <ListItemButton
              key={p.period}
              selected={mode === "detail" && detailPeriod === p.period}
              onClick={() => openPeriod(p.period)}
              title={formatPeriodLabel(p.period)}
              subtitle={`${p.txCount} hareket · ${p.importCount} dosya`}
              meta={
                <span className="badge">
                  {p.balanceAmount != null ? formatMoney(p.balanceAmount) : "Bakiye yok"}
                </span>
              }
            />
          ))}
          {filteredPeriods.length === 0 ? (
            <p className="muted text-sm px-1 py-4">
              {selectedAccountId
                ? "Henüz dönem yok. Sağdan yeni dönem açın."
                : "Önce banka hesabı tanımlayın."}
            </p>
          ) : null}
        </>
      }
      detail={
        <div className="space-y-4">
          {message ? (
            <div className="surface-solid p-3 text-sm border-l-4 border-[var(--accent)]">{message}</div>
          ) : null}
          {error ? (
            <div className="surface-solid p-3 text-sm border-l-4 border-[var(--danger)]">{error}</div>
          ) : null}

          {mode === "account" ? (
            <section className="surface p-5 space-y-4 rise">
              <div>
                <h2 className="text-xl font-semibold">Banka hesabı tanımla</h2>
                <p className="muted text-sm mt-1">Site hesabının banka adı, ünvan ve IBAN bilgisi.</p>
              </div>
              {kurumQuery.isLoading ? (
                <p className="muted text-sm">Kurum bilgisi yükleniyor…</p>
              ) : null}
              {!kurumQuery.isLoading && !siteId ? (
                <p className="text-[var(--danger)] text-sm">
                  Kurum operasyon kaydı (site) bulunamadı. Önce kurum/site tanımını kontrol edin.
                </p>
              ) : null}
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!siteId) {
                    setError("Kurum operasyon kaydı (site) bulunamadı.");
                    return;
                  }
                  createAccount.mutate();
                }}
              >
                <label className="text-sm space-y-1 sm:col-span-2">
                  <span className="muted">Hesap ünvanı</span>
                  <input
                    className="input"
                    required
                    value={accountForm.accountName}
                    onChange={(e) => setAccountForm((f) => ({ ...f, accountName: e.target.value }))}
                    placeholder="Site Aidat Hesabı"
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="muted">Banka adı</span>
                  <input
                    className="input"
                    required
                    value={accountForm.bankName}
                    onChange={(e) => setAccountForm((f) => ({ ...f, bankName: e.target.value }))}
                    placeholder="Ziraat Bankası"
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="muted">IBAN</span>
                  <input
                    className="input font-mono"
                    required
                    minLength={10}
                    maxLength={34}
                    value={accountForm.iban}
                    onChange={(e) => setAccountForm((f) => ({ ...f, iban: e.target.value }))}
                    placeholder="TR00…"
                  />
                </label>
                <div className="sm:col-span-2">
                  <button
                    className="btn"
                    type="submit"
                    disabled={createAccount.isPending || kurumQuery.isLoading || !siteId}
                  >
                    {createAccount.isPending
                      ? "Kaydediliyor…"
                      : kurumQuery.isLoading
                        ? "Yükleniyor…"
                        : "Hesabı kaydet"}
                  </button>
                </div>
              </form>
              {selectedAccount ? (
                <p className="muted text-sm">
                  Aktif hesap: {selectedAccount.accountName} · {formatIban(selectedAccount.iban)}
                </p>
              ) : null}
            </section>
          ) : null}

          {mode === "create-period" ? (
            <section className="surface p-5 space-y-4 rise">
              <div>
                <h2 className="text-xl font-semibold">Yeni banka dönemi</h2>
                <p className="muted text-sm mt-1">
                  Ay seçin. Sonra o aya ait bakiyeyi girip Excel/CSV yükleyebilirsiniz.
                </p>
              </div>
              {!selectedAccountId ? (
                <p className="muted">Önce banka hesabı tanımlayın.</p>
              ) : (
                <form className="flex flex-wrap gap-3 items-end" onSubmit={openCreatedPeriod}>
                  <label className="text-sm space-y-1">
                    <span className="muted">Dönem</span>
                    <input
                      className="input"
                      type="month"
                      required
                      value={newPeriod}
                      onChange={(e) => setNewPeriod(e.target.value)}
                    />
                  </label>
                  <button className="btn" type="submit">
                    Dönemi aç
                  </button>
                </form>
              )}
            </section>
          ) : null}

          {mode === "detail" && detailPeriod && selectedAccount ? (
            <>
              <section className="surface p-5 space-y-4 rise">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{formatPeriodLabel(detailPeriod)}</h2>
                    <p className="muted text-sm mt-1">
                      {selectedAccount.accountName} · {selectedAccount.bankName}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="rounded-[14px] bg-[var(--accent-soft)] px-4 py-3 text-right">
                      <div className="muted text-xs">Dönem bakiyesi</div>
                      <div className="text-2xl font-semibold mt-1">
                        {selectedPeriodSummary?.balanceAmount != null
                          ? formatMoney(selectedPeriodSummary.balanceAmount)
                          : "—"}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={deletePeriodMutation.isPending}
                      onClick={() => {
                        if (selectedPeriodSummary?.canDelete === false) {
                          setError(
                            "Bu dönemde tahsilat veya gider kaydı var. Dönem silinemez.",
                          );
                          return;
                        }
                        setError(null);
                        setDeleteConfirmOpen(true);
                      }}
                    >
                      Dönemi sil
                    </button>
                  </div>
                </div>

                {deleteConfirmOpen ? (
                  <div className="rounded-[14px] border border-[var(--danger)] p-4 space-y-3">
                    <p className="font-semibold text-[var(--danger)]">Dönemi silme onayı</p>
                    <p className="text-sm">
                      {formatPeriodLabel(detailPeriod)} dönemine ait yüklenen hareketler, import
                      dosyaları ve bakiye kaydı silinecek. Tahsilat/gider bağlantısı yoksa işlem
                      yapılır.
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
                        onClick={() => setDeleteConfirmOpen(false)}
                      >
                        Vazgeç
                      </button>
                    </div>
                  </div>
                ) : null}

                <form
                  className="grid gap-3 md:grid-cols-[1fr_1.2fr_auto] md:items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveBalance.mutate();
                  }}
                >
                  <label className="text-sm space-y-1">
                    <span className="muted">Kapanış bakiyesi (TL)</span>
                    <input
                      className="input"
                      required
                      inputMode="decimal"
                      value={balanceAmount}
                      onChange={(e) => setBalanceAmount(e.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="text-sm space-y-1">
                    <span className="muted">Not</span>
                    <input
                      className="input"
                      value={balanceNote}
                      onChange={(e) => setBalanceNote(e.target.value)}
                      placeholder="Ekstre kapanış bakiyesi"
                    />
                  </label>
                  <button className="btn" type="submit" disabled={saveBalance.isPending}>
                    {saveBalance.isPending ? "Kaydediliyor…" : "Bakiyeyi kaydet"}
                  </button>
                </form>
              </section>

              <section className="surface p-5 space-y-4 rise">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">Hesap hareketleri</h2>
                    <p className="muted text-sm mt-1">
                      Denizbank Excel formatı (Tarih / Açıklama / Tutar). Gelir ve gider ayrı
                      işlenir.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {flowTab === "income" ? (
                      <>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => reconcileMutation.mutate()}
                        >
                          Yeniden eşleştir
                        </button>
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={selected.length === 0}
                          onClick={() => void runBulkPreview()}
                        >
                          {selected.length || 0} tahsilatı önizle
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={selected.length === 0 || saveExpensesMutation.isPending}
                        onClick={() => saveExpensesMutation.mutate()}
                      >
                        {saveExpensesMutation.isPending
                          ? "Kaydediliyor…"
                          : `Gider harcaması olarak kaydet (${selected.length})`}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                  <label className="text-sm space-y-1">
                    <span className="muted">
                      Hesap Hareketleri Excel ({formatPeriodLabel(detailPeriod)})
                    </span>
                    <input
                      className="input"
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => void runPreviewFile()}
                  >
                    Dosya önizle
                  </button>
                  <button
                    className="btn btn-sm"
                    type="button"
                    disabled={!file || importMutation.isPending}
                    onClick={() => importMutation.mutate()}
                  >
                    İçe aktar
                  </button>
                </div>
                {preview ? (
                  <div className="rounded-[14px] bg-[var(--accent-soft)] p-3 text-sm">
                    Toplam {preview.totalRows} · Yeni {preview.newCount} · Mükerrer{" "}
                    {preview.duplicateCount}
                    {preview.incomeCount != null
                      ? ` · Gelir ${preview.incomeCount} · Gider ${preview.expenseCount}`
                      : null}
                    {preview.suggestedClosingBalance
                      ? ` · Ekstre bakiyesi ${formatMoney(preview.suggestedClosingBalance)}`
                      : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    className={`btn btn-sm ${flowTab === "income" ? "" : "btn-ghost"}`}
                    onClick={() => {
                      setFlowTab("income");
                      setSelected([]);
                      setFilter("");
                      setGridSearch("");
                    }}
                  >
                    Gelir ({items.filter((t) => t.direction === "IN").length})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${flowTab === "expense" ? "" : "btn-ghost"}`}
                    onClick={() => {
                      setFlowTab("expense");
                      setSelected([]);
                      setFilter("");
                      setGridSearch("");
                    }}
                  >
                    Gider ({items.filter((t) => t.direction === "OUT").length})
                  </button>
                </div>

                {flowTab === "income" ? (
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["", "Tümü"],
                      ["SUGGESTED", "Önerilen"],
                      ["REVIEW_REQUIRED", "Kontrol"],
                      ["UNMATCHED", "Eşleşmeyen"],
                      ["MATCHED", "Tahsil"],
                      ["IGNORED", "Yoksayılan"],
                    ].map(([value, label]) => (
                      <button
                        key={value || "all"}
                        type="button"
                        className={`btn btn-sm ${filter === value ? "" : "btn-ghost"}`}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => setSelected(selectableIncome.map((t) => t.id))}
                    >
                      Önerilenleri seç ({selectableIncome.length})
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 items-end">
                    <label className="text-sm space-y-1 min-w-[200px]">
                      <span className="muted">Varsayılan kategori</span>
                      <select
                        className="select"
                        value={expenseCategoryId}
                        onChange={(e) =>
                          setExpenseCategoryId(e.target.value ? Number(e.target.value) : "")
                        }
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => setSelected(selectableExpenses.map((t) => t.id))}
                    >
                      Açık giderleri seç ({selectableExpenses.length})
                    </button>
                  </div>
                )}
              </section>

              {bulkPreview && flowTab === "income" ? (
                <section className="surface-solid p-5 rise border border-[var(--warm)]">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <h2 className="text-xl">Toplu tahsilat önizleme</h2>
                      <p className="muted text-sm mt-1">
                        {bulkPreview.okCount} uygun / {bulkPreview.problemCount} problemli ·{" "}
                        {formatMoney(bulkPreview.totalAmount)}
                      </p>
                    </div>
                    <button
                      className="btn btn-warm"
                      type="button"
                      disabled={bulkCollect.isPending}
                      onClick={() => bulkCollect.mutate()}
                    >
                      Onayla ve tahsil et
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="table-wrap rise">
                <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
                  <label className="flex-1 min-w-[220px]">
                    <span className="sr-only">Hareketlerde ara</span>
                    <input
                      className="input w-full"
                      type="search"
                      placeholder="Açıklama, dekont, kanal, tutar, işlem…"
                      value={gridSearch}
                      onChange={(e) => setGridSearch(e.target.value)}
                      aria-label="Hareketlerde ara"
                    />
                  </label>
                  {gridSearch.trim() ? (
                    <>
                      <span className="muted text-sm whitespace-nowrap">
                        {visibleItems.length} sonuç
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => setGridSearch("")}
                      >
                        Temizle
                      </button>
                    </>
                  ) : null}
                </div>
                {txQuery.isLoading ? <div className="p-6 skeleton h-24" /> : null}
                <table className="data">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Tarih</th>
                      <th>İşlem</th>
                      <th className="hide-mobile">Açıklama</th>
                      <th className="hide-mobile">Dekont No</th>
                      <th className="hide-mobile">Kanal</th>
                      <th className="money">Tutar (TL)</th>
                      <th className="money hide-mobile">Güncel Bakiye</th>
                      {flowTab === "income" ? (
                        <>
                          <th>Skor</th>
                          <th>Daire</th>
                        </>
                      ) : (
                        <th>Kategori</th>
                      )}
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((tx) => {
                      const suggested =
                        categories.find((c) => c.code === tx.suggestedCategoryCode)?.id ??
                        (typeof expenseCategoryId === "number" ? expenseCategoryId : undefined);
                      const rowCat = rowCategories[tx.id] ?? suggested ?? "";
                      const signedAmount =
                        tx.direction === "OUT" ? `-${formatMoney(tx.amount)}` : formatMoney(tx.amount);
                      return (
                        <tr key={tx.id}>
                          <td>
                            <input
                              type="checkbox"
                              disabled={
                                flowTab === "income"
                                  ? tx.matchStatus === "MATCHED"
                                  : tx.matchStatus === "EXPENSE" || !!tx.matchedExpenseId
                              }
                              checked={selected.includes(tx.id)}
                              onChange={() => toggle(tx.id)}
                            />
                          </td>
                          <td>
                            {new Date(tx.transactionDate).toLocaleString("tr-TR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td>{tx.operationType ?? "—"}</td>
                          <td className="hide-mobile max-w-[280px] truncate">
                            {tx.description ?? "—"}
                          </td>
                          <td className="hide-mobile font-mono text-xs">
                            {tx.bankReference ?? "—"}
                          </td>
                          <td className="hide-mobile">{tx.channel ?? "—"}</td>
                          <td className="money">{signedAmount}</td>
                          <td className="money hide-mobile">
                            {tx.runningBalance != null ? formatMoney(tx.runningBalance) : "—"}
                          </td>
                          {flowTab === "income" ? (
                            <>
                              <td>{tx.matchScore ?? "—"}</td>
                              <td>{tx.matchedUnitId ?? "—"}</td>
                            </>
                          ) : (
                            <td>
                              {tx.matchStatus === "EXPENSE" ? (
                                <span className="muted text-sm">Kaydedildi</span>
                              ) : (
                                <select
                                  className="select"
                                  value={rowCat}
                                  onChange={(e) =>
                                    setRowCategories((prev) => ({
                                      ...prev,
                                      [tx.id]: Number(e.target.value),
                                    }))
                                  }
                                >
                                  {categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                          )}
                          <td>
                            <span className={statusBadge(tx.matchStatus)}>
                              {bankMatchStatusLabel(tx.matchStatus)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {visibleItems.length === 0 && !txQuery.isLoading ? (
                      <tr>
                        <td colSpan={11} className="muted py-8 text-center">
                          {gridSearch.trim()
                            ? "Aramanızla eşleşen hareket yok."
                            : flowTab === "income"
                              ? "Bu dönemde gelir hareketi yok. Excel yükleyin."
                              : "Bu dönemde gider hareketi yok. Excel yükleyin."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>
            </>
          ) : null}
        </div>
      }
    />
  );
}
