import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatIsoWeekRangeEs, IsoWeekAxisTick } from "../chartIsoWeekAxis";
import type {
  CoordinationTicketTimeParetoPayload,
  CoordinationTicketTimeParetoPeriodRow,
} from "../coordination/api";
import { CollapsibleSection } from "./CollapsibleSection";

const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";

const COLOR_HOURS = "#5b9bd5";
const COLOR_CUM = "#c45c26";
const COLOR_PCT80 = "#714b67";
const COLOR_TOP20 = "#017e84";

type EvolutionGranularity = "week" | "month";

function fmtHours(seconds: number): string {
  const h = seconds / 3600;
  if (!Number.isFinite(h) || h <= 0) return "0 h";
  return `${h.toFixed(h < 10 ? 1 : 0)} h`;
}

function PeriodTooltip({
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
        minWidth: 210,
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: range ? 4 : 8 }}>{mainLabel}</div>
      {range ? (
        <div style={{ fontWeight: 500, color: CHART_AXIS, marginBottom: 8, fontSize: "0.8rem" }}>{range}</div>
      ) : null}
      {payload.map((p, i) => {
        const dk = String(p.dataKey ?? "");
        const n = Number(p.value);
        let display = String(p.value ?? "");
        if (dk === "hours_total") display = `${Number.isFinite(n) ? n.toFixed(n < 10 ? 1 : 0) : "—"} h`;
        else if (dk.includes("pct") || dk.includes("Pct"))
          display = `${Number.isFinite(n) ? n.toFixed(1) : "—"} %`;
        return (
          <div
            key={i}
            style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 2 }}
          >
            <span style={{ color: p.color }}>{p.name}</span>
            <span>{display}</span>
          </div>
        );
      })}
      {row ? (
        <div style={{ marginTop: 6, color: CHART_AXIS, fontSize: "0.78rem" }}>
          {Number(row.tickets_for_80pct) || 0} de {Number(row.tickets_with_time) || 0} tickets cubren ~80 % del
          tiempo
        </div>
      ) : null}
    </div>
  );
}

function ParetoTicketTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown> | undefined;
  if (!row) return null;
  return (
    <div
      style={{
        background: CHART_TOOLTIP_BG,
        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
        borderRadius: 8,
        fontSize: "0.82rem",
        color: CHART_TEXT,
        padding: "0.45rem 0.55rem",
        maxWidth: 360,
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: 4 }}>
        #{String(row.rank)} · Ticket {String(row.ticket_id)}
      </div>
      <div style={{ marginBottom: 6, wordBreak: "break-word" }}>{String(row.ticket_name ?? "")}</div>
      {row.project_name ? (
        <div style={{ color: CHART_AXIS, marginBottom: 6, fontSize: "0.78rem" }}>
          Proyecto: {String(row.project_name)}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: COLOR_HOURS }}>Horas</span>
        <span>{fmtHours(Number(row.actiontime_seconds) || 0)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span>% del total</span>
        <span>{Number(row.pct_of_total).toFixed(2)} %</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: COLOR_CUM }}>% acumulado</span>
        <span>{Number(row.cumulative_pct).toFixed(2)} %</span>
      </div>
    </div>
  );
}

export type TicketTimeParetoSectionProps = {
  loading: boolean;
  error: string | null;
  payload: CoordinationTicketTimeParetoPayload | null;
};

