import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchCoordinationTicketBucketDetail,
  fetchCoordinationTicketsOutOfSlaDetail,
  type CoordinationAssigneeTicketsPerHourPayload,
  type CoordinationBucketDetailPayload,
  type CoordinationSummaryKpisPayload,
  type CoordinationTicketBucketKind,
  type CoordinationWeeklyAssigneePerformancePayload,
  type CoordinationWeeklyAssigneeSeriesItem,
  type CoordinationWeeklyEvolutionPayload,
  type CoordinationWeeklyEvolutionRow,
} from "./api";
import {
  fetchIndicatorsTicketsCreatedInRangeDetail,
  fetchIndicatorsTicketsOpenNowDetail,
  fetchIndicatorsTicketsResolvedInRangeDetail,
  type IndicatorsTicketKpiModalPayload,
  type ProjectType,
} from "../api";

const COORD_LINE_COLORS = ["#714b67", "#017e84", "#5b9bd5", "#ed7d31", "#70ad47", "#9e480e"];
const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";

function formatCoordWeekRangeEs(isoStart: string, isoEnd: string): string {
  const s = isoStart?.trim();
  const e = isoEnd?.trim();
  if (!s || !e) return "";
  const opt: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  const a = new Date(`${s}T12:00:00`);
  const b = new Date(`${e}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  return `${a.toLocaleDateString("es-EC", opt)} – ${b.toLocaleDateString("es-EC", opt)}`;
}

function CoordWeeklyStatTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: unknown; color?: string; payload?: unknown }>;
  label?: unknown;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown> | undefined;
  const mainLabel = String(label ?? row?.chartLabel ?? row?.period_label ?? "");
  const range = formatCoordWeekRangeEs(
    String(row?.week_period_start ?? ""),
    String(row?.week_period_end ?? ""),
  );
  return (
    <div
      style={{
        background: CHART_TOOLTIP_BG,
        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
        borderRadius: 8,
        fontSize: "0.82rem",
        color: CHART_TEXT,
        padding: "0.45rem 0.55rem",
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: range ? 4 : 8 }}>{mainLabel}</div>
      {range ? (
        <div style={{ fontWeight: 500, color: CHART_AXIS, marginBottom: 8, fontSize: "0.8rem" }}>{range}</div>
      ) : null}
      {payload.map((p, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <span style={{ color: p.color }}>{p.name}</span>
          <span>{String(p.value ?? "")}</span>
        </div>
      ))}
    </div>
  );
}

function CoordAssigneePerfTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: unknown; color?: string; dataKey?: unknown; payload?: unknown }>;
  label?: unknown;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown> | undefined;
  const mainLabel = String(label ?? row?.chartLabel ?? "");
  const range = formatCoordWeekRangeEs(
    String(row?.week_period_start ?? ""),
    String(row?.week_period_end ?? ""),
  );
  return (
    <div
      style={{
        background: CHART_TOOLTIP_BG,
        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
        borderRadius: 8,
        fontSize: "0.82rem",
        color: CHART_TEXT,
        padding: "0.45rem 0.55rem",
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: range ? 4 : 8 }}>{mainLabel}</div>
      {range ? (
        <div style={{ fontWeight: 500, color: CHART_AXIS, marginBottom: 8, fontSize: "0.8rem" }}>{range}</div>
      ) : null}
      {payload.map((p, i) => {
        const dk = String(p.dataKey ?? "");
        const raw = p.value;
        let shown: string;
        if (dk.startsWith("hours_")) {
          const n = typeof raw === "number" ? raw : Number(raw);
          shown = `${Number.isFinite(n) ? n.toFixed(2) : String(raw)} h`;
        } else {
          shown = String(raw ?? "");
        }
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span style={{ color: p.color }}>{p.name}</span>
            <span>{shown}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Leyendas que arrancan ocultas hasta activarlas en el gráfico semanal */
const WEEKLY_SERIES_OPTIONAL_OFF_KEYS: ReadonlySet<string> = new Set([
  "tickets_paused_events",
  "tickets_reopened_events",
  "tickets_out_of_sla",
]);

const WEEKLY_SERIES: readonly { key: keyof CoordinationWeeklyEvolutionRow; name: string }[] = [
  { key: "tickets_open_snapshot", name: "Abiertos (de los creados)" },
  { key: "tickets_open_historic_logs", name: "Abiertos (histórico, logs)" },
  { key: "tickets_created", name: "Creados" },
  { key: "tickets_resolved", name: "Resueltos" },
  { key: "tickets_paused_events", name: "Pausados (logs → en espera)" },
  { key: "tickets_reopened_events", name: "Reabiertos (logs)" },
  { key: "tickets_out_of_sla", name: "Fuera de SLA" },
];

/** Orden en rejilla «Resumen»: abiertos → iniciados → no iniciados → pausados → creados → reabiertos → resueltos → fuera de SLA */
type KpiModalKind =
  | "open"
  | "created"
  | "started"
  | "not_started"
  | "waiting"
  | "reopened"
  | "resolved"
  | "out_of_sla";

const BUCKET_KINDS: CoordinationTicketBucketKind[] = ["started", "not_started", "waiting", "reopened"];

function isBucketKind(kind: KpiModalKind): kind is CoordinationTicketBucketKind {
  return (BUCKET_KINDS as readonly string[]).includes(kind);
}

function SectionTitle({
  title,
  subtitle,
  styleHeader,
}: {
  title: string;
  subtitle?: string;
  styleHeader?: CSSProperties;
}) {
  return (
    <header style={{ marginBottom: "0.9rem", ...styleHeader }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>{title}</h2>
      {subtitle && (
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.88rem" }}>{subtitle}</p>
      )}
    </header>
  );
}

function fmtTiempoInvertido(seconds: number | null | undefined): string {
  const s = Number(seconds ?? 0);
  if (!Number.isFinite(s) || s <= 0) return "—";
  const hours = s / 3600;
  if (hours < 1) return `${Math.round((s / 60) * 10) / 10} min`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

function fmtTicketsPerHour(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(3)} t/h`;
}

function fmtResolvedPerRegHour(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(3)} res/h`;
}

function fmtAvgResolutionHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h >= 72) return `${(h / 24).toFixed(1)} d`;
  return `${h.toFixed(1)} h`;
}

const modalTitles: Record<KpiModalKind, string> = {
  open: "Tickets abiertos (estado actual)",
  created: "Tickets creados en el rango",
  started: "Tickets iniciados (en curso, asignado)",
  not_started: "Tickets no iniciados (nuevo o planificado)",
  waiting: "Tickets pausados (en espera)",
  reopened: "Tickets reabiertos",
  resolved: "Tickets resueltos en el rango",
  out_of_sla: "Tickets fuera de SLA (plazo TTR)",
};

function KpiModalSummaryLine({
  kind,
  indicatorsDateFrom,
  indicatorsDateTo,
  summaryCount,
  payload,
}: {
  kind: KpiModalKind;
  indicatorsDateFrom: string;
  indicatorsDateTo: string;
  summaryCount: number | null | undefined;
  payload: IndicatorsTicketKpiModalPayload | null;
}) {
  return (
    <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
      Rango de filtros: {payload?.date_from ?? indicatorsDateFrom} → {payload?.date_to ?? indicatorsDateTo}
      {kind === "open" ? (
        <> · Abiertos ahora mismo (sin cortar lista por fecha de creación). Tiempo mostrado: tareas en ese rango.</>
      ) : null}
      {kind === "reopened" ? (
        <>
          {" "}
          · Reabiertos: tickets que tras estar resuelto o cerrado vuelven a estar en curso (detección vía registros en
          glpi_logs).
        </>
      ) : null}
      {kind === "out_of_sla" ? (
        <>
          {" "}
          · Fuera de SLA: creados en el rango, con time_to_resolve en GLPI; resueltos/cerrados si el cierre superó el
          plazo; abiertos si el plazo ya venció (hora del servidor).
        </>
      ) : null}
      {payload && (
        <>
          {" "}
          · {payload.rows.length} ticket(s) en el listado
        </>
      )}
      {!payload && summaryCount != null && (
        <>
          {" "}
          · total en resumen: {summaryCount}
        </>
      )}
    </p>
  );
}

function CoordWeeklyChartLegend({
  payload,
  weeklySeriesOff,
  weeklyHoverKey,
  onHover,
  onLeave,
  onToggle,
  optionalOffByDefaultKeys,
}: {
  payload?: ReadonlyArray<{ value?: string; color?: string; dataKey?: unknown }>;
  weeklySeriesOff: Record<string, boolean>;
  weeklyHoverKey: string | null;
  onHover: (key: string) => void;
  onLeave: () => void;
  onToggle: (key: string) => void;
  /** Series que por defecto están ocultas (leyenda «opcional»). */
  optionalOffByDefaultKeys?: ReadonlySet<string>;
}) {
  if (!payload?.length) return null;
  return (
    <ul
      style={{
        listStyle: "none",
        margin: "0.35rem 0 0",
        padding: 0,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.55rem 1rem",
        justifyContent: "center",
        fontSize: "0.78rem",
        color: CHART_TEXT,
      }}
    >
      {payload.map((entry, i) => {
        const key = String(entry.dataKey ?? "");
        const off = !!weeklySeriesOff[key];
        const dimmedByHover = weeklyHoverKey != null && weeklyHoverKey !== key;
        const isOptional = optionalOffByDefaultKeys?.has(key) ?? false;
        const legendTitle =
          off && isOptional
            ? "Serie opcional oculta. Clic para mostrarla en el gráfico."
            : "Clic: mostrar u ocultar esta serie · Pasar el ratón: aislar la serie";
        return (
          <li
            key={`${key}-${i}`}
            role="button"
            tabIndex={0}
            onMouseEnter={() => onHover(key)}
            onMouseLeave={onLeave}
            onClick={() => onToggle(key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle(key);
              }
            }}
            title={legendTitle}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              userSelect: "none",
              opacity: off ? 0.42 : dimmedByHover ? 0.35 : 1,
              textDecoration: off ? "line-through" : undefined,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: entry.color ?? "#999",
                flexShrink: 0,
              }}
              aria-hidden
            />
            {entry.value ?? key}
          </li>
        );
      })}
    </ul>
  );
}

function sortRowsByCreacion(rows: IndicatorsTicketKpiModalPayload["rows"]) {
  return [...rows].sort((a, b) => {
    const fa = (a.fecha_creacion ?? "").trim();
    const fb = (b.fecha_creacion ?? "").trim();
    if (!fa && !fb) return a.ticket_id - b.ticket_id;
    if (!fa) return 1;
    if (!fb) return -1;
    const cmp = fa.localeCompare(fb);
    return cmp !== 0 ? cmp : a.ticket_id - b.ticket_id;
  });
}

type CoordIndicatorsSectionProps = {
  indicatorsDateFrom: string;
  indicatorsDateTo: string;
  setIndicatorsDateFrom: (v: string) => void;
  setIndicatorsDateTo: (v: string) => void;
  indicatorsProjectTypeId: number | null;
  setIndicatorsProjectTypeId: (v: number | null) => void;
  projectTypes: ProjectType[];
  projectTypesLoading: boolean;
  projectTypesErr: string | null;
  coordinationLoading: boolean;
  coordinationPageErr: string | null;
  coordinationWeeklyErr: string | null;
  coordinationAssigneeErr: string | null;
  coordinationProductivityErr: string | null;
  onRefresh: () => void;
  coordKpis: CoordinationSummaryKpisPayload | null;
  coordWeeklyEvolution: CoordinationWeeklyEvolutionPayload | null;
  coordWeeklyAssignee: CoordinationWeeklyAssigneePerformancePayload | null;
  coordAssigneeTicketsPerHour: CoordinationAssigneeTicketsPerHourPayload | null;
};

function KpiStatCard({
  label,
  cardTitle,
  statesHint,
  value,
  onOpen,
  disabled,
}: {
  label: string;
  cardTitle: string;
  /** Resumen de estados/criterio; se muestra al pasar el ratón sobre la tarjeta */
  statesHint: string;
  value: number | null | undefined;
  onOpen: () => void;
  disabled: boolean;
}) {
  const cardTitleAttr = `${statesHint} Clic en la cifra para ver el listado.`;
  return (
    <div
      title={cardTitleAttr}
      style={{
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "0.7rem 0.8rem",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "0.2rem",
        height: "100%",
      }}
    >
      <div
        style={{
          fontSize: "0.78rem",
          fontWeight: 650,
          color: "var(--text)",
          lineHeight: 1.3,
          wordBreak: "break-word",
        }}
      >
        {label.replace(/:\s*$/, "")}
      </div>
      <div
        style={{
          fontSize: "0.68rem",
          color: "var(--muted)",
          lineHeight: 1.25,
          flex: 1,
        }}
      >
        {cardTitle}
      </div>
      <button
        type="button"
        onClick={() => void onOpen()}
        disabled={disabled}
        title={cardTitleAttr}
        style={{
          display: "block",
          margin: "0.1rem 0 0",
          padding: "0.15rem 0 0",
          border: "none",
          borderTop: "1px solid var(--border)",
          background: "transparent",
          fontSize: "1.45rem",
          fontWeight: 800,
          lineHeight: 1.1,
          color: "var(--accent)",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          width: "100%",
        }}
      >
        {value ?? "—"}
      </button>
    </div>
  );
}

export function CoordIndicatorsSection(props: CoordIndicatorsSectionProps) {
  const {
    indicatorsDateFrom,
    indicatorsDateTo,
    setIndicatorsDateFrom,
    setIndicatorsDateTo,
    indicatorsProjectTypeId,
    setIndicatorsProjectTypeId,
    projectTypes,
    projectTypesLoading,
    projectTypesErr,
    coordinationLoading,
    coordinationPageErr,
    coordinationWeeklyErr,
    coordinationAssigneeErr,
    coordinationProductivityErr,
    onRefresh,
    coordKpis,
    coordWeeklyEvolution,
    coordWeeklyAssignee,
    coordAssigneeTicketsPerHour,
  } = props;

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailKind, setDetailKind] = useState<KpiModalKind | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailPayload, setDetailPayload] = useState<
    IndicatorsTicketKpiModalPayload | CoordinationBucketDetailPayload | null
  >(null);

  const [weeklySeriesOff, setWeeklySeriesOff] = useState<Record<string, boolean>>({});
  const [weeklyHoverKey, setWeeklyHoverKey] = useState<string | null>(null);

  const [perfTeamOff, setPerfTeamOff] = useState<Record<string, boolean>>({});
  const [perfTeamHover, setPerfTeamHover] = useState<string | null>(null);

  const toggleWeeklySeries = useCallback((key: string) => {
    setWeeklySeriesOff((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  const togglePerfTeamSeries = useCallback((key: string) => {
    setPerfTeamOff((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const k of WEEKLY_SERIES_OPTIONAL_OFF_KEYS) {
      next[k] = true;
    }
    setWeeklySeriesOff(next);
    setWeeklyHoverKey(null);
  }, [coordWeeklyEvolution?.date_from, coordWeeklyEvolution?.date_to, coordWeeklyEvolution?.project_type_id]);

  useEffect(() => {
    setPerfTeamOff({});
    setPerfTeamHover(null);
  }, [coordWeeklyAssignee?.date_from, coordWeeklyAssignee?.date_to, coordWeeklyAssignee?.project_type_id]);

  const closeDetailModal = useCallback(() => {
    setDetailOpen(false);
    setDetailKind(null);
    setDetailErr(null);
    setDetailPayload(null);
  }, []);

  const openDetailModal = useCallback(
    async (kind: KpiModalKind) => {
      if (!indicatorsDateFrom || !indicatorsDateTo) return;
      setDetailKind(kind);
      setDetailOpen(true);
      setDetailLoading(true);
      setDetailErr(null);
      setDetailPayload(null);
      try {
        if (isBucketKind(kind)) {
          setDetailPayload(
            await fetchCoordinationTicketBucketDetail(
              kind,
              indicatorsProjectTypeId,
              indicatorsDateFrom,
              indicatorsDateTo,
            ),
          );
          return;
        }
        const loader =
          kind === "created"
            ? fetchIndicatorsTicketsCreatedInRangeDetail
            : kind === "open"
              ? fetchIndicatorsTicketsOpenNowDetail
              : kind === "out_of_sla"
                ? fetchCoordinationTicketsOutOfSlaDetail
                : fetchIndicatorsTicketsResolvedInRangeDetail;
        setDetailPayload(await loader(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo));
      } catch (e) {
        setDetailErr(e instanceof Error ? e.message : String(e));
      } finally {
        setDetailLoading(false);
      }
    },
    [indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo],
  );

  const createdCount = coordKpis?.tickets_created_in_range ?? null;
  const resolvedCount = coordKpis?.tickets_resolved_in_range ?? null;
  const openCount = coordKpis?.tickets_open_now ?? null;
  const startedCount = coordKpis?.tickets_started_now ?? null;
  const notStartedCount = coordKpis?.tickets_not_started_now ?? null;
  const waitingCount = coordKpis?.tickets_waiting_now ?? null;
  const reopenedCount = coordKpis?.tickets_reopened_now ?? null;
  const outOfSlaCount = coordKpis?.tickets_out_of_sla_in_range ?? null;

  const summaryCountForModal =
    detailKind === "created"
      ? createdCount
      : detailKind === "open"
        ? openCount
        : detailKind === "resolved"
          ? resolvedCount
          : detailKind === "started"
            ? startedCount
            : detailKind === "not_started"
              ? notStartedCount
              : detailKind === "waiting"
                ? waitingCount
                : detailKind === "reopened"
                  ? reopenedCount
                  : detailKind === "out_of_sla"
                    ? outOfSlaCount
                    : null;

  const sortedDetailRows = useMemo(
    () => (detailPayload ? sortRowsByCreacion(detailPayload.rows) : []),
    [detailPayload],
  );

  const emptyDetailMessages: Record<KpiModalKind, string> = {
    open: "No hay tickets abiertos con los filtros actuales.",
    created: "No hay tickets creados en este rango con los filtros actuales.",
    started: "No hay tickets iniciados con los filtros actuales.",
    not_started: "No hay tickets no iniciados con los filtros actuales.",
    waiting: "No hay tickets en espera con los filtros actuales.",
    reopened: "No hay tickets reabiertos con los filtros actuales.",
    resolved: "No hay tickets resueltos en este rango con los filtros actuales.",
    out_of_sla: "No hay tickets fuera de SLA (en este criterio) con los filtros actuales.",
  };

  const emptyDetailMessage = detailKind != null ? emptyDetailMessages[detailKind] : "";

  const weeklyChartData = useMemo(() => {
    if (!coordWeeklyEvolution?.rows.length) return [];
    return coordWeeklyEvolution.rows.map((r) => ({
      ...r,
      chartLabel: r.period_label,
    }));
  }, [coordWeeklyEvolution]);

  const perfAssigneeSeriesResolved: CoordinationWeeklyAssigneeSeriesItem[] = useMemo(() => {
    const def = coordWeeklyAssignee?.assignee_series;
    if (def?.length) return def;
    const weeks = coordWeeklyAssignee?.weeks ?? [];
    const acc = new Map<
      number,
      { full_name: string; login: string | null; chart_key: string; seconds: number }
    >();
    for (const w of weeks) {
      for (const a of w.assignees) {
        const sec = a.actiontime_seconds ?? 0;
        const cur = acc.get(a.user_id);
        if (!cur) {
          acc.set(a.user_id, {
            full_name: a.full_name,
            login: a.login ?? null,
            chart_key: `u${a.user_id}`,
            seconds: sec,
          });
        } else {
          cur.seconds += sec;
        }
      }
    }
    return [...acc.entries()]
      .sort((x, y) => y[1].seconds - x[1].seconds || x[1].full_name.localeCompare(y[1].full_name, "es"))
      .map(([user_id, v]) => ({
        user_id,
        login: v.login ?? "",
        full_name: v.full_name,
        chart_key: v.chart_key,
      }));
  }, [coordWeeklyAssignee]);

  const perfPerformanceChartData = useMemo(() => {
    const weeks = coordWeeklyAssignee?.weeks ?? [];
    const series = perfAssigneeSeriesResolved;
    if (!weeks.length || !series.length) return [];
    return weeks.map((w) => {
      const row: Record<string, string | number> = {
        chartLabel: w.period_label,
        week_period_start: w.week_period_start ?? "",
        week_period_end: w.week_period_end ?? "",
      };
      for (const s of series) {
        const a =
          w.assignees.find((x) => x.user_id === s.user_id) ??
          (s.login ? w.assignees.find((x) => x.login === s.login) : undefined);
        const t = a?.tickets_worked ?? 0;
        const sec = a?.actiontime_seconds ?? 0;
        row[`tickets_${s.chart_key}`] = t;
        row[`hours_${s.chart_key}`] = Math.round((sec / 3600) * 100) / 100;
      }
      return row;
    });
  }, [coordWeeklyAssignee, perfAssigneeSeriesResolved]);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "1.2rem",
          }}
        >
          <SectionTitle
            title="Filtros"
            subtitle="La fecha de inicio, fecha fin y tipo de proyecto coinciden con los de «Indicadores». Pulse «Actualizar» para cargar los totales del resumen."
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "0.85rem",
              marginTop: "0.9rem",
              alignItems: "end",
            }}
          >
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
                Fecha inicio
              </label>
              <input
                type="date"
                value={indicatorsDateFrom}
                onChange={(e) => setIndicatorsDateFrom(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface2)",
                  color: "var(--text)",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Fecha fin</label>
              <input
                type="date"
                value={indicatorsDateTo}
                onChange={(e) => setIndicatorsDateTo(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface2)",
                  color: "var(--text)",
                }}
              />
            </div>
            <div style={{ gridColumn: "span 2", minWidth: 0 }}>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Tipo de proyecto</label>
              {projectTypesLoading && (
                <p style={{ color: "var(--muted)", fontSize: "0.86rem", margin: 0 }}>Cargando tipos…</p>
              )}
              {projectTypesErr && (
                <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", margin: 0 }}>Error: {projectTypesErr}</p>
              )}
              {!projectTypesLoading && !projectTypesErr && (
                <select
                  value={indicatorsProjectTypeId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setIndicatorsProjectTypeId(v === "" ? null : Number(v));
                  }}
                  disabled={!projectTypes.length}
                  style={{
                    width: "100%",
                    maxWidth: "480px",
                    padding: "0.55rem 0.65rem",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface2)",
                    color: "var(--text)",
                    fontSize: "0.9rem",
                  }}
                >
                  {!projectTypes.length ? (
                    <option value="">No hay tipos de proyecto en GLPI</option>
                  ) : (
                    <>
                      <option value="">Todos los tipos</option>
                      {projectTypes.map((pt) => (
                        <option key={pt.id} value={pt.id}>
                          {pt.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => void onRefresh()}
                disabled={coordinationLoading || !indicatorsDateFrom || !indicatorsDateTo}
                style={{
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  border: "none",
                  borderRadius: 8,
                  padding: "0.5rem 0.95rem",
                  fontWeight: 700,
                  cursor: coordinationLoading ? "wait" : "pointer",
                }}
              >
                {coordinationLoading ? "Cargando…" : "Actualizar"}
              </button>
            </div>
          </div>
        </section>

        {coordinationPageErr && (
          <p style={{ color: "var(--danger-text)", fontSize: "0.88rem", margin: 0 }}>
            Error al cargar indicadores coordinados: {coordinationPageErr}
          </p>
        )}

        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "1.2rem",
          }}
        >
          <SectionTitle
            title="Resumen"
            subtitle="Creados y resueltos con fecha en el rango. Abiertos, iniciados, no iniciados, pausados y reabiertos según el estado actual (la lista detallada de abiertos no se corta solo por fecha de creación). Fuera de SLA: entre los creados en el rango, incumplen el plazo TTR de GLPI (time_to_resolve) en cualquier estado. El tiempo en los modales usa tareas en el rango. Pulse cada cifra para el detalle; el listado se ordena por fecha de creación."
          />
          {coordinationLoading && (
            <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando totales…</p>
          )}
          {!coordinationLoading && coordKpis != null && (
            <div className="coord-kpi-grid">
              <KpiStatCard
                label="Total tickets abiertos:"
                cardTitle="Tickets abiertos ahora"
                statesHint="Estados: Nuevo, En curso, Planificado y En espera — todo lo que en GLPI no está en Resuelto ni Cerrado (instantáneo; el total no filtra por fecha de creación)."
                value={openCount}
                disabled={!indicatorsDateFrom || !indicatorsDateTo}
                onOpen={() => void openDetailModal("open")}
              />
              <KpiStatCard
                label="Total tickets iniciados:"
                cardTitle="En curso (asignado)"
                statesHint="Estado: En curso (GLPI «processing», id. típico 2). Tickets en curso en este momento."
                value={startedCount}
                disabled={!indicatorsDateFrom || !indicatorsDateTo}
                onOpen={() => void openDetailModal("started")}
              />
              <KpiStatCard
                label="Total de tickets no iniciados:"
                cardTitle="Nuevo o planificado"
                statesHint="Estados: Nuevo y Planificado (ids. 1 y 3 en el criterio de coordinación). Aún no en curso ni en espera según este reparto."
                value={notStartedCount}
                disabled={!indicatorsDateFrom || !indicatorsDateTo}
                onOpen={() => void openDetailModal("not_started")}
              />
              <KpiStatCard
                label="Total de tickets pausados:"
                cardTitle="En espera"
                statesHint="Estado: En espera (GLPI «waiting», id. típico 4). Pausados / en espera ahora."
                value={waitingCount}
                disabled={!indicatorsDateFrom || !indicatorsDateTo}
                onOpen={() => void openDetailModal("waiting")}
              />
              <KpiStatCard
                label="Total de tickets creados:"
                cardTitle="Tickets creados en rango"
                statesHint="Criterio temporal: fecha de apertura del ticket dentro del rango de filtros (todas piezas de estados que cumplan la fecha)."
                value={createdCount}
                disabled={!indicatorsDateFrom || !indicatorsDateTo}
                onOpen={() => void openDetailModal("created")}
              />
              <KpiStatCard
                label="Total de tickets reabiertos:"
                cardTitle="Tras resuelto o cerrado, vuelven a curso"
                statesHint="Estado actual distinto de Resuelto y Cerrado, y el historial en glpi_logs indica que salieron de Resuelto/Cerrado hacia otro estado (reapertura detectada por logs)."
                value={reopenedCount}
                disabled={!indicatorsDateFrom || !indicatorsDateTo}
                onOpen={() => void openDetailModal("reopened")}
              />
              <KpiStatCard
                label="Total de tickets resueltos:"
                cardTitle="Tickets resueltos en rango"
                statesHint="Estados: Resuelto o Cerrado (según configuración del API) con solvedate dentro del rango de filtros."
                value={resolvedCount}
                disabled={!indicatorsDateFrom || !indicatorsDateTo}
                onOpen={() => void openDetailModal("resolved")}
              />
              <KpiStatCard
                label="Total de tickets fuera de SLA:"
                cardTitle="Plazo TTR incumplido (todos los estados)"
                statesHint="Entre tickets creados en el rango con plazo TTR (time_to_resolve) en GLPI: incumplen si el cierre superó el plazo o, si siguen abiertos, si ya venció respecto a la hora del servidor."
                value={outOfSlaCount}
                disabled={!indicatorsDateFrom || !indicatorsDateTo}
                onOpen={() => void openDetailModal("out_of_sla")}
              />
            </div>
          )}
        </section>

        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "1.2rem",
          }}
        >
          <SectionTitle
            title="Evolución semanal (serie estadística)"
            subtitle="Por semana ISO. Abiertos (de los creados): cohorte creada en el rango que hoy sigue sin resuelto/cerrado. Abiertos (histórico, logs): al corte de cada semana, cuántos no estaban resuelto/cerrado según glpi_logs (y GLPI_TICKET_LOG_SO_STATUS), aunque ahora estén cerrados; si no hay líneas de estado, se usa t.status. Creados y resueltos: por fecha de apertura o solución. Por defecto solo se muestran Abiertos (dos series), Creados y Resueltos; el resto oculto hasta activarlo en la leyenda."
          />
          {coordinationWeeklyErr && (
            <p style={{ color: "var(--danger-text)", fontSize: "0.88rem", margin: "0.65rem 0 0" }}>
              Error al cargar evolución semanal: {coordinationWeeklyErr}
            </p>
          )}
          {!coordinationWeeklyErr && coordinationLoading && (
            <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando evolución…</p>
          )}
          {!coordinationWeeklyErr &&
            !coordinationLoading &&
            coordWeeklyEvolution &&
            weeklyChartData.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                No hay semanas en el rango seleccionado.
              </p>
            )}
          {!coordinationWeeklyErr && weeklyChartData.length > 0 && (
            <div style={{ width: "100%", marginTop: "0.85rem" }}>
              <ResponsiveContainer width="100%" height={420}>
                <LineChart data={weeklyChartData} margin={{ top: 8, right: 8, left: 4, bottom: 56 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="chartLabel"
                    tick={{ fill: CHART_TEXT, fontSize: 10 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    angle={-28}
                    textAnchor="end"
                    height={52}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: CHART_TEXT, fontSize: 11 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    width={40}
                  />
                  <Tooltip content={CoordWeeklyStatTooltip} />
                  <Legend
                    wrapperStyle={{ paddingTop: 8 }}
                    content={(legendProps) => (
                      <CoordWeeklyChartLegend
                        payload={legendProps.payload}
                        weeklySeriesOff={weeklySeriesOff}
                        weeklyHoverKey={weeklyHoverKey}
                        onHover={setWeeklyHoverKey}
                        onLeave={() => setWeeklyHoverKey(null)}
                        onToggle={toggleWeeklySeries}
                        optionalOffByDefaultKeys={WEEKLY_SERIES_OPTIONAL_OFF_KEYS}
                      />
                    )}
                  />
                  {WEEKLY_SERIES.map((s, i) => {
                    const showLine =
                      weeklyHoverKey != null ? weeklyHoverKey === s.key : !weeklySeriesOff[s.key];
                    return (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.name}
                        stroke={COORD_LINE_COLORS[i % COORD_LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                        hide={!showLine}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "1.2rem",
          }}
        >
          <SectionTitle
            title="Rendimiento del equipo (por semana ISO)"
            subtitle="Indicadores solo para los logins configurados en el API (`GLPI_COORD_PERFORMANCE_LOGINS`; por defecto: ejuma, DCAZA, NRIVADENEIRA, sconsultor). Eje izquierdo: tickets con tiempo por semana; eje derecho: horas de tarea (línea discontinua). Vacío en la variable = todos los técnicos."
          />
          {coordinationAssigneeErr && (
            <p style={{ color: "var(--danger-text)", fontSize: "0.88rem", margin: "0.65rem 0 0" }}>
              Error al cargar rendimiento por asignado: {coordinationAssigneeErr}
            </p>
          )}
          {!coordinationAssigneeErr && coordinationLoading && (
            <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
              Cargando rendimiento por técnico…
            </p>
          )}
          {!coordinationAssigneeErr &&
            !coordinationLoading &&
            coordWeeklyAssignee &&
            coordWeeklyAssignee.weeks.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                No hay semanas en el rango seleccionado.
              </p>
            )}
          {!coordinationAssigneeErr &&
            !coordinationLoading &&
            coordWeeklyAssignee &&
            coordWeeklyAssignee.weeks.length > 0 &&
            perfAssigneeSeriesResolved.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                No hay técnicos con datos en el alcance seleccionado.
              </p>
            )}
          {!coordinationAssigneeErr &&
            !coordinationLoading &&
            perfPerformanceChartData.length > 0 &&
            perfAssigneeSeriesResolved.length > 0 && (
              <div style={{ width: "100%", marginTop: "0.85rem" }}>
                <ResponsiveContainer width="100%" height={460}>
                  <LineChart
                    data={perfPerformanceChartData}
                    margin={{ top: 8, right: 18, left: 6, bottom: 56 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis
                      dataKey="chartLabel"
                      tick={{ fill: CHART_TEXT, fontSize: 10 }}
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      angle={-28}
                      textAnchor="end"
                      height={52}
                      interval={0}
                    />
                    <YAxis
                      yAxisId="tickets"
                      allowDecimals={false}
                      tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      width={42}
                      label={{
                        value: "Tickets",
                        angle: -90,
                        position: "insideLeft",
                        fill: CHART_AXIS,
                        fontSize: 11,
                        offset: 2,
                      }}
                    />
                    <YAxis
                      yAxisId="hours"
                      orientation="right"
                      allowDecimals
                      tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      width={48}
                      label={{
                        value: "Horas",
                        angle: 90,
                        position: "insideRight",
                        fill: CHART_AXIS,
                        fontSize: 11,
                        offset: 4,
                      }}
                    />
                    <Tooltip content={CoordAssigneePerfTooltip} />
                    <Legend
                      wrapperStyle={{ paddingTop: 8 }}
                      content={(legendProps) => (
                        <CoordWeeklyChartLegend
                          payload={legendProps.payload}
                          weeklySeriesOff={perfTeamOff}
                          weeklyHoverKey={perfTeamHover}
                          onHover={setPerfTeamHover}
                          onLeave={() => setPerfTeamHover(null)}
                          onToggle={togglePerfTeamSeries}
                        />
                      )}
                    />
                    {perfAssigneeSeriesResolved.map((s, i) => {
                      const col = COORD_LINE_COLORS[i % COORD_LINE_COLORS.length];
                      const label = s.login ? `${s.full_name} (${s.login})` : s.full_name;
                      const dkT = `tickets_${s.chart_key}`;
                      const dkH = `hours_${s.chart_key}`;
                      const showT =
                        perfTeamHover != null ? perfTeamHover === dkT : !perfTeamOff[dkT];
                      const showH =
                        perfTeamHover != null ? perfTeamHover === dkH : !perfTeamOff[dkH];
                      return (
                        <Fragment key={s.chart_key}>
                          <Line
                            yAxisId="tickets"
                            type="monotone"
                            dataKey={dkT}
                            name={`${label} · tickets`}
                            stroke={col}
                            strokeWidth={2}
                            dot={{ r: 3 }}
                            connectNulls
                            hide={!showT}
                          />
                          <Line
                            yAxisId="hours"
                            type="monotone"
                            dataKey={dkH}
                            name={`${label} · horas`}
                            stroke={col}
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            dot={{ r: 3 }}
                            connectNulls
                            hide={!showH}
                          />
                        </Fragment>
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
        </section>

        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "1.2rem",
          }}
        >
          <SectionTitle
            title="Análisis de productividad por recurso"
            subtitle="Mismo rango y filtros que el gráfico. Trabajo en tareas: tickets distintos con tiempo registrado, horas de actiontime y t/h. Resolución: tickets marcados resueltos/cerrados con solvedate en el rango donde el usuario es técnico asignado; tiempo medio = media desde apertura (t.date) hasta solvedate. Resueltos/h registrada = cierres en rango ÷ horas de tarea en rango (cuántos cierres por hora cargada)."
          />
          {coordinationProductivityErr && (
            <p style={{ color: "var(--danger-text)", fontSize: "0.88rem", margin: "0.65rem 0 0" }}>
              Error al cargar análisis tickets/hora: {coordinationProductivityErr}
            </p>
          )}
          {!coordinationProductivityErr && coordinationLoading && (
            <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando análisis…</p>
          )}
          {!coordinationProductivityErr &&
            !coordinationLoading &&
            coordAssigneeTicketsPerHour &&
            coordAssigneeTicketsPerHour.rows.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                No hay datos para mostrar.
              </p>
            )}
          {!coordinationProductivityErr &&
            !coordinationLoading &&
            coordAssigneeTicketsPerHour &&
            coordAssigneeTicketsPerHour.rows.length > 0 && (
              <div
                style={{
                  marginTop: "0.85rem",
                  overflowX: "auto",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                  <thead>
                    <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                      <th style={{ padding: "0.6rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Recurso</th>
                      <th style={{ padding: "0.6rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Login</th>
                      <th style={{ padding: "0.6rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Tickets con trabajo</th>
                      <th style={{ padding: "0.6rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Horas registradas</th>
                      <th style={{ padding: "0.6rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>t/h (trabajo)</th>
                      <th style={{ padding: "0.6rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Resueltos (rango)</th>
                      <th style={{ padding: "0.6rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>
                        Tiempo medio solución
                      </th>
                      <th style={{ padding: "0.6rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>
                        Resueltos/h registrada
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {coordAssigneeTicketsPerHour.rows.map((r, i) => (
                      <tr
                        key={`${r.user_id}-${r.login ?? i}`}
                        style={{
                          borderTop: "1px solid var(--border)",
                          background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                        }}
                      >
                        <td style={{ padding: "0.55rem 0.85rem" }}>{r.full_name}</td>
                        <td style={{ padding: "0.55rem 0.85rem", fontSize: "0.82rem" }}>
                          {r.login?.trim() ? r.login : "—"}
                        </td>
                        <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{r.tickets_worked}</td>
                        <td style={{ padding: "0.55rem 0.85rem" }}>{fmtTiempoInvertido(r.actiontime_seconds)}</td>
                        <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{fmtTicketsPerHour(r.tickets_per_hour)}</td>
                        <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{r.tickets_resolved_in_range}</td>
                        <td style={{ padding: "0.55rem 0.85rem" }}>{fmtAvgResolutionHours(r.avg_resolution_hours)}</td>
                        <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>
                          {fmtResolvedPerRegHour(r.resolved_per_registered_hour)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      </div>

      {detailOpen && detailKind != null && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(33, 37, 41, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
          }}
          onClick={closeDetailModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="coord-kpi-modal-title"
            style={{
              background: "var(--surface)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              padding: "1.25rem 1.5rem",
              maxWidth: "1120px",
              width: "100%",
              maxHeight: "82vh",
              overflowY: "auto",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
              <div>
                <h2 id="coord-kpi-modal-title" style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                  {modalTitles[detailKind]}
                </h2>
                <KpiModalSummaryLine
                  kind={detailKind}
                  indicatorsDateFrom={indicatorsDateFrom}
                  indicatorsDateTo={indicatorsDateTo}
                  summaryCount={summaryCountForModal}
                  payload={detailPayload}
                />
              </div>
              <button
                type="button"
                onClick={closeDetailModal}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "0.25rem 0.7rem",
                  color: "var(--muted)",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Cerrar
              </button>
            </div>

            {detailLoading && <p style={{ marginTop: "1rem", color: "var(--muted)" }}>Cargando tickets…</p>}
            {detailErr && (
              <p style={{ color: "var(--danger-text)", marginTop: "0.85rem", fontSize: "0.9rem" }}>
                Error: {detailErr}
              </p>
            )}
            {detailPayload && !detailLoading && (
              <div
                style={{ marginTop: "0.9rem", overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
              >
                {sortedDetailRows.length === 0 ? (
                  <p style={{ margin: "0.85rem", color: "var(--muted)", fontSize: "0.86rem" }}>{emptyDetailMessage}</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                    <thead>
                      <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>N.º ticket</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Título</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Proyecto</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Estado</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Solicitante</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Tiempo invertido</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Fecha de creación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDetailRows.map((r, i) => (
                        <tr
                          key={`${r.ticket_id}-${i}`}
                          style={{
                            borderTop: "1px solid var(--border)",
                            background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                          }}
                        >
                          <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{r.ticket_id}</td>
                          <td style={{ padding: "0.55rem 0.85rem" }}>{r.titulo?.trim() ? r.titulo : "—"}</td>
                          <td style={{ padding: "0.55rem 0.85rem", fontSize: "0.82rem" }}>
                            {r.proyecto?.trim() ? r.proyecto : "—"}
                          </td>
                          <td style={{ padding: "0.55rem 0.85rem", fontSize: "0.82rem" }}>
                            {r.estado?.trim() ? r.estado : "—"}
                          </td>
                          <td style={{ padding: "0.55rem 0.85rem", fontSize: "0.82rem" }}>
                            {r.solicitante?.trim() ? r.solicitante : "—"}
                          </td>
                          <td style={{ padding: "0.55rem 0.85rem" }}>{fmtTiempoInvertido(r.actiontime_seconds)}</td>
                          <td style={{ padding: "0.55rem 0.85rem", fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                            {r.fecha_creacion?.trim() ? r.fecha_creacion : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
