import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ListDetailLayout, ListItemButton } from "../components/ListDetailLayout";
import { api, formatMoney } from "../lib/api";
import { expenseStatusLabel } from "../lib/statusLabels";

type ExpensePeriod = {
  period: string;
  expenseCount: number;
  totalAmount: string;
};

type ExpenseCategory = { id: number; code: string; name: string };

type ExpenseRow = {
  id: number;
  expenseDate: string;
  categoryId: number;
  categoryCode: string | null;
  categoryName: string | null;
  amount: string;
  paymentStatus: string;
  period: string | null;
  description: string | null;
  status: string;
  bankTransactionId: number | null;
};

type ExpenseDraft = {
  categoryId: number;
  description: string;
  amount: string;
};

function normalizeMoneyInput(raw: string): string {
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Tutar geçersiz (örn. 1250.50)");
  }
  const [whole, frac = ""] = cleaned.split(".");
  return `${whole}.${(frac + "00").slice(0, 2)}`;
}

function toDraft(row: ExpenseRow): ExpenseDraft {
  return {
    categoryId: row.categoryId,
    description: row.description ?? "",
    amount: row.amount,
  };
}

function isDirty(row: ExpenseRow, draft: ExpenseDraft | undefined): boolean {
  if (!draft) return false;
  return (
    draft.categoryId !== row.categoryId ||
    (draft.description || "") !== (row.description ?? "") ||
    draft.amount.trim().replace(",", ".") !== row.amount
  );
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

export function ExpensesPage() {
  const qc = useQueryClient();
  const [detailPeriod, setDetailPeriod] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, ExpenseDraft>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const kurumQuery = useQuery({
    queryKey: ["kurum-me"],
    queryFn: () => api<{ id: number; siteId: number | null }>("/kurum/me"),
  });
  const siteId = kurumQuery.data?.siteId ?? undefined;

  const periodsQuery = useQuery({
    queryKey: ["expense-periods", siteId],
    enabled: !!siteId,
    queryFn: () => api<{ items: ExpensePeriod[] }>(`/expenses/periods?siteId=${siteId}`),
  });

  const categoriesQuery = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api<ExpenseCategory[]>("/expense-categories"),
  });

  const listQuery = useQuery({
    queryKey: ["expenses", siteId, detailPeriod],
    enabled: !!siteId && !!detailPeriod,
    queryFn: () =>
      api<ExpenseRow[]>(`/expenses?siteId=${siteId}&period=${detailPeriod}`),
  });

  const items = listQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  useEffect(() => {
    setDrafts(Object.fromEntries(items.map((row) => [row.id, toDraft(row)])));
    setMessage(null);
    setError(null);
  }, [listQuery.dataUpdatedAt, detailPeriod]);

  const cancelMutation = useMutation({
    mutationFn: (id: number) =>
      api(`/expenses/${id}/cancel`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: async () => {
      setMessage("Gider iptal edildi.");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      await qc.invalidateQueries({ queryKey: ["expense-periods"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "İptal başarısız"),
  });

  const saveMutation = useMutation({
    mutationFn: async (id: number) => {
      const draft = drafts[id];
      if (!draft) throw new Error("Satır bulunamadı");
      const amount = normalizeMoneyInput(draft.amount);
      return api(`/expenses/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          categoryId: draft.categoryId,
          description: draft.description.trim() || null,
          amount,
        }),
      });
    },
    onMutate: (id) => {
      setSavingId(id);
      setError(null);
    },
    onSuccess: async () => {
      setMessage("Gider kaydedildi.");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["expenses"] });
      await qc.invalidateQueries({ queryKey: ["expense-periods"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kayıt başarısız"),
    onSettled: () => setSavingId(null),
  });

  const periods = periodsQuery.data?.items ?? [];
  const selected = useMemo(
    () => periods.find((p) => p.period === detailPeriod) ?? null,
    [periods, detailPeriod],
  );

  function updateDraft(id: number, patch: Partial<ExpenseDraft>) {
    setDrafts((prev) => {
      const current = prev[id];
      if (!current) return prev;
      return { ...prev, [id]: { ...current, ...patch } };
    });
  }

  return (
    <ListDetailLayout
      badge="Gider"
      title="Gider harcamaları"
      subtitle="Banka ekstresinden kaydedilen dönem bazlı giderler. Yeni kayıt için Banka ekranını kullanın."
      headerActions={
        <a className="btn" href="/finance/bank">
          Banka ekranına git
        </a>
      }
      listTitle="Dönemler"
      detailTitle={detailPeriod ? formatPeriodLabel(detailPeriod) : "Dönem seçin"}
      list={
        <>
          {periods.map((p) => (
            <ListItemButton
              key={p.period}
              selected={detailPeriod === p.period}
              onClick={() => setDetailPeriod(p.period)}
              title={formatPeriodLabel(p.period)}
              subtitle={`${p.expenseCount} gider`}
              meta={<span className="badge">{formatMoney(p.totalAmount)}</span>}
            />
          ))}
          {periods.length === 0 ? (
            <p className="muted text-sm px-1 py-4">
              Henüz dönem gideri yok. Banka → Gider sekmesinden kaydedin.
            </p>
          ) : null}
        </>
      }
      detail={
        detailPeriod ? (
          <div className="space-y-4">
            <section className="surface p-5 rise flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{formatPeriodLabel(detailPeriod)}</h2>
                <p className="muted text-sm mt-1">
                  Kategori, açıklama ve tutarı satırda değiştirip Kaydet’e basın.
                </p>
              </div>
              <div className="rounded-[14px] bg-[var(--accent-soft)] px-4 py-3 text-right">
                <div className="muted text-xs">Dönem toplamı</div>
                <div className="text-2xl font-semibold mt-1">
                  {selected ? formatMoney(selected.totalAmount) : "—"}
                </div>
              </div>
            </section>

            {message ? <p className="text-sm text-[var(--success)]">{message}</p> : null}
            {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

            <section className="table-wrap rise">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Kategori</th>
                    <th>Açıklama</th>
                    <th className="money">Tutar</th>
                    <th>Kaynak</th>
                    <th>Durum</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => {
                    const draft = drafts[e.id] ?? toDraft(e);
                    const dirty = isDirty(e, draft);
                    const cancelled = e.status === "CANCELLED";
                    return (
                      <tr key={e.id}>
                        <td>{new Date(e.expenseDate).toLocaleDateString("tr-TR")}</td>
                        <td>
                          {cancelled ? (
                            e.categoryName ?? e.categoryCode ?? "—"
                          ) : (
                            <select
                              className="select"
                              value={draft.categoryId}
                              onChange={(ev) =>
                                updateDraft(e.id, { categoryId: Number(ev.target.value) })
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
                        <td>
                          {cancelled ? (
                            <span className="max-w-[320px] truncate block">
                              {e.description ?? "—"}
                            </span>
                          ) : (
                            <input
                              className="input"
                              value={draft.description}
                              onChange={(ev) =>
                                updateDraft(e.id, { description: ev.target.value })
                              }
                            />
                          )}
                        </td>
                        <td className="money">
                          {cancelled ? (
                            formatMoney(e.amount)
                          ) : (
                            <input
                              className="input text-right"
                              inputMode="decimal"
                              value={draft.amount}
                              onChange={(ev) => updateDraft(e.id, { amount: ev.target.value })}
                            />
                          )}
                        </td>
                        <td>{e.bankTransactionId ? "Banka" : "Manuel"}</td>
                        <td>
                          <span className="badge">{expenseStatusLabel(e.status)}</span>
                        </td>
                        <td>
                          {!cancelled ? (
                            <div className="flex flex-wrap gap-1">
                              <button
                                className="btn btn-sm"
                                type="button"
                                disabled={!dirty || savingId === e.id || saveMutation.isPending}
                                onClick={() => saveMutation.mutate(e.id)}
                              >
                                {savingId === e.id ? "…" : "Kaydet"}
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                disabled={cancelMutation.isPending}
                                onClick={() => {
                                  if (confirm("Gider iptal edilsin mi?")) {
                                    cancelMutation.mutate(e.id);
                                  }
                                }}
                              >
                                İptal
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && !listQuery.isLoading ? (
                    <tr>
                      <td colSpan={7} className="muted text-center py-8">
                        Bu dönemde gider yok.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          </div>
        ) : (
          <section className="surface p-8 muted text-center">Soldan dönem seçin.</section>
        )
      }
    />
  );
}
