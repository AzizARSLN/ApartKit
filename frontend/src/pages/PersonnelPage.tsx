import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { EmptyState, ErrorState, FormError, formatDateTr, LoadingRows, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useSiteId } from "../lib/useSite";

type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  position: string;
  hireDate: string;
  status: string;
};

type Leave = {
  id: number;
  employeeId: number;
  firstName: string;
  lastName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  dayCount: string;
  status: string;
};

const LEAVE_TYPES: Record<string, string> = {
  ANNUAL: "Yıllık",
  SICK: "Hastalık",
  UNPAID: "Ücretsiz",
  OTHER: "Diğer",
};

const LEAVE_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Bekliyor", className: "badge-warn" },
  APPROVED: { label: "Onaylandı", className: "badge-ok" },
  REJECTED: { label: "Reddedildi", className: "badge-danger" },
};

const today = () => new Date().toISOString().slice(0, 10);

function dayCount(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

export function PersonnelPage() {
  const siteId = useSiteId();
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [position, setPosition] = useState("");
  const [hireDate, setHireDate] = useState(today);
  const [leaveEmployee, setLeaveEmployee] = useState("");
  const [leaveType, setLeaveType] = useState("ANNUAL");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const employees = useQuery({
    queryKey: ["employees", siteId],
    enabled: !!siteId,
    queryFn: () => api<Employee[]>(`/employees?siteId=${siteId}`),
  });
  const leaves = useQuery({
    queryKey: ["leaves", siteId],
    enabled: !!siteId,
    queryFn: () => api<Leave[]>(`/leave-requests?siteId=${siteId}`),
  });

  const addEmployee = useMutation({
    mutationFn: () =>
      api("/employees", {
        method: "POST",
        body: JSON.stringify({ siteId, firstName, lastName, position, hireDate }),
      }),
    onSuccess: async () => {
      setFirstName("");
      setLastName("");
      setPosition("");
      await qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });
  const addLeave = useMutation({
    mutationFn: () =>
      api("/leave-requests", {
        method: "POST",
        body: JSON.stringify({
          employeeId: Number(leaveEmployee),
          leaveType,
          startDate,
          endDate,
          dayCount: String(days),
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leaves"] }),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: "APPROVED" | "REJECTED" }) =>
      api(`/leave-requests/${id}/approve`, { method: "POST", body: JSON.stringify({ decision }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leaves"] }),
  });

  const days = dayCount(startDate, endDate);

  function submitEmployee(e: FormEvent) {
    e.preventDefault();
    if (firstName.trim() && lastName.trim() && position.trim()) addEmployee.mutate();
  }

  function submitLeave(e: FormEvent) {
    e.preventDefault();
    if (leaveEmployee && days > 0) addLeave.mutate();
  }

  return (
    <div className="page">
      <PageHeader title="Personel" description="Site çalışanları ve izin talepleri." />

      <div className="grid gap-4 xl:grid-cols-2 items-start">
        <section className="space-y-3 rise">
          <form className="surface p-4 space-y-2" onSubmit={submitEmployee}>
            <h2 className="text-base">Personel ekle</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" placeholder="Ad" aria-label="Ad" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <input className="input" placeholder="Soyad" aria-label="Soyad" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              <input className="input" placeholder="Görev, örn. Kapıcı" aria-label="Görev" value={position} onChange={(e) => setPosition(e.target.value)} />
              <input className="input" type="date" aria-label="İşe giriş tarihi" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
            </div>
            <FormError error={addEmployee.error} />
            <button className="btn" disabled={!firstName.trim() || !lastName.trim() || !position.trim() || addEmployee.isPending}>
              Kaydet
            </button>
          </form>
          <div className="table-wrap">
            {employees.isLoading ? <LoadingRows rows={2} /> : null}
            {employees.isError ? <ErrorState error={employees.error} onRetry={() => void employees.refetch()} /> : null}
            {employees.data?.length === 0 ? <EmptyState title="Henüz personel yok" /> : null}
            {employees.data?.length ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>Ad soyad</th>
                    <th>Görev</th>
                    <th>Giriş</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.data.map((e) => (
                    <tr key={e.id}>
                      <td className="font-medium">
                        {e.firstName} {e.lastName}
                      </td>
                      <td>{e.position}</td>
                      <td>{formatDateTr(e.hireDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </section>

        <section className="space-y-3 rise">
          <form className="surface p-4 space-y-2" onSubmit={submitLeave}>
            <h2 className="text-base">İzin talebi</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="select" aria-label="Personel" value={leaveEmployee} onChange={(e) => setLeaveEmployee(e.target.value)}>
                <option value="">Personel seçin</option>
                {employees.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
              <select className="select" aria-label="İzin türü" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
                {Object.entries(LEAVE_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input className="input" type="date" aria-label="Başlangıç" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <input className="input" type="date" aria-label="Bitiş" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <p className="muted text-sm">{days > 0 ? `${days} gün` : "Bitiş tarihi başlangıçtan önce olamaz."}</p>
            <FormError error={addLeave.error} />
            <button className="btn" disabled={!leaveEmployee || !(days > 0) || addLeave.isPending}>
              Talep oluştur
            </button>
          </form>
          <FormError error={decide.error} />
          <div className="table-wrap">
            {leaves.isLoading ? <LoadingRows rows={2} /> : null}
            {leaves.isError ? <ErrorState error={leaves.error} onRetry={() => void leaves.refetch()} /> : null}
            {leaves.data?.length === 0 ? <EmptyState title="İzin talebi yok" /> : null}
            {leaves.data?.length ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>Personel</th>
                    <th>Tür</th>
                    <th>Tarih</th>
                    <th>Durum</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {leaves.data.map((l) => (
                    <tr key={l.id}>
                      <td className="font-medium">
                        {l.firstName} {l.lastName}
                      </td>
                      <td>{LEAVE_TYPES[l.leaveType] ?? l.leaveType}</td>
                      <td>
                        {formatDateTr(l.startDate)} – {formatDateTr(l.endDate)}
                      </td>
                      <td>
                        <span className={`badge ${LEAVE_STATUS[l.status]?.className ?? ""}`}>
                          {LEAVE_STATUS[l.status]?.label ?? l.status}
                        </span>
                      </td>
                      <td className="text-right">
                        {l.status === "PENDING" ? (
                          <span className="inline-flex gap-1">
                            <button className="btn btn-ghost btn-sm" type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: l.id, decision: "APPROVED" })}>
                              Onayla
                            </button>
                            <button className="btn btn-ghost btn-sm" type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: l.id, decision: "REJECTED" })}>
                              Reddet
                            </button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
