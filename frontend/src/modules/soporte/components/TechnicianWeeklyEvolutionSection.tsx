import { useEffect, useMemo, useState } from "react";
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

import type {
  CoordinationWeeklyTechnicianEvolutionPayload,
  CoordinationWeeklyTechnicianRow,
  CoordinationWeeklyTechnicianSeriesItem,
  CoordinationWeeklyTechnicianWeekBlock,
} from "../coordination/api";
import { CollapsibleSection } from "./CollapsibleSection";
import { formatIsoWeekRangeEs, IsoWeekAxisTick } from "../chartIsoWeekAxis";

const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";
const COLOR_MANAGED = "#714b67";
const COLOR_HOURS = "#017e84";
const COLOR_HOURS_MANAGED = "#e0a45a";
const COLOR_HOURS_RESOLVED = "#5bb8bc";

type EvolutionGranularity = "week" | "month";

function fmtActiontime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h <= 0) return `${m} min`;
  if (m <= 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function fmtHoursDecimal(seconds: number): string {
  return `${(seconds / 3600).toFixed(2)} h`;
}

function secToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

/** Agrupa bloques semanales ISO en meses calendario (clave = mes del lunes de la semana). */
function aggregateTechnicianWeeksByMonth(
  weeks: ReadonlyArray<CoordinationWeeklyTechnicianWeekBlock>,
): CoordinationWeeklyTechnicianWeekBlock[] {
  type Acc = {
    period_sort: number;
    period_label: string;
    week_period_start: string;
    week_period_end: string;
    byUser: Map<number, CoordinationWeeklyTechnicianRow>;
  };

  const byMonth = new Map<string, Acc>();
  for (const w of weeks) {
    const start = String(w.week_period_start ?? "").trim();
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
        byUser: new Map(),
      };
      byMonth.set(ym, acc);
    }

    for (const t of w.technicians) {
      const prev = acc.byUser.get(t.user_id);
      if (!prev) {
        acc.byUser.set(t.user_id, {
          user_id: t.user_id,
          full_name: t.full_name,
          login: t.login ?? null,
          tickets_created: t.tickets_created ?? 0,
          tickets_managed: t.tickets_managed ?? 0,
          actiontime_seconds: t.actiontime_seconds ?? 0,
          actiontime_managed_seconds: t.actiontime_managed_seconds ?? 0,
          actiontime_resolved_seconds: t.actiontime_resolved_seconds ?? 0,
        });
      } else {
        prev.tickets_created += t.tickets_created ?? 0;
        prev.tickets_managed += t.tickets_managed ?? 0;
        prev.actiontime_seconds += t.actiontime_seconds ?? 0;
        prev.actiontime_managed_seconds = (prev.actiontime_managed_seconds ?? 0) + (t.actiontime_managed_seconds ?? 0);
        prev.actiontime_resolved_seconds =
          (prev.actiontime_resolved_seconds ?? 0) + (t.actiontime_resolved_seconds ?? 0);
      }
    }
  }

  return [...byMonth.values()]
    .sort((a, b) => a.period_sort - b.period_sort)
    .map((acc) => ({
      period_sort: acc.period_sort,
      period_label: acc.period_label,
      week_period_start: acc.week_period_start,
      week_period_end: acc.week_period_end,
      technicians: [...acc.byUser.values()],
    }));
}

function TechEvolutionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string | number; value?: unknown; color?: string; dataKey?: unknown; payload?: unknown }>;
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
        const n = typeof raw === "number" ? raw : Number(raw);
        const isHours =
          dk.includes("hours") || dk.includes("Hours") || dk.startsWith("global_h") || dk.startsWith("tech_h");
        const shown = isHours
          ? `${Number.isFinite(n) ? n.toFixed(n < 10 ? 1 : 0) : String(raw)} h`
          : `${raw ?? 0} tickets`;
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
            <span style={{ color: p.color }}>{String(p.name ?? "")}</span>
            <span>{shown}</span>
          </div>
        );
      })}
    </div>
  );
}

export type TechnicianWeeklyEvolutionSectionProps = {
  loading: boolean;
  error: string | null;
  payload: CoordinationWeeklyTechnicianEvolutionPayload | null;
};

