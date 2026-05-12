import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
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
  type CoordinationWeeklyTicketsByRequestTypePayload,
  type CoordinationWeeklyRtDetailPayload,
} from "./api";
import { ProblemsSupportIndicatorsSection } from "../components/ProblemsSupportIndicatorsSection";
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

const COORD_LINE_COLORS = ["#714b67", "#017e84", "#5b9bd5", "#ed7d31", "#70ad47", "#9e480e"];

/** Serie global en «Rendimiento del equipo»: total tickets resueltos/cerrados por semana (evolución semanal). */
const PERF_TEAM_RESOLVED_BAR_KEY = "tickets_resolved_team";
const PERF_TEAM_RESOLVED_BAR_COLOR = "#495057";

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
  payload?: ReadonlyArray<{ name?: string; value?: unknown; color?: string; payload?: unknown }>;
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
        if (dk.startsWith("hours_assignee_")) {
          const n = typeof raw === "number" ? raw : Number(raw);
          shown = `${Number.isFinite(n) ? n.toFixed(2) : String(raw)} h`;
        } else if (
          dk === PERF_TEAM_RESOLVED_BAR_KEY ||
          dk.startsWith("tickets_assignee_") ||
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

/** Jornada soporte nominal para comparar utilización (horas imputadas GLPI). */
const EXPECTED_WEEKLY_SUPPORT_HOURS = 33;
/** Semanas equivalentes por mes natural (promedio ISO). */
const PERF_MONTHLY_WEEKS = 4.33;

type WeeklyAssigneePerfPoint = {
  chartLabel: string;
  worked: number;
  resolved: number;
  hours: number;
};

type AssigneeOperationalInsight = {
  weekly: WeeklyAssigneePerfPoint[];
  weekCount: number;
  sumWorked: number;
  sumResolved: number;
  sumHours: number;
  avgWorked: number;
  avgResolved: number;
  avgHours: number;
  utilizationPct: number;
  hoursPerTicketWorked: number | null;
  hoursPerTicketResolved: number | null;
  ratioResolvedOverWorked: number | null;
  capacityTicketsWeekAt33: number | null;
  capacityResolvedWeekAt33: number | null;
  capacityTicketsMonthAt33: number | null;
  capacityResolvedMonthAt33: number | null;
  trendWorkedLabel: string;
  trendResolvedLabel: string;
  trendHoursLabel: string;
  minMaxWorked: { min: WeeklyAssigneePerfPoint; max: WeeklyAssigneePerfPoint };
  minMaxResolved: { min: WeeklyAssigneePerfPoint; max: WeeklyAssigneePerfPoint };
  minMaxHours: { min: WeeklyAssigneePerfPoint; max: WeeklyAssigneePerfPoint };
  irregularityHoursCv: number;
  interpretation: string[];
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
  key: "worked" | "resolved" | "hours",
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
  const emptyPoint: WeeklyAssigneePerfPoint = { chartLabel: "—", worked: 0, resolved: 0, hours: 0 };
  if (!weekly.length) {
    return {
      weekly: [],
      weekCount: 0,
      sumWorked: 0,
      sumResolved: 0,
      sumHours: 0,
      avgWorked: 0,
      avgResolved: 0,
      avgHours: 0,
      utilizationPct: 0,
      hoursPerTicketWorked: null,
      hoursPerTicketResolved: null,
      ratioResolvedOverWorked: null,
      capacityTicketsWeekAt33: null,
      capacityResolvedWeekAt33: null,
      capacityTicketsMonthAt33: null,
      capacityResolvedMonthAt33: null,
      trendWorkedLabel: "sin datos",
      trendResolvedLabel: "sin datos",
      trendHoursLabel: "sin datos",
      minMaxWorked: { min: emptyPoint, max: emptyPoint },
      minMaxResolved: { min: emptyPoint, max: emptyPoint },
      minMaxHours: { min: emptyPoint, max: emptyPoint },
      irregularityHoursCv: 0,
      interpretation: ["No hay semanas en el periodo seleccionado."],
      executiveSummary:
        "No hay datos semanales para analizar; ajuste el rango de fechas o verifique que existan imputaciones en GLPI.",
    };
  }

  const weekCount = weekly.length;
  let sumWorked = 0;
  let sumResolved = 0;
  let sumHours = 0;
  for (const w of weekly) {
    sumWorked += w.worked;
    sumResolved += w.resolved;
    sumHours += w.hours;
  }
  const avgWorked = sumWorked / weekCount;
  const avgResolved = sumResolved / weekCount;
  const avgHours = sumHours / weekCount;
  const utilizationPct = (avgHours / EXPECTED_WEEKLY_SUPPORT_HOURS) * 100;
  const hoursPerTicketWorked = sumWorked > 0 ? sumHours / sumWorked : null;
  const hoursPerTicketResolved = sumResolved > 0 ? sumHours / sumResolved : null;
  const ratioResolvedOverWorked = sumWorked > 0 ? sumResolved / sumWorked : null;

  const capacityTicketsWeekAt33 =
    hoursPerTicketWorked != null && hoursPerTicketWorked > 0
      ? EXPECTED_WEEKLY_SUPPORT_HOURS / hoursPerTicketWorked
      : null;
  const capacityResolvedWeekAt33 =
    hoursPerTicketResolved != null && hoursPerTicketResolved > 0
      ? EXPECTED_WEEKLY_SUPPORT_HOURS / hoursPerTicketResolved
      : null;
  const capacityTicketsMonthAt33 =
    capacityTicketsWeekAt33 != null ? capacityTicketsWeekAt33 * PERF_MONTHLY_WEEKS : null;
  const capacityResolvedMonthAt33 =
    capacityResolvedWeekAt33 != null ? capacityResolvedWeekAt33 * PERF_MONTHLY_WEEKS : null;

  const workedVals = weekly.map((w) => w.worked);
  const resolvedVals = weekly.map((w) => w.resolved);
  const hoursVals = weekly.map((w) => w.hours);
  const trendWorkedLabel = perfTrendHalfSpanish(workedVals);
  const trendResolvedLabel = perfTrendHalfSpanish(resolvedVals);
  const trendHoursLabel = perfTrendHalfSpanish(hoursVals);

  const minMaxWorked = perfMinMaxWeek(weekly, "worked");
  const minMaxResolved = perfMinMaxWeek(weekly, "resolved");
  const minMaxHours = perfMinMaxWeek(weekly, "hours");

  const irregularityHoursCv = avgHours > 0 ? perfStdSample(hoursVals) / avgHours : 0;

  const interpretation: string[] = [];

  if (sumWorked === 0 && sumHours === 0) {
    interpretation.push(
      "No hay tickets trabajados ni horas imputadas en el periodo con los filtros actuales; no es posible valorar rendimiento ni utilización.",
    );
  } else {
    if (ratioResolvedOverWorked != null && ratioResolvedOverWorked < 0.75 && sumWorked >= 3) {
      interpretation.push(
        "Los cierres semanales son claramente inferiores al volumen de tickets trabajados: puede haber acumulación de pendientes, trabajo prolongado en curso o cierres aplazados (coordinar revisión de cola y definición de «listo para cerrar»).",
      );
    } else if (ratioResolvedOverWorked != null && ratioResolvedOverWorked > 1.15 && sumResolved > 0) {
      interpretation.push(
        "Hay más cierres que tickets trabajados en el agregado del periodo: es coherente con desahogo de stock arrastrado o cierres concentrados en pocas semanas; revisar reparto histórico.",
      );
    }

    if (avgHours < EXPECTED_WEEKLY_SUPPORT_HOURS * 0.72) {
      interpretation.push(
        "La utilización frente a 33 h/semana es baja: puede indicar subregistro de tareas en GLPI, tiempo en reuniones o actividades no imputadas, multitarea fuera del ticket o menor carga asignada.",
      );
    }
    if (avgHours > EXPECTED_WEEKLY_SUPPORT_HOURS * 1.08) {
      interpretation.push(
        "Las horas imputadas superan de forma sostenida la referencia de 33 h/semana: posible sobrecarga, horas extra no gestionadas o necesidad de refuerzo / redistribución.",
      );
    }

    if (hoursPerTicketWorked != null && hoursPerTicketWorked >= 5) {
      interpretation.push(
        "El tiempo medio por ticket trabajado es alto: valorar complejidad funcional o técnica, dependencias externas, falta de documentación o fricción en escalaciones.",
      );
    } else if (hoursPerTicketWorked != null && hoursPerTicketWorked > 0 && hoursPerTicketWorked <= 1.2) {
      interpretation.push(
        "El tiempo medio por ticket trabajado es muy contenido: puede reflejar tickets simples, automatización o, en algunos equipos, imputación parcial; contrastar calidad de registro.",
      );
    }

    if (irregularityHoursCv >= 0.42) {
      interpretation.push(
        "La carga horaria semanal es irregular (alta dispersión): posible soporte reactivo, picos por incidentes o mala nivelación de la cartera; conviene planificación conjunta con coordinación.",
      );
    } else if (weekly.length >= 4 && irregularityHoursCv < 0.22) {
      interpretation.push("La imputación horaria semanal es relativamente estable: ritmo previsible para planificación.");
    }

    if (utilizationPct >= 88 && utilizationPct <= 102 && irregularityHoursCv < 0.35) {
      interpretation.push(
        "Combinación de utilización cercana al objetivo y dispersión moderada: lectura de equilibrio operativo si la calidad de servicio se mantiene.",
      );
    }

    interpretation.push(
      "Factores frecuentes a contrastar con el técnico y negocio: tickets complejos, reparto desigual, tiempo en reuniones, multitarea, soporte funcional fuerte o demoras en validación de cierre.",
    );
  }

  let executiveSummary = "";
  if (sumWorked === 0 && sumHours === 0) {
    executiveSummary =
      "Sin actividad imputable en el rango analizado no hay lectura de productividad ni de utilización; ampliar fechas o revisar asignaciones en GLPI.";
  } else {
    executiveSummary = [
      `Productividad media ${avgWorked.toFixed(1)} tickets trabajados/semana y ${avgResolved.toFixed(1)} resueltos/semana (${weekly.length} semanas ISO).`,
      `Imputación media ${avgHours.toFixed(1)} h/semana (${utilizationPct.toFixed(0)}% de ${EXPECTED_WEEKLY_SUPPORT_HOURS} h nominales).`,
      hoursPerTicketWorked != null
        ? `${hoursPerTicketWorked.toFixed(2)} h por ticket trabajado y ${
            hoursPerTicketResolved != null ? `${hoursPerTicketResolved.toFixed(2)} h por ticket resuelto` : "sin base para h/resuelto"
          } (formulas periodo: horas ÷ tickets).`
        : "",
      capacityTicketsWeekAt33 != null
        ? `Capacidad teórica ~${capacityTicketsWeekAt33.toFixed(1)} tickets/semana y ~${(capacityTicketsMonthAt33 ?? 0).toFixed(
            0,
          )}/mes a 33 h manteniendo el mismo esfuerzo por ticket trabajado.`
        : "",
      capacityResolvedWeekAt33 != null && hoursPerTicketResolved != null
        ? `Si se mantuviera el mismo esfuerzo medio por cierre, cabrían ~${capacityResolvedWeekAt33.toFixed(
            1,
          )} resoluciones/semana (~${(capacityResolvedMonthAt33 ?? 0).toFixed(0)}/mes).`
        : "",
      utilizationPct < 72
        ? "Riesgo principal: subutilización o subregistro frente a la capacidad declarada."
        : utilizationPct > 105
          ? "Riesgo principal: sobrecarga respecto a la referencia de 33 h."
          : "Riesgo moderado: vigilar desvíos entre trabajado vs cerrado y estabilidad semanal.",
      ratioResolvedOverWorked != null && ratioResolvedOverWorked < 0.75 && sumWorked >= 3
        ? "Recomendación: sesión de priorización y definición de criterios de cierre para reducir fricción inventario/en curso."
        : "Recomendación: mantener ritmo de imputación homogéneo y revisión quincenal de ratio trabajado/resuelto.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return {
    weekly,
    weekCount: weekly.length,
    sumWorked,
    sumResolved,
    sumHours,
    avgWorked,
    avgResolved,
    avgHours,
    utilizationPct,
    hoursPerTicketWorked,
    hoursPerTicketResolved,
    ratioResolvedOverWorked,
    capacityTicketsWeekAt33,
    capacityResolvedWeekAt33,
    capacityTicketsMonthAt33,
    capacityResolvedMonthAt33,
    trendWorkedLabel,
    trendResolvedLabel,
    trendHoursLabel,
    minMaxWorked,
    minMaxResolved,
    minMaxHours,
    irregularityHoursCv,
    interpretation,
    executiveSummary,
  };
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
  avgWorkedDisplay: number;
  avgResolvedDisplay: number;
  avgHoursDisplay: number;
}) {
  const { displayName, color, insight, avgWorkedDisplay, avgResolvedDisplay, avgHoursDisplay } = props;
  const ins = insight;

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

      <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--muted)", lineHeight: 1.45 }}>
        Fuente GLPI: semanas ISO del filtro. <strong>Tickets trabajados</strong>: distintos tickets donde el técnico figura
        como asignado y registró tiempo en la semana. <strong>Tickets resueltos</strong>: cierres resuelto/cerrado con{" "}
        <code style={{ fontSize: "0.78rem" }}>solvedate</code> en esa semana ISO como asignado.{" "}
        <strong>Horas imputadas</strong>: suma de <code style={{ fontSize: "0.78rem" }}>actiontime</code> del técnico en el
        rango (tareas que intersectan el filtro). Referencia de capacidad: <strong>{EXPECTED_WEEKLY_SUPPORT_HOURS} h</strong>{" "}
        laborales semanales por técnico.
      </p>

      <h4 style={sectionTitleStyle()}>Definiciones y fórmulas utilizadas</h4>
      <ul style={{ margin: "0 0 0.85rem", paddingLeft: "1.15rem", fontSize: "0.82rem", color: "var(--text)", lineHeight: 1.5 }}>
        <li>
          Utilización semanal (%) = (promedio de horas imputadas por semana ÷ {EXPECTED_WEEKLY_SUPPORT_HOURS}) × 100. Aquí: (
          {avgHoursDisplay.toFixed(2)} ÷ {EXPECTED_WEEKLY_SUPPORT_HOURS}) × 100 ={" "}
          <strong>{ins.utilizationPct.toFixed(1)}%</strong>.
        </li>
        <li>
          Horas por ticket trabajado (periodo) = horas imputadas totales ÷ tickets trabajados totales →{" "}
          {ins.hoursPerTicketWorked != null ? (
            <strong>{ins.hoursPerTicketWorked.toFixed(3)} h</strong>
          ) : (
            <span style={{ color: "var(--muted)" }}>N/A (sin tickets trabajados)</span>
          )}
          .
        </li>
        <li>
          Horas por ticket resuelto (periodo) = horas imputadas totales ÷ tickets resueltos totales →{" "}
          {ins.hoursPerTicketResolved != null ? (
            <strong>{ins.hoursPerTicketResolved.toFixed(3)} h</strong>
          ) : (
            <span style={{ color: "var(--muted)" }}>N/A (sin resueltos)</span>
          )}
          .
        </li>
        <li>
          Capacidad teórica semanal a 33 h (trabajados) ≈ 33 ÷ (h/ticket trabajado); mensual ≈ × {PERF_MONTHLY_WEEKS} semanas.
        </li>
      </ul>

      <h4 style={sectionTitleStyle()}>1. Tickets trabajados (promedio y dinámica)</h4>
      <ul style={{ margin: "0 0 0.85rem", paddingLeft: "1.15rem", fontSize: "0.82rem", lineHeight: 1.5 }}>
        <li>
          Promedio semanal: <strong>{avgWorkedDisplay.toFixed(2)}</strong> tickets (Σ semanal ÷ {ins.weekCount} semanas).
        </li>
        <li>Tendencia (mitades del periodo): {ins.trendWorkedLabel}.</li>
        <li>
          Semana de menor carga trabajada: <strong>{ins.minMaxWorked.min.chartLabel}</strong> ({ins.minMaxWorked.min.worked}{" "}
          tickets); mayor carga: <strong>{ins.minMaxWorked.max.chartLabel}</strong> ({ins.minMaxWorked.max.worked} tickets).
        </li>
      </ul>

      <h4 style={sectionTitleStyle()}>2. Tickets resueltos / cerrados y relación con lo trabajado</h4>
      <ul style={{ margin: "0 0 0.85rem", paddingLeft: "1.15rem", fontSize: "0.82rem", lineHeight: 1.5 }}>
        <li>
          Promedio semanal de resueltos: <strong>{avgResolvedDisplay.toFixed(2)}</strong>.
        </li>
        <li>Tendencia: {ins.trendResolvedLabel}.</li>
        <li>
          Ratio periodo resueltos ÷ trabajados:{" "}
          {ins.ratioResolvedOverWorked != null ? (
            <strong>{ins.ratioResolvedOverWorked.toFixed(2)}</strong>
          ) : (
            <span style={{ color: "var(--muted)" }}>—</span>
          )}{" "}
          (valores inferiores a 1 sugieren más trabajo en curso que cierres en la ventana).
        </li>
        <li>
          Picos: menor volumen de cierres en <strong>{ins.minMaxResolved.min.chartLabel}</strong> ({ins.minMaxResolved.min.resolved})
          ; mayor en <strong>{ins.minMaxResolved.max.chartLabel}</strong> ({ins.minMaxResolved.max.resolved}).
        </li>
      </ul>

      <h4 style={sectionTitleStyle()}>3. Horas imputadas y utilización</h4>
      <ul style={{ margin: "0 0 0.85rem", paddingLeft: "1.15rem", fontSize: "0.82rem", lineHeight: 1.5 }}>
        <li>
          Promedio semanal: <strong>{avgHoursDisplay.toFixed(2)} h</strong>. Tendencia: {ins.trendHoursLabel}.
        </li>
        <li>
          Utilización vs {EXPECTED_WEEKLY_SUPPORT_HOURS} h: <strong>{ins.utilizationPct.toFixed(1)}%</strong>.
        </li>
        <li>
          Horas: mínimo en <strong>{ins.minMaxHours.min.chartLabel}</strong> ({ins.minMaxHours.min.hours.toFixed(1)} h), máximo en{" "}
          <strong>{ins.minMaxHours.max.chartLabel}</strong> ({ins.minMaxHours.max.hours.toFixed(1)} h).
        </li>
      </ul>

      <h4 style={sectionTitleStyle()}>4. Horas por ticket y capacidad estimada</h4>
      <ul style={{ margin: "0 0 0.85rem", paddingLeft: "1.15rem", fontSize: "0.82rem", lineHeight: 1.5 }}>
        <li>
          Horas / ticket trabajado:{" "}
          {ins.hoursPerTicketWorked != null ? <strong>{ins.hoursPerTicketWorked.toFixed(3)} h</strong> : "—"}.
        </li>
        <li>
          Horas / ticket resuelto:{" "}
          {ins.hoursPerTicketResolved != null ? <strong>{ins.hoursPerTicketResolved.toFixed(3)} h</strong> : "—"}.
        </li>
        <li>
          Capacidad teórica a ritmo observado (33 h/sem):{" "}
          {ins.capacityTicketsWeekAt33 != null ? (
            <>
              ~<strong>{ins.capacityTicketsWeekAt33.toFixed(1)}</strong> tickets trabajados/semana (~
              <strong>{ins.capacityTicketsMonthAt33?.toFixed(0)}</strong>/mes).
            </>
          ) : (
            "—"
          )}
        </li>
        <li>
          Resoluciones/semana manteniendo h/resuelto medio:{" "}
          {ins.capacityResolvedWeekAt33 != null ? (
            <>
              ~<strong>{ins.capacityResolvedWeekAt33.toFixed(1)}</strong>/semana (~
              <strong>{ins.capacityResolvedMonthAt33?.toFixed(0)}</strong>/mes).
            </>
          ) : (
            "—"
          )}
        </li>
      </ul>

      <h4 style={sectionTitleStyle()}>5. Interpretación operativa</h4>
      <ul style={{ margin: "0 0 0.85rem", paddingLeft: "1.15rem", fontSize: "0.82rem", lineHeight: 1.55 }}>
        {ins.interpretation.map((line, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            {line}
          </li>
        ))}
      </ul>

      <h4 style={sectionTitleStyle()}>6. Conclusión ejecutiva</h4>
      <p
        style={{
          margin: 0,
          fontSize: "0.86rem",
          lineHeight: 1.55,
          padding: "0.65rem 0.75rem",
          borderLeft: `4px solid ${color}`,
          background: "var(--surface)",
          color: "var(--text)",
        }}
      >
        {ins.executiveSummary}
      </p>
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
  coordinationAssigneeErr: string | null;
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
  coordWeeklyAssignee: CoordinationWeeklyAssigneePerformancePayload | null;
  coordWeeklyTicketsByRequestType: CoordinationWeeklyTicketsByRequestTypePayload | null;
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
    coordWeeklyAssignee,
    coordWeeklyTicketsByRequestType,
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
        const secAssignee = a?.actiontime_assignee_seconds ?? 0;
        const secOnResolved = a?.actiontime_on_resolved_assignee_seconds ?? 0;
        row[`tickets_assignee_${s.chart_key}`] = a?.tickets_assignee_worked ?? 0;
        row[`hours_assignee_${s.chart_key}`] = Math.round((secAssignee / 3600) * 100) / 100;
        row[`tickets_resolved_assignee_${s.chart_key}`] = a?.tickets_resolved_assignee ?? 0;
        row[`hours_on_resolved_assignee_${s.chart_key}`] = Math.round((secOnResolved / 3600) * 100) / 100;
      }
      return row;
    });
  }, [coordWeeklyAssignee, perfAssigneeSeriesResolved, coordWeeklyEvolution]);

  /** Media semanal de tickets resueltos del equipo (misma métrica que la serie «Resueltos» del gráfico de evolución). */
  const perfTeamResolvedAvgPerWeek = useMemo(() => {
    const rows = perfPerformanceChartData;
    if (!rows.length) return 0;
    let sum = 0;
    for (const row of rows) {
      sum += Number(row[PERF_TEAM_RESOLVED_BAR_KEY] ?? 0) || 0;
    }
    return sum / rows.length;
  }, [perfPerformanceChartData]);

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

  /** Métricas de referencia para líneas del gráfico e informe operativo (solo rol asignado + horas imputadas). */
  const perfBarPerAssigneeBreakdown = useMemo(() => {
    const rows = perfPerformanceChartData;
    const assignees = perfAssigneeSeriesFiltered;
    if (!rows.length || !assignees.length) return [];
    const n = rows.length;
    return assignees.map((s, i) => {
      const weeklySeries: WeeklyAssigneePerfPoint[] = rows.map((row) => ({
        chartLabel: String(row.chartLabel ?? ""),
        worked: Number(row[`tickets_assignee_${s.chart_key}`] ?? 0) || 0,
        resolved: Number(row[`tickets_resolved_assignee_${s.chart_key}`] ?? 0) || 0,
        hours: Number(row[`hours_assignee_${s.chart_key}`] ?? 0) || 0,
      }));

      let sumTicketsAssignee = 0;
      let sumHoursAssignee = 0;
      let sumTicketsResolvedAssignee = 0;
      for (const row of rows) {
        sumTicketsAssignee += Number(row[`tickets_assignee_${s.chart_key}`] ?? 0) || 0;
        sumHoursAssignee += Number(row[`hours_assignee_${s.chart_key}`] ?? 0) || 0;
        sumTicketsResolvedAssignee += Number(row[`tickets_resolved_assignee_${s.chart_key}`] ?? 0) || 0;
      }
      const avgTicketsAssigneePerWeek = sumTicketsAssignee / n;
      const avgHoursAssigneePerWeek = sumHoursAssignee / n;
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
        avgTicketsAssigneePerWeek,
        avgHoursAssigneePerWeek,
        avgTicketsResolvedAssigneePerWeek,
        operationalInsight,
      };
    });
  }, [perfPerformanceChartData, perfAssigneeSeriesFiltered]);

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
            subtitle="Por semana ISO. Creados y resueltos: por fecha de apertura o solución. Pausados y reabiertos: según eventos en glpi_logs. Fuera de SLA: tickets creados en el rango que incumplen TTR, agrupados por semana de creación. Por defecto se muestran Creados y Resueltos; pausados, reabiertos y fuera de SLA ocultos hasta activarlos en la leyenda."
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
                <LineChart data={weeklyChartData} margin={{ top: 8, right: 8, left: 4, bottom: 76 }}>
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
            subtitle="Cada grupo de barras corresponde a una semana ISO: tickets trabajados como asignado (con tiempo registrado), tickets resueltos/cerrados en esa semana (`solvedate`) como asignado, y horas imputadas reales del técnico en el rango. Eje derecho: horas; línea gris horizontal de referencia a 33 h/semana nominales. Barra oscura adicional: total de resueltos del equipo (evolución semanal). El bloque inferior desarrolla el análisis operativo y ejecutivo por técnico (capacidad, utilización, riesgos y recomendaciones). Alcance: `GLPI_COORD_PERFORMANCE_LOGINS`."
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
                        value: "Tickets trabajados / resueltos",
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
                      const dkW = `tickets_assignee_${s.chart_key}`;
                      const dkR = `tickets_resolved_assignee_${s.chart_key}`;
                      const dkH = `hours_assignee_${s.chart_key}`;
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
                            name={`${label} · trabajados`}
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
                            name={`${label} · horas imputadas`}
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
                          y={item.avgTicketsAssigneePerWeek}
                          stroke={item.color}
                          strokeDasharray="8 5"
                          strokeWidth={2}
                          ifOverflow="extendDomain"
                          label={
                            perfBarShowCompactRefLabels
                              ? {
                                  value: `${item.shortRefLabel} · ${item.avgTicketsAssigneePerWeek.toFixed(1)} trab/sem (media)`,
                                  fill: item.color,
                                  fontSize: 9,
                                  position: idx % 2 === 0 ? "insideTopLeft" : "insideTopRight",
                                }
                              : undefined
                          }
                        />
                        <ReferenceLine
                          yAxisId="hours"
                          y={item.avgHoursAssigneePerWeek}
                          stroke={item.color}
                          strokeDasharray="3 5"
                          strokeWidth={2}
                          strokeOpacity={0.9}
                          ifOverflow="extendDomain"
                          label={
                            perfBarShowCompactRefLabels
                              ? {
                                  value: `${item.shortRefLabel} · ${item.avgHoursAssigneePerWeek.toFixed(1)} h/sem (media)`,
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
                      Promedios por semana ISO en el rango de filtros; utilización frente a{" "}
                      <strong>{EXPECTED_WEEKLY_SUPPORT_HOURS} h</strong> semanales por técnico; capacidad teórica mensual con{" "}
                      <strong>{PERF_MONTHLY_WEEKS}</strong> semanas equivalentes. Las líneas discontinuas del gráfico muestran la
                      media de tickets trabajados y de horas imputadas (rol asignado).
                    </p>
                    {perfBarPerAssigneeBreakdown.map((item) => (
                      <PerfTechnicianOperationalReport
                        key={item.chart_key}
                        displayName={item.displayName}
                        color={item.color}
                        insight={item.operationalInsight}
                        avgWorkedDisplay={item.avgTicketsAssigneePerWeek}
                        avgResolvedDisplay={item.avgTicketsResolvedAssigneePerWeek}
                        avgHoursDisplay={item.avgHoursAssigneePerWeek}
                      />
                    ))}
                  </div>
                )}
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
            title="Tickets por fuente de solicitud (semana ISO)"
            subtitle="Se excluyen las fuentes «Phone» y «(sin fuente)». Pulse una barra del gráfico o «Ver tickets» junto a cada fuente para listar números de ticket, título, proyecto, tiempo invertido (tareas en el rango de filtros) y fecha de creación. Proyecto GLPI opcional abajo; con varias semanas use el scroll horizontal del gráfico."
          />
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
        </section>

        <ProblemsSupportIndicatorsSection
          loading={coordinationLoading}
          err={coordProblemsSupportErr}
          data={coordProblemsSupport}
        />
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
