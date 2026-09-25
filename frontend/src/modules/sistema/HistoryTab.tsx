import { useCallback, useEffect, useState } from "react";

import { createManualRun, fetchRuns, fetchRunSends, fetchSchedule, retrySend, type ReportRun, type ReportSend } from "./api";
import { Card, errText, fmtDate, fmtDateTime, NoticeBox, StatusBadge, type Notice } from "./shared";

const ACTIVE = new Set(["queued", "running"]);

export function HistoryTab() {
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [sends, setSends] = useState<ReportSend[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetchRuns();
      setRuns(r);
      if (selected != null) setSends(await fetchRunSends(selected));
    } catch (e) {
      setNotice({ kind: "err", text: errText(e) });
    }
  }, [selected]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    fetchSchedule()
      .then((s) => setTestMode(s.config.test_mode))
      .catch(() => undefined);
  }, []);

  // Refresco automático mientras haya ejecuciones en curso o en cola.
  const hasActive = runs.some((r) => ACTIVE.has(r.status)) || sends.some((s) => s.status === "pending" || s.status === "sending");
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [hasActive, reload]);

  const sendAll = async () => {
    const period = from && to ? `del ${fmtDate(from)} al ${fmtDate(to)}` : "del período configurado";
    const target = testMode ? "a los destinatarios de PRUEBA" : "a los solicitantes de cada proyecto activo";
    if (!window.confirm(`¿Enviar ahora el informe ${period} ${target}?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await createManualRun({ project_ids: null, ...(from && to ? { date_from: from, date_to: to } : {}) });
      setNotice({ kind: "ok", text: `Envío #${r.run_id} en cola${r.test_mode ? " (modo prueba)" : ""}. Se procesará en menos de un minuto.` });
      setSelected(r.run_id);
    } catch (e) {
      setNotice({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const retry = async (s: ReportSend) => {
    if (s.status === "failed" && s.last_error?.includes("interrumpido")) {
      if (!window.confirm("El envío se interrumpió y el correo pudo haber salido. ¿Reintentar de todas formas?")) return;
    }
    try {
      await retrySend(s.id);
      await reload();
    } catch (e) {
      setNotice({ kind: "err", text: errText(e) });
    }
  };

  return (
    <>
      <Card
        title="Enviar ahora"
        hint="Genera y envía el informe de todos los proyectos activos. Si no indica fechas, se usa el período configurado (calculado a la fecha de hoy)."
      >
        {testMode && (
          <div className="sys-msg sys-msg-warn" style={{ marginTop: 0, marginBottom: "0.8rem" }}>
            Modo prueba activo: los correos irán solo a los destinatarios de prueba.
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end" }}>
          <label className="sys-field">
            Desde (opcional)
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="sys-field">
            Hasta (opcional)
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="odoo-btn odoo-btn-primary" onClick={sendAll} disabled={busy || Boolean(from) !== Boolean(to)}>
            {busy ? "Encolando…" : "Enviar a todos los proyectos"}
          </button>
        </div>
        <NoticeBox notice={notice} />
      </Card>

      <Card title="Historial de ejecuciones" hint="Seleccione una ejecución para ver el detalle por proyecto.">
        <div className="sys-actions" style={{ marginTop: 0, marginBottom: "0.7rem" }}>
          <button type="button" className="odoo-btn odoo-btn-secondary" onClick={() => void reload()}>
            Actualizar
          </button>
        </div>
        <div className="sys-table-wrap">
          <table className="sys-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Origen</th>
                <th>Período</th>
                <th>Estado</th>
                <th>Enviados</th>
                <th>Fallidos</th>
                <th>Omitidos</th>
                <th>Solicitado por</th>
                <th>Creado</th>
                <th>Finalizado</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ color: "var(--muted)" }}>
                    Aún no hay ejecuciones.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className={`sys-row-click${selected === r.id ? " sys-row-selected" : ""}`}
                  onClick={() => {
                    setSelected(r.id);
                    fetchRunSends(r.id).then(setSends).catch((e) => setNotice({ kind: "err", text: errText(e) }));
                  }}
                >
                  <td>{r.id}</td>
                  <td>
                    {r.trigger === "auto" ? "Automático" : "Manual"}
                    {r.test_mode && (
                      <>
                        {" "}
                        <span className="sys-badge sys-badge-warn">Prueba</span>
                      </>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {fmtDate(r.period_from)} – {fmtDate(r.period_to)}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{r.sent}</td>
                  <td style={{ color: r.failed ? "var(--danger-text)" : undefined, fontWeight: r.failed ? 700 : undefined }}>{r.failed}</td>
                  <td>{r.skipped}</td>
                  <td>{r.requested_by ?? (r.trigger === "auto" ? "Programación" : "—")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {selected != null && (
        <Card title={`Detalle de la ejecución #${selected}`}>
          <div className="sys-table-wrap">
            <table className="sys-table">
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Estado</th>
                  <th>Destinatarios</th>
                  <th>Tickets</th>
                  <th>Tiempo total</th>
                  <th>Intentos</th>
                  <th>Detalle</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sends.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600, minWidth: 180 }}>{s.project_name ?? `#${s.project_id}`}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td style={{ minWidth: 220, fontSize: "0.78rem" }}>
                      {s.recipients_to.map((r) => r.email).join(", ") || "—"}
                      {s.recipients_cc.length > 0 && <div style={{ color: "var(--muted)" }}>CC: {s.recipients_cc.join(", ")}</div>}
                    </td>
                    <td>{s.tickets_count}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {s.total_hhmm}
                    </td>
                    <td>{s.attempts}</td>
                    <td style={{ minWidth: 220, fontSize: "0.78rem" }}>
                      {s.status === "sent" && `Enviado ${fmtDateTime(s.sent_at)}`}
                      {s.status === "skipped" && s.skip_reason}
                      {s.status === "failed" && (
                        <>
                          <span style={{ color: "var(--danger-text)" }}>{s.last_error}</span>
                          <div style={{ color: "var(--muted)" }}>
                            {s.next_attempt_at ? `Reintento automático: ${fmtDateTime(s.next_attempt_at)}` : "Sin más reintentos automáticos"}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      {(s.status === "failed" || s.status === "skipped") && (
                        <button type="button" className="odoo-btn odoo-btn-secondary" onClick={() => retry(s)}>
                          Reintentar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
