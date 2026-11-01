import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { WindowGrid } from "../components/WindowGrid";

export function LoginPage() {
  const { session, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="login-page">
      <WindowGrid level={0} />
      <div className="login-intro">
        <div className="brand login-wordmark">ApartKit</div>
        <p>Aidat, banka ekstresi, talepler. Apartmanın işleri tek defterde.</p>
      </div>
      <main className="login-sheet">
        <form onSubmit={onSubmit} className="login-form">
          <h1>Giriş yap</h1>
          <label className="login-field">
            <span>E-posta</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="login-field">
            <span>Şifre</span>
            <input
              className="input"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="login-show-password">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
            Şifreyi göster
          </label>
          {error ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn login-submit" disabled={loading}>
            {loading ? "Giriş yapılıyor…" : "Giriş yap"}
          </button>
        </form>
      </main>
    </div>
  );
}
