import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { EmptyState, ErrorState, FormError, formatDateTr, LoadingRows, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useSiteId } from "../lib/useSite";

type Ticket = {
  id: number;
  unitNo: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
};

type Comment = { id: number; body: string; createdAt: string; authorName: string | null };

const STATUSES = [
  { value: "OPEN", label: "Açık" },
  { value: "IN_PROGRESS", label: "İşlemde" },
  { value: "RESOLVED", label: "Çözüldü" },
  { value: "CLOSED", label: "Kapalı" },
];

const PRIORITIES = [
  { value: "LOW", label: "Düşük" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "Yüksek" },
  { value: "URGENT", label: "Acil" },
];

function priorityLabel(value: string): string {
  return PRIORITIES.find((p) => p.value === value)?.label ?? value;
}

function TicketDetail({ ticket, onChanged }: { ticket: Ticket; onChanged: () => Promise<void> }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const comments = useQuery({
    queryKey: ["ticket-comments", ticket.id],
    queryFn: () => api<Comment[]>(`/tickets/${ticket.id}/comments`),
  });
  const patch = useMutation({
    mutationFn: (status: string) =>
      api(`/tickets/${ticket.id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: onChanged,
  });
  const addComment = useMutation({
    mutationFn: () =>
      api(`/tickets/${ticket.id}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: async () => {
      setBody("");
      await qc.invalidateQueries({ queryKey: ["ticket-comments", ticket.id] });
    },
  });

  return (
    <div className="surface p-5 space-y-4 rise">
      <div>
        <h2 className="text-lg">{ticket.title}</h2>
        <p className="muted text-sm">
          {ticket.unitNo ? `Daire ${ticket.unitNo} · ` : ""}
          {priorityLabel(ticket.priority)} · {formatDateTr(ticket.createdAt)}
        </p>
        {ticket.description ? <p className="text-sm mt-2 whitespace-pre-wrap">{ticket.description}</p> : null}
      </div>
      <label className="block text-sm space-y-1">
        <span className="muted">Durum</span>
        <select
          className="select"
          value={ticket.status}
          disabled={patch.isPending}
          onChange={(e) => patch.mutate(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <FormError error={patch.error} />
      <div className="space-y-2">
        <h3 className="section-label">Notlar</h3>
        {comments.isLoading ? <LoadingRows rows={1} /> : null}
        {comments.isError ? <ErrorState error={comments.error} /> : null}
        {comments.data?.length === 0 ? <p className="muted text-sm">Henüz not yok.</p> : null}
        <ul className="space-y-2">
          {comments.data?.map((c) => (
            <li key={c.id} className="text-sm border-l-2 border-[var(--line)] pl-3">
              <p className="whitespace-pre-wrap">{c.body}</p>
              <p className="muted text-xs">
                {c.authorName ?? "—"} · {formatDateTr(c.createdAt)}
              </p>
            </li>
          ))}
        </ul>
        <textarea
          className="input"
          rows={2}
          placeholder="Not ekleyin"
          aria-label="Not"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <FormError error={addComment.error} />
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={!body.trim() || addComment.isPending}
          onClick={() => addComment.mutate()}
        >
          Notu kaydet
        </button>
      </div>
    </div>
  );
}

export function TicketsPage() {
  const siteId = useSiteId();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("NORMAL");

  const list = useQuery({
    queryKey: ["tickets", siteId, statusFilter],
    enabled: !!siteId,
    queryFn: () =>
      api<Ticket[]>(`/tickets?siteId=${siteId}${statusFilter ? `&status=${statusFilter}` : ""}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tickets"] });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: number }>("/tickets", {
        method: "POST",
        body: JSON.stringify({ siteId, title: title.trim(), priority }),
      }),
    onSuccess: async (created) => {
      setTitle("");
      setPriority("NORMAL");
      setSelectedId(created.id);
      await refresh();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) create.mutate();
  }

  const selected = list.data?.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="page">
      <PageHeader title="Talepler" description="Arıza, şikâyet ve iş taleplerini açın, atayın, kapatın." />
      <form className="surface p-4 flex flex-col sm:flex-row gap-2 rise" onSubmit={onSubmit}>
        <input
          className="input"
          placeholder="Talep başlığı, örn. Asansör arızası"
          aria-label="Talep başlığı"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          className="select sm:max-w-36"
          aria-label="Öncelik"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="btn whitespace-nowrap" disabled={!title.trim() || create.isPending}>
          Talep aç
        </button>
      </form>
      <FormError error={create.error} />

      <div className="flex flex-wrap gap-1.5">
        {[{ value: "", label: "Tümü" }, ...STATUSES].map((s) => (
          <button
            key={s.value}
            type="button"
            className={`btn btn-sm ${statusFilter === s.value ? "" : "btn-ghost"}`}
            onClick={() => setStatusFilter(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px] items-start">
        <div className="table-wrap rise">
          {list.isLoading ? <LoadingRows /> : null}
          {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
          {list.data?.length === 0 ? <EmptyState title="Bu görünümde talep yok" /> : null}
          {list.data?.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Başlık</th>
                  <th>Daire</th>
                  <th>Öncelik</th>
                  <th>Durum</th>
                  <th>Tarih</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((t) => (
                  <tr
                    key={t.id}
                    className={`is-clickable ${t.id === selectedId ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <td className="font-medium">{t.title}</td>
                    <td>{t.unitNo ?? "—"}</td>
                    <td>
                      <span className={`badge ${t.priority === "URGENT" ? "badge-danger" : t.priority === "HIGH" ? "badge-warn" : ""}`}>
                        {priorityLabel(t.priority)}
                      </span>
                    </td>
                    <td>{STATUSES.find((s) => s.value === t.status)?.label ?? t.status}</td>
                    <td>{formatDateTr(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        {selected ? (
          <TicketDetail key={selected.id} ticket={selected} onChanged={refresh} />
        ) : (
          <div className="surface-solid empty-state">Ayrıntı için listeden bir talep seçin.</div>
        )}
      </div>
    </div>
  );
}
