import { useEffect, useState, type FormEvent } from "react";

import { fetchSmtp, fetchSmtpGlpiDefaults, saveSmtp, sendSmtpTest, type SmtpConfig, type SmtpSecurity } from "./api";
import { Card, errText, NoticeBox, type Notice } from "./shared";

const SECURITY_PORT: Record<SmtpSecurity, number> = { none: 25, starttls: 587, ssl: 465 };

export function SmtpTab() {
  const [cfg, setCfg] = useState<SmtpConfig | null>(null);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testNotice, setTestNotice] = useState<Notice>(null);

  useEffect(() => {
    fetchSmtp()
      .then(setCfg)
      .catch((e) => setNotice({ kind: "err", text: errText(e) }));
  }, []);

  if (!cfg) return <NoticeBox notice={notice ?? { kind: "warn", text: "Cargando configuración SMTP…" }} />;

  const set = <K extends keyof SmtpConfig>(k: K, v: SmtpConfig[K]) => setCfg({ ...cfg, [k]: v });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { password_set: _ignored, ...rest } = cfg;
      const saved = await saveSmtp({ ...rest, password: clearPassword ? "" : password ? password : null });
      setCfg(saved);
      setPassword("");
      setClearPassword(false);
      setNotice({ kind: "ok", text: "Configuración SMTP guardada." });
    } catch (ex) {
      setNotice({ kind: "err", text: errText(ex) });
    } finally {
      setBusy(false);
    }
  };

  const loadFromGlpi = async () => {
    setNotice(null);
    try {
      const d = await fetchSmtpGlpiDefaults();
      setCfg({ ...cfg, ...d, from_name: d.from_name || cfg.from_name });
      setNotice({
        kind: "warn",
        text: "Valores copiados de la configuración de notificaciones de GLPI. Ingrese la contraseña (GLPI la guarda cifrada con su propia clave) y pulse Guardar.",
      });
    } catch (ex) {
      setNotice({ kind: "err", text: errText(ex) });
    }
  };

  const test = async () => {
    setTestBusy(true);
    setTestNotice(null);
    try {
      const r = await sendSmtpTest(testTo);
      setTestNotice({ kind: "ok", text: `Correo de prueba enviado a ${r.to.join(", ")}. Revise la bandeja de entrada.` });
    } catch (ex) {
      setTestNotice({ kind: "err", text: errText(ex) });
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <>
      <Card
        title="Servidor de correo saliente (SMTP)"
        hint="Cuenta desde la que se envían los informes automáticos. La contraseña se guarda cifrada y nunca se muestra."
      >
        <form onSubmit={save}>
          <div className="sys-grid">
            <label className="sys-field">
              Servidor SMTP
              <input value={cfg.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.gmail.com" required />
            </label>
            <label className="sys-field">
              Seguridad
              <select
                value={cfg.security}
                onChange={(e) => {
                  const s = e.target.value as SmtpSecurity;
                  setCfg({ ...cfg, security: s, port: SECURITY_PORT[s] });
                }}
              >
                <option value="ssl">SSL/TLS (puerto 465)</option>
                <option value="starttls">STARTTLS (puerto 587)</option>
                <option value="none">Sin cifrado (no recomendado)</option>
              </select>
            </label>
            <label className="sys-field">
              Puerto
              <input type="number" min={1} max={65535} value={cfg.port} onChange={(e) => set("port", Number(e.target.value))} required />
            </label>
            <label className="sys-field">
              Usuario
              <input value={cfg.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" placeholder="cuenta@dominio.com" />
            </label>
            <label className="sys-field">
              Contraseña
              <input
                type="password"
                value={password}
                disabled={clearPassword}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={cfg.password_set ? "•••••••• (guardada; deje vacío para conservarla)" : "Contraseña o clave de aplicación"}
              />
              {cfg.password_set && (
                <span className="sys-check" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
                  Quitar la contraseña guardada
                </span>
              )}
            </label>
            <label className="sys-field">
              Tiempo de espera (s)
              <input
                type="number"
                min={5}
                max={120}
                value={cfg.timeout_seconds}
                onChange={(e) => set("timeout_seconds", Number(e.target.value))}
              />
            </label>
            <label className="sys-field">
              Correo remitente
              <input type="email" value={cfg.from_email} onChange={(e) => set("from_email", e.target.value)} required />
            </label>
            <label className="sys-field">
              Nombre remitente
              <input value={cfg.from_name} onChange={(e) => set("from_name", e.target.value)} />
            </label>
            <label className="sys-field">
              Responder a (opcional)
              <input type="email" value={cfg.reply_to} onChange={(e) => set("reply_to", e.target.value)} />
            </label>
          </div>
          <p className="sys-hint" style={{ marginTop: "0.8rem" }}>
            Con Gmail o Google Workspace use una <strong>contraseña de aplicación</strong> (requiere verificación en dos pasos); la
            contraseña normal de la cuenta es rechazada por Google.
          </p>
          <div className="sys-actions">
            <button type="submit" className="odoo-btn odoo-btn-primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" className="odoo-btn odoo-btn-secondary" onClick={loadFromGlpi}>
              Copiar valores de GLPI
            </button>
          </div>
          <NoticeBox notice={notice} />
        </form>
      </Card>

      <Card title="Probar configuración" hint="Envía un correo simple con la configuración guardada (guarde antes los cambios).">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="sys-input"
            type="email"
            style={{ maxWidth: 320 }}
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="destinatario@dominio.com"
          />
          <button type="button" className="odoo-btn odoo-btn-secondary" onClick={test} disabled={testBusy || !testTo.includes("@")}>
            {testBusy ? "Enviando…" : "Enviar correo de prueba"}
          </button>
        </div>
        <NoticeBox notice={testNotice} />
      </Card>
    </>
  );
}
