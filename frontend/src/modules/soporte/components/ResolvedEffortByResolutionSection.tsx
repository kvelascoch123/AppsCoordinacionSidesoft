import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatIsoWeekRangeEs, IsoWeekAxisTick } from "../chartIsoWeekAxis";
import type { CoordinationResolvedEffortPayload, CoordinationResolvedEffortRow } from "../coordination/api";
import { CollapsibleSection } from "./CollapsibleSection";

const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";

const COLOR_HOURS = "#5b9bd5";
const COLOR_TICKETS = "#70ad47";
const COLOR_AVG = "#c45c26";

type EvolutionGranularity = "week" | "month";

const COUNT_KEYS = ["tickets_resolved", "actiontime_total_seconds"] as const;

function aggregateByMonth(rows: ReadonlyArray<CoordinationResolvedEffortRow>): CoordinationResolvedEffortRow[] {
  type Acc = {
    period_sort: number;
    period_label: string;
    week_period_start: string;
    week_period_end: string;
    tickets_resolved: number;
    actiontime_total_seconds: number;
  };
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
        tickets_resolved: 0,
        actiontime_total_seconds: 0,
      };
      byMonth.set(ym, acc);
    }
    for (const k of COUNT_KEYS) {
      acc[k] += Number(r[k] ?? 0) || 0;
    }
  }
  return [...byMonth.values()]
    .sort((a, b) => a.period_sort - b.period_sort)
    .map((a) => {
      const tr = a.tickets_resolved;
      const sec = a.actiontime_total_seconds;
      return {
        ...a,
        avg_hours_per_ticket: tr > 0 ? Math.round((sec / 3600 / tr) * 100) / 100 : 0,
      };
    });
}

