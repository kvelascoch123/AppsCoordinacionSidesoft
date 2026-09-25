import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createManualRun,
  downloadReportPreviewFile,
  fetchReportPreview,
  fetchReportProjects,
  saveReportProject,
  type ReportPreview,
  type ReportProject,
} from "./api";
import { Card, emailsToText, errText, fmtDate, NoticeBox, textToEmails, type Notice } from "./shared";

type Draft = {
  is_active: boolean;
  extra_to: string;
  extra_cc: string;
};

const toDraft = (p: ReportProject): Draft => ({
  is_active: p.is_active,
  extra_to: emailsToText(p.extra_to),
  extra_cc: emailsToText(p.extra_cc),
});

function hhmm(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

/** Correo tal como se enviará; iframe aislado (sin scripts) que se ajusta a la altura del contenido. */
function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);
  const fit = () => {
    const doc = ref.current?.contentDocument;
    if (doc) setHeight(doc.documentElement.scrollHeight + 8);
  };
  return (
    <iframe
      ref={ref}
      title="Vista previa del correo"
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><html><body style="margin:0;padding:12px;background:#f0f2f5">${html}</body></html>`}
      onLoad={fit}
      style={{ width: "100%", height, border: "1px solid var(--border)", borderRadius: "var(--radius)", marginTop: "0.4rem" }}
    />
  );
}

function PreviewPanel({ project, onClose }: { project: ReportProject; onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ReportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(
    async (f?: string, t?: string) => {
      setLoading(true);
      setNotice(null);
      try {
        const p = await fetchReportPreview(project.id, f, t);
        setData(p);
        setFrom(p.date_from);
        setTo(p.date_to);
      } catch (e) {
        setNotice({ kind: "err", text: errText(e) });
      } finally {
        setLoading(false);
      }
    },
    [project.id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (fmt: "pdf" | "docx") => {
    try {
      await downloadReportPreviewFile(project.id, fmt, from, to);
    } catch (e) {
      setNotice({ kind: "err", text: errText(e) });
    }
  };

  const sendNow = async () => {
    if (!data) return;
    const dest = data.test_mode ? `(modo prueba) ${data.test_recipients.join(", ")}` : data.to.join(", ");
    if (!window.confirm(`¿Enviar ahora el informe de ${project.name} (${fmtDate(from)} – ${fmtDate(to)}) a:\n${dest}?`)) return;
    try {
      const r = await createManualRun({ project_ids: [project.id], date_from: from, date_to: to });
      setNotice({ kind: "ok", text: `Envío #${r.run_id} en cola. El servicio de envío lo procesará en menos de un minuto (vea «Historial»).` });
    } catch (e) {
      setNotice({ kind: "err", text: errText(e) });
    }
  };

  return (
    <Card title={`Vista previa: ${project.name}`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end" }}>
        <label className="sys-field">
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="sys-field">
          Hasta
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="odoo-btn odoo-btn-secondary" onClick={() => load(from, to)} disabled={loading}>
          {loading ? "Consultando…" : "Actualizar"}
        </button>
        <button type="button" className="odoo-btn odoo-btn-secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <NoticeBox notice={notice} />
      {data && (
        <div style={{ marginTop: "1rem" }}>
          {data.test_mode && (
            <div className="sys-msg sys-msg-warn" style={{ marginTop: 0, marginBottom: "0.8rem" }}>
              Modo prueba activo: el correo se enviará solo a {data.test_recipients.join(", ") || "(sin destinatarios de prueba)"}.
            </div>
          )}
          <div className="sys-status">
            <div>
              <small>Tickets en el informe</small>
              <strong>{data.tickets_count}</strong>
            </div>
            <div>
              <small>Tiempo total invertido</small>
              <strong>{hhmm(data.summary.total.seconds)}</strong>
            </div>
          </div>
          <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
            <strong>Para:</strong> {data.to.length ? data.to.join(", ") : <em style={{ color: "var(--danger-text)" }}>ningún solicitante con correo</em>}
          </p>
          {data.cc.length > 0 && (
            <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
              <strong>CC:</strong> {data.cc.join(", ")}
            </p>
          )}
          {data.requesters.length > 0 && (
            <p className="sys-hint" style={{ margin: "0 0 0.6rem" }}>
              Solicitantes: {data.requesters.map((r) => `${r.name || r.email} (${r.tickets} ticket${r.tickets === 1 ? "" : "s"})`).join(" · ")}
            </p>
          )}
          <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
            <strong>Asunto:</strong> {data.subject}
          </p>
          <EmailFrame html={data.html} />
          <div className="sys-actions">
            <button type="button" className="odoo-btn odoo-btn-secondary" onClick={() => download("pdf")}>
              Descargar PDF
            </button>
            <button type="button" className="odoo-btn odoo-btn-secondary" onClick={() => download("docx")}>
              Descargar Word
            </button>
            <button type="button" className="odoo-btn odoo-btn-primary" onClick={sendNow} disabled={!data.to.length && !data.test_mode}>
              Enviar ahora
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function ProjectsTab() {
  const [projects, setProjects] = useState<ReportProject[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [filter, setFilter] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [preview, setPreview] = useState<ReportProject | null>(null);

  useEffect(() => {
    fetchReportProjects()
      .then((p) => {
        setProjects(p);
        setDrafts(Object.fromEntries(p.map((x) => [x.id, toDraft(x)])));
      })
      .catch((e) => setNotice({ kind: "err", text: errText(e) }));
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, filter]);

  const isDirty = (p: ReportProject) => JSON.stringify(toDraft(p)) !== JSON.stringify(drafts[p.id]);

  const save = async (p: ReportProject) => {
    const d = drafts[p.id];
    setSavingId(p.id);
    setNotice(null);
    try {
      const body = {
        is_active: d.is_active,
        extra_to: textToEmails(d.extra_to),
        extra_cc: textToEmails(d.extra_cc),
      };
      await saveReportProject(p.id, body);
      const updated = { ...p, ...body };
      setProjects((all) => all.map((x) => (x.id === p.id ? updated : x)));
      setDrafts((all) => ({ ...all, [p.id]: toDraft(updated) }));
      setNotice({ kind: "ok", text: `Proyecto «${p.name}» guardado.` });
    } catch (e) {
      setNotice({ kind: "err", text: errText(e) });
    } finally {
      setSavingId(null);
    }
  };

  const edit = (id: number, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  const activeCount = projects.filter((p) => p.is_active).length;

  return (
    <>
      {preview && <PreviewPanel key={preview.id} project={preview} onClose={() => setPreview(null)} />}
      <Card
        title="Proyectos incluidos en el envío"
        hint={`${activeCount} de ${projects.length} proyectos activos. «Para extra» y «CC extra» se suman a los solicitantes de los tickets.`}
      >
        <input
          className="sys-input"
          style={{ maxWidth: 320, marginBottom: "0.8rem" }}
          placeholder="Buscar proyecto…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="sys-table-wrap">
          <table className="sys-table">
            <thead>
              <tr>
                <th>Enviar</th>
                <th>Proyecto</th>
                <th />
                <th>Para extra</th>
                <th>CC extra</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const d = drafts[p.id];
                if (!d) return null;
                return (
                  <tr key={p.id} className={preview?.id === p.id ? "sys-row-selected" : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Incluir ${p.name}`}
                        checked={d.is_active}
                        onChange={(e) => edit(p.id, { is_active: e.target.checked })}
                      />
                    </td>
                    <td style={{ minWidth: 200, fontWeight: 600 }}>{p.name}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="odoo-btn odoo-btn-primary"
                        disabled={!isDirty(p) || savingId === p.id}
                        onClick={() => save(p)}
                      >
                        {savingId === p.id ? "…" : "Guardar"}
                      </button>{" "}
                      <button
                        type="button"
                        className="odoo-btn odoo-btn-secondary"
                        onClick={() => {
                          setPreview(p);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Vista previa
                      </button>
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <input className="sys-input" value={d.extra_to} onChange={(e) => edit(p.id, { extra_to: e.target.value })} />
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <input className="sys-input" value={d.extra_cc} onChange={(e) => edit(p.id, { extra_cc: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <NoticeBox notice={notice} />
      </Card>
    </>
  );
}
