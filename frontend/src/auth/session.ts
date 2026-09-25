/**
 * Sesión del panel: la API usa una cookie HttpOnly (el navegador la envía sola en peticiones same-origin).
 * El interceptor global de fetch añade la cabecera anti-CSRF a toda llamada /api y avisa cuando la sesión expira,
 * sin tener que modificar cada llamada existente en api.ts.
 */

export type SessionUser = {
  id: number;
  login: string;
  full_name: string;
  role: "admin" | "user";
  profiles: string[];
};

export type Session = { user: SessionUser; authEnabled: boolean };

export const UNAUTHORIZED_EVENT = "coorddash:unauthorized";

function isApiUrl(input: RequestInfo | URL): URL | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.origin);
  return url.origin === window.location.origin && url.pathname.startsWith("/api/") ? url : null;
}

let installed = false;

export function installApiFetchInterceptor(): void {
  if (installed) return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = isApiUrl(input);
    if (!url) return originalFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-Requested-With", "XMLHttpRequest");
    const res = await originalFetch(input, { ...init, headers, credentials: "same-origin" });
    if (res.status === 401 && !url.pathname.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return res;
  };
}

async function errorText(res: Response): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as { detail?: unknown };
    if (typeof j.detail === "string") return j.detail;
  } catch {
    /* texto plano */
  }
  return t || res.statusText;
}

export async function fetchSession(): Promise<Session | null> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await errorText(res));
  const j = (await res.json()) as { user: SessionUser; auth_enabled: boolean };
  return { user: j.user, authEnabled: j.auth_enabled };
}

export async function login(loginName: string, password: string): Promise<SessionUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: loginName, password }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return ((await res.json()) as { user: SessionUser }).user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
