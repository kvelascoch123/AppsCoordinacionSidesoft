import { useCallback, useEffect, useState, type FormEvent } from "react";

import { fetchSchedule, saveSchedule, type Frequency, type ScheduleConfig, type SchedulePayload } from "./api";
import { Card, emailsToText, errText, fmtDate, fmtDateTime, NoticeBox, textToEmails, type Notice } from "./shared";

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "monthly_last_business_day", label: "Mensual: último día hábil (lun–vie)" },
  { value: "monthly_last_day", label: "Mensual: último día del mes" },
  { value: "monthly_day", label: "Mensual: un día fijo" },
  { value: "weekly", label: "Semanal" },
  { value: "daily", label: "Diario" },
];
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const VARIABLES = ["{proyecto}", "{periodo}", "{desde}", "{hasta}", "{total_tickets}", "{total_horas}"];

type ListField = "cc" | "bcc" | "test_recipients" | "exclude_domains";
const LIST_FIELDS: ListField[] = ["cc", "bcc", "test_recipients", "exclude_domains"];

function workerState(heartbeat: string | null): Notice {
  if (!heartbeat) {
    return { kind: "err", text: "El servicio de envío (worker) no ha reportado actividad. Verifique que el contenedor «worker» esté en ejecución." };
  }
  const ageMin = (Date.now() - new Date(heartbeat).getTime()) / 60000;
  if (ageMin > 3) {
    return {
      kind: "err",
      text: `El servicio de envío (worker) no responde desde ${fmtDateTime(heartbeat)}. Los correos no se enviarán hasta que vuelva a ejecutarse.`,
    };
  }
  return null;
}

