import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { api, loadSession, saveSession, type AuthSession } from "../lib/api";

type AuthContextValue = {
  session: AuthSession | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      async login(email: string, password: string) {
        const result = await api<AuthSession>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        saveSession(result);
        setSession(result);
      },
      logout() {
        saveSession(null);
        setSession(null);
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
