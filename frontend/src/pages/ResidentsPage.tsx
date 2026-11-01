import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ListDetailLayout, ListItemButton } from "../components/ListDetailLayout";
import { api, formatMoney } from "../lib/api";
import { printHtmlDocument } from "../lib/printHtml";
import { chargeStatusLabel } from "../lib/statusLabels";

type ResidentRow = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  floorNo: string | null;
  unitNo: string | null;
  residentType: string | null;
  managementRole: string | null;
};

type ResidentType = "OWNER" | "TENANT";
type ManagementRole = "MANAGER" | "ASSISTANT_MANAGER" | "";

type ResidentProfile = {
  person: {
    id: number;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  };
  units: Array<{ unitId: number; unitNo: string; floorNo: string | null; role: string }>;
  periodSummaries: Array<{ period: string; charged: string; paid: string; open: string }>;
  charges: Array<{
    id: number;
    period: string;
    unitNo: string;
    typeName: string;
    amount: string;
    openAmount: string;
    status: string;
    dueDate: string;
  }>;
  payments: Array<{
    id: number;
    paymentDate: string;
    unitNo: string;
    amount: string;
    paymentMethod: string;
    period: string | null;
    status: string;
  }>;
  totals: { charged: string; paid: string; open: string };
};

function residentTypeLabel(type: string | null): string {
  if (type === "OWNER") return "Ev Sahibi";
  if (type === "TENANT") return "Kiracı";
  return "—";
}

function managementRoleLabel(role: string | null | undefined): string {
  if (role === "MANAGER") return "Yönetici";
  if (role === "ASSISTANT_MANAGER") return "Yönetici Yardımcısı";
  return "Yok";
}

function formatPeriodLabel(period: string): string {
  const [y, m] = period.split("-");
  const months = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ];
  const monthName = months[Number(m) - 1];
  return monthName ? `${monthName} ${y}` : period;
}

