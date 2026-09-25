import { useEffect, useMemo, useState, type FormEvent } from "react";

import "./survey.css";

/** Página pública /encuesta (sin login). El enlace firmado del correo identifica proyecto y período. */

type Context = {
  project_name: string;
  period_label: string;
  date_from: string;
  date_to: string;
  training_modules: string[];
  other_module: string;
};

type Scores = { solution: number | null; response: number | null; quality: number | null };

const SCALE = [0, 1, 2, 3, 4, 5];

async function apiError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown };
    if (typeof j.detail === "string") return j.detail;
  } catch {
    /* sin cuerpo JSON */
  }
  return "No pudimos procesar su solicitud. Intente nuevamente en unos minutos.";
}

function readLink() {
  const q = new URLSearchParams(window.location.search);
  const ts = q.get("ts");
  const preset = ts !== null && /^[0-5]$/.test(ts) ? Number(ts) : null;
  return {
    link: { p: q.get("p") ?? "", desde: q.get("desde") ?? "", hasta: q.get("hasta") ?? "", s: q.get("s") ?? "0", k: q.get("k") ?? "" },
    preset,
  };
}

function storageKey(k: string) {
  return `coorddash-survey-sent-${k}`;
}

function wasSubmitted(k: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(k)) === "1";
  } catch {
    return false;
  }
}