export function TicketTimeParetoSection(props: TicketTimeParetoSectionProps) {
  const { loading, error, payload } = props;
  const [granularity, setGranularity] = useState<EvolutionGranularity>("week");

  const range = payload?.range ?? null;

  const periodRows: CoordinationTicketTimeParetoPeriodRow[] = useMemo(() => {
    if (!payload) return [];
    return granularity === "month" ? payload.months : payload.weeks;
  }, [payload, granularity]);

  const evolutionChartData = useMemo(
    () =>
      periodRows.map((r) => ({
        ...r,
        chartLabel:
          granularity === "month"
            ? (() => {
                const start = String(r.week_period_start ?? "");
                if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
                  const d = new Date(`${start}T12:00:00`);
                  if (!Number.isNaN(d.getTime())) {
                    return d.toLocaleDateString("es-EC", { month: "short", year: "numeric" });
                  }
                }
                return r.period_label;
              })()
            : r.period_label,
        hours_total: Math.round(((Number(r.actiontime_total_seconds) || 0) / 3600) * 100) / 100,
        pct_tickets_for_80: Number(r.pct_tickets_for_80) || 0,
        pct_hours_top20: Number(r.pct_hours_in_top_20pct_tickets) || 0,
      })),
    [periodRows, granularity],
  );

  const paretoChartData = useMemo(() => {
    const tops = range?.top_tickets ?? [];
    return tops.map((t) => ({
      ...t,
      chartLabel: `#${t.rank}`,
      hours: Math.round((t.actiontime_seconds / 3600) * 100) / 100,
    }));
  }, [range]);

  const title =
    granularity === "month"
      ? "Indicador 80-20 de tickets por tiempo de consumo (mensual)"
      : "Indicador 80-20 de tickets por tiempo de consumo (semanal)";

  const subtitle =
    "Regla de Pareto sobre el tiempo imputado en tareas (`actiontime`) con fecha en el rango de filtros. " +
    "Se ordenan los tickets de mayor a menor consumo: cuántos hacen falta para acumular ~80 % de las horas, " +
    "y qué % de horas concentran el 20 % de tickets con más tiempo. " +
    "El gráfico de ranking usa todo el rango de fechas; la evolución recalcula el 80-20 por semana ISO o por mes calendario. " +
    "Respeta entidad y tipo de proyecto.";

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
        aria-label="Granularidad indicador 80-20"
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
            name="pareto-evolution-granularity"
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
            name="pareto-evolution-granularity"
            checked={granularity === "month"}
            onChange={() => setGranularity("month")}
          />
          Mensual
        </label>
      </div>

      {error && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.88rem", margin: "0.65rem 0 0" }}>
          Error al cargar indicador 80-20: {error}
        </p>
      )}
      {!error && loading && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
          Cargando indicador 80-20…
        </p>
      )}
      {!error && !loading && payload && (range?.tickets_with_time ?? 0) === 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
          No hay tickets con tiempo imputado en el rango seleccionado.
        </p>
      )}

      {!error && range && (range.tickets_with_time ?? 0) > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
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
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Horas totales (rango)</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: COLOR_HOURS }}>
                {fmtHours(range.actiontime_total_seconds)}
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
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Tickets con tiempo</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{range.tickets_with_time}</div>
            </div>
            <div
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0.65rem 0.75rem",
              }}
            >
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Tickets para ~80 % horas</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: COLOR_PCT80 }}>
                {range.tickets_for_80pct}{" "}
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  ({range.pct_tickets_for_80.toFixed(1)} %)
                </span>
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
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>% horas en top 20 % tickets</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: COLOR_TOP20 }}>
                {range.pct_hours_in_top_20pct_tickets.toFixed(1)} %
              </div>
            </div>
          </div>

          {paretoChartData.length > 0 && (
            <div style={{ width: "100%", marginTop: "1rem" }}>
              <h3 style={{ margin: "0 0 0.45rem", fontSize: "0.92rem", fontWeight: 650 }}>
                Ranking Pareto (rango completo de filtros)
              </h3>
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={paretoChartData} margin={{ top: 8, right: 12, left: 4, bottom: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="chartLabel"
                    tick={{ fill: CHART_TEXT, fontSize: 10 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
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
                    yAxisId="pct"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fill: CHART_TEXT, fontSize: 11 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    width={40}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={ParetoTicketTooltip} />
                  <Legend wrapperStyle={{ paddingTop: 8 }} />
                  <Bar
                    yAxisId="hours"
                    dataKey="hours"
                    name="Horas del ticket"
                    fill={COLOR_HOURS}
                    fillOpacity={0.75}
                    maxBarSize={28}
                  />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="cumulative_pct"
                    name="% acumulado"
                    stroke={COLOR_CUM}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <ReferenceLine yAxisId="pct" y={80} stroke={COLOR_PCT80} strokeDasharray="6 4" label="80 %" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {evolutionChartData.length > 0 && (
            <div style={{ width: "100%", marginTop: "1.15rem" }}>
              <h3 style={{ margin: "0 0 0.45rem", fontSize: "0.92rem", fontWeight: 650 }}>
                Evolución {granularity === "month" ? "mensual" : "semanal"} de la concentración
              </h3>
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart data={evolutionChartData} margin={{ top: 8, right: 12, left: 4, bottom: 76 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis
                    dataKey="chartLabel"
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    tick={(p) => (
                      <IsoWeekAxisTick
                        {...p}
                        rows={evolutionChartData}
                        labelFill={CHART_TEXT}
                        rangeFill={CHART_AXIS}
                      />
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
                    yAxisId="pct"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fill: CHART_TEXT, fontSize: 11 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    width={40}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip content={PeriodTooltip} />
                  <Legend wrapperStyle={{ paddingTop: 8 }} />
                  <Bar
                    yAxisId="hours"
                    dataKey="hours_total"
                    name="Horas totales del periodo"
                    fill={COLOR_HOURS}
                    fillOpacity={0.65}
                    maxBarSize={28}
                  />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="pct_tickets_for_80"
                    name="% tickets para 80 % horas"
                    stroke={COLOR_PCT80}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="pct_hours_top20"
                    name="% horas en top 20 % tickets"
                    stroke={COLOR_TOP20}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {paretoChartData.length > 0 && (
            <div style={{ marginTop: "1.15rem", overflowX: "auto" }}>
              <h3 style={{ margin: "0 0 0.55rem", fontSize: "0.95rem", fontWeight: 650 }}>
                Tickets que concentran el consumo (hasta ~80 % o top listado)
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "0.5rem 0.65rem" }}>#</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>Ticket</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>Proyecto</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>Horas</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>% total</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>% acum.</th>
                  </tr>
                </thead>
                <tbody>
                  {paretoChartData.map((t) => (
                    <tr key={t.ticket_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.5rem 0.65rem" }}>{t.rank}</td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>
                        <span style={{ fontWeight: 600 }}>#{t.ticket_id}</span>{" "}
                        <span style={{ color: "var(--muted)" }}>{t.ticket_name}</span>
                      </td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>{t.project_name || "—"}</td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>{fmtHours(t.actiontime_seconds)}</td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>{t.pct_of_total.toFixed(2)} %</td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>{t.cumulative_pct.toFixed(2)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}
