import {
  Banknote,
  BarChart3,
  Building2,
  ClipboardList,
  Fuel,
  Gavel,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Moon,
  Receipt,
  Settings,
  Sun,
  UserCog,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useKurum } from "../lib/useSite";

type NavItem = { to: string; label: string; icon: LucideIcon };

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: "Genel", items: [{ to: "/dashboard", label: "Özet", icon: LayoutDashboard }] },
  {
    label: "Finans",
    items: [
      { to: "/finance/charges", label: "Aidat ve tahakkuk", icon: Receipt },
      { to: "/finance/bank", label: "Banka mutabakatı", icon: Landmark },
      { to: "/finance/payments", label: "Tahsilatlar", icon: Banknote },
      { to: "/finance/expenses", label: "Giderler", icon: Wallet },
      { to: "/finance/reports", label: "Raporlar", icon: BarChart3 },
    ],
  },
  {
    label: "Site",
    items: [
      { to: "/management/units", label: "Daireler", icon: Building2 },
      { to: "/management/residents", label: "Sakinler", icon: Users },
      { to: "/management/employees", label: "Personel", icon: UserCog },
    ],
  },
  {
    label: "Operasyon",
    items: [
      { to: "/operations/tickets", label: "Talepler", icon: Wrench },
      { to: "/operations/fuel", label: "Yakıt", icon: Fuel },
      { to: "/communication/announcements", label: "Duyurular", icon: Megaphone },
      { to: "/communication/decisions", label: "Karar defteri", icon: Gavel },
    ],
  },
  {
    label: "Yönetim",
    items: [
      { to: "/settings", label: "Kurum", icon: Settings },
      { to: "/settings/audit", label: "İşlem geçmişi", icon: History },
    ],
  },
];

const THEME_KEY = "apartkit.theme";

function initialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Tarayıcı depolaması kapalıysa sistem tercihi kullanılır.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Tercih yalnızca bu oturumda geçerli kalır.
    }
  }, [theme]);
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

export function AppLayout() {
  const { session, logout } = useAuth();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const kurumQuery = useKurum();

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="flex items-center gap-2.5 px-2">
          <span className="brand-mark" aria-hidden>
            <ClipboardList size={18} />
          </span>
          <div className="min-w-0">
            <div className="brand text-lg leading-tight truncate">ApartKit</div>
            <div className="muted text-xs truncate">{kurumQuery.data?.name ?? session.user.fullName}</div>
          </div>
        </div>

        <nav className="app-nav" aria-label="Ana menü">
          {navGroups.map((group) => (
            <div key={group.label} className="app-nav-group">
              <div className="section-label px-2 mb-1 hide-mobile">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/settings"}
                  className={({ isActive }) => `app-nav-link ${isActive ? "is-active" : ""}`}
                >
                  <item.icon size={17} aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="app-sidebar-foot">
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            aria-label={theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}
            onClick={toggle}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button className="btn btn-ghost flex-1" type="button" onClick={logout}>
            <LogOut size={16} aria-hidden /> Çıkış yap
          </button>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