function ResolvedEffortTooltip({
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
  const hoursTotal = Number(row?.hours_total ?? 0);
  const tickets = Number(row?.tickets_resolved ?? 0);
  const avg = Number(row?.avg_hours_per_ticket ?? 0);
  return (
    <div
      style={{
        background: CHART_TOOLTIP_BG,
        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
        borderRadius: 8,
        fontSize: "0.82rem",
        color: CHART_TEXT,
        padding: "0.45rem 0.55rem",
        minWidth: 200,
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: range ? 4 : 8 }}>{mainLabel}</div>
      {range ? (
        <div style={{ fontWeight: 500, color: CHART_AXIS, marginBottom: 8, fontSize: "0.8rem" }}>{range}</div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <span style={{ color: COLOR_HOURS }}>Horas totales resueltos</span>
        <span>{Number.isFinite(hoursTotal) ? `${hoursTotal.toFixed(hoursTotal < 10 ? 1 : 0)} h` : "—"}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <span style={{ color: COLOR_TICKETS }}>Tickets resueltos</span>
        <span>{Number.isFinite(tickets) ? String(tickets) : "—"}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: COLOR_AVG }}>Promedio horas/ticket</span>
        <span>{Number.isFinite(avg) ? `${avg.toFixed(2)} h` : "—"}</span>
      </div>
    </div>
  );
}

export type ResolvedEffortByResolutionSectionProps = {
  loading: boolean;
  error: string | null;
  payload: CoordinationResolvedEffortPayload | null;
};

export function ResolvedEffortByResolutionSection(props: ResolvedEffortByResolutionSectionProps) {
  const { loading, error, payload } = props;
  const [granularity, setGranularity] = useState<EvolutionGranularity>("week");
  const [seriesOff, setSeriesOff] = useState<Record<string, boolean>>({});
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const chartData = useMemo(() => {
    if (!payload?.rows.length) return [];
    const rows = granularity === "month" ? aggregateByMonth(payload.rows) : payload.rows;
    return rows.map((r) => ({
      ...r,
      chartLabel: r.period_label,
      hours_total: Math.round(((Number(r.actiontime_total_seconds) || 0) / 3600) * 100) / 100,
      avg_hours_per_ticket: Number(r.avg_hours_per_ticket) || 0,
    }));
  }, [payload, granularity]);

  const periodTotals = useMemo(() => {
    let tickets = 0;
    let seconds = 0;
    for (const r of chartData) {
      tickets += Number(r.tickets_resolved) || 0;
      seconds += Number(r.actiontime_total_seconds) || 0;
    }
    const hours = Math.round((seconds / 3600) * 100) / 100;
    const avg = tickets > 0 ? Math.round((seconds / 3600 / tickets) * 100) / 100 : 0;
    return { tickets, hours, avg };
  }, [chartData]);

  const title =
    granularity === "month"
      ? "Promedio de horas por ticket resuelto (mensual)"
      : "Promedio de horas por ticket resuelto (semanal)";
  const subtitle =
    granularity === "month"
      ? "Indicador independiente de «Horas en gestionados/resueltos» de la evolución semanal. Atribuye el actiontime histórico completo de cada ticket (todas las tareas, sin filtrar por fecha) al mes del lunes de la semana ISO de COALESCE(solvedate, closedate). Reaperturas: solo la resolución final vigente. Barras: horas totales y tickets; línea: promedio h/ticket."
      : "Indicador independiente de «Horas en gestionados/resueltos» de la evolución semanal. Atribuye el actiontime histórico completo de cada ticket (todas las tareas, sin filtrar por fecha) a la semana ISO de COALESCE(solvedate, closedate). Reaperturas: solo la resolución final vigente. Barras: horas totales y tickets; línea: promedio h/ticket.";

  const show = (key: string) => (hoverKey != null ? hoverKey === key : !seriesOff[key]);

  return (
    <CollapsibleSection title={title} subtitle={subtitle}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.75rem 1.25rem",
          marginBottom: "0.35rem",
        }}
        role="radiogroup"
        aria-label="Granularidad esfuerzo por resolución"
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
            name="resolved-effort-granularity"
            checked={granularity === "week"}
            onChange={() => setGranularity("week")}
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
            name="resolved-effort-granularity"
            checked={granularity === "month"}
            onChange={() => setGranularity("month")}
          />
          Mensual
        </label>
      </div>

      {error && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.88rem", margin: "0.65rem 0 0" }}>
          Error al cargar esfuerzo por resolución: {error}
        </p>
      )}
      {!error && loading && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
          Cargando esfuerzo por resolución…
        </p>
      )}
      {!error && !loading && payload && chartData.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
          {granularity === "month" ? "No hay meses en el rango seleccionado." : "No hay semanas en el rango seleccionado."}
        </p>
      )}

      {!error && chartData.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "0.65rem",
              marginTop: "0.75rem",
            }}
          >
            <div
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0.65rem 0.75rem",
              }}
            >
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Horas totales resueltos</div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, color: COLOR_HOURS }}>
                {periodTotals.hours.toFixed(periodTotals.hours < 10 ? 1 : 0)} h
              </div>
            </div>
            <div
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0.65rem 0.75rem",
              }}
            >
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Tickets resueltos</div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, color: COLOR_TICKETS }}>{periodTotals.tickets}</div>
            </div>
            <div
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0.65rem 0.75rem",
              }}
            >
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Promedio horas/ticket</div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, color: COLOR_AVG }}>
                {periodTotals.avg.toFixed(2)} h
              </div>
            </div>
          </div>

          <div style={{ width: "100%", marginTop: "0.85rem" }}>
            <ResponsiveContainer width="100%" height={420}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 76 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis
                  dataKey="chartLabel"
                  tickLine={{ stroke: CHART_AXIS }}
                  axisLine={{ stroke: CHART_AXIS }}
                  tick={(p) => (
                    <IsoWeekAxisTick {...p} rows={chartData} labelFill={CHART_TEXT} rangeFill={CHART_AXIS} />
                  )}
                  height={74}
                  interval={0}
                />
                <YAxis
                  yAxisId="hours"
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                  tickLine={{ stroke: CHART_AXIS }}
                  axisLine={{ stroke: CHART_AXIS }}
                  width={44}
                  label={{ value: "h", position: "insideTopLeft", offset: 8, fill: CHART_AXIS, fontSize: 11 }}
                />
                <YAxis
                  yAxisId="tickets"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                  tickLine={{ stroke: CHART_AXIS }}
                  axisLine={{ stroke: CHART_AXIS }}
                  width={40}
                />
                <Tooltip content={ResolvedEffortTooltip} />
                <Legend
                  wrapperStyle={{ paddingTop: 8 }}
                  onClick={(e) => {
                    const key = String((e as { dataKey?: unknown }).dataKey ?? "");
                    if (!key) return;
                    setSeriesOff((p) => ({ ...p, [key]: !p[key] }));
                  }}
                  onMouseEnter={(e) => {
                    const key = String((e as { dataKey?: unknown }).dataKey ?? "");
                    if (key) setHoverKey(key);
                  }}
                  onMouseLeave={() => setHoverKey(null)}
                />
                <Bar
                  yAxisId="hours"
                  dataKey="hours_total"
                  name="Horas totales resueltos"
                  fill={COLOR_HOURS}
                  fillOpacity={0.72}
                  maxBarSize={28}
                  hide={!show("hours_total")}
                />
                <Bar
                  yAxisId="tickets"
                  dataKey="tickets_resolved"
                  name="Tickets resueltos"
                  fill={COLOR_TICKETS}
                  fillOpacity={0.65}
                  maxBarSize={22}
                  hide={!show("tickets_resolved")}
                />
                <Line
                  yAxisId="hours"
                  type="monotone"
                  dataKey="avg_hours_per_ticket"
                  name="Promedio horas/ticket"
                  stroke={COLOR_AVG}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: COLOR_AVG, strokeWidth: 0 }}
                  connectNulls
                  hide={!show("avg_hours_per_ticket")}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
