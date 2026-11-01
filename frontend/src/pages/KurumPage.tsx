import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

type Kurum = {
  id: number;
  name: string;
  code: string;
  address: string | null;
  taxNumber: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  siteId: number | null;
};

export function KurumPage() {
  const qc = useQueryClient();
  const kurumQuery = useQuery({
    queryKey: ["kurum"],
    queryFn: () => api<Kurum>("/kurum/me"),
  });

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const k = kurumQuery.data;
    if (!k) return;
    setName(k.name);
    setCode(k.code);
    setAddress(k.address ?? "");
    setTaxNumber(k.taxNumber ?? "");
    setPhone(k.phone ?? "");
    setEmail(k.email ?? "");
  }, [kurumQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api<Kurum>("/kurum/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim(),
          address: address.trim() || null,
          taxNumber: taxNumber.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
        }),
      }),
    onSuccess: async () => {
      setMessage("Kurum bilgileri kaydedildi.");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["kurum"] });
      await qc.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err) => {
      setMessage(null);
      setError(err instanceof Error ? err.message : "Kayıt başarısız");
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <header className="rise">
        <h1 className="text-3xl">Kurum</h1>
        <p className="muted mt-2">
          Tüm tanımlar ve hareketler bu kuruma bağlıdır. Adı Ayarlar’dan güncelleyin.
        </p>
      </header>

      <form onSubmit={onSubmit} className="surface p-5 space-y-4 rise max-w-3xl">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block space-y-1.5 text-sm font-medium sm:col-span-2">
            <span>Kurum adı</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Kurum kodu</span>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Vergi no</span>
            <input className="input" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Telefon</span>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>E-posta</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium sm:col-span-2">
            <span>Adres</span>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
        </div>

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        {message ? <p className="text-sm text-[var(--accent-strong)]">{message}</p> : null}

        <button className="btn" type="submit" disabled={saveMutation.isPending || kurumQuery.isLoading}>
          {saveMutation.isPending ? "Kaydediliyor…" : "Kurumu kaydet"}
        </button>
      </form>

      <div className="surface p-5 space-y-2 rise">
        <p className="font-semibold">Finans politikaları (kilitli)</p>
        <ul className="muted text-sm space-y-1 list-disc pl-5">
          <li>Fazla ödeme reddedilir</li>
          <li>Gecikme faizi varsayılan kapalı</li>
          <li>Tahsilat reverse → banka hareketi UNMATCHED</li>
          <li>Kısmi ödenmiş charge iptali için önce reverse gerekir</li>
        </ul>
      </div>
    </div>
  );
}
