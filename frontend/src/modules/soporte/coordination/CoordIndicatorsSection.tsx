import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchCoordinationTicketBucketDetail,
  fetchCoordinationTicketsOutOfSlaDetail,
  fetchCoordinationWeeklyTicketsByRequestTypeDetail,
  type CoordinationBucketDetailPayload,
  type CoordinationSummaryKpisPayload,
  type CoordinationTicketBucketKind,
  type CoordinationWeeklyAssigneePerformancePayload,
  type CoordinationWeeklyAssigneeSeriesItem,
  type CoordinationWeeklyEvolutionPayload,
  type CoordinationWeeklyEvolutionRow,
  type CoordinationResolvedEffortPayload,
  type CoordinationTicketTimeParetoPayload,
  type CoordinationWeeklyTechnicianEvolutionPayload,
  type CoordinationWeeklyTicketsByRequestTypePayload,
  type CoordinationWeeklyRtDetailPayload,
  type AiEstimationFieldSliceData,
  type AiUsageSummaryPayload,
  type AiUsageWeeklyPayload,
  type AiUsageByStatusPayload,
} from "./api";
import { ProblemsSupportIndicatorsSection } from "../components/ProblemsSupportIndicatorsSection";
import { AiEstimationEfficiencySection } from "../components/AiEstimationEfficiencySection";
import { AiUsageSection } from "../components/AiUsageSection";
import { KnowledgeBaseSection } from "../components/KnowledgeBaseSection";
import { TechnicianWeeklyEvolutionSection } from "../components/TechnicianWeeklyEvolutionSection";
import { ResolvedEffortByResolutionSection } from "../components/ResolvedEffortByResolutionSection";
import { TicketTimeParetoSection } from "../components/TicketTimeParetoSection";
import { CollapsibleSection } from "../components/CollapsibleSection";
import {
  fetchIndicatorsTicketsCreatedInRangeDetail,
  fetchIndicatorsTicketsOpenNowDetail,
  fetchIndicatorsTicketsResolvedInRangeDetail,
  type IndicatorsProblemsSupportPayload,
  type IndicatorsTicketKpiModalPayload,
  type ProjectType,
  type SupportProject,
} from "../../../api";
import { formatIsoWeekRangeEs, IsoWeekAxisTick } from "../chartIsoWeekAxis";

const COORD_LINE_COLORS = ["#714b67", "#017e84", "#c77d1a", "#5b9bd5", "#ed7d31", "#70ad47", "#9e480e"];

/** Serie global en «Rendimiento del equipo»: total tickets resueltos/cerrados por semana (evolución semanal). */
const PERF_TEAM_RESOLVED_BAR_KEY = "tickets_resolved_team";
const PERF_TEAM_RESOLVED_BAR_COLOR = "#495057";

/** Hay dato operativo en la barra de la semana (equipo o alguno de los técnicos listados). */
function perfPerformanceRowHasActivity(
  row: Record<string, string | number>,
  assigneeSeries: ReadonlyArray<{ chart_key: string }>,
): boolean {
  const team = Number(row[PERF_TEAM_RESOLVED_BAR_KEY] ?? 0);
  if (Number.isFinite(team) && team > 0) return true;
  for (const s of assigneeSeries) {
    const k = s.chart_key;
    if (Number(row[`tickets_assigned_${k}`] ?? 0) > 0) return true;
    if (Number(row[`tickets_resolved_assignee_${k}`] ?? 0) > 0) return true;
    if (Number(row[`hours_effort_${k}`] ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Filas para medias / análisis: se omiten semanas iniciales con todo en cero (suelen ser parciales y distorsionan la media).
 * Si no hubiera ninguna semana con datos, se devuelven todas las filas.
 */
function slicePerfChartRowsForAverages(
  rows: ReadonlyArray<Record<string, string | number>>,
  assigneeSeries: ReadonlyArray<{ chart_key: string }>,
): Record<string, string | number>[] {
  if (!rows.length) return [];
  let start = 0;
  while (start < rows.length && !perfPerformanceRowHasActivity(rows[start]!, assigneeSeries)) {
    start += 1;
  }
  const sliced = rows.slice(start);
  return sliced.length > 0 ? sliced : [...rows];
}

/** Alineado al backend `_normalize_request_type_label` (orden de fuentes en leyenda). */
function normRequestTypeLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

function fmtBarLabelTickets(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n));
}

function fmtBarLabelHours(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(1);
}
const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";

function CoordWeeklyStatTooltip({
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
  const mainLabel = String(label ?? row?.chartLabel ?? row?.period_label ?? "");
  const range = formatIsoWeekRangeEs(
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
        const isHours = dk.startsWith("hours_");
        const raw = Number(p.value);
        const display =
          isHours && Number.isFinite(raw) ? `${raw.toFixed(raw < 10 ? 1 : 0)} h` : String(p.value ?? "");
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
            <span>{display}</span>
          </div>
        );
      })}
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
  const range = formatIsoWeekRangeEs(
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
        if (dk.startsWith("hours_effort_")) {
          const n = typeof raw === "number" ? raw : Number(raw);
          shown = `${Number.isFinite(n) ? n.toFixed(2) : String(raw)} h`;
        } else if (
          dk === PERF_TEAM_RESOLVED_BAR_KEY ||
          dk.startsWith("tickets_assigned_") ||
          dk.startsWith("tickets_resolved_assignee_")
        ) {
          shown = `${raw ?? 0} tickets`;
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

/** Jornada soporte nominal para comparar utilización y capacidad teórica (horas imputadas GLPI). */
const EXPECTED_WEEKLY_SUPPORT_HOURS = 36;
/** Semanas equivalentes por mes natural (promedio ISO). */
const PERF_MONTHLY_WEEKS = 4.33;

type WeeklyAssigneePerfPoint = {
  chartLabel: string;
  /** Tickets asignados al técnico en la semana (evento en `glpi_logs`). */
  assigned: number;
  resolved: number;
  /** Horas imputadas como técnico de tarea en la semana (cualquier ticket). */
  hours: number;
};

type AssigneeOperationalInsight = {
  weekly: WeeklyAssigneePerfPoint[];
  weekCount: number;
  sumAssigned: number;
  sumResolved: number;
  sumHours: number;
  avgAssigned: number;
  avgResolved: number;
  avgHours: number;
  utilizationPct: number;
  hoursPerTicketAssigned: number | null;
  hoursPerTicketResolved: number | null;
  /** resueltos / asignados en el periodo agregado; no implica balance semanal cerrado. */
  ratioResolvedOverAssigned: number | null;
  capacityTicketsWeekAt33: number | null;
  capacityResolvedWeekAt33: number | null;
  capacityTicketsMonthAt33: number | null;
  capacityResolvedMonthAt33: number | null;
  trendAssignedLabel: string;
  trendResolvedLabel: string;
  trendHoursLabel: string;
  minMaxAssigned: { min: WeeklyAssigneePerfPoint; max: WeeklyAssigneePerfPoint };
  minMaxResolved: { min: WeeklyAssigneePerfPoint; max: WeeklyAssigneePerfPoint };
  minMaxHours: { min: WeeklyAssigneePerfPoint; max: WeeklyAssigneePerfPoint };
  irregularityHoursCv: number;
  /** Texto breve para gerencia (2–4 frases). */
  executiveSummary: string;
};

function perfMean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function perfStdSample(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = perfMean(nums);
  return Math.sqrt(nums.reduce((s, x) => s + (x - m) ** 2, 0) / (nums.length - 1));
}

/** Compara media primera vs segunda mitad del periodo (tendencia operativa simple). */
function perfTrendHalfSpanish(values: number[]): string {
  if (values.length < 2) return "sin datos suficientes para tendencia";
  const mid = Math.max(1, Math.floor(values.length / 2));
  const first = values.slice(0, mid);
  const second = values.slice(mid);
  const m1 = perfMean(first);
  const m2 = perfMean(second);
  const delta = m2 - m1;
  const noise = Math.max(0.25, m1 * 0.12);
  if (delta > noise) return "alza respecto al inicio del periodo";
  if (delta < -noise) return "descenso respecto al inicio del periodo";
  return "relativamente estable entre mitades del periodo";
}

function perfMinMaxWeek(
  weekly: WeeklyAssigneePerfPoint[],
  key: "assigned" | "resolved" | "hours",
): { min: WeeklyAssigneePerfPoint; max: WeeklyAssigneePerfPoint } {
  const first = weekly[0];
  let min = first;
  let max = first;
  for (const w of weekly) {
    if (w[key] < min[key]) min = w;
    if (w[key] > max[key]) max = w;
  }
  return { min, max };
}

function buildAssigneeOperationalInsight(weekly: WeeklyAssigneePerfPoint[]): AssigneeOperationalInsight {
  const emptyPoint: WeeklyAssigneePerfPoint = { chartLabel: "—", assigned: 0, resolved: 0, hours: 0 };
  if (!weekly.length) {
    return {
      weekly: [],
      weekCount: 0,
      sumAssigned: 0,
      sumResolved: 0,
      sumHours: 0,
      avgAssigned: 0,
      avgResolved: 0,
      avgHours: 0,
      utilizationPct: 0,
      hoursPerTicketAssigned: null,
      hoursPerTicketResolved: null,
      ratioResolvedOverAssigned: null,
      capacityTicketsWeekAt33: null,
      capacityResolvedWeekAt33: null,
      capacityTicketsMonthAt33: null,
      capacityResolvedMonthAt33: null,
      trendAssignedLabel: "sin datos",
      trendResolvedLabel: "sin datos",
      trendHoursLabel: "sin datos",
      minMaxAssigned: { min: emptyPoint, max: emptyPoint },
      minMaxResolved: { min: emptyPoint, max: emptyPoint },
      minMaxHours: { min: emptyPoint, max: emptyPoint },
      irregularityHoursCv: 0,
      executiveSummary: "No hay semanas en el rango. Amplíe fechas o compruebe datos en GLPI.",
    };
  }

  const weekCount = weekly.length;
  let sumAssigned = 0;
  let sumResolved = 0;
  let sumHours = 0;
  for (const w of weekly) {
    sumAssigned += w.assigned;
    sumResolved += w.resolved;
    sumHours += w.hours;
  }
  const avgAssigned = sumAssigned / weekCount;
  const avgResolved = sumResolved / weekCount;
  const avgHours = sumHours / weekCount;
  const utilizationPct = (avgHours / EXPECTED_WEEKLY_SUPPORT_HOURS) * 100;
  const hoursPerTicketAssigned = sumAssigned > 0 ? sumHours / sumAssigned : null;
  const hoursPerTicketResolved = sumResolved > 0 ? sumHours / sumResolved : null;
  const ratioResolvedOverAssigned = sumAssigned > 0 ? sumResolved / sumAssigned : null;

  const capacityTicketsWeekAt33 =
    hoursPerTicketAssigned != null && hoursPerTicketAssigned > 0
      ? EXPECTED_WEEKLY_SUPPORT_HOURS / hoursPerTicketAssigned
      : null;
  const capacityResolvedWeekAt33 =
    hoursPerTicketResolved != null && hoursPerTicketResolved > 0
      ? EXPECTED_WEEKLY_SUPPORT_HOURS / hoursPerTicketResolved
      : null;
  const capacityTicketsMonthAt33 =
    capacityTicketsWeekAt33 != null ? capacityTicketsWeekAt33 * PERF_MONTHLY_WEEKS : null;
  const capacityResolvedMonthAt33 =
    capacityResolvedWeekAt33 != null ? capacityResolvedWeekAt33 * PERF_MONTHLY_WEEKS : null;

  const assignedVals = weekly.map((w) => w.assigned);
  const resolvedVals = weekly.map((w) => w.resolved);
  const hoursVals = weekly.map((w) => w.hours);
  const trendAssignedLabel = perfTrendHalfSpanish(assignedVals);
  const trendResolvedLabel = perfTrendHalfSpanish(resolvedVals);
  const trendHoursLabel = perfTrendHalfSpanish(hoursVals);

  const minMaxAssigned = perfMinMaxWeek(weekly, "assigned");
  const minMaxResolved = perfMinMaxWeek(weekly, "resolved");
  const minMaxHours = perfMinMaxWeek(weekly, "hours");

  const irregularityHoursCv = avgHours > 0 ? perfStdSample(hoursVals) / avgHours : 0;

  let executiveSummary = "";
  if (sumAssigned === 0 && sumHours === 0) {
    executiveSummary =
      "En este rango no hay asignaciones en el log ni horas imputadas. Revise fechas, la opción GLPI_LOG_ASSIGNEE_TECH_SEARCH_OPTION y las tareas en GLPI.";
  } else {
    const parts: string[] = [
      `En ${weekly.length} semana(s) ISO, de media: ${avgAssigned.toFixed(1)} asignaciones, ${avgResolved.toFixed(
        1,
      )} resueltos y ${avgHours.toFixed(1)} h imputadas por semana.`,
      `Eso es un ${insPctFmt(utilizationPct)} de las ${EXPECTED_WEEKLY_SUPPORT_HOURS} h semanales de referencia.`,
    ];
    if (ratioResolvedOverAssigned != null && sumAssigned > 0) {
      if (ratioResolvedOverAssigned < 0.75 && sumAssigned >= 3) {
        parts.push("Se asignó más de lo que se cerró en el periodo: conviene revisar la cola.");
      } else if (ratioResolvedOverAssigned > 1.15 && sumResolved > 0) {
        parts.push("Se cerró más de lo asignado en el periodo: suele reflejar trabajo acumulado ya cerrado.");
      }
    }
    if (utilizationPct < 72 && sumHours > 0) {
      parts.push("Imputación claramente por debajo de la referencia: ¿falta registrar tiempo en GLPI?");
    } else if (utilizationPct > 108) {
      parts.push("Imputación por encima de la referencia: vigilar carga o reparto.");
    }
    executiveSummary = parts.join(" ");
  }

  return {
    weekly,
    weekCount: weekly.length,
    sumAssigned,
    sumResolved,
    sumHours,
    avgAssigned,
    avgResolved,
    avgHours,
    utilizationPct,
    hoursPerTicketAssigned,
    hoursPerTicketResolved,
    ratioResolvedOverAssigned,
    capacityTicketsWeekAt33,
    capacityResolvedWeekAt33,
    capacityTicketsMonthAt33,
    capacityResolvedMonthAt33,
    trendAssignedLabel,
    trendResolvedLabel,
    trendHoursLabel,
    minMaxAssigned,
    minMaxResolved,
    minMaxHours,
    irregularityHoursCv,
    executiveSummary,
  };
}

function insPctFmt(n: number): string {
  return `${Math.round(n)}%`;
}

/** Botón compacto con panel al hover (pantalla / informe operativo). */
function PerfOperationalDetailHover({ detail }: { detail: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", justifyContent: "center" }}>
      <button
        type="button"
        aria-label="Ver qué significa este indicador"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          cursor: "help",
          border: "1px solid var(--border)",
          borderRadius: 999,
          width: 22,
          height: 22,
          padding: 0,
          lineHeight: 1,
          fontSize: "0.72rem",
          fontWeight: 700,
          color: "var(--muted)",
          background: "var(--surface)",
        }}
      >
        ?
      </button>
      {open ? (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 80,
            width: 340,
            maxWidth: "min(90vw, 380px)",
            maxHeight: "70vh",
            overflowY: "auto",
            padding: "0.65rem 0.75rem",
            fontSize: "0.78rem",
            lineHeight: 1.48,
            textAlign: "left",
            fontWeight: 400,
            color: "var(--text)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
          }}
        >
          {detail}
        </div>
      ) : null}
    </span>
  );
}

