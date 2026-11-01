import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="rise flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl md:text-3xl">{title}</h1>
        {description ? <p className="muted mt-1 max-w-2xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <Inbox className="mx-auto mb-2" size={24} aria-hidden />
      <p className="font-medium text-[var(--ink)]">{title}</p>
      {hint ? <p className="text-sm mt-1">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <AlertTriangle className="mx-auto mb-2 text-[var(--danger)]" size={24} aria-hidden />
      <p className="font-medium text-[var(--ink)]">
        {error instanceof Error ? error.message : "Veriler yüklenemedi."}
      </p>
      {onRetry ? (
        <button className="btn btn-ghost btn-sm mt-3" type="button" onClick={onRetry}>
          Tekrar dene
        </button>
      ) : null}
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-9" />
      ))}
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="text-sm text-[var(--danger)]" role="alert">
      {error instanceof Error ? error.message : "İşlem başarısız."}
    </p>
  );
}

export function formatDateTr(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("tr-TR");
}