function ScaleQuestion({
  id,
  title,
  help,
  low,
  high,
  value,
  onChange,
  error,
}: {
  id: string;
  title: string;
  help: string;
  low: string;
  high: string;
  value: number | null;
  onChange: (v: number) => void;
  error: boolean;
}) {
  return (
    <fieldset className="svy-question" aria-describedby={`${id}-help`}>
      <legend>
        {title} <span className="svy-req" aria-hidden>*</span>
      </legend>
      <p id={`${id}-help`} className="svy-help">
        {help}
      </p>
      <div className="svy-scale" role="radiogroup" aria-label={title}>
        {SCALE.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={value === n ? "svy-scale-btn svy-selected" : "svy-scale-btn"}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="svy-scale-labels">
        <span>{low}</span>
        <span>{high}</span>
      </div>
      {error && <p className="svy-error">Por favor, seleccione una calificación.</p>}
    </fieldset>
  );
}

export function SurveyPage() {
  const { link, preset } = useMemo(readLink, []);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [scores, setScores] = useState<Scores>({ solution: preset, response: null, quality: null });
  const [needsTraining, setNeedsTraining] = useState<boolean | null>(null);
  const [module, setModule] = useState("");
  const [moduleOther, setModuleOther] = useState("");
  const [name, setName] = useState("");
  const [observations, setObservations] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [done, setDone] = useState(() => wasSubmitted(link.k));

  useEffect(() => {
    document.title = "Encuesta de satisfacción · SIDESOFT";
    if (!link.p || !link.k) {
      setLoadErr("El enlace de la encuesta está incompleto.");
      return;
    }
    const q = new URLSearchParams(link);
    fetch(`/api/survey/context?${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await apiError(res));
        setCtx((await res.json()) as Context);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, [link]);

  const isOther = ctx != null && module === ctx.other_module;
  const trainingInvalid = needsTraining === null || (needsTraining && (!module || (isOther && !moduleOther.trim())));
  const invalid = scores.solution === null || scores.response === null || scores.quality === null || trainingInvalid;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (invalid || !ctx) return;
    setSending(true);
    setSendErr(null);
    try {
      const res = await fetch("/api/survey/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          link: { ...link, p: Number(link.p), s: Number(link.s) },
          answers: {
            score_solution_time: scores.solution,
            score_response_time: scores.response,
            score_quality: scores.quality,
            needs_training: needsTraining,
            training_module: needsTraining ? module : null,
            training_other: needsTraining && isOther ? moduleOther : null,
            respondent_name: name,
            observations,
          },
        }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      try {
        window.localStorage.setItem(storageKey(link.k), "1");
      } catch {
        /* almacenamiento no disponible: solo afecta el aviso de «ya respondida» */
      }
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (ex) {
      setSendErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="svy-page">
      <main className="svy-card">
        <header className="svy-header">
          <img src="/informe-header.jpg" alt="SIDESOFT" className="svy-logo" />
          <span className="svy-eyebrow">Encuesta de satisfacción</span>
        </header>

        {loadErr && (
          <section className="svy-state" role="alert">
            <h1>No pudimos abrir la encuesta</h1>
            <p>{loadErr}</p>
            <p>
              Le sugerimos utilizar el enlace del correo más reciente. Si el inconveniente persiste, comuníquese con nuestro
              equipo de soporte y con gusto le ayudaremos.
            </p>
          </section>
        )}

        {!loadErr && !ctx && <p className="svy-help">Cargando encuesta…</p>}

        {ctx && done && (
          <section className="svy-state svy-thanks" role="status">
            <div className="svy-check" aria-hidden>
              ✓
            </div>
            <h1>¡Gracias por su tiempo!</h1>
            <p>
              Hemos registrado sus respuestas sobre la atención brindada a <strong>{ctx.project_name}</strong> durante{" "}
              {ctx.period_label}.
            </p>
            <p>Su opinión es fundamental para seguir mejorando la calidad de nuestro servicio.</p>
            <p className="svy-sign">Departamento de Atención al Cliente · SIDESOFT CIA. LTDA.</p>
          </section>
        )}

        {ctx && !done && (
          <form onSubmit={submit} noValidate>
            <h1 className="svy-title">¿Cómo fue su experiencia con nuestro soporte?</h1>
            <p className="svy-intro">
              Estimado cliente de <strong>{ctx.project_name}</strong>: agradecemos la confianza depositada en SIDESOFT. Le
              invitamos a calificar la atención recibida durante <strong>{ctx.period_label}</strong>. Sus respuestas nos
              permiten mejorar continuamente; completar la encuesta le tomará menos de un minuto.
            </p>
            <p className="svy-legend">
              Califique cada aspecto de 0 a 5, donde 0 es la calificación más baja y 5 la más alta.
            </p>

            <ScaleQuestion
              id="q-solution"
              title="Tiempo de solución"
              help="¿Qué tan rápido se resolvieron sus requerimientos?"
              low="Muy lento"
              high="Muy rápido"
              value={scores.solution}
              onChange={(v) => setScores({ ...scores, solution: v })}
              error={showErrors && scores.solution === null}
            />
            <ScaleQuestion
              id="q-response"
              title="Tiempo de respuesta"
              help="¿Con qué rapidez recibió la primera atención de nuestro equipo?"
              low="Muy lento"
              high="Muy rápido"
              value={scores.response}
              onChange={(v) => setScores({ ...scores, response: v })}
              error={showErrors && scores.response === null}
            />
            <ScaleQuestion
              id="q-quality"
              title="Calidad de la atención"
              help="¿Las soluciones brindadas cumplieron con sus expectativas?"
              low="Muy deficiente"
              high="Excelente"
              value={scores.quality}
              onChange={(v) => setScores({ ...scores, quality: v })}
              error={showErrors && scores.quality === null}
            />

            <fieldset className="svy-question">
              <legend>
                Capacitación <span className="svy-req" aria-hidden>*</span>
              </legend>
              <p className="svy-help">¿Su equipo requiere capacitación en algún módulo o proceso del sistema?</p>
              <div className="svy-choice" role="radiogroup" aria-label="¿Requiere capacitación?">
                {[
                  { v: true, label: "Sí" },
                  { v: false, label: "No" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={needsTraining === o.v}
                    className={needsTraining === o.v ? "svy-choice-btn svy-selected" : "svy-choice-btn"}
                    onClick={() => setNeedsTraining(o.v)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {needsTraining && (
                <div className="svy-sub">
                  <label className="svy-label" htmlFor="svy-module">
                    Módulo o proceso
                  </label>
                  <select id="svy-module" value={module} onChange={(e) => setModule(e.target.value)} className="svy-input">
                    <option value="">Seleccione el módulo o proceso…</option>
                    {ctx.training_modules.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value={ctx.other_module}>Otro (especificar)</option>
                  </select>
                  {isOther && (
                    <input
                      className="svy-input"
                      style={{ marginTop: "0.6rem" }}
                      maxLength={200}
                      placeholder="Indique el módulo o proceso"
                      value={moduleOther}
                      onChange={(e) => setModuleOther(e.target.value)}
                      aria-label="Otro módulo o proceso"
                    />
                  )}
                </div>
              )}
              {showErrors && trainingInvalid && (
                <p className="svy-error">
                  {needsTraining === null
                    ? "Por favor, indique si su equipo requiere capacitación."
                    : "Por favor, indique el módulo o proceso."}
                </p>
              )}
            </fieldset>

            <div className="svy-question">
              <label className="svy-label" htmlFor="svy-name">
                Nombre y cargo <span className="svy-optional">(opcional)</span>
              </label>
              <input
                id="svy-name"
                className="svy-input"
                maxLength={150}
                autoComplete="name"
                placeholder="Ej.: María Pérez – Contadora"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="svy-question">
              <label className="svy-label" htmlFor="svy-obs">
                Comentarios o sugerencias <span className="svy-optional">(opcional)</span>
              </label>
              <textarea
                id="svy-obs"
                className="svy-input"
                rows={4}
                maxLength={3000}
                placeholder="Cuéntenos qué valoró de nuestra atención o qué podemos mejorar."
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
              />
            </div>

            {showErrors && invalid && (
              <p className="svy-error" role="alert">
                Revise las preguntas marcadas antes de enviar.
              </p>
            )}
            {sendErr && (
              <p className="svy-error" role="alert">
                {sendErr}
              </p>
            )}
            <button type="submit" className="svy-submit" disabled={sending}>
              {sending ? "Enviando…" : "Enviar respuestas"}
            </button>
            <p className="svy-privacy">
              Sus respuestas se utilizarán únicamente para evaluar y mejorar la calidad de nuestro servicio.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
