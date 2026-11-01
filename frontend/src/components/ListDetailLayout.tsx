import type { ReactNode } from "react";

type ListDetailLayoutProps = {
  title: string;
  subtitle?: string;
  badge?: string;
  headerActions?: ReactNode;
  /** Sol liste içeriği (kaydırılabilir) */
  list: ReactNode;
  /** Listenin altında kompakt filtre paneli */
  filters?: ReactNode;
  /** Sağ detay paneli */
  detail: ReactNode;
  listTitle?: string;
  detailTitle?: string;
  sidebarWidthClassName?: string;
};

/**
 * Sol liste + alt filtre + sağ detay düzeni.
 * Sakinler, dönemler vb. master-detail ekranlarında yeniden kullanılır.
 */
export function ListDetailLayout({
  title,
  subtitle,
  badge,
  headerActions,
  list,
  filters,
  detail,
  listTitle = "Liste",
  detailTitle,
  sidebarWidthClassName = "lg:w-[300px]",
}: ListDetailLayoutProps) {
  return (
    <div className="space-y-4">
      <header className="rise flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          {badge ? <p className="badge mb-3">{badge}</p> : null}
          <h1 className="text-2xl md:text-3xl">{title}</h1>
          {subtitle ? <p className="muted mt-2 max-w-2xl">{subtitle}</p> : null}
        </div>
        {headerActions ? <div className="flex flex-wrap gap-2">{headerActions}</div> : null}
      </header>

      <div className={`grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)] items-start`}>
        <aside
          className={`surface p-3 space-y-3 rise w-full ${sidebarWidthClassName} lg:sticky lg:top-4`}
        >
          <h2 className="text-sm font-semibold px-1">{listTitle}</h2>
          <div className="max-h-[52vh] overflow-auto space-y-1 pr-1">{list}</div>
          {filters ? (
            <div className="border-t border-[var(--line)] pt-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide muted px-1">Filtre</p>
              {filters}
            </div>
          ) : null}
        </aside>

        <main className="min-w-0 space-y-4">
          {detailTitle ? (
            <h2 className="text-xl font-semibold rise">{detailTitle}</h2>
          ) : null}
          {detail}
        </main>
      </div>
    </div>
  );
}

type ListItemButtonProps = {
  selected?: boolean;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  onClick: () => void;
};

export function ListItemButton({
  selected,
  title,
  subtitle,
  meta,
  onClick,
}: ListItemButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-[12px] border px-3 py-2.5 transition ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[inset_3px_0_0_var(--accent)]"
          : "border-transparent hover:bg-[var(--accent-tint)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-sm">{title}</span>
        {meta}
      </div>
      {subtitle ? <p className="muted text-xs mt-1">{subtitle}</p> : null}
    </button>
  );
}