export function ScheduleTab() {
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [cfg, setCfg] = useState<ScheduleConfig | null>(null);
  const [lists, setLists] = useState<Record<ListField, string>>({ cc: "", bcc: "", test_recipients: "", exclude_domains: "" });
  const [modules, setModules] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const apply = useCallback((p: SchedulePayload) => {
    setData(p);
    setCfg(p.config);
    setLists({
      cc: emailsToText(p.config.cc),
      bcc: emailsToText(p.config.bcc),
      test_recipients: emailsToText(p.config.test_recipients),
      exclude_domains: p.config.exclude_domains.join(", "),
    });
    setModules(p.config.training_modules.join("\n"));
  }, []);

  useEffect(() => {
    fetchSchedule()
      .then(apply)
      .catch((e) => setNotice({ kind: "err", text: errText(e) }));
  }, [apply]);

  // Refresca solo el panel de estado (latido del worker, próximo envío) sin tocar el formulario en edición.
  useEffect(() => {
    const t = setInterval(() => {
      fetchSchedule()
        .then(setData)
        .catch(() => undefined);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!cfg || !data) return <NoticeBox notice={notice ?? { kind: "warn", text: "Cargando programación…" }} />;

  const set = <K extends keyof ScheduleConfig>(k: K, v: ScheduleConfig[K]) => setCfg({ ...cfg, [k]: v });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const payload: ScheduleConfig = { ...cfg };
      for (const f of LIST_FIELDS) payload[f] = textToEmails(lists[f]);
      payload.training_modules = modules.split("\n").map((m) => m.trim()).filter(Boolean);
      apply(await saveSchedule(payload));
      setNotice({ kind: "ok", text: "Programación guardada." });
    } catch (ex) {
      setNotice({ kind: "err", text: errText(ex) });
    } finally {
      setBusy(false);
    }
  };

  const worker = workerState(data.worker_heartbeat);

  return (
    <form onSubmit={save}>
      <div className="sys-status">
        <div>
          <small>Estado</small>
          <strong style={{ color: cfg.enabled ? "var(--ok)" : "var(--muted)" }}>
            {data.config.enabled ? (data.config.test_mode ? "Activo (modo prueba)" : "Activo") : "Desactivado"}
          </strong>
        </div>
        <div>
          <small>Próximo envío</small>
          <strong>{data.config.enabled ? fmtDateTime(data.next_run_at) : "—"}</strong>
        </div>
        <div>
          <small>Período del próximo informe</small>
          <strong>{data.next_period ? `${fmtDate(data.next_period.from)} – ${fmtDate(data.next_period.to)}` : "—"}</strong>
        </div>
        <div>
          <small>Servicio de envío (worker)</small>
          <strong style={{ color: worker ? "var(--danger-text)" : "var(--ok)" }}>
            {worker ? "Sin actividad" : `Activo · ${fmtDateTime(data.worker_heartbeat)}`}
          </strong>
        </div>
      </div>
      <NoticeBox notice={worker} />

      <Card
        title="Programación del envío"
        hint="Cada ejecución genera el informe de cada proyecto activo y envía un solo correo por proyecto a todos los solicitantes de sus tickets."
      >
        <label className="sys-check" style={{ marginBottom: "1rem" }}>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          <strong>Envío automático activo</strong>
        </label>
        <div className="sys-grid">
          <label className="sys-field">
            Frecuencia
            <select value={cfg.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {cfg.frequency === "monthly_day" && (
            <label className="sys-field">
              Día del mes
              <input
                type="number"
                min={1}
                max={31}
                value={cfg.day_of_month}
                onChange={(e) => set("day_of_month", Number(e.target.value))}
              />
              <span style={{ fontSize: "0.75rem" }}>Si el mes tiene menos días, se usa el último.</span>
            </label>
          )}
          {cfg.frequency === "weekly" && (
            <label className="sys-field">
              Día de la semana
              <select value={cfg.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="sys-field">
            Hora de envío
            <input type="time" value={cfg.send_time} onChange={(e) => set("send_time", e.target.value)} required />
          </label>
          <label className="sys-field">
            Zona horaria
            <input value={cfg.timezone} onChange={(e) => set("timezone", e.target.value)} required />
          </label>
          <label className="sys-field">
            Período del informe
            <select value={cfg.period_mode} onChange={(e) => set("period_mode", e.target.value as ScheduleConfig["period_mode"])}>
              <option value="current_month">Mes en curso (día 1 hasta la fecha de envío)</option>
              <option value="previous_month">Mes anterior completo</option>
            </select>
          </label>
          <label className="sys-field">
            Adjuntar informe como
            <select
              value={cfg.attachment_format}
              onChange={(e) => set("attachment_format", e.target.value as ScheduleConfig["attachment_format"])}
            >
              <option value="pdf">PDF</option>
              <option value="docx">Word (.docx)</option>
              <option value="both">PDF y Word</option>
              <option value="none">Sin adjunto</option>
            </select>
          </label>
          <label className="sys-field">
            Reintentos máximos por proyecto
            <input
              type="number"
              min={1}
              max={10}
              value={cfg.max_attempts}
              onChange={(e) => set("max_attempts", Number(e.target.value))}
            />
          </label>
        </div>
        <label className="sys-check" style={{ marginTop: "0.9rem" }}>
          <input
            type="checkbox"
            checked={cfg.embed_report_in_body}
            onChange={(e) => set("embed_report_in_body", e.target.checked)}
          />
          Incluir el informe en el cuerpo del correo (resumen del tiempo invertido y detalle de tickets gestionados)
        </label>
        <label className="sys-check" style={{ marginTop: "0.5rem" }}>
          <input type="checkbox" checked={cfg.skip_empty} onChange={(e) => set("skip_empty", e.target.checked)} />
          No enviar a proyectos sin tickets con tiempo registrado en el período
        </label>
      </Card>

      <Card title="Destinatarios" hint="Para: solicitantes de los tickets del informe (correo principal en GLPI). Se excluyen usuarios inactivos.">
        <div className="sys-grid">
          <label className="sys-field">
            CC para todos los proyectos
            <input value={lists.cc} onChange={(e) => setLists({ ...lists, cc: e.target.value })} placeholder="coordinacion@sidesoft.com.ec" />
          </label>
          <label className="sys-field">
            CCO para todos los proyectos
            <input value={lists.bcc} onChange={(e) => setLists({ ...lists, bcc: e.target.value })} />
          </label>
          <label className="sys-field">
            Excluir solicitantes de estos dominios
            <input
              value={lists.exclude_domains}
              onChange={(e) => setLists({ ...lists, exclude_domains: e.target.value })}
              placeholder="sidesoft.com.ec"
            />
            <span style={{ fontSize: "0.75rem" }}>Evita enviar el informe del cliente a personal interno que registró tickets.</span>
          </label>
        </div>
      </Card>

      <Card
        title="Encuesta de satisfacción"
        hint="Agrega al correo una invitación a calificar el servicio. Cada enlace identifica el proyecto y el período, y está firmado para que no pueda alterarse. Las respuestas se consultan en la pestaña «Encuestas»."
      >
        <label className="sys-check" style={{ marginBottom: "0.9rem" }}>
          <input type="checkbox" checked={cfg.survey_enabled} onChange={(e) => set("survey_enabled", e.target.checked)} />
          Incluir la encuesta en el correo
        </label>
        <div className="sys-grid">
          <label className="sys-field">
            URL pública del panel
            <input
              value={cfg.survey_base_url}
              onChange={(e) => set("survey_base_url", e.target.value)}
              placeholder="https://soporte.sidesoft.com.ec"
            />
            <span style={{ fontSize: "0.75rem" }}>
              Dirección desde la que los clientes abren la encuesta (se agrega «/encuesta»). Debe ser accesible desde internet.
            </span>
          </label>
          <label className="sys-field">
            Módulos o procesos para capacitación (uno por línea)
            <textarea rows={8} value={modules} onChange={(e) => setModules(e.target.value)} />
            <span style={{ fontSize: "0.75rem" }}>La opción «Otro (especificar)» se agrega automáticamente.</span>
          </label>
        </div>
        {cfg.survey_enabled && !cfg.survey_base_url && (
          <div className="sys-msg sys-msg-warn">Indique la URL pública; sin ella la encuesta no se incluye en el correo.</div>
        )}
      </Card>

      <Card
        title="Contenido del correo"
        hint={<>Texto introductorio que va antes del informe. Variables disponibles: {VARIABLES.join(" ")}</>}
      >
        <div className="sys-grid">
          <label className="sys-field sys-field-wide">
            Asunto
            <input value={cfg.subject_template} onChange={(e) => set("subject_template", e.target.value)} required />
          </label>
          <label className="sys-field sys-field-wide">
            Cuerpo
            <textarea rows={12} value={cfg.body_template} onChange={(e) => set("body_template", e.target.value)} required />
          </label>
        </div>
      </Card>

      <Card
        title="Modo prueba"
        hint="Mientras esté activo, todos los correos (automáticos y manuales) se envían solo a los destinatarios de prueba, con el asunto «[PRUEBA]» y la lista de destinatarios reales en el cuerpo."
      >
        <label className="sys-check" style={{ marginBottom: "0.8rem" }}>
          <input type="checkbox" checked={cfg.test_mode} onChange={(e) => set("test_mode", e.target.checked)} />
          Modo prueba activo
        </label>
        <label className="sys-field">
          Destinatarios de prueba
          <input
            value={lists.test_recipients}
            onChange={(e) => setLists({ ...lists, test_recipients: e.target.value })}
            placeholder="kvelasco@sidesoft.com.ec"
          />
        </label>
      </Card>

      <div className="sys-actions" style={{ marginTop: 0 }}>
        <button type="submit" className="odoo-btn odoo-btn-primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar programación"}
        </button>
      </div>
      <NoticeBox notice={notice} />
    </form>
  );
}