function perfDetailListStyle(): CSSProperties {
  return { margin: "0.35rem 0 0", paddingLeft: "1.05rem" };
}

function perfDetailAssignedContent(ins: AssigneeOperationalInsight, avgAssigned: number): ReactNode {
  return (
    <>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>
        1. Asignados (log GLPI) → {avgAssigned.toFixed(2)} / semana | Total {ins.sumAssigned}
      </div>
      <div>Significa:</div>
      <ul style={perfDetailListStyle()}>
        <li>En promedio se asignaron {avgAssigned.toFixed(2)} tickets por semana.</li>
        <li>En todo el período recibió {ins.sumAssigned} tickets.</li>
      </ul>
      <p style={{ margin: "0.5rem 0 0" }}>👉 Esto mide la carga nueva de trabajo.</p>
      <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.76rem" }}>
        NO significa que esos tickets se resolvieron esa misma semana.
      </p>
    </>
  );
}

function perfDetailResolvedContent(ins: AssigneeOperationalInsight, avgResolved: number): ReactNode {
  return (
    <>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>
        2. Resueltos / cerrados → {avgResolved.toFixed(2)} / semana | Total {ins.sumResolved}
      </div>
      <div>Significa:</div>
      <ul style={perfDetailListStyle()}>
        <li>En promedio resolvió {avgResolved.toFixed(2)} tickets por semana.</li>
        <li>En total cerró {ins.sumResolved} tickets durante el período.</li>
      </ul>
      <p style={{ margin: "0.5rem 0 0" }}>👉 Importante: Esos tickets pueden ser viejos o de semanas anteriores.</p>
      <p style={{ margin: "0.35rem 0 0" }}>Esto mide capacidad de resolución.</p>
    </>
  );
}

function perfDetailHoursContent(ins: AssigneeOperationalInsight, avgHours: number): ReactNode {
  return (
    <>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>
        3. Horas imputadas (tareas) → {avgHours.toFixed(2)} h / semana | Total {ins.sumHours.toFixed(2)} h
      </div>
      <div>Significa:</div>
      <ul style={perfDetailListStyle()}>
        <li>El técnico trabajó aproximadamente {avgHours.toFixed(2)} horas por semana.</li>
        <li>En total registró {ins.sumHours.toFixed(2)} horas trabajadas.</li>
      </ul>
    </>
  );
}

function perfDetailUtilizationContent(ins: AssigneeOperationalInsight, avgHours: number): ReactNode {
  const ref = EXPECTED_WEEKLY_SUPPORT_HOURS;
  const pctRounded = Math.round(ins.utilizationPct);
  return (
    <>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>
        4. Utilización vs {ref} h/sem → {insPctFmt(ins.utilizationPct)}
      </div>
      <div>Esto compara:</div>
      <ul style={perfDetailListStyle()}>
        <li>Horas trabajadas reales</li>
        <li>VS</li>
        <li>Horas esperadas de capacidad semanal ({ref} horas)</li>
      </ul>
      <p style={{ margin: "0.45rem 0 0" }}>Cálculo aproximado:</p>
      <p style={{ margin: "0.25rem 0 0", fontFamily: "monospace", fontSize: "0.76rem" }}>
        ({avgHours.toFixed(2)} ÷ {ref}) × 100 ≈ {pctRounded}%
      </p>
      <p style={{ margin: "0.45rem 0 0" }}>Interpretación sencilla:</p>
      <p style={{ margin: "0.35rem 0 0" }}>
        👉 El técnico estuvo ocupado el {pctRounded}% de su capacidad semanal estimada.
      </p>
    </>
  );
}

function perfDetailRatioSimpleBullets(ratio: number): ReactNode {
  if (ratio >= 0.95 && ratio <= 1.05) {
    return (
      <ul style={perfDetailListStyle()}>
        <li>resolvió casi la misma cantidad que recibió;</li>
        <li>el backlog del periodo se mantuvo equilibrado.</li>
      </ul>
    );
  }
  if (ratio < 0.95) {
    return (
      <ul style={perfDetailListStyle()}>
        <li>cerró menos tickets de los asignados en el periodo;</li>
        <li>puede quedar cola o trabajo en curso.</li>
      </ul>
    );
  }
  return (
    <ul style={perfDetailListStyle()}>
      <li>cerró más tickets de los asignados en el periodo;</li>
      <li>suele reflejar cierre de trabajo acumulado de semanas anteriores.</li>
    </ul>
  );
}

function perfDetailRatioContent(ins: AssigneeOperationalInsight): ReactNode {
  const r = ins.ratioResolvedOverAssigned;
  if (ins.sumAssigned <= 0 || r == null) {
    return (
      <p style={{ margin: 0 }}>No hay asignaciones en el periodo para calcular este ratio.</p>
    );
  }
  return (
    <>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>5. Resueltos ÷ asignados → {r.toFixed(2)}</div>
      <div>Compara:</div>
      <ul style={perfDetailListStyle()}>
        <li>Tickets resueltos = {ins.sumResolved}</li>
        <li>Tickets asignados = {ins.sumAssigned}</li>
      </ul>
      <p style={{ margin: "0.45rem 0 0" }}>Cálculo:</p>
      <p style={{ margin: "0.25rem 0 0", fontFamily: "monospace", fontSize: "0.76rem" }}>
        {ins.sumResolved} ÷ {ins.sumAssigned} = {r.toFixed(2)}
      </p>
      <p style={{ margin: "0.45rem 0 0" }}>Interpretación:</p>
      <p style={{ margin: "0.35rem 0 0" }}>👉 Por cada ticket recibido, logró cerrar {r.toFixed(2)}.</p>
      <p style={{ margin: "0.45rem 0 0" }}>O dicho simple:</p>
      {perfDetailRatioSimpleBullets(r)}
    </>
  );
}