export function TechnicianWeeklyEvolutionSection(props: TechnicianWeeklyEvolutionSectionProps) {
  const { loading, error, payload } = props;
  const [techSelection, setTechSelection] = useState<string[]>([]);
  const [evolutionGranularity, setEvolutionGranularity] = useState<EvolutionGranularity>("week");

  const technicianSeries: CoordinationWeeklyTechnicianSeriesItem[] = useMemo(() => {
    const def = payload?.technician_series;
    if (def?.length) return def;
    const totals = payload?.technician_totals ?? [];
    return totals.map((t) => ({
      user_id: t.user_id,
      login: t.login ?? "",
      full_name: t.full_name,
      chart_key: `u${t.user_id}`,
    }));
  }, [payload]);

  const technicianSeriesSorted = useMemo(
    () => [...technicianSeries].sort((a, b) => a.full_name.localeCompare(b.full_name, "es")),
    [technicianSeries],
  );

  const seriesKeysSig = useMemo(
    () => technicianSeriesSorted.map((s) => s.chart_key).join("|"),
    [technicianSeriesSorted],
  );

  useEffect(() => {
    setTechSelection(technicianSeriesSorted.map((s) => s.chart_key));
  }, [seriesKeysSig]);

  const selectedSeries = useMemo(() => {
    const sel = new Set(techSelection);
    return technicianSeriesSorted.filter((s) => sel.has(s.chart_key));
  }, [technicianSeriesSorted, techSelection]);

  const showGlobalView = selectedSeries.length !== 1;

  const periodBlocks = useMemo(() => {
    const weeks = payload?.weeks ?? [];
    if (!weeks.length) return [];
    return evolutionGranularity === "month" ? aggregateTechnicianWeeksByMonth(weeks) : weeks;
  }, [payload, evolutionGranularity]);

  const chartData = useMemo(() => {
    if (!periodBlocks.length || !technicianSeries.length || selectedSeries.length === 0) return [];

    const selectedKeys = new Set(selectedSeries.map((s) => s.chart_key));

    return periodBlocks.map((w) => {
      const row: Record<string, string | number> = {
        chartLabel: w.period_label,
        period_sort: w.period_sort,
        week_period_start: w.week_period_start,
        week_period_end: w.week_period_end,
      };

      if (showGlobalView) {
        let managedSum = 0;
        let hoursSum = 0;
        let hoursManagedSum = 0;
        let hoursResolvedSum = 0;
        for (const s of technicianSeries) {
          if (!selectedKeys.has(s.chart_key)) continue;
          const t =
            w.technicians.find((x) => x.user_id === s.user_id) ??
            (s.login ? w.technicians.find((x) => x.login === s.login) : undefined);
          managedSum += t?.tickets_managed ?? 0;
          hoursSum += t?.actiontime_seconds ?? 0;
          hoursManagedSum += t?.actiontime_managed_seconds ?? 0;
          hoursResolvedSum += t?.actiontime_resolved_seconds ?? 0;
        }
        row.global_managed = managedSum;
        row.global_hours = secToHours(hoursSum);
        row.global_hours_managed = secToHours(hoursManagedSum);
        row.global_hours_resolved = secToHours(hoursResolvedSum);
      } else {
        const s = selectedSeries[0]!;
        const t =
          w.technicians.find((x) => x.user_id === s.user_id) ??
          (s.login ? w.technicians.find((x) => x.login === s.login) : undefined);
        row.tech_managed = t?.tickets_managed ?? 0;
        row.tech_hours = secToHours(t?.actiontime_seconds ?? 0);
        row.tech_hours_managed = secToHours(t?.actiontime_managed_seconds ?? 0);
        row.tech_hours_resolved = secToHours(t?.actiontime_resolved_seconds ?? 0);
      }

      return row;
    });
  }, [periodBlocks, technicianSeries, selectedSeries, showGlobalView]);

  const sectionTitle =
    evolutionGranularity === "month"
      ? "Evolución mensual por técnico (gestionados · tiempo)"
      : "Evolución semanal por técnico (gestionados · tiempo)";

  const sectionSubtitle =
    evolutionGranularity === "month"
      ? "Por mes calendario (suma de semanas ISO cuyo lunes cae en ese mes). Líneas: tickets gestionados (imputación) y tiempo total registrado. Barras (eje horas): horas en tickets con evento gestionado o resuelto en glpi_logs esa semana (misma lógica que la evolución semanal global). Un solo técnico = vista individual; varios = suma de la selección."
      : "Por semana ISO. Líneas: tickets gestionados (imputación) y tiempo total registrado. Barras (eje horas): horas en tickets con evento gestionado (Nuevo→En curso/Planificado/En espera) o resuelto/cerrado en glpi_logs esa semana — misma lógica que «Horas en gestionados/resueltos» de la evolución semanal. Un solo técnico = vista individual; varios = suma de la selección.";

  const selectionTotals = useMemo(() => {
    const sel = new Set(selectedSeries.map((s) => s.user_id));
    const rows = (payload?.technician_totals ?? []).filter((r) => sel.has(r.user_id));
    if (rows.length === 0) return null;
    if (showGlobalView) {
      return {
        label: selectedSeries.length === technicianSeriesSorted.length ? "Equipo (todos)" : "Equipo (selección)",
        tickets_managed: rows.reduce((acc, r) => acc + r.tickets_managed, 0),
        actiontime_seconds: rows.reduce((acc, r) => acc + r.actiontime_seconds, 0),
      };
    }
    const r = rows[0]!;
    return {
      label: r.login ? `${r.full_name} (${r.login})` : r.full_name,
      tickets_managed: r.tickets_managed,
      actiontime_seconds: r.actiontime_seconds,
    };
  }, [payload, selectedSeries, showGlobalView, technicianSeriesSorted.length]);

  const tableRows = useMemo(() => {
    const sel = new Set(selectedSeries.map((s) => s.user_id));
    return (payload?.technician_totals ?? []).filter((r) => sel.has(r.user_id));
  }, [payload, selectedSeries]);

  const singleTechLabel = useMemo(() => {
    if (showGlobalView || selectedSeries.length !== 1) return null;
    const s = selectedSeries[0]!;
    return s.login ? `${s.full_name} (${s.login})` : s.full_name;
  }, [selectedSeries, showGlobalView]);

  return (
    <CollapsibleSection title={sectionTitle} subtitle={sectionSubtitle}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.75rem 1.25rem",
          marginBottom: "0.35rem",
        }}
        role="radiogroup"
        aria-label="Granularidad de la evolución por técnico"
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
            name="tech-evolution-granularity"
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
            name="tech-evolution-granularity"
            checked={evolutionGranularity === "month"}
            onChange={() => setEvolutionGranularity("month")}
          />
          Mensual
        </label>
      </div>
      {error && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.88rem", margin: "0.65rem 0 0" }}>
          Error al cargar evolución por técnico: {error}
        </p>
      )}
      {!error && loading && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando evolución por técnico…</p>
      )}
      {!error && !loading && payload && payload.weeks.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
          {evolutionGranularity === "month"
            ? "No hay meses en el rango seleccionado."
            : "No hay semanas en el rango seleccionado."}
        </p>
      )}
      {!error && !loading && payload && payload.weeks.length > 0 && (
        <>
          {selectionTotals && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "0.65rem",
                marginTop: "0.85rem",
              }}
            >
              <div
                style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "0.75rem 0.9rem",
                }}
              >
                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  Tickets gestionados{showGlobalView ? " (global)" : ""}
                </div>
                <div style={{ fontSize: "1.45rem", fontWeight: 700 }}>{selectionTotals.tickets_managed}</div>
                {!showGlobalView && singleTechLabel && (
                  <div style={{ fontSize: "0.74rem", color: "var(--muted)", marginTop: 4 }}>{singleTechLabel}</div>
                )}
              </div>
              <div
                style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "0.75rem 0.9rem",
                }}
              >
                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  Tiempo invertido{showGlobalView ? " (global)" : ""}
                </div>
                <div style={{ fontSize: "1.45rem", fontWeight: 700 }}>
                  {fmtActiontime(selectionTotals.actiontime_seconds)}
                </div>
                {!showGlobalView && singleTechLabel && (
                  <div style={{ fontSize: "0.74rem", color: "var(--muted)", marginTop: 4 }}>{singleTechLabel}</div>
                )}
              </div>
            </div>
          )}

          {technicianSeriesSorted.length > 0 && (
            <div style={{ marginTop: "1rem", maxWidth: 480 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem 0.75rem",
                  marginBottom: "0.5rem",
                }}
              >
                <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)" }}>Técnicos</span>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  ({techSelection.length}/{technicianSeriesSorted.length})
                </span>
                <button
                  type="button"
                  onClick={() => setTechSelection(technicianSeriesSorted.map((s) => s.chart_key))}
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
                  onClick={() => setTechSelection([])}
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
                {showGlobalView
                  ? "Vista global: suma de los técnicos marcados."
                  : "Vista individual: datos del único técnico seleccionado."}
              </p>
              <div
                role="group"
                aria-label="Técnicos incluidos en el gráfico"
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  background: "var(--surface)",
                }}
              >
                {technicianSeriesSorted.map((s, i) => {
                  const checked = techSelection.includes(s.chart_key);
                  const label = s.login ? `${s.full_name} (${s.login})` : s.full_name;
                  const last = i === technicianSeriesSorted.length - 1;
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
                          setTechSelection((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.chart_key)) next.delete(s.chart_key);
                            else next.add(s.chart_key);
                            return technicianSeriesSorted
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

          {selectedSeries.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
              Seleccione al menos un técnico para ver la evolución{" "}
              {evolutionGranularity === "month" ? "mensual" : "semanal"}.
            </p>
          ) : (
            chartData.length > 0 && (
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
                      yAxisId="tickets"
                      allowDecimals={false}
                      tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      width={42}
                      label={{
                        value: "Tickets gestionados",
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
                    <Tooltip content={(p) => <TechEvolutionTooltip {...p} />} />
                    <Legend wrapperStyle={{ paddingTop: 8 }} />
                    {showGlobalView ? (
                      <>
                        <Bar
                          yAxisId="hours"
                          dataKey="global_hours_managed"
                          name="Horas en gestionados (logs)"
                          fill={COLOR_HOURS_MANAGED}
                          fillOpacity={0.72}
                          maxBarSize={26}
                        />
                        <Bar
                          yAxisId="hours"
                          dataKey="global_hours_resolved"
                          name="Horas en resueltos (logs)"
                          fill={COLOR_HOURS_RESOLVED}
                          fillOpacity={0.72}
                          maxBarSize={26}
                        />
                        <Line
                          yAxisId="tickets"
                          type="monotone"
                          dataKey="global_managed"
                          name="Tickets gestionados (global)"
                          stroke={COLOR_MANAGED}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                        <Line
                          yAxisId="hours"
                          type="monotone"
                          dataKey="global_hours"
                          name="Tiempo invertido (global)"
                          stroke={COLOR_HOURS}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                          strokeDasharray="6 4"
                        />
                      </>
                    ) : (
                      <>
                        <Bar
                          yAxisId="hours"
                          dataKey="tech_hours_managed"
                          name="Horas en gestionados (logs)"
                          fill={COLOR_HOURS_MANAGED}
                          fillOpacity={0.72}
                          maxBarSize={26}
                        />
                        <Bar
                          yAxisId="hours"
                          dataKey="tech_hours_resolved"
                          name="Horas en resueltos (logs)"
                          fill={COLOR_HOURS_RESOLVED}
                          fillOpacity={0.72}
                          maxBarSize={26}
                        />
                        <Line
                          yAxisId="tickets"
                          type="monotone"
                          dataKey="tech_managed"
                          name={`Tickets gestionados · ${singleTechLabel ?? "técnico"}`}
                          stroke={COLOR_MANAGED}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                        <Line
                          yAxisId="hours"
                          type="monotone"
                          dataKey="tech_hours"
                          name={`Tiempo invertido · ${singleTechLabel ?? "técnico"}`}
                          stroke={COLOR_HOURS}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                          strokeDasharray="6 4"
                        />
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )
          )}

          {tableRows.length > 0 && showGlobalView && (
            <div style={{ marginTop: "1.15rem", overflowX: "auto" }}>
              <h3 style={{ margin: "0 0 0.55rem", fontSize: "0.95rem", fontWeight: 650 }}>
                Desglose por técnico en el rango (selección actual)
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "0.5rem 0.65rem" }}>Técnico</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>Gestionados</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>Tiempo</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>Horas gestionados (logs)</th>
                    <th style={{ padding: "0.5rem 0.65rem" }}>Horas resueltos (logs)</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.user_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.5rem 0.65rem" }}>
                        {r.login ? `${r.full_name} (${r.login})` : r.full_name}
                      </td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>{r.tickets_managed}</td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>{fmtHoursDecimal(r.actiontime_seconds)}</td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>
                        {fmtHoursDecimal(r.actiontime_managed_seconds ?? 0)}
                      </td>
                      <td style={{ padding: "0.5rem 0.65rem" }}>
                        {fmtHoursDecimal(r.actiontime_resolved_seconds ?? 0)}
                      </td>
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
