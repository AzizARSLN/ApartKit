import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui";
import { api } from "../lib/api";

type AuditRow = {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  userName: string | null;
};

export function AuditPage() {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["audit", page],
    queryFn: () => api<{ items: AuditRow[]; totalPages: number }>(`/audit-logs?page=${page}&pageSize=50`),
  });

  return (
    <div className="page">
      <PageHeader title="İşlem geçmişi" description="Sistemde yapılan kritik işlemlerin değiştirilemez kaydı." />
      <div className="table-wrap rise">
        {list.isLoading ? <LoadingRows /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.data?.items.length === 0 ? <EmptyState title="Kayıt yok" /> : null}
        {list.data?.items.length ? (
          <table className="data">
            <thead>
              <tr>
                <th>Zaman</th>
                <th>Kullanıcı</th>
                <th>İşlem</th>
                <th>Kayıt</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString("tr-TR")}</td>
                  <td>{row.userName ?? "Sistem"}</td>
                  <td>
                    <code className="text-xs">{row.action}</code>
                  </td>
                  <td className="muted">
                    {row.entityType}
                    {row.entityId ? ` #${row.entityId}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {list.data && list.data.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button className="btn btn-ghost btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Önceki
          </button>
          <span className="muted">
            {page} / {list.data.totalPages}
          </span>
          <button className="btn btn-ghost btn-sm" type="button" disabled={page >= list.data.totalPages} onClick={() => setPage(page + 1)}>
            Sonraki
          </button>
        </div>
      ) : null}
    </div>
  );
}
