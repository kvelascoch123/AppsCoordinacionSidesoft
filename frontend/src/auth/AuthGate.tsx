import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { fetchSession, login, logout, UNAUTHORIZED_EVENT, type Session, type SessionUser } from "./session";

type State = { status: "loading" } | { status: "anon"; notice?: string } | { status: "authed"; session: Session };

function LoginScreen({ notice, onLoggedIn }: { notice?: string; onLoggedIn: (u: SessionUser) => void }) {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onLoggedIn(await login(loginName.trim(), password));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>Coordinación GLPI</h1>
        <p>Ingrese con su usuario y contraseña de GLPI.</p>
        {notice && <div className="sys-msg sys-msg-warn" style={{ marginTop: 0, marginBottom: "1rem" }}>{notice}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <label className="sys-field">
            Usuario
            <input autoComplete="username" autoFocus value={loginName} onChange={(e) => setLoginName(e.target.value)} required />
          </label>
          <label className="sys-field">
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        </div>
        {err && <div className="sys-msg sys-msg-err">{err}</div>}
        <button type="submit" className="odoo-btn odoo-btn-primary" disabled={busy} style={{ width: "100%", marginTop: "1.1rem", padding: "0.55rem" }}>
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}

export function AuthGate({ children }: { children: (session: Session, onLogout: () => void) => ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    fetchSession()
      .then((s) => setState(s ? { status: "authed", session: s } : { status: "anon" }))
      .catch((e) => setState({ status: "anon", notice: e instanceof Error ? e.message : String(e) }));
    const onUnauthorized = () =>
      setState((s) => (s.status === "authed" ? { status: "anon", notice: "Su sesión expiró. Ingrese nuevamente." } : s));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const handleLogout = useCallback(() => {
    void logout().finally(() => setState({ status: "anon" }));
  }, []);

  if (state.status === "loading") {
    return <div className="auth-screen" style={{ color: "var(--muted)" }}>Cargando…</div>;
  }
  if (state.status === "anon") {
    return <LoginScreen notice={state.notice} onLoggedIn={(user) => setState({ status: "authed", session: { user, authEnabled: true } })} />;
  }
  return <>{children(state.session, handleLogout)}</>;
}
