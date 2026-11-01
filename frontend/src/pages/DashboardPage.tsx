import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { MonthlyChart, type MonthlyRow } from "../components/MonthlyChart";
import { ErrorState, LoadingRows } from "../components/ui";
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

type Debtor = {
  unitId: number;
  unitNo: string;
  residentName: string | null;
  openAmount: string;
  overdueAmount: string;
};

type Task = { label: string; to: string };

function pendingTasks(dash: Dashboard): Task[] {
  const tasks: Task[] = [];
  if (Number(dash.chargeTotalThisMonth) === 0) {
    tasks.push({ label: "Bu ayın aidatı henüz borçlandırılmadı", to: "/finance/charges" });
  }
  if (dash.pendingBankCount > 0) {
    tasks.push({ label: `${dash.pendingBankCount} banka hareketi eşleşme bekliyor`, to: "/finance/bank" });
  }
  if (Number(dash.overdue) > 0) {
    tasks.push({ label: `${formatMoney(dash.overdue)} borcun vadesi geçti`, to: "/finance/reports" });
  }
  if (dash.openTicketCount > 0) {
    tasks.push({ label: `${dash.openTicketCount} talep açık`, to: "/operations/tickets" });
  }
  return tasks;
}

function MonthSummary({ dash }: { dash: Dashboard }) {
  const charged = Number(dash.chargeTotalThisMonth);
  const collected = Number(dash.paymentTotalThisMonth);
  const percent = charged > 0 ? Math.round((collected / charged) * 100) : null;

  return (
    <section className="dash-summary rise">
      <div>
        <div className="dash-label">Bu ay tahsil edilen</div>
        <div className="dash-collected">{formatMoney(collected)}</div>
        <div className="dash-progress" aria-hidden>
          <i style={{ width: `${Math.min(percent ?? 0, 100)}%` }} />
        </div>
        <p className="muted text-sm mt-2">
          {percent === null
            ? "Bu ay tahakkuk yok."
            : `${formatMoney(charged)} tahakkukun %${percent} karşılığı. Eski borçlara gelen ödemeler de dahildir.`}
        </p>
      </div>
      <dl className="dash-facts">
        <div>
          <dt>Açık borç</dt>
          <dd>{formatMoney(dash.openDebt)}</dd>
        </div>
        <div>
          <dt>Vadesi geçmiş</dt>
          <dd className={Number(dash.overdue) > 0 ? "text-[var(--danger)]" : undefined}>{formatMoney(dash.overdue)}</dd>
        </div>
        <div>
          <dt>Aktif daire</dt>
          <dd>{dash.unitCount}</dd>
        </div>
      </dl>
    </section>
  );
}

function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <section className="rise">
      <h2 className="dash-heading">Sırada</h2>
      {tasks.length === 0 ? (
        <p className="dash-row muted">Bekleyen iş yok.</p>
      ) : (
        <ul className="m-0 p-0 list-none">
          {tasks.map((task) => (
            <li key={task.to}>
              <Link className="dash-row dash-task" to={task.to}>
                {task.label}
                <ArrowRight size={16} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopDebtors({ siteId }: { siteId: number }) {
  const debtorsQuery = useQuery({
    queryKey: ["reports-debtors", siteId],
    queryFn: () => api<Debtor[]>(`/reports/debtors?siteId=${siteId}`),
  });
  const debtors = debtorsQuery.data?.slice(0, 5) ?? [];

  return (
    <section className="rise">
      <h2 className="dash-heading flex items-baseline justify-between">
        En yüksek borçlar
        <Link className="dash-more" to="/finance/reports">
          Tümü
        </Link>
      </h2>
      {debtorsQuery.isLoading ? <LoadingRows rows={3} /> : null}
      {debtorsQuery.isError ? <ErrorState error={debtorsQuery.error} onRetry={() => void debtorsQuery.refetch()} /> : null}
      {debtorsQuery.isSuccess && debtors.length === 0 ? <p className="dash-row muted">Borçlu daire yok.</p> : null}
      {debtors.map((debtor) => (
        <div key={debtor.unitId} className="dash-row">
          <span className="min-w-0 truncate">
            <b className="font-semibold">{debtor.unitNo}</b> <span className="muted">{debtor.residentName ?? "Kayıtlı kişi yok"}</span>
          </span>
          <span className="money">{formatMoney(debtor.openAmount)}</span>
        </div>
      ))}
    </section>
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

  const month = new Date().toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

  return (
    <div className="page dash">
      <header className="dash-header rise">
        <div>
          <div className="dash-label">{kurumQuery.data?.name}</div>
          <h1>{month}</h1>
        </div>
        <Link className="btn btn-ghost btn-sm" to="/finance/bank">
          Ekstre yükle
        </Link>
      </header>

      {kurumQuery.isError ? <ErrorState error={kurumQuery.error} onRetry={() => void kurumQuery.refetch()} /> : null}
      {kurumQuery.data && !siteId ? (
        <p className="dash-row">
          Henüz site tanımlanmamış.
          <Link className="dash-more" to="/settings">
            Kurum ayarları
          </Link>
        </p>
      ) : null}
      {dashQuery.isError ? <ErrorState error={dashQuery.error} onRetry={() => void dashQuery.refetch()} /> : null}
      {dashQuery.isLoading || kurumQuery.isLoading ? <LoadingRows rows={3} /> : null}

      {dashQuery.data ? <MonthSummary dash={dashQuery.data} /> : null}

      {dashQuery.data && siteId ? (
        <div className="dash-columns">
          <TaskList tasks={pendingTasks(dashQuery.data)} />
          <TopDebtors siteId={siteId} />
        </div>
      ) : null}

      {siteId ? (
        <section className="rise">
          <h2 className="dash-heading">Son 12 ay</h2>
          <div className="pt-3">
            {monthlyQuery.isLoading ? <LoadingRows rows={3} /> : null}
            {monthlyQuery.isError ? <ErrorState error={monthlyQuery.error} onRetry={() => void monthlyQuery.refetch()} /> : null}
            {monthlyQuery.data ? <MonthlyChart rows={monthlyQuery.data} /> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