function printResidentProfile(profile: ResidentProfile, kurumName: string): void {
  const periodsHtml = profile.periodSummaries
    .map(
      (p) => `
      <tr>
        <td>${formatPeriodLabel(p.period)}</td>
        <td style="text-align:right">${formatMoney(p.charged)}</td>
        <td style="text-align:right">${formatMoney(p.paid)}</td>
        <td style="text-align:right">${formatMoney(p.open)}</td>
      </tr>`,
    )
    .join("");

  const unitsHtml = profile.units
    .map((u) => `Daire ${u.unitNo} · Kat ${u.floorNo ?? "—"} · ${u.role}`)
    .join("<br/>");

  const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>${profile.person.firstName} ${profile.person.lastName} — Cari Özet</title>
  <style>
    body { font-family: Segoe UI, sans-serif; color: #1a2421; padding: 24px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .muted { color: #6b7872; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; }
    .card .label { font-size: 12px; color: #6b7872; }
    .card .value { font-size: 18px; font-weight: 700; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th, td { border-bottom: 1px solid #e5e5e5; padding: 8px; text-align: left; }
    th { color: #6b7872; font-size: 11px; text-transform: uppercase; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <p class="muted">${kurumName}</p>
  <h1>${profile.person.firstName} ${profile.person.lastName}</h1>
  <p class="muted">
    ${profile.person.phone ?? "—"} · ${profile.person.email ?? "—"}<br/>
    ${unitsHtml || "Bağlı daire yok"}
  </p>
  <div class="cards">
    <div class="card"><div class="label">Toplam borç</div><div class="value">${formatMoney(profile.totals.charged)}</div></div>
    <div class="card"><div class="label">Toplam ödenen</div><div class="value">${formatMoney(profile.totals.paid)}</div></div>
    <div class="card"><div class="label">Kalan bakiye</div><div class="value">${formatMoney(profile.totals.open)}</div></div>
  </div>
  <h2 style="font-size:16px;margin:18px 0 6px">Dönem bazlı özet</h2>
  <table>
    <thead><tr><th>Dönem</th><th style="text-align:right">Borç</th><th style="text-align:right">Ödenen</th><th style="text-align:right">Kalan</th></tr></thead>
    <tbody>
      ${periodsHtml || `<tr><td colspan="4" class="muted">Dönem hareketi yok.</td></tr>`}
    </tbody>
  </table>
  <p class="muted" style="margin-top:24px">Oluşturma: ${new Date().toLocaleString("tr-TR")}</p>
</body>
</html>`;

  printHtmlDocument(
    html,
    `${profile.person.firstName}_${profile.person.lastName}_cari`.replace(/\s+/g, "_"),
  );
}

export function ResidentsPage() {
  const qc = useQueryClient();
  const kurumQuery = useQuery({
    queryKey: ["kurum"],
    queryFn: () => api<{ name: string; siteId: number | null }>("/kurum/me"),
  });
  const siteId = kurumQuery.data?.siteId ?? undefined;

  const [filterQ, setFilterQ] = useState("");
  const [filterUnit, setFilterUnit] = useState("");
  const [filterType, setFilterType] = useState<"all" | ResidentType>("all");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<"detail" | "create" | "profile">("detail");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [draft, setDraft] = useState<ResidentRow | null>(null);
  const [createForm, setCreateForm] = useState({
    firstName: "",
    lastName: "",
    floorNo: "",
    unitNo: "",
    phone: "",
    email: "",
    residentType: "OWNER" as ResidentType,
    managementRole: "" as ManagementRole,
  });

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(filterQ.trim()), 250);
    return () => window.clearTimeout(t);
  }, [filterQ]);

  const residentsQuery = useQuery({
    queryKey: ["residents", siteId, debouncedQ, filterUnit, filterType],
    enabled: !!siteId,
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "200" });
      if (siteId) params.set("siteId", String(siteId));
      if (debouncedQ) params.set("q", debouncedQ);
      if (filterUnit.trim()) params.set("unitNo", filterUnit.trim());
      if (filterType !== "all") params.set("residentType", filterType);
      return api<{ items: ResidentRow[] }>(`/residents?${params}`);
    },
  });

  const items = residentsQuery.data?.items ?? [];

  useEffect(() => {
    if (mode !== "detail") return;
    if (selectedId == null && items.length > 0) {
      setSelectedId(items[0]!.id);
      return;
    }
    if (selectedId != null && !items.some((i) => i.id === selectedId) && items[0]) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId, mode]);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    if (mode === "detail" && selected) {
      setDraft({ ...selected });
    }
  }, [selected, mode]);

  const profileQuery = useQuery({
    queryKey: ["resident-profile", selectedId],
    enabled: mode === "profile" && selectedId != null,
    queryFn: () => api<ResidentProfile>(`/residents/${selectedId}/profile`),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!siteId) throw new Error("Kurum operasyon kaydı bulunamadı");
      return api<ResidentRow>("/residents", {
        method: "POST",
        body: JSON.stringify({
          siteId,
          firstName: createForm.firstName.trim(),
          lastName: createForm.lastName.trim(),
          floorNo: createForm.floorNo.trim(),
          unitNo: createForm.unitNo.trim(),
          phone: createForm.phone.trim() || undefined,
          email: createForm.email.trim() || undefined,
          residentType: createForm.residentType,
          managementRole: createForm.managementRole || null,
        }),
      });
    },
    onSuccess: async (created) => {
      setCreateForm({
        firstName: "",
        lastName: "",
        floorNo: "",
        unitNo: "",
        phone: "",
        email: "",
        residentType: "OWNER",
        managementRole: "",
      });
      setMessage({ type: "ok", text: "Sakin eklendi." });
      await qc.invalidateQueries({ queryKey: ["residents"] });
      await qc.invalidateQueries({ queryKey: ["units"] });
      setSelectedId(created.id);
      setMode("detail");
    },
    onError: (err) => {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Sakin eklenemedi" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Sakin seçilmedi");
      return api(`/residents/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          phone: draft.phone?.trim() || null,
          email: draft.email?.trim() || null,
          floorNo: draft.floorNo?.trim() || undefined,
          unitNo: draft.unitNo?.trim() || undefined,
          managementRole: draft.managementRole || null,
        }),
      });
    },
    onSuccess: async () => {
      setMessage({ type: "ok", text: "Sakin bilgileri güncellendi." });
      await qc.invalidateQueries({ queryKey: ["residents"] });
      await qc.invalidateQueries({ queryKey: ["units"] });
      await qc.invalidateQueries({ queryKey: ["resident-profile"] });
    },
    onError: (err) => {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Güncelleme başarısız",
      });
    },
  });

  function onCreateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!createForm.firstName.trim() || !createForm.lastName.trim()) {
      setMessage({ type: "err", text: "Ad ve soyad zorunludur." });
      return;
    }
    if (!createForm.floorNo.trim() || !createForm.unitNo.trim()) {
      setMessage({ type: "err", text: "Kat ve daire numarası zorunludur." });
      return;
    }
    createMutation.mutate();
  }

  const detailPanel =
    mode === "create" ? (
      <section className="surface p-5 space-y-4 rise">
        <h2 className="text-xl font-semibold">Yeni sakin ekle</h2>
        <form onSubmit={onCreateSubmit} className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="muted">Ad</span>
            <input
              className="input"
              value={createForm.firstName}
              onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
              required
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Soyad</span>
            <input
              className="input"
              value={createForm.lastName}
              onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
              required
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Kat</span>
            <input
              className="input"
              value={createForm.floorNo}
              onChange={(e) => setCreateForm({ ...createForm, floorNo: e.target.value })}
              required
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Daire no</span>
            <input
              className="input"
              value={createForm.unitNo}
              onChange={(e) => setCreateForm({ ...createForm, unitNo: e.target.value })}
              required
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Telefon</span>
            <input
              className="input"
              value={createForm.phone}
              onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">E-posta</span>
            <input
              className="input"
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Sakin tipi</span>
            <select
              className="select"
              value={createForm.residentType}
              onChange={(e) =>
                setCreateForm({ ...createForm, residentType: e.target.value as ResidentType })
              }
            >
              <option value="OWNER">Ev Sahibi</option>
              <option value="TENANT">Kiracı</option>
            </select>
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Yönetim görevi</span>
            <select
              className="select"
              value={createForm.managementRole}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  managementRole: e.target.value as ManagementRole,
                })
              }
            >
              <option value="">Yok</option>
              <option value="MANAGER">Yönetici (aidat muaf)</option>
              <option value="ASSISTANT_MANAGER">Yönetici Yardımcısı (aidat muaf)</option>
            </select>
            <span className="muted text-xs block mt-1">
              Yönetici / yardımcı seçilirse aylık aidat 0 TL hesaplanır.
            </span>
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button className="btn" type="submit" disabled={createMutation.isPending || !siteId}>
              {createMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setMode(selectedId ? "detail" : "detail")}
            >
              İptal
            </button>
          </div>
        </form>
      </section>
    ) : mode === "profile" && selectedId != null ? (
      <section className="surface p-5 space-y-5 rise" id="resident-profile-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {profileQuery.data
                ? `${profileQuery.data.person.firstName} ${profileQuery.data.person.lastName}`
                : "Cari özet"}
            </h2>
            <p className="muted text-sm mt-1">Dönem bazlı borç / ödeme / kalan bakiye</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm"
              type="button"
              disabled={!profileQuery.data}
              onClick={() => {
                if (profileQuery.data) {
                  printResidentProfile(
                    profileQuery.data,
                    kurumQuery.data?.name ?? "Site Yönetim",
                  );
                }
              }}
            >
              PDF yazdır
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode("detail")}>
              Bilgilere dön
            </button>
          </div>
        </div>

        {profileQuery.isLoading ? <p className="muted">Yükleniyor…</p> : null}
        {profileQuery.data ? (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="surface-solid p-4 rounded-[14px]">
                <div className="muted text-sm">Toplam borç</div>
                <div className="text-2xl font-semibold mt-1">
                  {formatMoney(profileQuery.data.totals.charged)}
                </div>
              </div>
              <div className="surface-solid p-4 rounded-[14px]">
                <div className="muted text-sm">Toplam ödenen</div>
                <div className="text-2xl font-semibold mt-1">
                  {formatMoney(profileQuery.data.totals.paid)}
                </div>
              </div>
              <div className="surface-solid p-4 rounded-[14px]">
                <div className="muted text-sm">Kalan bakiye</div>
                <div className="text-2xl font-semibold mt-1 text-[var(--warm)]">
                  {formatMoney(profileQuery.data.totals.open)}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {profileQuery.data.units.map((u) => (
                <span key={u.unitId} className="badge">
                  Daire {u.unitNo} · Kat {u.floorNo ?? "—"} · {u.role}
                </span>
              ))}
            </div>

            <div>
              <h3 className="font-semibold mb-3">Dönem kartları</h3>
              {profileQuery.data.periodSummaries.length === 0 ? (
                <p className="muted text-sm">Bu sakin için dönem tahakkuku yok.</p>
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {profileQuery.data.periodSummaries
                    .filter((p) => /^\d{4}-\d{2}$/.test(p.period))
                    .map((p) => (
                      <div key={p.period} className="surface-solid p-4 rounded-[14px] space-y-2">
                        <p className="font-semibold">{formatPeriodLabel(p.period)}</p>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <div className="muted text-xs">Borç</div>
                            <div className="font-semibold">{formatMoney(p.charged)}</div>
                          </div>
                          <div>
                            <div className="muted text-xs">Ödenen</div>
                            <div className="font-semibold">{formatMoney(p.paid)}</div>
                          </div>
                          <div>
                            <div className="muted text-xs">Kalan</div>
                            <div className="font-semibold">{formatMoney(p.open)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-semibold mb-2">Tahakkuklar</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Dönem</th>
                      <th>Daire</th>
                      <th>Tür</th>
                      <th className="money">Tutar</th>
                      <th className="money">Kalan</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileQuery.data.charges.map((c) => (
                      <tr key={c.id}>
                        <td>{formatPeriodLabel(c.period)}</td>
                        <td>{c.unitNo}</td>
                        <td>{c.typeName}</td>
                        <td className="money">{formatMoney(c.amount)}</td>
                        <td className="money">{formatMoney(c.openAmount)}</td>
                        <td>
                          <span className="badge">{chargeStatusLabel(c.status)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Ödemeler</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>Dönem</th>
                      <th>Daire</th>
                      <th>Yöntem</th>
                      <th className="money">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileQuery.data.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{new Date(p.paymentDate).toLocaleDateString("tr-TR")}</td>
                        <td>{p.period ? formatPeriodLabel(p.period) : "—"}</td>
                        <td>{p.unitNo}</td>
                        <td>{p.paymentMethod}</td>
                        <td className="money">{formatMoney(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </section>
    ) : draft ? (
      <section className="surface p-5 space-y-4 rise">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {draft.firstName} {draft.lastName}
            </h2>
            <p className="muted text-sm mt-1">
              Daire {draft.unitNo ?? "—"} · Kat {draft.floorNo ?? "—"} ·{" "}
              {residentTypeLabel(draft.residentType)}
              {draft.managementRole
                ? ` · ${managementRoleLabel(draft.managementRole)}`
                : ""}
            </p>
          </div>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              setMode("profile");
            }}
          >
            Detay profil / cari
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="muted">Ad</span>
            <input
              className="input"
              value={draft.firstName}
              onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Soyad</span>
            <input
              className="input"
              value={draft.lastName}
              onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Kat</span>
            <input
              className="input"
              value={draft.floorNo ?? ""}
              onChange={(e) => setDraft({ ...draft, floorNo: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Daire no</span>
            <input
              className="input"
              value={draft.unitNo ?? ""}
              onChange={(e) => setDraft({ ...draft, unitNo: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">Telefon</span>
            <input
              className="input"
              value={draft.phone ?? ""}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="muted">E-posta</span>
            <input
              className="input"
              value={draft.email ?? ""}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1 sm:col-span-2">
            <span className="muted">Yönetim görevi</span>
            <select
              className="select"
              value={draft.managementRole ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  managementRole: e.target.value ? e.target.value : null,
                })
              }
            >
              <option value="">Yok</option>
              <option value="MANAGER">Yönetici (aidat muaf)</option>
              <option value="ASSISTANT_MANAGER">Yönetici Yardımcısı (aidat muaf)</option>
            </select>
            <span className="muted text-xs block mt-1">
              Bu görevdeki sakinlerin bağlı dairelerinde aylık aidat 0 TL tahakkuk eder.
            </span>
          </label>
        </div>

        <button
          className="btn"
          type="button"
          disabled={updateMutation.isPending}
          onClick={() => updateMutation.mutate()}
        >
          {updateMutation.isPending ? "Güncelleniyor…" : "Güncelle"}
        </button>
      </section>
    ) : (
      <section className="surface p-8 rise">
        <p className="muted">Soldan bir sakin seçin veya yeni sakin ekleyin.</p>
      </section>
    );

  return (
    <>
      <ListDetailLayout
        badge="Yönetim"
        title="Sakinler"
        subtitle="Soldan sakin seçin; sağda bilgileri güncelleyin veya cari özeti açın."
        listTitle={`Sakin listesi (${items.length})`}
        headerActions={
          <button
            className="btn btn-warm"
            type="button"
            onClick={() => {
              setMode("create");
              setMessage(null);
            }}
          >
            Yeni sakin ekle
          </button>
        }
        filters={
          <div className="space-y-2">
            <input
              className="input"
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
              placeholder="Ara…"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                value={filterUnit}
                onChange={(e) => setFilterUnit(e.target.value)}
                placeholder="Daire"
              />
              <select
                className="select"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as "all" | ResidentType)}
              >
                <option value="all">Tümü</option>
                <option value="OWNER">Ev Sahibi</option>
                <option value="TENANT">Kiracı</option>
              </select>
            </div>
            <button
              className="btn btn-ghost btn-sm w-full"
              type="button"
              onClick={() => {
                setFilterQ("");
                setFilterUnit("");
                setFilterType("all");
              }}
            >
              Temizle
            </button>
          </div>
        }
        list={
          <>
            {items.map((p) => (
              <ListItemButton
                key={p.id}
                selected={mode !== "create" && selectedId === p.id}
                title={`${p.firstName} ${p.lastName}`}
                subtitle={`Daire ${p.unitNo ?? "—"} · ${residentTypeLabel(p.residentType)}${
                  p.managementRole ? ` · ${managementRoleLabel(p.managementRole)}` : ""
                }`}
                meta={<span className="badge">{p.unitNo ?? "—"}</span>}
                onClick={() => {
                  setSelectedId(p.id);
                  setMode("detail");
                  setMessage(null);
                }}
              />
            ))}
            {items.length === 0 ? (
              <p className="muted text-sm px-1 py-4">Filtreye uygun sakin yok.</p>
            ) : null}
          </>
        }
        detail={
          <>
            {message ? (
              <p
                className={
                  message.type === "ok"
                    ? "text-[var(--accent-strong)] text-sm"
                    : "text-[var(--danger)] text-sm"
                }
              >
                {message.text}
              </p>
            ) : null}
            {detailPanel}
          </>
        }
      />
    </>
  );
}