function perfDetailHoursPerTicketContent(ins: AssigneeOperationalInsight, hA: string, hR: string): ReactNode {
  const ex =
    ins.sumResolved > 0 ? (ins.sumHours / ins.sumResolved).toFixed(2) : "—";
  return (
    <>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>
        6. Horas / ticket asignado · resuelto → {hA} · {hR}
      </div>
      <div>Esto intenta calcular:</div>
      <ul style={perfDetailListStyle()}>
        <li>Cuántas horas promedio se invirtieron por ticket.</li>
      </ul>
      <div style={{ marginTop: "0.45rem" }}>Probablemente:</div>
      <ul style={perfDetailListStyle()}>
        <li>{hA} por ticket asignado (horas totales ÷ asignaciones del periodo).</li>
        <li>{hR} por ticket resuelto (horas totales ÷ resueltos del periodo).</li>
      </ul>
      {ins.sumResolved > 0 ? (
        <>
          <p style={{ margin: "0.45rem 0 0" }}>Ejemplo conceptual:</p>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.76rem", color: "var(--muted)" }}>
            Si trabajó {ins.sumHours.toFixed(2)} horas y resolvió {ins.sumResolved} tickets:
          </p>
          <p style={{ margin: "0.2rem 0 0", fontFamily: "monospace", fontSize: "0.76rem" }}>
            {ins.sumHours.toFixed(2)} ÷ {ins.sumResolved} = {ex}
          </p>
        </>
      ) : null}
      <p style={{ margin: "0.45rem 0 0" }}>Interpretación:</p>
      <p style={{ margin: "0.35rem 0 0" }}>
        {ins.sumResolved > 0 ? (
          <>
            👉 Resolver cada ticket consumió aproximadamente {ex} horas promedio (vía resueltos).
          </>
        ) : (
          <>No hay resueltos en el periodo para esta lectura por ticket cerrado.</>
        )}
      </p>
    </>
  );
}

function perfDetailCapacityContent(ins: AssigneeOperationalInsight): ReactNode {
  const ref = EXPECTED_WEEKLY_SUPPORT_HOURS;
  const wA = ins.capacityTicketsWeekAt33;
  const wR = ins.capacityResolvedWeekAt33;
  return (
    <>
      <div style={{ fontWeight: 650, marginBottom: 6 }}>7. Capacidad teórica a {ref} h</div>
      <div>La tabla intenta estimar:</div>
      <p style={{ margin: "0.45rem 0 0" }}>
        👉 «Si el técnico trabaja normalmente {ref} horas semanales, ¿cuántos tickets podría manejar?»
      </p>
      <ul style={perfDetailListStyle()}>
        <li>
          {wA != null ? `~${wA.toFixed(1)} tickets asignados por semana` : "— tickets asignados por semana (sin dato)"}
        </li>
        <li>
          {wR != null ? `~${wR.toFixed(1)} tickets resueltos por semana` : "— tickets resueltos por semana (sin dato)"}
        </li>
      </ul>
      <p style={{ margin: "0.45rem 0 0", color: "var(--muted)", fontSize: "0.76rem" }}>
        Es una proyección de capacidad operativa (supone el mismo ritmo horas/ticket observado).
      </p>
    </>
  );
}

function buildExecutiveManagerialInterpretation(ins: AssigneeOperationalInsight): string {
  if (!ins.weekCount) return "";
  const pct = Math.round(ins.utilizationPct);
  return (
    `El técnico recibió una carga moderada de tickets, mantuvo una capacidad de resolución cercana al volumen recibido ` +
    `y utilizó aproximadamente el ${pct}% de su capacidad operativa semanal. Sin embargo, el análisis debe considerar ` +
    `que los tickets resueltos y las horas trabajadas pueden corresponder a backlog de semanas anteriores, por lo que ` +
    `las métricas deben interpretarse como indicadores independientes de carga, capacidad y esfuerzo operativo.`
  );
}

function sectionTitleStyle(): CSSProperties {
  return {
    margin: "1.1rem 0 0.45rem",
    fontSize: "0.92rem",
    fontWeight: 650,
    color: "var(--text)",
    borderBottom: "1px solid var(--border)",
    paddingBottom: 6,
  };
}

function PerfTechnicianOperationalReport(props: {
  displayName: string;
  color: string;
  insight: AssigneeOperationalInsight;
  avgAssignedDisplay: number;
  avgResolvedDisplay: number;
  avgHoursDisplay: number;
}) {
  const { displayName, color, insight, avgAssignedDisplay, avgResolvedDisplay, avgHoursDisplay } = props;
  const ins = insight;
  const ratioStr =
    ins.ratioResolvedOverAssigned != null && ins.sumAssigned > 0
      ? ins.ratioResolvedOverAssigned.toFixed(2)
      : "—";
  const hPerAssign = ins.hoursPerTicketAssigned != null ? `${ins.hoursPerTicketAssigned.toFixed(2)} h` : "—";
  const hPerRes = ins.hoursPerTicketResolved != null ? `${ins.hoursPerTicketResolved.toFixed(2)} h` : "—";
  const capAssign =
    ins.capacityTicketsWeekAt33 != null
      ? `~${ins.capacityTicketsWeekAt33.toFixed(1)}/sem · ~${(ins.capacityTicketsMonthAt33 ?? 0).toFixed(0)}/mes`
      : "—";
  const capRes =
    ins.capacityResolvedWeekAt33 != null
      ? `~${ins.capacityResolvedWeekAt33.toFixed(1)}/sem · ~${(ins.capacityResolvedMonthAt33 ?? 0).toFixed(0)}/mes`
      : "—";

  const cell: CSSProperties = {
    border: "1px solid var(--border)",
    padding: "0.45rem 0.55rem",
    verticalAlign: "top",
  };
  const th: CSSProperties = { ...cell, fontWeight: 650, background: "var(--surface)", color: "var(--text)" };

  return (
    <article
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1rem 1.1rem",
        background: "var(--surface2, rgba(0,0,0,0.02))",
        maxWidth: 900,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.65rem" }}>
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: 999, background: color, flexShrink: 0 }} />
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 650 }}>Análisis operativo — {displayName}</h3>
      </div>

      <p style={{ margin: "0 0 0.85rem", fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.45 }}>
        Números del filtro actual. Las tres columnas del gráfico no miden los mismos tickets: asignación (log), cierre
        (`solvedate`) y horas en tareas.
      </p>

      <h4 style={sectionTitleStyle()}>Datos del periodo</h4>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1rem" }}>
        <caption style={{ captionSide: "bottom", fontSize: "0.76rem", color: "var(--muted)", textAlign: "left", paddingTop: 6 }}>
          Media = promedio por semana ISO (solo semanas desde la primera con datos; sin prefijo vacío). Total = suma en esas mismas
          semanas. Ratio = resueltos ÷ asignados en ese subconjunto (no es balance semanal cerrado).
        </caption>
        <thead>
          <tr>
            <th scope="col" style={th}>
              Indicador
            </th>
            <th scope="col" style={th}>
              Media / semana
            </th>
            <th scope="col" style={th}>
              Total periodo
            </th>
            <th scope="col" style={th}>
              Tendencia (mitad 1 → 2)
            </th>
            <th scope="col" style={{ ...th, width: 56, textAlign: "center" }}>
              Detalle
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>Asignados (log GLPI)</td>
            <td style={cell}>{avgAssignedDisplay.toFixed(2)}</td>
            <td style={cell}>{ins.sumAssigned}</td>
            <td style={cell}>{ins.trendAssignedLabel}</td>
            <td style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>
              <PerfOperationalDetailHover detail={perfDetailAssignedContent(ins, avgAssignedDisplay)} />
            </td>
          </tr>
          <tr>
            <td style={cell}>Resueltos / cerrados</td>
            <td style={cell}>{avgResolvedDisplay.toFixed(2)}</td>
            <td style={cell}>{ins.sumResolved}</td>
            <td style={cell}>{ins.trendResolvedLabel}</td>
            <td style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>
              <PerfOperationalDetailHover detail={perfDetailResolvedContent(ins, avgResolvedDisplay)} />
            </td>
          </tr>
          <tr>
            <td style={cell}>Horas imputadas (tareas)</td>
            <td style={cell}>{`${avgHoursDisplay.toFixed(2)} h`}</td>
            <td style={cell}>{`${ins.sumHours.toFixed(2)} h`}</td>
            <td style={cell}>{ins.trendHoursLabel}</td>
            <td style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>
              <PerfOperationalDetailHover detail={perfDetailHoursContent(ins, avgHoursDisplay)} />
            </td>
          </tr>
          <tr>
            <td style={cell}>Utilización vs {EXPECTED_WEEKLY_SUPPORT_HOURS} h/sem</td>
            <td style={cell} colSpan={3}>
              <strong>{ins.utilizationPct.toFixed(0)}%</strong>
            </td>
            <td style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>
              <PerfOperationalDetailHover detail={perfDetailUtilizationContent(ins, avgHoursDisplay)} />
            </td>
          </tr>
          <tr>
            <td style={cell}>Resueltos ÷ asignados (periodo)</td>
            <td style={cell} colSpan={3}>
              <strong>{ratioStr}</strong>
            </td>
            <td style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>
              <PerfOperationalDetailHover detail={perfDetailRatioContent(ins)} />
            </td>
          </tr>
          <tr>
            <td style={cell}>Horas / ticket asignado · / resuelto</td>
            <td style={cell} colSpan={3}>
              {hPerAssign} · {hPerRes}
            </td>
            <td style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>
              <PerfOperationalDetailHover detail={perfDetailHoursPerTicketContent(ins, hPerAssign, hPerRes)} />
            </td>
          </tr>
          <tr>
            <td style={cell}>Capacidad teórica a {EXPECTED_WEEKLY_SUPPORT_HOURS} h (asign. · resuel.)</td>
            <td style={cell} colSpan={3}>
              {capAssign} · {capRes}
            </td>
            <td style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>
              <PerfOperationalDetailHover detail={perfDetailCapacityContent(ins)} />
            </td>
          </tr>
        </tbody>
      </table>

      <h4 style={sectionTitleStyle()}>Semanas con menor y mayor actividad</h4>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1rem" }}>
        <thead>
          <tr>
            <th scope="col" style={th} />
            <th scope="col" style={th}>
              Semana menor
            </th>
            <th scope="col" style={th}>
              Semana mayor
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>Asignados</td>
            <td style={cell}>
              {ins.minMaxAssigned.min.chartLabel} ({ins.minMaxAssigned.min.assigned})
            </td>
            <td style={cell}>
              {ins.minMaxAssigned.max.chartLabel} ({ins.minMaxAssigned.max.assigned})
            </td>
          </tr>
          <tr>
            <td style={cell}>Resueltos</td>
            <td style={cell}>
              {ins.minMaxResolved.min.chartLabel} ({ins.minMaxResolved.min.resolved})
            </td>
            <td style={cell}>
              {ins.minMaxResolved.max.chartLabel} ({ins.minMaxResolved.max.resolved})
            </td>
          </tr>
          <tr>
            <td style={cell}>Horas</td>
            <td style={cell}>
              {ins.minMaxHours.min.chartLabel} ({ins.minMaxHours.min.hours.toFixed(1)} h)
            </td>
            <td style={cell}>
              {ins.minMaxHours.max.chartLabel} ({ins.minMaxHours.max.hours.toFixed(1)} h)
            </td>
          </tr>
        </tbody>
      </table>

      <h4 style={sectionTitleStyle()}>6. Conclusión ejecutiva</h4>
      <p
        style={{
          margin: 0,
          fontSize: "0.88rem",
          lineHeight: 1.55,
          padding: "0.65rem 0.75rem",
          borderLeft: `4px solid ${color}`,
          background: "var(--surface)",
          color: "var(--text)",
        }}
      >
        {ins.executiveSummary}
      </p>
      {ins.weekCount > 0 ? (
        <div style={{ marginTop: "0.85rem" }}>
          <p style={{ margin: "0 0 0.35rem", fontSize: "0.88rem", fontWeight: 650, color: "var(--text)" }}>
            Interpretación ejecutiva REAL de esta tabla
          </p>
          <p style={{ margin: "0 0 0.45rem", fontSize: "0.8rem", color: "var(--muted)" }}>En palabras gerenciales:</p>
          <blockquote
            style={{
              margin: 0,
              padding: "0.6rem 0.75rem 0.6rem 0.85rem",
              borderLeft: "4px solid var(--border)",
              background: "var(--surface2, rgba(0,0,0,0.02))",
              fontSize: "0.86rem",
              lineHeight: 1.55,
              color: "var(--text)",
            }}
          >
            {buildExecutiveManagerialInterpretation(ins)}
          </blockquote>
        </div>
      ) : null}
    </article>
  );
}

