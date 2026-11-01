import { useQuery } from "@tanstack/react-query";
import { MonthlyChart, type MonthlyRow } from "../components/MonthlyChart";
import { EmptyState, ErrorState, formatDateTr, LoadingRows, PageHeader } from "../components/ui";
import { api, formatMoney } from "../lib/api";
import { useSiteId } from "../lib/useSite";

type Debtor = {
  unitId: number;
  unitNo: string;
  residentName: string | null;
  openAmount: string;
  overdueAmount: string;
  oldestDueDate: string;
};

type Aging = { buckets: Record<string, string> };

export function ReportsPage() {
  const siteId = useSiteId();
  const enabled = !!siteId;
  const monthly = useQuery({
    queryKey: ["reports-monthly", siteId],
    enabled,
    queryFn: () => api<MonthlyRow[]>(`/reports/monthly?siteId=${siteId}`),
  });
  const aging = useQuery({
    queryKey: ["reports-aging", siteId],
    enabled,
    queryFn: () => api<Aging>(`/reports/debt-aging?siteId=${siteId}`),
  });
  const debtors = useQuery({
    queryKey: ["reports-debtors", siteId],
    enabled,
    queryFn: () => api<Debtor[]>(`/reports/debtors?siteId=${siteId}`),
  });

  const buckets = Object.entries(aging.data?.buckets ?? {});
  const maxBucket = Math.max(1, ...buckets.map(([, value]) => Number(value)));

  return (
    <div className="page">
      <PageHeader title="Raporlar" description="Tahsilat performansı, borç yaşlandırma ve borçlu daireler." />

      <section className="surface p-5 rise">
        <h2 className="text-lg mb-3">Tahakkuk ve tahsilat</h2>
        {monthly.isLoading ? <LoadingRows rows={3} /> : null}
        {monthly.isError ? <ErrorState error={monthly.error} onRetry={() => void monthly.refetch()} /> : null}
        {monthly.data ? (
          <>
            <MonthlyChart rows={monthly.data} />
            <details className="mt-4">
              <summary className="text-sm cursor-pointer">Tablo olarak göster</summary>
              <div className="table-wrap mt-2">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Dönem</th>
                      <th className="money">Tahakkuk</th>
                      <th className="money">Tahsilat</th>
                      <th className="money">Gider</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.data.map((row) => (
                      <tr key={row.period}>
                        <td>{row.period}</td>
                        <td className="money">{formatMoney(row.charged)}</td>
                        <td className="money">{formatMoney(row.collected)}</td>
                        <td className="money">{formatMoney(row.spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : null}
      </section>

      <section className="surface p-5 rise">
        <h2 className="text-lg mb-3">Borç yaşlandırma</h2>
        {aging.isLoading ? <LoadingRows rows={3} /> : null}
        {aging.isError ? <ErrorState error={aging.error} onRetry={() => void aging.refetch()} /> : null}
        <ul className="space-y-2">
          {buckets.map(([label, value]) => (
            <li key={label} className="aging-row">
              <span className="text-sm">{label} gün</span>
              <span className="aging-track">
                <i style={{ width: `${(Number(value) / maxBucket) * 100}%` }} />
              </span>
              <span className="money text-sm">{formatMoney(value)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rise">
        <h2 className="text-lg mb-3">Borçlu daireler</h2>
        <div className="table-wrap">
          {debtors.isLoading ? <LoadingRows /> : null}
          {debtors.isError ? <ErrorState error={debtors.error} onRetry={() => void debtors.refetch()} /> : null}
          {debtors.data?.length === 0 ? <EmptyState title="Açık borcu olan daire yok" /> : null}
          {debtors.data?.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Daire</th>
                  <th>Sakin</th>
                  <th>En eski vade</th>
                  <th className="money">Vadesi geçmiş</th>
                  <th className="money">Açık borç</th>
                </tr>
              </thead>
              <tbody>
                {debtors.data.map((row) => (
                  <tr key={row.unitId}>
                    <td className="font-semibold">{row.unitNo}</td>
                    <td>{row.residentName ?? "—"}</td>
                    <td>{formatDateTr(row.oldestDueDate)}</td>
                    <td className="money">{formatMoney(row.overdueAmount)}</td>
                    <td className="money">{formatMoney(row.openAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </section>
    </div>
  );
}
