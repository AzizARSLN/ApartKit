import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { EmptyState, ErrorState, FormError, formatDateTr, LoadingRows, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useSiteId } from "../lib/useSite";

type Announcement = {
  id: number;
  title: string;
  body: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
};

type Decision = {
  id: number;
  decisionNo: string;
  decisionDate: string;
  title: string;
  body: string;
  status: string;
};

const ANNOUNCEMENT_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  PUBLISHED: "Yayında",
  ARCHIVED: "Arşivde",
};

export function AnnouncementsPage() {
  const siteId = useSiteId();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const list = useQuery({
    queryKey: ["announcements", siteId],
    enabled: !!siteId,
    queryFn: () => api<Announcement[]>(`/announcements?siteId=${siteId}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["announcements"] });

  const create = useMutation({
    mutationFn: (status: "DRAFT" | "PUBLISHED") =>
      api("/announcements", {
        method: "POST",
        body: JSON.stringify({ siteId, title: title.trim(), body: body.trim(), status }),
      }),
    onSuccess: async () => {
      setTitle("");
      setBody("");
      await refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/announcements/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: refresh,
  });

  const canSubmit = !!title.trim() && !!body.trim() && !create.isPending;

  return (
    <div className="page">
      <PageHeader title="Duyurular" description="Sakinlere duyuru hazırlayın, yayınlayın ve arşivleyin." />
      <section className="surface p-4 space-y-2 rise">
        <input
          className="input"
          placeholder="Başlık"
          aria-label="Duyuru başlığı"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="input"
          rows={3}
          placeholder="Duyuru metni"
          aria-label="Duyuru metni"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <FormError error={create.error} />
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" type="button" disabled={!canSubmit} onClick={() => create.mutate("DRAFT")}>
            Taslak kaydet
          </button>
          <button className="btn" type="button" disabled={!canSubmit} onClick={() => create.mutate("PUBLISHED")}>
            Yayınla
          </button>
        </div>
      </section>

      <FormError error={setStatus.error} />
      {list.isLoading ? <LoadingRows /> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data?.length === 0 ? <EmptyState title="Henüz duyuru yok" /> : null}
      <ul className="space-y-3">
        {list.data?.map((a) => (
          <li key={a.id} className="surface-solid p-4 rise">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base">{a.title}</h2>
              <span className={`badge ${a.status === "PUBLISHED" ? "badge-ok" : a.status === "DRAFT" ? "badge-warn" : ""}`}>
                {ANNOUNCEMENT_LABELS[a.status] ?? a.status}
              </span>
              <span className="muted text-xs ml-auto">{formatDateTr(a.publishedAt ?? a.createdAt)}</span>
            </div>
            <p className="text-sm mt-2 whitespace-pre-wrap">{a.body}</p>
            <div className="flex gap-2 mt-3">
              {a.status !== "PUBLISHED" ? (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: a.id, status: "PUBLISHED" })}
                >
                  Yayınla
                </button>
              ) : null}
              {a.status !== "ARCHIVED" ? (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: a.id, status: "ARCHIVED" })}
                >
                  Arşivle
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DecisionsPage() {
  const siteId = useSiteId();
  const qc = useQueryClient();
  const [decisionDate, setDecisionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const list = useQuery({
    queryKey: ["decisions", siteId],
    enabled: !!siteId,
    queryFn: () => api<Decision[]>(`/decisions?siteId=${siteId}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["decisions"] });

  const create = useMutation({
    mutationFn: () =>
      api("/decisions", {
        method: "POST",
        body: JSON.stringify({ siteId, decisionDate, title: title.trim(), body: body.trim() }),
      }),
    onSuccess: async () => {
      setTitle("");
      setBody("");
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api(`/decisions/${id}/cancel`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: async () => {
      setConfirmId(null);
      await refresh();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim() && body.trim()) create.mutate();
  }

  return (
    <div className="page">
      <PageHeader
        title="Karar defteri"
        description="Yönetim kararları yıl bazında otomatik numaralanır. Kayıtlar silinmez, yalnızca iptal edilir."
      />
      <form className="surface p-4 space-y-2 rise" onSubmit={onSubmit}>
        <div className="grid gap-2 sm:grid-cols-[170px_1fr]">
          <input
            className="input"
            type="date"
            aria-label="Karar tarihi"
            value={decisionDate}
            onChange={(e) => setDecisionDate(e.target.value)}
          />
          <input
            className="input"
            placeholder="Karar konusu"
            aria-label="Karar konusu"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <textarea
          className="input"
          rows={3}
          placeholder="Karar metni"
          aria-label="Karar metni"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <FormError error={create.error} />
        <div className="flex justify-end">
          <button className="btn" disabled={!title.trim() || !body.trim() || !decisionDate || create.isPending}>
            Kararı kaydet
          </button>
        </div>
      </form>

      <FormError error={cancel.error} />
      {list.isLoading ? <LoadingRows /> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data?.length === 0 ? <EmptyState title="Henüz karar kaydı yok" /> : null}
      <ul className="space-y-3">
        {list.data?.map((d) => (
          <li key={d.id} className="surface-solid p-4 rise">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge">{d.decisionNo}</span>
              <h2 className={`text-base ${d.status === "CANCELLED" ? "line-through muted" : ""}`}>{d.title}</h2>
              {d.status === "CANCELLED" ? <span className="badge badge-danger">İptal</span> : null}
              <span className="muted text-xs ml-auto">{formatDateTr(d.decisionDate)}</span>
            </div>
            <p className="text-sm mt-2 whitespace-pre-wrap">{d.body}</p>
            {d.status === "CANCELLED" ? null : confirmId === d.id ? (
              <div className="flex gap-2 mt-3">
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(d.id)}
                >
                  Evet, iptal et
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmId(null)}>
                  Vazgeç
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm mt-3" type="button" onClick={() => setConfirmId(d.id)}>
                İptal et
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
