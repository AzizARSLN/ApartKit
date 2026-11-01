import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, formatMoney } from "../lib/api";

const nav = [
  { to: "/dashboard", label: "Özet" },
  { to: "/finance/bank", label: "Banka" },
  { to: "/finance/charges", label: "Tahakkuk" },
  { to: "/finance/expenses", label: "Gider" },
  { to: "/management/units", label: "Daireler" },
  { to: "/management/residents", label: "Sakinler" },
  { to: "/operations/tickets", label: "Talepler" },
  { to: "/settings", label: "Kurum" },
];

export function AppLayout() {
  const { session, logout } = useAuth();
  const location = useLocation();
  const kurumQuery = useQuery({
    queryKey: ["kurum"],
    queryFn: () => api<{ name: string; code: string }>("/kurum/me"),
    enabled: !!session,
  });

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="surface m-3 mb-0 lg:mb-3 p-5 flex flex-col gap-6">
        <div className="rise">
          <div className="brand text-2xl text-[var(--accent-strong)]">
            {kurumQuery.data?.name ?? "Site Yönetim"}
          </div>
          <p className="muted text-sm mt-1">{session.user.fullName}</p>
        </div>
        <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-[14px] px-3 py-2.5 text-sm font-semibold whitespace-nowrap transition ${
                  isActive
                    ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                    : "hover:bg-white/60 text-[var(--ink-soft)]"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button className="btn btn-ghost mt-auto" type="button" onClick={logout}>
          Çıkış yap
        </button>
      </aside>
      <main className="p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  className = "",
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`surface-solid p-5 rise ${className}`}>
      <div className="muted text-sm">{label}</div>
      <div className="text-2xl md:text-3xl mt-2 font-bold tracking-tight">{value}</div>
      {hint ? <div className="muted text-xs mt-2">{hint}</div> : null}
    </div>
  );
}

export function DashboardPage() {
  const kurumQuery = useQuery({
    queryKey: ["kurum"],
    queryFn: () =>
      api<{ id: number; name: string; code: string; siteId: number | null }>("/kurum/me"),
  });

  const siteId = kurumQuery.data?.siteId ?? undefined;
  const dashQuery = useQuery({
    queryKey: ["dashboard", siteId],
    enabled: !!siteId,
    queryFn: () =>
      api<{
        chargeTotalThisMonth: string;
        paymentTotalThisMonth: string;
        openDebt: string;
        overdue: string;
        unitCount: number;
      }>(`/reports/dashboard?siteId=${siteId}`),
  });

  const charge = Number(dashQuery.data?.chargeTotalThisMonth ?? 0);
  const payment = Number(dashQuery.data?.paymentTotalThisMonth ?? 0);
  const rate = charge > 0 ? `${((payment / charge) * 100).toFixed(0)}%` : "—";

  return (
    <div className="space-y-6">
      <header className="rise flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <p className="badge mb-3">{kurumQuery.data?.name ?? "Kurum"}</p>
          <h1 className="text-3xl md:text-4xl">Bugünün finansal nabzı</h1>
          <p className="muted mt-2 max-w-xl">
            Aidat, tahsilat ve banka mutabakatını tek bakışta izleyin.
          </p>
        </div>
        <NavLink to="/finance/bank" className="btn btn-warm w-fit">
          Banka mutabakatına git
        </NavLink>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Metric
          className="rise-delay-1"
          label="Bu ay tahakkuk"
          value={dashQuery.isLoading ? "…" : formatMoney(dashQuery.data?.chargeTotalThisMonth)}
        />
        <Metric
          className="rise-delay-1"
          label="Bu ay tahsilat"
          value={dashQuery.isLoading ? "…" : formatMoney(dashQuery.data?.paymentTotalThisMonth)}
        />
        <Metric
          className="rise-delay-2"
          label="Açık borç"
          value={dashQuery.isLoading ? "…" : formatMoney(dashQuery.data?.openDebt)}
        />
        <Metric
          label="Vadesi geçmiş"
          value={dashQuery.isLoading ? "…" : formatMoney(dashQuery.data?.overdue)}
        />
        <Metric label="Daire sayısı" value={String(dashQuery.data?.unitCount ?? "…")} />
        <Metric label="Tahsilat oranı" value={rate} hint="Bu ay tahsilat / tahakkuk" />
      </div>

      <section className="surface p-5 rise">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-xl">Kurum</h2>
          <span className="badge">{kurumQuery.data?.code ?? "—"}</span>
        </div>
        {kurumQuery.isLoading ? <div className="skeleton h-10" /> : null}
        {kurumQuery.data ? (
          <div className="py-2 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{kurumQuery.data.name}</div>
              <div className="muted text-sm">Kod: {kurumQuery.data.code}</div>
            </div>
            <NavLink className="btn btn-sm btn-ghost" to="/settings">
              Düzenle
            </NavLink>
          </div>
        ) : null}
      </section>
    </div>
  );
}
