import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { session, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş başarısız");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <section className="relative hidden lg:flex flex-col justify-between p-10 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(145deg, rgba(15,122,108,0.92), rgba(10,92,82,0.88)), url('https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80') center/cover",
          }}
        />
        <div className="relative z-10 text-white">
          <div className="brand text-4xl">Site Yönetim</div>
          <p className="mt-4 max-w-md text-white/85 text-lg leading-relaxed">
            Aidat, banka mutabakatı ve tahsilatı tek akışta yönetin. Modern, hızlı, düşük kaynaklı.
          </p>
        </div>
        <div className="relative z-10 text-white/70 text-sm">Türkiye site & apartman operasyonları · 2026</div>
      </section>

      <section className="grid place-items-center px-4 py-10">
        <form onSubmit={onSubmit} className="surface w-full max-w-md p-8 space-y-5 rise">
          <div>
            <div className="brand text-3xl text-[var(--accent-strong)] lg:hidden">Site Yönetim</div>
            <h1 className="text-2xl mt-1">Panele giriş</h1>
            <p className="muted mt-2 text-sm">Yönetici hesabınızla devam edin</p>
          </div>
          <label className="block space-y-2 text-sm font-medium">
            <span>E-posta</span>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            <span>Şifre</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          <button className="btn w-full" disabled={loading}>
            {loading ? "Giriş yapılıyor…" : "Giriş yap"}
          </button>
        </form>
      </section>
    </div>
  );
}
