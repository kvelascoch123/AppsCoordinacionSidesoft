import { useCallback, useEffect, useState } from "react";

import { fetchReportProjects, fetchSurveys, type ReportProject, type SurveyResponse, type SurveySummary } from "./api";
import { Card, errText, fmtDate, fmtDateTime, NoticeBox, type Notice } from "./shared";

const fmtAvg = (v: number | null) => (v == null ? "—" : v.toFixed(2));

function ScoreBadge({ value }: { value: number }) {
  const cls = value >= 4 ? "sys-badge-ok" : value >= 3 ? "sys-badge-warn" : "sys-badge-err";
  return <span className={`sys-badge ${cls}`}>{value}</span>;
}

export function SurveysTab() {
  const [projects, setProjects] = useState<ReportProject[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<SurveyResponse[]>([]);
  const [summary, setSummary] = useState<SurveySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const r = await fetchSurveys({ projectId: projectId || undefined, from: from || undefined, to: to || undefined });
      setRows(r.responses);
      setSummary(r.summary);
    } catch (e) {
      setNotice({ kind: "err", text: errText(e) });
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetchReportProjects()
      .then(setProjects)
      .catch(() => undefined);
  }, []);

  return (
    <>
      <Card title="Respuestas de la encuesta de satisfacción" hint="Calificaciones de 0 a 5 enviadas por los clientes desde el enlace del informe.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end" }}>
          <label className="sys-field" style={{ minWidth: 260 }}>
            Proyecto
            <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Todos los proyectos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sys-field">
            Respondidas desde
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="sys-field">
            Hasta
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="odoo-btn odoo-btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Consultando…" : "Actualizar"}
          </button>
        </div>
        <NoticeBox notice={notice} />
      </Card>

      <Card title="Resumen por proyecto">
        <div className="sys-table-wrap">
          <table className="sys-table">
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Respuestas</th>
                <th>Tiempo de solución</th>
                <th>Tiempo de respuesta</th>
                <th>Calidad</th>
                <th>Solicitudes de capacitación</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)" }}>
                    Aún no hay respuestas.
                  </td>
                </tr>
              )}
              {summary.map((s) => (
                <tr key={s.projects_id}>
                  <td style={{ fontWeight: 600 }}>{s.project_name ?? `#${s.projects_id}`}</td>
                  <td>{s.responses}</td>
                  <td>{fmtAvg(s.avg_solution_time)}</td>
                  <td>{fmtAvg(s.avg_response_time)}</td>
                  <td>{fmtAvg(s.avg_quality)}</td>
                  <td>{s.training_requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Detalle de respuestas">
        <div className="sys-table-wrap">
          <table className="sys-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proyecto</th>
                <th>Período</th>
                <th>Respondió</th>
                <th>Solución</th>
                <th>Respuesta</th>
                <th>Calidad</th>
                <th>Capacitación</th>
                <th>Comentarios</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.date_creation)}</td>
                  <td style={{ fontWeight: 600, minWidth: 160 }}>{r.project_name ?? `#${r.projects_id}`}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {fmtDate(r.period_from)} – {fmtDate(r.period_to)}
                  </td>
                  <td>{r.respondent_name ?? "—"}</td>
                  <td>
                    <ScoreBadge value={r.score_solution_time} />
                  </td>
                  <td>
                    <ScoreBadge value={r.score_response_time} />
                  </td>
                  <td>
                    <ScoreBadge value={r.score_quality} />
                  </td>
                  <td style={{ minWidth: 150 }}>{r.needs_training ? r.training_module ?? "Sí" : "No"}</td>
                  <td style={{ minWidth: 220, whiteSpace: "pre-wrap" }}>{r.observations ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