/** Leyendas que arrancan ocultas hasta activarlas en el gráfico semanal */
const WEEKLY_SERIES_OPTIONAL_OFF_KEYS: ReadonlySet<string> = new Set([
  "tickets_paused_events",
  "tickets_reopened_events",
  "tickets_out_of_sla",
]);

const WEEKLY_SERIES: readonly { key: keyof CoordinationWeeklyEvolutionRow; name: string }[] = [
  { key: "tickets_created", name: "Creados" },
  { key: "tickets_resolved", name: "Resueltos (logs → resuelto/cerrado)" },
  { key: "tickets_managed_events", name: "Gestionados (logs → desde nuevo)" },
  { key: "tickets_paused_events", name: "Pausados (logs → en espera)" },
  { key: "tickets_reopened_events", name: "Reabiertos (logs)" },
  { key: "tickets_out_of_sla", name: "Fuera de SLA" },
];

/** Barras de horas (eje derecho) sobre la misma evolución semanal. */
const WEEKLY_HOUR_BARS: readonly { key: "hours_on_managed" | "hours_on_resolved"; name: string; color: string }[] = [
  { key: "hours_on_managed", name: "Horas en gestionados", color: "#e0a45a" },
  { key: "hours_on_resolved", name: "Horas en resueltos", color: "#5bb8bc" },
];

type EvolutionGranularity = "week" | "month";

const EVOLUTION_COUNT_KEYS = [
  "tickets_created",
  "tickets_resolved",
  "tickets_managed_events",
  "actiontime_managed_seconds",
  "actiontime_resolved_seconds",
  "tickets_open_snapshot",
  "tickets_open_historic_logs",
  "tickets_paused_events",
  "tickets_reopened_events",
  "tickets_out_of_sla",
] as const satisfies readonly (keyof CoordinationWeeklyEvolutionRow)[];

