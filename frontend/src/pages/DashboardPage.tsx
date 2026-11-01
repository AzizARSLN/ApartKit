import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDot } from "lucide-react";
import { Link } from "react-router-dom";
import { MonthlyChart, type MonthlyRow } from "../components/MonthlyChart";
import { ErrorState, LoadingRows, PageHeader } from "../components/ui";
import { api, formatMoney } from "../lib/api";
import { useKurum } from "../lib/useSite";

type Dashboard = {
  chargeTotalThisMonth: string;
  paymentTotalThisMonth: string;
  openDebt: string;
  overdue: string;
  unitCount: number;
  pendingBankCount: number;
  openTicketCount: number;
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface-solid p-4 rise">
      <div className="muted text-sm">{label}</div>
      <div className="money-figure">{value}</div>
      {hint ? <div className="muted text-xs mt-1">{hint}</div> : null}
    </div>
  );
}

function Step({
  index,
  title,
  detail,
  done,
  to,
  action,
}: {
  index: number;
  title: string;
  detail: string;
  done: boolean;
  to: string;
  action: string;
}) {
  return (
    <li className="flow-step">
      <div className="flex items-center gap-2 text-sm font-medium">
        {done ? (
          <CheckCircle2 size={17} className="text-[var(--ok)]" aria-hidden />
        ) : (
          <CircleDot size={17} className="text-[var(--warm)]" aria-hidden />
        )}
        {index}. {title}
        <span className={`badge ml-auto ${done ? "badge-ok" : "badge-warn"}`}>
          {done ? "Tamam" : "Bekliyor"}
        </span>
      </div>
      <p className="muted text-sm mt-1.5 flex-1">{detail}</p>
      <Link className={`btn btn-sm mt-3 ${done ? "btn-ghost" : ""}`} to={to}>
        {action}
      </Link>
    </li>
  );
}

export function DashboardPage() {
  const kurumQuery = useKurum();
  const siteId = kurumQuery.data?.siteId ?? undefined;

  const dashQuery = useQuery({
    queryKey: ["dashboard", siteId],
    enabled: !!siteId,
    queryFn: () => api<Dashboard>(`/reports/dashboard?siteId=${siteId}`),
  });
  const monthlyQuery = useQuery({
    queryKey: ["reports-monthly", siteId],
    enabled: !!siteId,
    queryFn: () => api<MonthlyRow[]>(`/reports/monthly?siteId=${siteId}`),
  });

  const dash = dashQuery.data;
  const charge = Number(dash?.chargeTotalThisMonth ?? 0);
  const payment = Number(dash?.paymentTotalThisMonth ?? 0);
  const rate = charge > 0 ? `%${((payment / charge) * 100).toFixed(0)}` : "—";
  const overdue = Number(dash?.overdue ?? 0);

  return (
    <div className="page">
      <PageHeader title="Özet" description={kurumQuery.data?.name} />

      {dashQuery.isError ? <ErrorState error={dashQuery.error} onRetry={() => void dashQuery.refetch()} /> : null}
      {dashQuery.isLoading || kurumQuery.isLoading ? <LoadingRows rows={3} /> : null}

      {dash ? (
        <>
          <section className="surface p-5 rise">
            <h2 className="text-lg mb-3">Bu ayın işleri</h2>
            <ol className="flow-steps">
              <Step
                index={1}
                title="Aidatı borçlandır"
                detail={charge > 0 ? `Bu ay ${formatMoney(charge)} tahakkuk edildi.` : "Bu ay için henüz dönem oluşturulmadı."}
                done={charge > 0}
                to="/finance/charges"
                action={charge > 0 ? "Dönemleri gör" : "Dönem oluştur"}
              />
              <Step
                index={2}
                title="Bankayı eşleştir"
                detail={
                  dash.pendingBankCount > 0
                    ? `${dash.pendingBankCount} gelen hareket eşleşme bekliyor.`
                    : "Eşleşme bekleyen hareket yok. Yeni ekstre yükleyebilirsiniz."
                }
                done={dash.pendingBankCount === 0}
                to="/finance/bank"
                action={dash.pendingBankCount > 0 ? "Eşleştirmeye git" : "Ekstre yükle"}
              />
              <Step
                index={3}
                title="Geciken borçları takip et"
                detail={overdue > 0 ? `${formatMoney(overdue)} vadesi geçmiş borç var.` : "Vadesi geçmiş borç yok."}
                done={overdue === 0}
                to="/finance/reports"
                action="Borçluları gör"
              />
            </ol>
          </section>

          <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
            <Metric label="Bu ay tahakkuk" value={formatMoney(dash.chargeTotalThisMonth)} />
            <Metric label="Bu ay tahsilat" value={formatMoney(dash.paymentTotalThisMonth)} hint={`Tahsilat oranı ${rate}`} />
            <Metric label="Açık borç" value={formatMoney(dash.openDebt)} hint={`Vadesi geçmiş ${formatMoney(dash.overdue)}`} />
            <Metric label="Daire / açık talep" value={`${dash.unitCount} / ${dash.openTicketCount}`} />
          </div>
        </>
      ) : null}

      <section className="surface p-5 rise">
        <h2 className="text-lg mb-3">Son 12 ay</h2>
        {monthlyQuery.isLoading ? <LoadingRows rows={3} /> : null}
        {monthlyQuery.isError ? <ErrorState error={monthlyQuery.error} onRetry={() => void monthlyQuery.refetch()} /> : null}
        {monthlyQuery.data ? <MonthlyChart rows={monthlyQuery.data} /> : null}
      </section>
    </div>
  );
}
