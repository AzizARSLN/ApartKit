import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { unitStatusLabel } from "../lib/statusLabels";

type UnitResident = {
  personId: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  role: string;
};

type UnitRow = {
  id: number;
  unitNo: string;
  floorNo: string | null;
  grossM2: string | null;
  netM2: string | null;
  landShare: string | null;
  status: string;
  residents: UnitResident[];
};

type UnitDraft = {
  id: number;
  unitNo: string;
  floorNo: string;
  grossM2: string;
  netM2: string;
  landShare: string;
  status: "ACTIVE" | "INACTIVE";
};

function toDraft(u: UnitRow): UnitDraft {
  return {
    id: u.id,
    unitNo: u.unitNo,
    floorNo: u.floorNo ?? "",
    grossM2: u.grossM2 ?? "",
    netM2: u.netM2 ?? "",
    landShare: u.landShare ?? "",
    status: u.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  };
}

export function UnitsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [draft, setDraft] = useState<UnitDraft | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const kurumQuery = useQuery({
    queryKey: ["kurum"],
    queryFn: () => api<{ name: string; siteId: number | null }>("/kurum/me"),
  });
  const siteId = kurumQuery.data?.siteId ?? undefined;

  const unitsQuery = useQuery({
    queryKey: ["units", siteId, debouncedSearch],
    enabled: !!siteId,
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "200" });
      if (debouncedSearch) params.set("q", debouncedSearch);
      return api<{ items: UnitRow[]; total: number }>(`/sites/${siteId}/units?${params}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!siteId || !draft) throw new Error("Daire seçilmedi");
      return api(`/sites/${siteId}/units/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          unitNo: draft.unitNo.trim(),
          floorNo: draft.floorNo.trim() || null,
          grossM2: draft.grossM2.trim() || null,
          netM2: draft.netM2.trim() || null,
          landShare: draft.landShare.trim() || null,
          status: draft.status,
        }),
      });
    },
    onSuccess: async () => {
      setMessage({ type: "ok", text: "Daire güncellendi." });
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["units"] });
      await qc.invalidateQueries({ queryKey: ["units-all"] });
    },
    onError: (err) => {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Daire güncellenemedi",
      });
    },
  });

  return (
    <div className="space-y-6">
      <header className="rise">
        <p className="badge mb-3">Yönetim</p>
        <h1 className="text-3xl">Daireler</h1>
        <p className="muted mt-2">
          {kurumQuery.data?.name ?? "Kurum"} · {unitsQuery.data?.total ?? 0} bağımsız bölüm
        </p>
      </header>

      {message ? (
        <p
          className={
            message.type === "ok"
              ? "text-sm text-[var(--accent-strong)]"
              : "text-sm text-[var(--danger)] font-medium"
          }
        >
          {message.text}
        </p>
      ) : null}

      <div className="surface p-4 rise">
        <label className="block space-y-1.5 text-sm font-medium max-w-xl">
          <span>Ara</span>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Daire no, kat, sakin adı, telefon veya e-posta…"
          />
        </label>
      </div>

      <div className="table-wrap rise">
        <table className="data">
          <thead>
            <tr>
              <th>No</th>
              <th>Kat</th>
              <th>m²</th>
              <th>Oturanlar</th>
              <th>İletişim</th>
              <th>Durum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(unitsQuery.data?.items ?? []).map((u) => (
              <tr key={u.id}>
                <td className="font-semibold">{u.unitNo}</td>
                <td>{u.floorNo ?? "—"}</td>
                <td>{u.grossM2 ?? "—"}</td>
                <td>
                  {(u.residents ?? []).length === 0 ? (
                    <span className="muted">Kayıt yok</span>
                  ) : (
                    <ul className="space-y-1">
                      {u.residents.map((r) => (
                        <li key={`${u.id}-${r.personId}`}>
                          <span className="font-medium">
                            {r.firstName} {r.lastName}
                          </span>{" "}
                          <span className="badge">{r.role}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  {(u.residents ?? []).length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {u.residents.map((r) => (
                        <li key={`${u.id}-${r.personId}-c`} className="muted">
                          {r.phone || r.email ? (
                            <>
                              {r.phone ?? "—"}
                              {r.email ? ` · ${r.email}` : ""}
                            </>
                          ) : (
                            "—"
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  <span className="badge">{unitStatusLabel(u.status)}</span>
                </td>
                <td>
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => {
                      setDraft(toDraft(u));
                      setMessage(null);
                    }}
                  >
                    Düzenle
                  </button>
                </td>
              </tr>
            ))}
            {(unitsQuery.data?.items.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7} className="muted text-center py-8">
                  {debouncedSearch ? "Aramaya uygun daire bulunamadı." : "Henüz daire kaydı yok."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(18, 24, 22, 0.45)" }}
          onClick={() => {
            if (!updateMutation.isPending) setDraft(null);
          }}
        >
          <div
            className="surface p-5 w-full max-w-lg space-y-4 rise"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unit-edit-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="unit-edit-title" className="text-lg font-semibold">
                  Daire düzenle
                </h3>
                <p className="muted text-sm mt-1">No / kat / m² / durum bilgilerini güncelleyin.</p>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={updateMutation.isPending}
                onClick={() => setDraft(null)}
              >
                Kapat
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm space-y-1">
                <span className="muted">Daire no</span>
                <input
                  className="input"
                  value={draft.unitNo}
                  onChange={(e) => setDraft({ ...draft, unitNo: e.target.value })}
                  required
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="muted">Kat</span>
                <input
                  className="input"
                  value={draft.floorNo}
                  onChange={(e) => setDraft({ ...draft, floorNo: e.target.value })}
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="muted">Brüt m²</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.grossM2}
                  onChange={(e) => setDraft({ ...draft, grossM2: e.target.value })}
                  placeholder="örn. 120.00"
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="muted">Net m²</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.netM2}
                  onChange={(e) => setDraft({ ...draft, netM2: e.target.value })}
                  placeholder="örn. 105.00"
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="muted">Arsa payı</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.landShare}
                  onChange={(e) => setDraft({ ...draft, landShare: e.target.value })}
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="muted">Durum</span>
                <select
                  className="select"
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      status: e.target.value as "ACTIVE" | "INACTIVE",
                    })
                  }
                >
                  <option value="ACTIVE">Aktif</option>
                  <option value="INACTIVE">Pasif</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={updateMutation.isPending}
                onClick={() => setDraft(null)}
              >
                Vazgeç
              </button>
              <button
                className="btn btn-sm"
                type="button"
                disabled={updateMutation.isPending || !draft.unitNo.trim()}
                onClick={() => updateMutation.mutate()}
              >
                {updateMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
