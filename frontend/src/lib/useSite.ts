import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type KurumSummary = { id: number; name: string; code: string; siteId: number | null };

export function useKurum() {
  return useQuery({
    queryKey: ["kurum"],
    queryFn: () => api<KurumSummary>("/kurum/me"),
  });
}

export function useSiteId(): number | undefined {
  return useKurum().data?.siteId ?? undefined;
}
