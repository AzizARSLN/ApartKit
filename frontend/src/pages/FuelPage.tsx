import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { EmptyState, ErrorState, FormError, LoadingRows, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useSiteId } from "../lib/useSite";

type Tank = {
  id: number;
  fuelType: string;
  unit: string;
  capacity: string;
  minimumStock: string;
  remainingStock: string;
  dailyAverage: string;
  daysRemaining: number | null;
  isLow: boolean;
};

const QUANTITY = /^\d+(\.\d{1,3})?$/;

function normalize(value: string): string {
  return value.trim().replace(",", ".");
}

function TankCard({ tank, onChanged }: { tank: Tank; onChanged: () => Promise<void> }) {
  const [kind, setKind] = useState<"purchase" | "consumption">("consumption");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const qty = normalize(quantity);
  const price = normalize(unitPrice);
  const valid = QUANTITY.test(qty) && Number(qty) > 0 && (kind === "consumption" || /^\d+(\.\d{1,4})?$/.test(price));

  const record = useMutation({
    mutationFn: () => {
      const now = new Date().toISOString();
      return kind === "consumption"
        ? api("/fuel/consumptions", {
            method: "POST",
            body: JSON.stringify({ fuelTankId: tank.id, consumptionDate: now, quantity: qty }),
          })
        : api("/fuel/purchases", {
            method: "POST",
            body: JSON.stringify({
              fuelTankId: tank.id,
              purchaseDate: now,
              quantity: qty,
              unitPrice: price,
              totalAmount: (Number(qty) * Number(price)).toFixed(2),
            }),
          });
    },
    onSuccess: async () => {
      setQuantity("");
      setUnitPrice("");
      await onChanged();
    },
  });

  const percent = Math.min(100, (Number(tank.remainingStock) / Math.max(1, Number(tank.capacity))) * 100);

  return (
    <li className="surface-solid p-4 space-y-3 rise">
      <div className="flex items-center gap-2">
        <h2 className="text-base">{tank.fuelType}</h2>
        {tank.isLow ? (
          <span className="badge badge-warn ml-auto">
            <AlertTriangle size={12} aria-hidden /> Stok düşük
          </span>
        ) : null}
      </div>
      <div className="aging-track" role="img" aria-label={`Doluluk yüzde ${percent.toFixed(0)}`}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm">
        {Number(tank.remainingStock).toLocaleString("tr-TR")} / {Number(tank.capacity).toLocaleString("tr-TR")} {tank.unit}
        <span className="muted">
          {" · "}
          {tank.daysRemaining == null ? "Tüketim verisi yok" : `Yaklaşık ${tank.daysRemaining} gün yeter`}
        </span>
      </p>
      <div className="grid gap-2 grid-cols-2">
        <select
          className="select col-span-2"
          aria-label="Hareket türü"
          value={kind}
          onChange={(e) => setKind(e.target.value as "purchase" | "consumption")}
        >
          <option value="consumption">Tüketim gir</option>
          <option value="purchase">Alım gir</option>
        </select>
        <input
          className={`input ${kind === "consumption" ? "col-span-2" : ""}`}
          inputMode="decimal"
          placeholder={`Miktar (${tank.unit})`}
          aria-label="Miktar"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        {kind === "purchase" ? (
          <input
            className="input"
            inputMode="decimal"
            placeholder="Birim fiyat"
            aria-label="Birim fiyat"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        ) : null}
      </div>
      <FormError error={record.error} />
      <button className="btn btn-ghost btn-sm" type="button" disabled={!valid || record.isPending} onClick={() => record.mutate()}>
        Kaydet
      </button>
    </li>
  );
}

export function FuelPage() {
  const siteId = useSiteId();
  const qc = useQueryClient();
  const [fuelType, setFuelType] = useState("");
  const [capacity, setCapacity] = useState("");
  const [minimumStock, setMinimumStock] = useState("");

  const tanks = useQuery({
    queryKey: ["fuel", siteId],
    enabled: !!siteId,
    queryFn: () => api<Tank[]>(`/fuel/overview?siteId=${siteId}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["fuel"] });

  const cap = normalize(capacity);
  const min = normalize(minimumStock) || "0";
  const valid = !!fuelType.trim() && QUANTITY.test(cap) && QUANTITY.test(min);

  const create = useMutation({
    mutationFn: () =>
      api("/fuel/tanks", {
        method: "POST",
        body: JSON.stringify({ siteId, fuelType: fuelType.trim(), capacity: cap, minimumStock: min }),
      }),
    onSuccess: async () => {
      setFuelType("");
      setCapacity("");
      setMinimumStock("");
      await refresh();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid) create.mutate();
  }

  return (
    <div className="page">
      <PageHeader title="Yakıt" description="Stok, tüketim ve kalan gün tahmini. Son 30 günün ortalamasıyla hesaplanır." />
      <form className="surface p-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] rise" onSubmit={onSubmit}>
        <input className="input" placeholder="Yakıt türü, örn. Motorin" aria-label="Yakıt türü" value={fuelType} onChange={(e) => setFuelType(e.target.value)} />
        <input className="input" inputMode="decimal" placeholder="Kapasite (LT)" aria-label="Kapasite" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <input className="input" inputMode="decimal" placeholder="Asgari stok (LT)" aria-label="Asgari stok" value={minimumStock} onChange={(e) => setMinimumStock(e.target.value)} />
        <button className="btn whitespace-nowrap" disabled={!valid || create.isPending}>
          Tank ekle
        </button>
      </form>
      <FormError error={create.error} />
      {tanks.isLoading ? <LoadingRows rows={2} /> : null}
      {tanks.isError ? <ErrorState error={tanks.error} onRetry={() => void tanks.refetch()} /> : null}
      {tanks.data?.length === 0 ? <EmptyState title="Henüz yakıt tankı yok" hint="Takibe başlamak için yukarıdan tank ekleyin." /> : null}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tanks.data?.map((tank) => <TankCard key={tank.id} tank={tank} onChanged={refresh} />)}
      </ul>
    </div>
  );
}
