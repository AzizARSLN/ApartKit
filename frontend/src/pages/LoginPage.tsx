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
      <section className="login-hero hidden lg:flex flex-col justify-between p-10">
        <div className="brand text-2xl">ApartKit</div>
        <div>
          <p className="text-4xl font-semibold tracking-tight leading-tight max-w-lg">
            Aidat, banka mutabakatı ve tahsilat tek akışta.
          </p>
          <p className="mt-4 max-w-md text-lg opacity-80">
            Banka ekstresini yükleyin, eşleşenleri onaylayın, makbuzlar hazır olsun.
          </p>
        </div>
        <div className="text-sm opacity-70">Açık kaynak site ve apartman yönetimi</div>
      </section>

      <section className="grid place-items-center px-4 py-10">
        <form onSubmit={onSubmit} className="surface w-full max-w-md p-8 space-y-5 rise">
          <div>
            <div className="brand text-2xl text-[var(--accent-strong)] lg:hidden">ApartKit</div>
            <h1 className="text-2xl mt-1">Panele giriş</h1>
            <p className="muted mt-2 text-sm">Yönetici hesabınızla devam edin</p>
          </div>
          <label className="block space-y-2 text-sm font-medium">
            <span>E-posta</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            <span>Şifre</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
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
