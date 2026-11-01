import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, FormError, formatDateTr, LoadingRows, PageHeader } from "../components/ui";
import { api, formatMoney } from "../lib/api";
import { paymentStatusLabel } from "../lib/statusLabels";
import { useSiteId } from "../lib/useSite";

type Payment = {
  id: number;
  paymentDate: string;
  amount: string;
  paymentMethod: string;
  description: string | null;
  status: string;
  unitNo: string;
  receiptNo: string | null;
};

const METHODS: Record<string, string> = {
  BANK_TRANSFER: "Havale / EFT",
  CASH: "Nakit",
  CREDIT_CARD: "Kredi kartı",
};

export function PaymentsPage() {
  const siteId = useSiteId();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const list = useQuery({
    queryKey: ["payments", siteId, page],
    enabled: !!siteId,
    queryFn: () =>
      api<{ items: Payment[]; total: number; totalPages: number }>(
        `/payments?siteId=${siteId}&page=${page}&pageSize=50`,
      ),
  });

  const reverse = useMutation({
    mutationFn: (id: number) =>
      api(`/payments/${id}/reverse`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: async () => {
      setConfirmId(null);
      await Promise.all(
        ["payments", "charges", "dashboard", "bank-transactions"].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });

  return (
    <div className="page">
      <PageHeader
        title="Tahsilatlar"
        description="Tüm ödemeler ve makbuzlar. Yeni tahsilat için banka mutabakatını veya dönem ekranını kullanın."
        actions={
          <>
            <Link className="btn btn-ghost" to="/finance/charges">
              Dönemden tahsil et
            </Link>
            <Link className="btn" to="/finance/bank">
              Banka mutabakatı
            </Link>
          </>
        }
      />
      <FormError error={reverse.error} />
      <div className="table-wrap rise">
        {list.isLoading ? <LoadingRows /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.data?.items.length === 0 ? <EmptyState title="Henüz tahsilat yok" /> : null}
        {list.data?.items.length ? (
          <table className="data">
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Daire</th>
                <th>Yöntem</th>
                <th>Makbuz</th>
                <th>Durum</th>
                <th className="money">Tutar</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td>{formatDateTr(p.paymentDate)}</td>
                  <td className="font-semibold">{p.unitNo}</td>
                  <td>{METHODS[p.paymentMethod] ?? p.paymentMethod}</td>
                  <td>{p.receiptNo ?? "—"}</td>
                  <td>
                    <span className={`badge ${p.status === "POSTED" ? "badge-ok" : "badge-warn"}`}>
                      {paymentStatusLabel(p.status)}
                    </span>
                  </td>
                  <td className="money">{formatMoney(p.amount)}</td>
                  <td className="text-right">
                    {p.status !== "POSTED" ? null : confirmId === p.id ? (
                      <span className="inline-flex gap-1">
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          disabled={reverse.isPending}
                          onClick={() => reverse.mutate(p.id)}
                        >
                          Evet, iade et
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmId(null)}>
                          Vazgeç
                        </button>
                      </span>
                    ) : (
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmId(p.id)}>
                        İade et
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {list.data && list.data.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button className="btn btn-ghost btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Önceki
          </button>
          <span className="muted">
            {page} / {list.data.totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={page >= list.data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Sonraki
          </button>
        </div>
      ) : null}
    </div>
  );
}