/** Agrupa filas semanales ISO en meses calendario (clave = mes del lunes de la semana). */
function aggregateWeeklyEvolutionByMonth(
  rows: ReadonlyArray<CoordinationWeeklyEvolutionRow>,
): CoordinationWeeklyEvolutionRow[] {
  type Acc = {
    period_sort: number;
    period_label: string;
    week_period_start: string;
    week_period_end: string;
  } & Record<(typeof EVOLUTION_COUNT_KEYS)[number], number>;

  const byMonth = new Map<string, Acc>();
  for (const r of rows) {
    const start = String(r.week_period_start ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const ym = start.slice(0, 7);
    const [yStr, mStr] = ym.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) continue;

    let acc = byMonth.get(ym);
    if (!acc) {
      const monthStart = `${ym}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const monthEnd = `${ym}-${String(lastDay).padStart(2, "0")}`;
      const labelDate = new Date(`${monthStart}T12:00:00`);
      const period_label = Number.isNaN(labelDate.getTime())
        ? ym
        : labelDate.toLocaleDateString("es-EC", { month: "short", year: "numeric" });
      acc = {
        period_sort: y * 100 + m,
        period_label,
        week_period_start: monthStart,
        week_period_end: monthEnd,
        tickets_created: 0,
        tickets_resolved: 0,
        tickets_managed_events: 0,
        actiontime_managed_seconds: 0,
        actiontime_resolved_seconds: 0,
        tickets_open_snapshot: 0,
        tickets_open_historic_logs: 0,
        tickets_paused_events: 0,
        tickets_reopened_events: 0,
        tickets_out_of_sla: 0,
      };
      byMonth.set(ym, acc);
    }
    for (const k of EVOLUTION_COUNT_KEYS) {
      acc[k] += Number(r[k] ?? 0) || 0;
    }
  }
  return [...byMonth.values()].sort((a, b) => a.period_sort - b.period_sort);
}

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

/** Última semana del gráfico con conteo > 0 para esa serie; si no hay, la última semana del eje. */
function weeklyRtLatestWeekRowForSeries(
  chartData: ReadonlyArray<Record<string, unknown>>,
  chartKey: string,
): { period_sort: string; chartLabel: string } | null {
  for (let i = chartData.length - 1; i >= 0; i--) {
    const row = chartData[i];
    const n = Number(row[chartKey] ?? 0);
    if (Number.isFinite(n) && n > 0) {
      return { period_sort: String(row.period_sort ?? ""), chartLabel: String(row.chartLabel ?? "") };
    }
  }
  const last = chartData[chartData.length - 1];
  return last
    ? { period_sort: String(last.period_sort ?? ""), chartLabel: String(last.chartLabel ?? "") }
    : null;
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
  coordinationResolvedEffortErr: string | null;
  coordinationTicketParetoErr: string | null;
  coordinationAssigneeErr: string | null;
  coordinationTechnicianErr: string | null;
  coordinationWeeklyRequestTypeErr: string | null;
  weeklyRtProjectFilterId: number | null;
  setWeeklyRtProjectFilterId: (v: number | null) => void;
  weeklyRtProjectOptions: SupportProject[];
  weeklyRtProjectsErr: string | null;
  /** API `/api/indicators/problems-support` (no usa tipo de proyecto). */
  coordProblemsSupport: IndicatorsProblemsSupportPayload | null;
  coordProblemsSupportErr: string | null;
  onRefresh: () => void;
  coordKpis: CoordinationSummaryKpisPayload | null;
  coordWeeklyEvolution: CoordinationWeeklyEvolutionPayload | null;
  coordResolvedEffort: CoordinationResolvedEffortPayload | null;
  coordTicketPareto: CoordinationTicketTimeParetoPayload | null;
  coordWeeklyAssignee: CoordinationWeeklyAssigneePerformancePayload | null;
  coordWeeklyTechnician: CoordinationWeeklyTechnicianEvolutionPayload | null;
  coordWeeklyTicketsByRequestType: CoordinationWeeklyTicketsByRequestTypePayload | null;
  aiEstimationSlices: AiEstimationFieldSliceData[];
  aiUsageSummary: AiUsageSummaryPayload | null;
  aiUsageSummaryErr: string | null;
  aiUsageWeekly: AiUsageWeeklyPayload | null;
  aiUsageWeeklyErr: string | null;
  aiUsageByStatus: AiUsageByStatusPayload | null;
  aiUsageByStatusErr: string | null;
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
    coordinationResolvedEffortErr,
    coordinationTicketParetoErr,
    coordinationAssigneeErr,
    coordinationTechnicianErr,
    coordinationWeeklyRequestTypeErr,
    weeklyRtProjectFilterId,
    setWeeklyRtProjectFilterId,
    weeklyRtProjectOptions,
    weeklyRtProjectsErr,
    coordProblemsSupport,
    coordProblemsSupportErr,
    onRefresh,
    coordKpis,
    coordWeeklyEvolution,
    coordResolvedEffort,
    coordTicketPareto,
    coordWeeklyAssignee,
    coordWeeklyTechnician,
    coordWeeklyTicketsByRequestType,
    aiEstimationSlices,
    aiUsageSummary,
    aiUsageSummaryErr,
    aiUsageWeekly,
    aiUsageWeeklyErr,
    aiUsageByStatus,
    aiUsageByStatusErr,
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
  const [evolutionGranularity, setEvolutionGranularity] = useState<EvolutionGranularity>("week");


  const [perfTeamOff, setPerfTeamOff] = useState<Record<string, boolean>>({});
  const [perfTeamHover, setPerfTeamHover] = useState<string | null>(null);
  /** chart_key de asignados visibles en «Rendimiento del equipo» (select múltiple). */
  const [perfAssigneeSelection, setPerfAssigneeSelection] = useState<string[]>([]);
  /** Series rt_* del gráfico «Fuente de solicitud»; por defecto ninguna (usuario elige con casillas). */
  const [requestTypeFilterSelection, setRequestTypeFilterSelection] = useState<string[]>([]);

  const [weeklyRtModalOpen, setWeeklyRtModalOpen] = useState(false);
  const [weeklyRtModalLoading, setWeeklyRtModalLoading] = useState(false);
  const [weeklyRtModalErr, setWeeklyRtModalErr] = useState<string | null>(null);
  const [weeklyRtModalPayload, setWeeklyRtModalPayload] = useState<CoordinationWeeklyRtDetailPayload | null>(null);
  const [weeklyRtModalHeading, setWeeklyRtModalHeading] = useState("");

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

  const closeWeeklyRtModal = useCallback(() => {
    setWeeklyRtModalOpen(false);
    setWeeklyRtModalErr(null);
    setWeeklyRtModalPayload(null);
    setWeeklyRtModalHeading("");
  }, []);

  const openWeeklyRtModal = useCallback(
    async (periodSort: number, requesttypesId: number, heading: string) => {
      if (!indicatorsDateFrom || !indicatorsDateTo || !Number.isFinite(periodSort)) return;
      setWeeklyRtModalOpen(true);
      setWeeklyRtModalLoading(true);
      setWeeklyRtModalErr(null);
      setWeeklyRtModalPayload(null);
      setWeeklyRtModalHeading(heading);
      try {
        setWeeklyRtModalPayload(
          await fetchCoordinationWeeklyTicketsByRequestTypeDetail(
            indicatorsProjectTypeId,
            indicatorsDateFrom,
            indicatorsDateTo,
            periodSort,
            requesttypesId,
            weeklyRtProjectFilterId,
          ),
        );
      } catch (e) {
        setWeeklyRtModalErr(e instanceof Error ? e.message : String(e));
      } finally {
        setWeeklyRtModalLoading(false);
      }
    },
    [
      indicatorsProjectTypeId,
      indicatorsDateFrom,
      indicatorsDateTo,
      weeklyRtProjectFilterId,
    ],
  );

  const sortedWeeklyRtModalRows = useMemo(
    () => (weeklyRtModalPayload ? sortRowsByCreacion(weeklyRtModalPayload.rows) : []),
    [weeklyRtModalPayload],
  );

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
    const rows =
      evolutionGranularity === "month"
        ? aggregateWeeklyEvolutionByMonth(coordWeeklyEvolution.rows)
        : coordWeeklyEvolution.rows;
    return rows.map((r) => ({
      ...r,
      chartLabel: r.period_label,
      hours_on_managed: Math.round(((Number(r.actiontime_managed_seconds) || 0) / 3600) * 100) / 100,
      hours_on_resolved: Math.round(((Number(r.actiontime_resolved_seconds) || 0) / 3600) * 100) / 100,
    }));
  }, [coordWeeklyEvolution, evolutionGranularity]);

  const evolutionSectionTitle =
    evolutionGranularity === "month"
      ? "Evolución mensual (serie estadística)"
      : "Evolución semanal (serie estadística)";

  const evolutionSectionSubtitle =
    evolutionGranularity === "month"
      ? "Por mes calendario (suma de las semanas ISO cuyo lunes cae en ese mes). Líneas: creados, resueltos/gestionados/pausados/reabiertos vía glpi_logs, fuera de SLA. Barras (eje derecho): horas de tareas (actiontime) en la misma semana ISO sobre tickets gestionados o resueltos esa semana. Por defecto se muestran Creados, Resueltos, Gestionados y las barras de horas; pausados, reabiertos y fuera de SLA ocultos hasta activarlos en la leyenda."
      : "Por semana ISO. Líneas: creados, resueltos/gestionados/pausados/reabiertos vía glpi_logs, fuera de SLA. Barras (eje derecho): horas de tareas (actiontime) en la misma semana ISO sobre tickets gestionados o resueltos esa semana. Por defecto se muestran Creados, Resueltos, Gestionados y las barras de horas; pausados, reabiertos y fuera de SLA ocultos hasta activarlos en la leyenda.";

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
    const evRows = coordWeeklyEvolution?.rows ?? [];
    const resolvedByPeriod = new Map<number, number>();
    for (const r of evRows) {
      resolvedByPeriod.set(Number(r.period_sort), Number(r.tickets_resolved ?? 0));
    }
    if (!weeks.length || !series.length) return [];
    return weeks.map((w) => {
      const ps = Number(w.period_sort);
      const row: Record<string, string | number> = {
        chartLabel: w.period_label,
        period_sort: ps,
        week_period_start: w.week_period_start ?? "",
        week_period_end: w.week_period_end ?? "",
        [PERF_TEAM_RESOLVED_BAR_KEY]: resolvedByPeriod.get(ps) ?? 0,
      };
      for (const s of series) {
        const a =
          w.assignees.find((x) => x.user_id === s.user_id) ??
          (s.login ? w.assignees.find((x) => x.login === s.login) : undefined);
        const secEffort = a?.actiontime_seconds ?? 0;
        row[`tickets_assigned_${s.chart_key}`] = a?.tickets_assigned_in_week ?? 0;
        row[`hours_effort_${s.chart_key}`] = Math.round((secEffort / 3600) * 100) / 100;
        row[`tickets_resolved_assignee_${s.chart_key}`] = a?.tickets_resolved_assignee ?? 0;
      }
      return row;
    });
  }, [coordWeeklyAssignee, perfAssigneeSeriesResolved, coordWeeklyEvolution]);

  const perfAssigneeSeriesSorted = useMemo(
    () =>
      [...perfAssigneeSeriesResolved].sort((a, b) =>
        a.full_name.localeCompare(b.full_name, "es"),
      ),
    [perfAssigneeSeriesResolved],
  );

  const perfAssigneeSeriesKeysSig = useMemo(
    () => perfAssigneeSeriesSorted.map((s) => s.chart_key).join("|"),
    [perfAssigneeSeriesSorted],
  );

  useEffect(() => {
    setPerfAssigneeSelection(perfAssigneeSeriesSorted.map((s) => s.chart_key));
  }, [perfAssigneeSeriesKeysSig]);

  const perfAssigneeSeriesFiltered = useMemo(() => {
    const sel = new Set(perfAssigneeSelection);
    return perfAssigneeSeriesSorted.filter((s) => sel.has(s.chart_key));
  }, [perfAssigneeSeriesSorted, perfAssigneeSelection]);

  /** Semanas usadas en medias y en el informe operativo (se quita el prefijo de semanas con todo en cero). */
  const perfPerformanceChartRowsForAverages = useMemo(
    () => slicePerfChartRowsForAverages(perfPerformanceChartData, perfAssigneeSeriesFiltered),
    [perfPerformanceChartData, perfAssigneeSeriesFiltered],
  );

  /** Media de resueltos del equipo solo en semanas con datos (misma lógica que líneas de referencia por técnico). */
  const perfTeamResolvedAvgPerWeek = useMemo(() => {
    const rows = perfPerformanceChartRowsForAverages;
    if (!rows.length) return 0;
    let sum = 0;
    for (const row of rows) {
      sum += Number(row[PERF_TEAM_RESOLVED_BAR_KEY] ?? 0) || 0;
    }
    return sum / rows.length;
  }, [perfPerformanceChartRowsForAverages]);

  /** Media móvil de referencia: asignaciones (log), resueltos como asignado, horas totales en tareas. */
  const perfBarPerAssigneeBreakdown = useMemo(() => {
    const rows = perfPerformanceChartRowsForAverages;
    const assignees = perfAssigneeSeriesFiltered;
    if (!rows.length || !assignees.length) return [];
    const n = rows.length;
    return assignees.map((s, i) => {
      const weeklySeries: WeeklyAssigneePerfPoint[] = rows.map((row) => ({
        chartLabel: String(row.chartLabel ?? ""),
        assigned: Number(row[`tickets_assigned_${s.chart_key}`] ?? 0) || 0,
        resolved: Number(row[`tickets_resolved_assignee_${s.chart_key}`] ?? 0) || 0,
        hours: Number(row[`hours_effort_${s.chart_key}`] ?? 0) || 0,
      }));

      let sumTicketsAssigned = 0;
      let sumHoursEffort = 0;
      let sumTicketsResolvedAssignee = 0;
      for (const row of rows) {
        sumTicketsAssigned += Number(row[`tickets_assigned_${s.chart_key}`] ?? 0) || 0;
        sumHoursEffort += Number(row[`hours_effort_${s.chart_key}`] ?? 0) || 0;
        sumTicketsResolvedAssignee += Number(row[`tickets_resolved_assignee_${s.chart_key}`] ?? 0) || 0;
      }
      const avgTicketsAssignedPerWeek = sumTicketsAssigned / n;
      const avgHoursEffortPerWeek = sumHoursEffort / n;
      const avgTicketsResolvedAssigneePerWeek = sumTicketsResolvedAssignee / n;

      const operationalInsight = buildAssigneeOperationalInsight(weeklySeries);

      const color = COORD_LINE_COLORS[i % COORD_LINE_COLORS.length];
      const displayName = s.login ? `${s.full_name} (${s.login})` : s.full_name;
      const shortRefLabel =
        (s.login && String(s.login).trim()) ||
        (s.full_name.split(/\s+/)[0] ?? displayName).slice(0, 12);
      return {
        chart_key: s.chart_key,
        displayName,
        shortRefLabel,
        color,
        avgTicketsAssignedPerWeek,
        avgHoursEffortPerWeek,
        avgTicketsResolvedAssigneePerWeek,
        operationalInsight,
      };
    });
  }, [perfPerformanceChartRowsForAverages, perfAssigneeSeriesFiltered]);

  const perfBarShowCompactRefLabels = perfBarPerAssigneeBreakdown.length <= 4;

  const coordWeeklyRequestTypeChartModel = useMemo(() => {
    const payload = coordWeeklyTicketsByRequestType;
    if (!payload?.rows.length) {
      return {
        chartData: [] as Record<string, string | number>[],
        series: [] as { chartKey: string; name: string; requesttypesId: number }[],
      };
    }
    const rows = payload.rows;
    const periodKeys = [...new Set(rows.map((r) => r.period_sort))].sort((a, b) => Number(a) - Number(b));
    const periodLabel = new Map<string, string>();
    const weekBounds = new Map<string, { start: string; end: string }>();
    const cellMap = new Map<string, Map<number, number>>();
    for (const r of rows) {
      periodLabel.set(r.period_sort, r.period_label);
      const ws = r.week_period_start?.trim();
      const we = r.week_period_end?.trim();
      if (ws && we && !weekBounds.has(r.period_sort)) weekBounds.set(r.period_sort, { start: ws, end: we });
      if (!cellMap.has(r.period_sort)) cellMap.set(r.period_sort, new Map());
      cellMap.get(r.period_sort)!.set(r.requesttypes_id, r.ticket_count);
    }
    const totals = new Map<number, number>();
    const names = new Map<number, string>();
    for (const r of rows) {
      totals.set(r.requesttypes_id, (totals.get(r.requesttypes_id) ?? 0) + r.ticket_count);
      names.set(r.requesttypes_id, r.request_type_name);
    }
    const allowOrder = payload.request_type_allowlist_applied ?? [];
    const orderIdx = new Map<string, number>();
    allowOrder.forEach((label, i) => {
      orderIdx.set(normRequestTypeLabel(label), i);
    });
    const typeIds = [...totals.entries()]
      .sort((a, b) => {
        const na = normRequestTypeLabel(names.get(a[0]) ?? "");
        const nb = normRequestTypeLabel(names.get(b[0]) ?? "");
        const ia = orderIdx.has(na) ? orderIdx.get(na)! : 9999;
        const ib = orderIdx.has(nb) ? orderIdx.get(nb)! : 9999;
        if (ia !== ib) return ia - ib;
        return b[1] - a[1] || a[0] - b[0];
      })
      .map(([id]) => id);
    const series = typeIds.map((id) => ({
      chartKey: `rt_${id}`,
      name: names.get(id) ?? `Fuente ${id}`,
      requesttypesId: id,
    }));
    const chartData = periodKeys.map((pk) => {
      const wb = weekBounds.get(pk);
      const row: Record<string, string | number> = {
        chartLabel: periodLabel.get(pk) ?? pk,
        period_sort: pk,
        week_period_start: wb?.start ?? "",
        week_period_end: wb?.end ?? "",
      };
      const cells = cellMap.get(pk) ?? new Map();
      for (const id of typeIds) {
        row[`rt_${id}`] = cells.get(id) ?? 0;
      }
      return row;
    });
    return { chartData, series };
  }, [coordWeeklyTicketsByRequestType]);

  const requestTypeSeriesKeysSig = useMemo(
    () => coordWeeklyRequestTypeChartModel.series.map((s) => s.chartKey).join("\0"),
    [coordWeeklyRequestTypeChartModel.series],
  );

  useEffect(() => {
    setRequestTypeFilterSelection(coordWeeklyRequestTypeChartModel.series.map((s) => s.chartKey));
  }, [requestTypeSeriesKeysSig]);

  const coordWeeklyRequestTypeSeriesFiltered = useMemo(() => {
    const sel = new Set(requestTypeFilterSelection);
    return coordWeeklyRequestTypeChartModel.series.filter((s) => sel.has(s.chartKey));
  }, [coordWeeklyRequestTypeChartModel.series, requestTypeFilterSelection]);

  /** Total tickets por semana = suma de TODAS las fuentes en datos (alta en semana ISO); las barras solo muestran las categorías marcadas para ver cuántos encajan en cada fuente. */
  const coordWeeklyRequestTypeChartDataWithTotal = useMemo(() => {
    const allKeys = coordWeeklyRequestTypeChartModel.series.map((s) => s.chartKey);
    return coordWeeklyRequestTypeChartModel.chartData.map((row) => {
      let weekTotalTickets = 0;
      for (const k of allKeys) {
        weekTotalTickets += Number(row[k] ?? 0) || 0;
      }
      return { ...row, weekTotalTickets };
    });
  }, [coordWeeklyRequestTypeChartModel.chartData, coordWeeklyRequestTypeChartModel.series]);

  const requestTypeSeriesColorIndex = useMemo(() => {
    const m = new Map<string, number>();
    coordWeeklyRequestTypeChartModel.series.forEach((s, i) => {
      m.set(s.chartKey, i);
    });
    return m;
  }, [coordWeeklyRequestTypeChartModel.series]);

  /** Ancho mínimo del composición para que las barras agrupadas no queden en hilacha (scroll horizontal si hace falta). */
  const coordWeeklyRtChartPixelWidth = useMemo(() => {
    const weekCount = coordWeeklyRequestTypeChartDataWithTotal.length;
    const seriesCount = Math.max(1, coordWeeklyRequestTypeSeriesFiltered.length);
    const perWeek = Math.min(220, Math.max(92, 36 + seriesCount * 15));
    return Math.max(720, weekCount * perWeek);
  }, [coordWeeklyRequestTypeChartDataWithTotal.length, coordWeeklyRequestTypeSeriesFiltered.length]);

  const coordWeeklyRtChartHeight = 480;

  const showRequestTypeBarLabels = coordWeeklyRequestTypeSeriesFiltered.length <= 6;

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

        <CollapsibleSection
          title="Resumen"
          subtitle="Creados y resueltos con fecha en el rango. Abiertos, iniciados, no iniciados, pausados y reabiertos según el estado actual (la lista detallada de abiertos no se corta solo por fecha de creación). Fuera de SLA: entre los creados en el rango, incumplen el plazo TTR de GLPI (time_to_resolve) en cualquier estado. El tiempo en los modales usa tareas en el rango. Pulse cada cifra para el detalle; el listado se ordena por fecha de creación."
        >
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
        </CollapsibleSection>

        <CollapsibleSection title={evolutionSectionTitle} subtitle={evolutionSectionSubtitle}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.75rem 1.25rem",
              marginBottom: "0.35rem",
            }}
            role="radiogroup"
            aria-label="Granularidad de la serie estadística"
          >
            <span style={{ fontSize: "0.86rem", color: "var(--muted)" }}>Periodo:</span>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: "0.88rem",
                margin: 0,
              }}
            >
              <input
                type="radio"
                name="coord-evolution-granularity"
                checked={evolutionGranularity === "week"}
                onChange={() => setEvolutionGranularity("week")}
              />
              Semanal
            </label>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: "0.88rem",
                margin: 0,
              }}
            >
              <input
                type="radio"
                name="coord-evolution-granularity"
                checked={evolutionGranularity === "month"}
                onChange={() => setEvolutionGranularity("month")}
              />
              Mensual
            </label>
          </div>
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
                {evolutionGranularity === "month"
                  ? "No hay meses en el rango seleccionado."
                  : "No hay semanas en el rango seleccionado."}
              </p>
            )}
          {!coordinationWeeklyErr && weeklyChartData.length > 0 && (
            <div style={{ width: "100%", marginTop: "0.85rem" }}>
              <ResponsiveContainer width="100%" height={420}>
                <ComposedChart data={weeklyChartData} margin={{ top: 8, right: 12, left: 4, bottom: 76 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="chartLabel"
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    tick={(p) => (
                      <IsoWeekAxisTick {...p} rows={weeklyChartData} labelFill={CHART_TEXT} rangeFill={CHART_AXIS} />
                    )}
                    height={74}
                    interval={0}
                  />
                  <YAxis
                    yAxisId="tickets"
                    allowDecimals={false}
                    tick={{ fill: CHART_TEXT, fontSize: 11 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    width={40}
                  />
                  <YAxis
                    yAxisId="hours"
                    orientation="right"
                    tick={{ fill: CHART_TEXT, fontSize: 11 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    width={44}
                    tickFormatter={(v) => `${v}`}
                    label={{
                      value: "h",
                      position: "insideTopRight",
                      offset: 8,
                      fill: CHART_AXIS,
                      fontSize: 11,
                    }}
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
                  {WEEKLY_HOUR_BARS.map((s) => {
                    const showBar =
                      weeklyHoverKey != null ? weeklyHoverKey === s.key : !weeklySeriesOff[s.key];
                    return (
                      <Bar
                        key={s.key}
                        yAxisId="hours"
                        dataKey={s.key}
                        name={s.name}
                        fill={s.color}
                        fillOpacity={0.72}
                        maxBarSize={28}
                        hide={!showBar}
                      />
                    );
                  })}
                  {WEEKLY_SERIES.map((s, i) => {
                    const showLine =
                      weeklyHoverKey != null ? weeklyHoverKey === s.key : !weeklySeriesOff[s.key];
                    return (
                      <Line
                        key={s.key}
                        yAxisId="tickets"
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
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CollapsibleSection>

        <ResolvedEffortByResolutionSection
          loading={coordinationLoading}
          error={coordinationResolvedEffortErr}
          payload={coordResolvedEffort}
        />

        <TicketTimeParetoSection
          loading={coordinationLoading}
          error={coordinationTicketParetoErr}
          payload={coordTicketPareto}
        />

        <TechnicianWeeklyEvolutionSection
          loading={coordinationLoading}
          error={coordinationTechnicianErr}
          payload={coordWeeklyTechnician}
        />

        <CollapsibleSection
          title="Rendimiento del equipo (por semana ISO)"
          subtitle={`Tres métricas independientes por semana ISO: (1) asignaciones al técnico según \`glpi_logs\` (\`GLPI_LOG_ASSIGNEE_TECH_SEARCH_OPTION\`, fecha del evento), (2) resueltos/cerrados con \`solvedate\` en la semana como asignado del ticket, (3) horas en tareas (\`actiontime\`) como técnico de la tarea, sin exigir coincidir con asignación/resolución de la misma semana. Eje derecho: horas; referencia ${EXPECTED_WEEKLY_SUPPORT_HOURS} h/semana. Barra gris: total resueltos del equipo. Detalle inferior: análisis por técnico. Alcance: \`GLPI_COORD_PERFORMANCE_LOGINS\`.`}
        >
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
            perfAssigneeSeriesSorted.length > 0 && (
              <div style={{ marginTop: "0.85rem", maxWidth: 480 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem 0.75rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)" }}>Asignados</span>
                  <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    ({perfAssigneeSelection.length}/{perfAssigneeSeriesSorted.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPerfAssigneeSelection(perfAssigneeSeriesSorted.map((s) => s.chart_key))
                    }
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--accent, #0d6efd)",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      textDecoration: "underline",
                      padding: 0,
                    }}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setPerfAssigneeSelection([])}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--accent, #0d6efd)",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      textDecoration: "underline",
                      padding: 0,
                    }}
                  >
                    Ninguno
                  </button>
                </div>
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", color: "var(--muted)" }}>
                  Marque las casillas que quiera incluir en el gráfico (varios a la vez, sin Ctrl).
                </p>
                {perfAssigneeSeriesFiltered.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginBottom: "0.55rem",
                    }}
                  >
                    {perfAssigneeSeriesFiltered.map((s) => (
                      <button
                        key={s.chart_key}
                        type="button"
                        title="Quitar del gráfico"
                        onClick={() =>
                          setPerfAssigneeSelection((prev) => prev.filter((k) => k !== s.chart_key))
                        }
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid var(--border)",
                          background: "var(--surface)",
                          color: "var(--text)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          maxWidth: "100%",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.login ? `${s.full_name} (${s.login})` : s.full_name}
                        </span>
                        <span aria-hidden style={{ opacity: 0.75, fontWeight: 700 }}>
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div
                  role="group"
                  aria-label="Asignados incluidos en el gráfico"
                  style={{
                    maxHeight: 240,
                    overflowY: "auto",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    background: "var(--surface)",
                  }}
                >
                  {perfAssigneeSeriesSorted.map((s, i) => {
                    const checked = perfAssigneeSelection.includes(s.chart_key);
                    const label = s.login ? `${s.full_name} (${s.login})` : s.full_name;
                    const last = i === perfAssigneeSeriesSorted.length - 1;
                    return (
                      <label
                        key={s.chart_key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontSize: "0.86rem",
                          borderBottom: last ? undefined : "1px solid var(--border)",
                          margin: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setPerfAssigneeSelection((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.chart_key)) next.delete(s.chart_key);
                              else next.add(s.chart_key);
                              return perfAssigneeSeriesSorted
                                .filter((x) => next.has(x.chart_key))
                                .map((x) => x.chart_key);
                            });
                          }}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          {!coordinationAssigneeErr &&
            !coordinationLoading &&
            perfPerformanceChartData.length > 0 &&
            perfAssigneeSeriesSorted.length > 0 &&
            perfAssigneeSelection.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                Seleccione al menos un asignado para ver tickets y horas en el gráfico.
              </p>
            )}
          {!coordinationAssigneeErr &&
            !coordinationLoading &&
            perfPerformanceChartData.length > 0 &&
            perfAssigneeSeriesFiltered.length > 0 && (
              <div style={{ width: "100%", marginTop: "0.85rem" }}>
                <ResponsiveContainer width="100%" height={560}>
                  <BarChart
                    data={perfPerformanceChartData}
                    margin={{
                      top: perfBarPerAssigneeBreakdown.length > 2 ? 44 : 36,
                      right: 18,
                      left: 6,
                      bottom: 76,
                    }}
                    barCategoryGap="18%"
                    barGap={4}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis
                      dataKey="chartLabel"
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      tick={(p) => (
                        <IsoWeekAxisTick {...p} rows={perfPerformanceChartData} labelFill={CHART_TEXT} rangeFill={CHART_AXIS} />
                      )}
                      height={74}
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
                        value: "Asignados (log) / resueltos (asignado)",
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
                    {perfAssigneeSeriesFiltered.map((s, i) => {
                      const col = COORD_LINE_COLORS[i % COORD_LINE_COLORS.length];
                      const label = s.login ? `${s.full_name} (${s.login})` : s.full_name;
                      const dkW = `tickets_assigned_${s.chart_key}`;
                      const dkR = `tickets_resolved_assignee_${s.chart_key}`;
                      const dkH = `hours_effort_${s.chart_key}`;
                      const showW =
                        perfTeamHover != null ? perfTeamHover === dkW : !perfTeamOff[dkW];
                      const showR =
                        perfTeamHover != null ? perfTeamHover === dkR : !perfTeamOff[dkR];
                      const showH =
                        perfTeamHover != null ? perfTeamHover === dkH : !perfTeamOff[dkH];
                      return (
                        <Fragment key={s.chart_key}>
                          <Bar
                            yAxisId="tickets"
                            dataKey={dkW}
                            name={`${label} · asignados (log)`}
                            fill={col}
                            radius={[3, 3, 0, 0]}
                            maxBarSize={34}
                            hide={!showW}
                          >
                            <LabelList
                              dataKey={dkW}
                              position="top"
                              fill={CHART_TEXT}
                              fontSize={9}
                              formatter={fmtBarLabelTickets}
                            />
                          </Bar>
                          <Bar
                            yAxisId="tickets"
                            dataKey={dkR}
                            name={`${label} · resueltos`}
                            fill={col}
                            fillOpacity={0.38}
                            radius={[3, 3, 0, 0]}
                            maxBarSize={34}
                            stroke={col}
                            strokeWidth={1}
                            strokeDasharray="5 4"
                            hide={!showR}
                          >
                            <LabelList
                              dataKey={dkR}
                              position="top"
                              fill={col}
                              fontSize={9}
                              formatter={fmtBarLabelTickets}
                            />
                          </Bar>
                          <Bar
                            yAxisId="hours"
                            dataKey={dkH}
                            name={`${label} · horas (tareas)`}
                            fill={col}
                            fillOpacity={0.52}
                            radius={[3, 3, 0, 0]}
                            maxBarSize={34}
                            stroke={col}
                            strokeWidth={1}
                            strokeDasharray="3 3"
                            hide={!showH}
                          >
                            <LabelList
                              dataKey={dkH}
                              position="top"
                              fill={CHART_AXIS}
                              fontSize={9}
                              formatter={fmtBarLabelHours}
                            />
                          </Bar>
                        </Fragment>
                      );
                    })}
                    {(() => {
                      const showTeamResolved =
                        perfTeamHover != null
                          ? perfTeamHover === PERF_TEAM_RESOLVED_BAR_KEY
                          : !perfTeamOff[PERF_TEAM_RESOLVED_BAR_KEY];
                      return (
                        <Bar
                          yAxisId="tickets"
                          dataKey={PERF_TEAM_RESOLVED_BAR_KEY}
                          name="Total tickets resueltos (equipo)"
                          fill={PERF_TEAM_RESOLVED_BAR_COLOR}
                          radius={[3, 3, 0, 0]}
                          maxBarSize={36}
                          hide={!showTeamResolved}
                        >
                          <LabelList
                            dataKey={PERF_TEAM_RESOLVED_BAR_KEY}
                            position="top"
                            fill={CHART_TEXT}
                            fontSize={9}
                            formatter={fmtBarLabelTickets}
                          />
                        </Bar>
                      );
                    })()}
                    {perfBarPerAssigneeBreakdown.map((item, idx) => (
                      <Fragment key={`${item.chart_key}-avg-lines`}>
                        <ReferenceLine
                          yAxisId="tickets"
                          y={item.avgTicketsAssignedPerWeek}
                          stroke={item.color}
                          strokeDasharray="8 5"
                          strokeWidth={2}
                          ifOverflow="extendDomain"
                          label={
                            perfBarShowCompactRefLabels
                              ? {
                                  value: `${item.shortRefLabel} · ${item.avgTicketsAssignedPerWeek.toFixed(1)} asig/sem (media)`,
                                  fill: item.color,
                                  fontSize: 9,
                                  position: idx % 2 === 0 ? "insideTopLeft" : "insideTopRight",
                                }
                              : undefined
                          }
                        />
                        <ReferenceLine
                          yAxisId="hours"
                          y={item.avgHoursEffortPerWeek}
                          stroke={item.color}
                          strokeDasharray="3 5"
                          strokeWidth={2}
                          strokeOpacity={0.9}
                          ifOverflow="extendDomain"
                          label={
                            perfBarShowCompactRefLabels
                              ? {
                                  value: `${item.shortRefLabel} · ${item.avgHoursEffortPerWeek.toFixed(1)} h/sem (media)`,
                                  fill: item.color,
                                  fontSize: 9,
                                  position: idx % 2 === 0 ? "insideBottomRight" : "insideBottomLeft",
                                }
                              : undefined
                          }
                        />
                      </Fragment>
                    ))}
                    <ReferenceLine
                      yAxisId="hours"
                      y={EXPECTED_WEEKLY_SUPPORT_HOURS}
                      stroke="#868e96"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      ifOverflow="extendDomain"
                      label={{
                        value: `Referencia ${EXPECTED_WEEKLY_SUPPORT_HOURS} h/sem`,
                        fill: CHART_AXIS,
                        fontSize: 9,
                        position: "insideRight",
                      }}
                    />
                    {(() => {
                      const showTeamResolved =
                        perfTeamHover != null
                          ? perfTeamHover === PERF_TEAM_RESOLVED_BAR_KEY
                          : !perfTeamOff[PERF_TEAM_RESOLVED_BAR_KEY];
                      if (!showTeamResolved || perfPerformanceChartData.length === 0) return null;
                      return (
                        <ReferenceLine
                          yAxisId="tickets"
                          y={perfTeamResolvedAvgPerWeek}
                          stroke={PERF_TEAM_RESOLVED_BAR_COLOR}
                          strokeDasharray="6 4"
                          strokeWidth={2}
                          strokeOpacity={0.85}
                          ifOverflow="extendDomain"
                          label={{
                            value: `Media resueltos (equipo): ${perfTeamResolvedAvgPerWeek.toFixed(1)}/sem`,
                            fill: PERF_TEAM_RESOLVED_BAR_COLOR,
                            fontSize: 9,
                            position: "insideRight",
                          }}
                        />
                      );
                    })()}
                  </BarChart>
                </ResponsiveContainer>
                {perfBarPerAssigneeBreakdown.length > 0 && (
                  <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1.35rem" }}>
                    <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 650 }}>
                      Detalle de análisis operativo y ejecutivo
                    </h3>
                    <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)", maxWidth: 920, lineHeight: 1.45 }}>
                      Tabla con medias y totales del rango; las <strong>medias y líneas de referencia</strong> usan solo las
                      semanas desde la primera con datos (se ignoran semanas iniciales con todo en cero). Capacidad teórica
                      supone <strong>{EXPECTED_WEEKLY_SUPPORT_HOURS} h</strong>/sem y <strong>{PERF_MONTHLY_WEEKS}</strong> semanas/mes.
                    </p>
                    {perfBarPerAssigneeBreakdown.map((item) => (
                      <PerfTechnicianOperationalReport
                        key={item.chart_key}
                        displayName={item.displayName}
                        color={item.color}
                        insight={item.operationalInsight}
                        avgAssignedDisplay={item.avgTicketsAssignedPerWeek}
                        avgResolvedDisplay={item.avgTicketsResolvedAssigneePerWeek}
                        avgHoursDisplay={item.avgHoursEffortPerWeek}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Tickets por fuente de solicitud (semana ISO)"
          subtitle="Se excluyen las fuentes «Phone» y «(sin fuente)». Pulse una barra del gráfico o «Ver tickets» junto a cada fuente para listar números de ticket, título, proyecto, tiempo invertido (tareas en el rango de filtros) y fecha de creación. Proyecto GLPI opcional abajo; con varias semanas use el scroll horizontal del gráfico."
        >
          <div
            style={{
              marginTop: "0.85rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "0.65rem",
              alignItems: "end",
              width: "100%",
            }}
          >
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
                Proyecto (solo este gráfico)
              </label>
              <select
                value={weeklyRtProjectFilterId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setWeeklyRtProjectFilterId(v === "" ? null : Number(v));
                }}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.65rem",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface2)",
                  color: "var(--text)",
                  fontSize: "0.88rem",
                }}
              >
                <option value="">Todos los proyectos</option>
                {weeklyRtProjectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {weeklyRtProjectsErr ? (
            <p style={{ color: "var(--danger-text)", fontSize: "0.78rem", margin: "0.35rem 0 0" }}>
              No se cargó el listado de proyectos: {weeklyRtProjectsErr}
            </p>
          ) : null}
          {coordinationWeeklyRequestTypeErr && (
            <p style={{ color: "var(--danger-text)", fontSize: "0.88rem", margin: "0.65rem 0 0" }}>
              Error al cargar tickets por fuente: {coordinationWeeklyRequestTypeErr}
            </p>
          )}
          {!coordinationWeeklyRequestTypeErr && coordinationLoading && (
            <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
              Cargando datos por fuente…
            </p>
          )}
          {!coordinationWeeklyRequestTypeErr &&
            !coordinationLoading &&
            coordWeeklyTicketsByRequestType &&
            coordWeeklyRequestTypeChartModel.chartData.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                No hay tickets en el rango con los filtros actuales.
              </p>
            )}
          {!coordinationWeeklyRequestTypeErr &&
            !coordinationLoading &&
            coordWeeklyRequestTypeChartModel.chartData.length > 0 &&
            coordWeeklyRequestTypeChartModel.series.length > 0 && (
              <div style={{ marginTop: "0.85rem", width: "100%" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem 0.75rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)" }}>
                    Fuentes de solicitud
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    ({requestTypeFilterSelection.length}/{coordWeeklyRequestTypeChartModel.series.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRequestTypeFilterSelection(
                        coordWeeklyRequestTypeChartModel.series.map((s) => s.chartKey),
                      )
                    }
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--accent, #0d6efd)",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      textDecoration: "underline",
                      padding: 0,
                    }}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestTypeFilterSelection([])}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--accent, #0d6efd)",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      textDecoration: "underline",
                      padding: 0,
                    }}
                  >
                    Ninguno
                  </button>
                </div>
                <p style={{ margin: "0 0 0.65rem", fontSize: "0.78rem", color: "var(--muted)" }}>
                  Active las fuentes en la cuadrícula; desplace horizontalmente el gráfico si hay muchas semanas.
                </p>
                {coordWeeklyRequestTypeSeriesFiltered.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginBottom: "0.65rem",
                    }}
                  >
                    {coordWeeklyRequestTypeSeriesFiltered.map((s) => (
                      <button
                        key={s.chartKey}
                        type="button"
                        title="Quitar del gráfico"
                        onClick={() =>
                          setRequestTypeFilterSelection((prev) => prev.filter((k) => k !== s.chartKey))
                        }
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid var(--border)",
                          background: "var(--surface)",
                          color: "var(--text)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          maxWidth: "100%",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.name}
                        </span>
                        <span aria-hidden style={{ opacity: 0.75, fontWeight: 700 }}>
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div
                  role="group"
                  aria-label="Fuentes de solicitud en el gráfico"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: 8,
                    width: "100%",
                  }}
                >
                  {coordWeeklyRequestTypeChartModel.series.map((s) => {
                    const checked = requestTypeFilterSelection.includes(s.chartKey);
                    const cid = `rtcb-${s.chartKey}`;
                    return (
                      <div
                        key={s.chartKey}
                        aria-label={s.name}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          padding: "8px 10px",
                          borderRadius: "var(--radius)",
                          border: "1px solid var(--border)",
                          background: checked ? "var(--surface2)" : "var(--surface)",
                          lineHeight: 1.25,
                        }}
                      >
                        <input
                          id={cid}
                          type="checkbox"
                          checked={checked}
                          style={{ marginTop: 2, flexShrink: 0 }}
                          onChange={() => {
                            setRequestTypeFilterSelection((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.chartKey)) next.delete(s.chartKey);
                              else next.add(s.chartKey);
                              return coordWeeklyRequestTypeChartModel.series
                                .filter((x) => next.has(x.chartKey))
                                .map((x) => x.chartKey);
                            });
                          }}
                        />
                        <label
                          htmlFor={cid}
                          style={{
                            flex: 1,
                            cursor: "pointer",
                            fontSize: "0.82rem",
                            wordBreak: "break-word",
                            minWidth: 0,
                          }}
                        >
                          {s.name}
                        </label>
                        <button
                          type="button"
                          title="Ver tickets (última semana con datos en el gráfico)"
                          onClick={() => {
                            const hit = weeklyRtLatestWeekRowForSeries(
                              coordWeeklyRequestTypeChartDataWithTotal,
                              s.chartKey,
                            );
                            if (!hit?.period_sort) return;
                            void openWeeklyRtModal(Number(hit.period_sort), s.requesttypesId, `${hit.chartLabel} · ${s.name}`);
                          }}
                          style={{
                            flexShrink: 0,
                            alignSelf: "center",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "4px 8px",
                            fontSize: "0.74rem",
                            cursor: "pointer",
                            background: "var(--surface)",
                            color: "var(--accent, #0d6efd)",
                          }}
                        >
                          Ver tickets
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          {!coordinationWeeklyRequestTypeErr &&
            !coordinationLoading &&
            coordWeeklyRequestTypeChartModel.chartData.length > 0 &&
            coordWeeklyRequestTypeChartModel.series.length > 0 &&
            requestTypeFilterSelection.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                Seleccione al menos una fuente de solicitud para ver el gráfico.
              </p>
            )}
          {!coordinationWeeklyRequestTypeErr &&
            !coordinationLoading &&
            coordWeeklyRequestTypeChartModel.chartData.length > 0 &&
            coordWeeklyRequestTypeSeriesFiltered.length > 0 && (
              <div
                style={{
                  width: "100%",
                  marginTop: "0.85rem",
                  overflowX: "auto",
                  overflowY: "hidden",
                  paddingBottom: 6,
                }}
              >
                <div style={{ width: coordWeeklyRtChartPixelWidth, minWidth: "100%", height: coordWeeklyRtChartHeight }}>
                  <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={coordWeeklyRequestTypeChartDataWithTotal}
                    margin={{ top: 28, right: 12, left: 6, bottom: 76 }}
                    barCategoryGap="6%"
                    barGap={3}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis
                      dataKey="chartLabel"
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      tick={(p) => (
                        <IsoWeekAxisTick
                          {...p}
                          rows={coordWeeklyRequestTypeChartDataWithTotal}
                          labelFill={CHART_TEXT}
                          rangeFill={CHART_AXIS}
                        />
                      )}
                      height={74}
                      interval={0}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      width={40}
                      label={{
                        value: "Tickets",
                        angle: -90,
                        position: "insideLeft",
                        fill: CHART_AXIS,
                        fontSize: 11,
                        offset: 2,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: CHART_TOOLTIP_BG,
                        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                        borderRadius: 8,
                        fontSize: "0.82rem",
                      }}
                      labelFormatter={(_, items) => {
                        const pl = items?.[0]?.payload as Record<string, unknown> | undefined;
                        const lab = String(pl?.chartLabel ?? "");
                        const range = formatIsoWeekRangeEs(
                          String(pl?.week_period_start ?? ""),
                          String(pl?.week_period_end ?? ""),
                        );
                        return range ? `${lab} (${range})` : lab;
                      }}
                    />
                    <Legend wrapperStyle={{ paddingTop: 8 }} />
                    {coordWeeklyRequestTypeSeriesFiltered.map((s) => {
                      const ci = requestTypeSeriesColorIndex.get(s.chartKey) ?? 0;
                      return (
                        <Bar
                          key={s.chartKey}
                          dataKey={s.chartKey}
                          name={s.name}
                          fill={COORD_LINE_COLORS[ci % COORD_LINE_COLORS.length]}
                          radius={[3, 3, 0, 0]}
                          maxBarSize={56}
                          style={{ cursor: "pointer" }}
                          onClick={(barData: unknown) => {
                            const o = barData as { payload?: Record<string, unknown> };
                            const pl = o?.payload;
                            if (!pl) return;
                            const ps = Number(pl.period_sort);
                            if (!Number.isFinite(ps)) return;
                            void openWeeklyRtModal(
                              ps,
                              s.requesttypesId,
                              `${String(pl.chartLabel ?? ps)} · ${s.name}`,
                            );
                          }}
                        >
                          {showRequestTypeBarLabels ? (
                            <LabelList
                              dataKey={s.chartKey}
                              position="top"
                              fill={CHART_TEXT}
                              fontSize={9}
                              formatter={fmtBarLabelTickets}
                            />
                          ) : null}
                        </Bar>
                      );
                    })}
                    <Line
                      type="stepAfter"
                      dataKey="weekTotalTickets"
                      name="Total semana (todos los tickets)"
                      stroke="#111827"
                      strokeWidth={2}
                      strokeDasharray="7 4"
                      dot={{ r: 4, fill: "#111827", strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="weekTotalTickets"
                        position="top"
                        fill="#111827"
                        fontSize={9}
                        fontWeight={700}
                        formatter={fmtBarLabelTickets}
                      />
                    </Line>
                  </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
        </CollapsibleSection>

        <ProblemsSupportIndicatorsSection
          loading={coordinationLoading}
          err={coordProblemsSupportErr}
          data={coordProblemsSupport}
        />

        <AiEstimationEfficiencySection
          loading={coordinationLoading}
          slices={aiEstimationSlices}
          projectTypeId={indicatorsProjectTypeId}
          dateFrom={indicatorsDateFrom}
          dateTo={indicatorsDateTo}
        />

        <AiUsageSection
          loading={coordinationLoading}
          summaryErr={aiUsageSummaryErr}
          weeklyErr={aiUsageWeeklyErr}
          byStatusErr={aiUsageByStatusErr}
          summary={aiUsageSummary}
          weekly={aiUsageWeekly}
          byStatus={aiUsageByStatus}
          projectTypeId={indicatorsProjectTypeId}
          dateFrom={indicatorsDateFrom}
          dateTo={indicatorsDateTo}
        />

        <KnowledgeBaseSection />
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

      {weeklyRtModalOpen && (
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
          onClick={closeWeeklyRtModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-rt-modal-title"
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
                <h2 id="weekly-rt-modal-title" style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                  Tickets de la celda (semana + fuente)
                </h2>
                <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                  {weeklyRtModalHeading}
                  {weeklyRtModalPayload ? (
                    <>
                      {" "}
                      · Rango {weeklyRtModalPayload.date_from} → {weeklyRtModalPayload.date_to}
                      {" · "}
                      {weeklyRtModalPayload.rows.length} ticket(s)
                    </>
                  ) : null}
                </p>
                <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.78rem" }}>
                  Tiempo invertido: suma de actiontime de tareas en el mismo rango de fechas que los filtros superiores.
                </p>
              </div>
              <button
                type="button"
                onClick={closeWeeklyRtModal}
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

            {weeklyRtModalLoading && (
              <p style={{ marginTop: "1rem", color: "var(--muted)" }}>Cargando tickets…</p>
            )}
            {weeklyRtModalErr && (
              <p style={{ color: "var(--danger-text)", marginTop: "0.85rem", fontSize: "0.9rem" }}>
                Error: {weeklyRtModalErr}
              </p>
            )}
            {weeklyRtModalPayload && !weeklyRtModalLoading && (
              <div
                style={{
                  marginTop: "0.9rem",
                  overflowX: "auto",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                }}
              >
                {sortedWeeklyRtModalRows.length === 0 ? (
                  <p style={{ margin: "0.85rem", color: "var(--muted)", fontSize: "0.86rem" }}>
                    No hay tickets en esta celda con los filtros actuales.
                  </p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                    <thead>
                      <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>N.º ticket</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Título</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Proyecto</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Estado</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Tiempo invertido</th>
                        <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Fecha de creación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedWeeklyRtModalRows.map((r, i) => (
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
