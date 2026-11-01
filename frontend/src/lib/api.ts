const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    tenantId: number;
    email: string;
    fullName: string;
    roles: string[];
    siteIds: number[];
  };
};

const STORAGE_KEY = "siteyonetim.auth";

export function loadSession(): AuthSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession | null): void {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export class ApiError extends Error {
  code: string;
  details: unknown;
  status: number;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      const snippet = text.trim().slice(0, 120).replace(/\s+/g, " ");
      throw new ApiError(
        response.status || 502,
        "INVALID_JSON",
        response.ok
          ? "Sunucu beklenmeyen yanıt döndü. Backend (port 3000) çalışıyor mu?"
          : `API hatası (${response.status}). Backend yanıtı JSON değil: ${snippet || "(boş)"}`,
        { contentType, snippet },
      );
    }
  }

  if (!response.ok) {
    const err = (data ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(
      response.status,
      err.code ?? "HTTP_ERROR",
      err.message ?? "İstek başarısız",
      err.details ?? {},
    );
  }
  return data as T;
}

let refreshInFlight: Promise<string | null> | null = null;

/** Süresi dolan access token'ı yeniler; eşzamanlı istekler tek refresh'i paylaşır. */
function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    const session = loadSession();
    if (!session) return null;
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (response.ok) {
        const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
        saveSession({ ...session, ...tokens });
        return tokens.accessToken;
      }
      if (response.status !== 401) return null;
    } catch {
      return null;
    }
    saveSession(null);
    window.location.assign("/login");
    return null;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function api<T>(
  path: string,
  options: RequestInit & { siteId?: number } = {},
): Promise<T> {
  const session = loadSession();
  const headers = new Headers(options.headers);
  const hasBody = options.body != null && options.body !== "";
  if (hasBody && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (session?.accessToken) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }
  if (options.siteId) {
    headers.set("X-Site-Id", String(options.siteId));
  }

  let response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && session?.refreshToken && !path.startsWith("/auth/")) {
    const accessToken = await refreshAccessToken();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
      response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  return parseResponse<T>(response);
}

export async function apiUpload<T>(
  path: string,
  form: FormData,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const session = loadSession();
  const headers = new Headers(extraHeaders);
  if (session?.accessToken) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }
  let response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form,
  });
  if (response.status === 401 && session?.refreshToken) {
    const accessToken = await refreshAccessToken();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
      response = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: form });
    }
  }
  return parseResponse<T>(response);
}

export function formatMoney(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
  }).format(n);
}
