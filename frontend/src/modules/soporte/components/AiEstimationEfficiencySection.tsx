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

import {
  fetchAiEstimationTicketsDetail,
  type AiEstimationFieldKey,
  type AiEstimationFieldSliceData,
  type AiEstimationSummaryPayload,
  type AiEstimationTicketRow,
  type AiEstimationSemaforoKey,
  type AiEstimationTicketsDetailOptions,
} from "../coordination/api";
import { CollapsibleSection } from "./CollapsibleSection";
import {
  formatDecimalHoursAsHhMm,
  formatGlpiHmRaw,
  formatSignedDecimalHoursAsHhMm,
} from "../glpiTime";
import { formatIsoWeekRangeEs, IsoWeekAxisTick } from "../chartIsoWeekAxis";

const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";

const SEMAFORO_COLORS: Record<string, string> = {
  sin_estimar: "#adb5bd",
  sin_tiempo: "#5b9bd5",
  dentro: "#198754",
  leve: "#ffc107",
  significativo: "#dc3545",
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} %`;
}

function fmtDurationDecimal(v: number | null | undefined): string {
  return formatDecimalHoursAsHhMm(v);
}

function fmtDurationSigned(v: number | null | undefined): string {
  return formatSignedDecimalHoursAsHhMm(v);
}

function fmtEstimated(raw: string | null | undefined, decimalHours: number | null | undefined): string {
  if (raw != null && String(raw).trim() !== "") return formatGlpiHmRaw(raw);
  return formatDecimalHoursAsHhMm(decimalHours);
}

function buildKpiAnalyses(summary: AiEstimationSummaryPayload) {
  const {
    compliance_rate_pct: compliancePct,
    tickets_within_estimate: within,
    tickets_comparable: comparable,
    avg_deviation_pct: avgDev,
    efficiency_ratio: efficiencyRatio,
    net_hours_vs_estimate: netHours,
    tickets_with_estimate: withEstimate,
    total_tickets: totalTickets,
    significant_deviation_rate_pct: significantPct,
    tickets_significant_deviation: significantCount,
  } = summary;

  const complianceAnalysis = (() => {
    if (comparable === 0) {
      return "Todavía no hay tickets con estimación IA y tiempo registrado para comparar en este rango.";
    }
    const failed = comparable - within;
    if (compliancePct != null && compliancePct >= 70) {
      return `Buen resultado: ${within} de ${comparable} tickets terminaron dentro del tiempo estimado. La IA acierta en la mayoría de los casos comparables.`;
    }
    if (compliancePct != null && compliancePct >= 50) {
      return `Resultado mixto: ${within} cumplieron y ${failed} se pasaron del estimado. La IA acierta en algo más de la mitad de los tickets comparables.`;
    }
    return `Hay margen de mejora: solo ${within} de ${comparable} tickets cumplieron el estimado. En la mayoría (${failed}) el tiempo real superó lo previsto por la IA.`;
  })();

  const deviationAnalysis = (() => {
    if (avgDev == null || comparable === 0) {
      return "Sin datos suficientes para calcular la desviación promedio.";
    }
    if (avgDev <= -5) {
      return `En promedio el equipo resolvió un ${Math.abs(avgDev).toFixed(1)} % más rápido de lo estimado. La IA suele sobreestimar el esfuerzo.`;
    }
    if (avgDev <= 5) {
      return `La desviación promedio es baja (${avgDev > 0 ? "+" : ""}${avgDev.toFixed(1)} %). En conjunto, lo estimado y lo ejecutado están bastante alineados.`;
    }
    if (avgDev <= 20) {
      return `En promedio el trabajo tardó un ${avgDev.toFixed(1)} % más de lo estimado. La IA tiende a subestimar un poco el esfuerzo necesario.`;
    }
    return `En promedio el tiempo real superó bastante el estimado (+${avgDev.toFixed(1)} %). La IA está subestimando con frecuencia el esfuerzo.`;
  })();

  const efficiencyAnalysis = (() => {
    if (efficiencyRatio == null) {
      return "No hay horas estimadas y ejecutadas suficientes para calcular este ratio.";
    }
    if (efficiencyRatio > 1.05) {
      return `Con valor ${efficiencyRatio.toFixed(2)}, en total se estimaron más horas de las que realmente se trabajaron. A nivel global del periodo, el equipo fue más rápido de lo previsto.`;
    }
    if (efficiencyRatio >= 0.95) {
      return `Con valor ${efficiencyRatio.toFixed(2)}, las horas estimadas y ejecutadas en el periodo están muy equilibradas.`;
    }
    return `Con valor ${efficiencyRatio.toFixed(2)}, se trabajó más de lo estimado en el conjunto del periodo. La estimación global quedó corta.`;
  })();

  const netHoursAnalysis = (() => {
    if (netHours == null || comparable === 0) {
      return "Sin tickets comparables no se puede calcular el balance neto de horas.";
    }
    const formatted = formatSignedDecimalHoursAsHhMm(netHours);
    if (netHours > 0) {
      return `El equipo ahorró ${formatted.replace(/^\+/, "")} respecto a lo estimado en los ${comparable} tickets comparables. Se invirtió menos tiempo del previsto por la IA.`;
    }
    if (netHours < 0) {
      return `El equipo trabajó ${formatted.replace(/^−/, "")} más de lo estimado en los ${comparable} tickets comparables. Hubo sobrecoste frente a la estimación IA.`;
    }
    return `En los ${comparable} tickets comparables, las horas estimadas y ejecutadas se compensan exactamente (balance 0:00).`;
  })();

  const coveragePct = totalTickets > 0 ? (withEstimate / totalTickets) * 100 : null;
  const coverageAnalysis = (() => {
    if (totalTickets === 0) {
      return "No hay tickets creados en el rango seleccionado.";
    }
    if (coveragePct != null && coveragePct >= 99) {
      return `Excelente cobertura: ${withEstimate} de ${totalTickets} tickets tienen estimación IA. El problema, si lo hay, no es falta de datos sino la precisión de esas estimaciones.`;
    }
    if (coveragePct != null && coveragePct >= 70) {
      return `${withEstimate} de ${totalTickets} tickets tienen estimación IA (${coveragePct.toFixed(1)} %). Aún hay tickets sin estimar que no entran en los cálculos de cumplimiento.`;
    }
    return `Solo ${withEstimate} de ${totalTickets} tickets tienen estimación IA. Conviene revisar por qué faltan estimaciones antes de evaluar la precisión.`;
  })();

  const significantAnalysis = (() => {
    if (comparable === 0) {
      return "Sin tickets comparables no se puede medir el desvío significativo.";
    }
    if (significantPct != null && significantPct >= 40) {
      return `Preocupante: ${significantCount} tickets (${significantPct.toFixed(1)} % de los comparables) superaron el estimado en más de un 20 %. Los fallos no son casos aislados.`;
    }
    if (significantPct != null && significantPct >= 20) {
      return `Hay atención: ${significantCount} tickets (${significantPct.toFixed(1)} %) se desviaron mucho del estimado. Conviene revisar esos casos concretos.`;
    }
    return `Solo ${significantCount} tickets (${significantPct?.toFixed(1) ?? "0"} %) tuvieron un desvío mayor al 20 %. La mayoría de desvíos son moderados.`;
  })();

  return {
    compliance: complianceAnalysis,
    deviation: deviationAnalysis,
    efficiency: efficiencyAnalysis,
    netHours: netHoursAnalysis,
    coverage: coverageAnalysis,
    significant: significantAnalysis,
  };
}

type KpiCardProps = {
  label: string;
  value: string;
  hint: string;
  analysis?: string;
  accent?: string;
  onClick?: () => void;
};

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function KpiCard({ label, value, hint, analysis, accent = "var(--accent)", onClick }: KpiCardProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const clickable = Boolean(onClick);

  return (
    <div
      style={{
        textAlign: "left",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${accent}`,
        borderRadius: "var(--radius)",
        padding: "1rem 1.15rem",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
        <div
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? onClick : undefined}
          onKeyDown={
            clickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick?.();
                  }
                }
              : undefined
          }
          style={{
            flex: 1,
            minWidth: 0,
            cursor: clickable ? "pointer" : "default",
          }}
        >
          <div style={{ color: "var(--muted)", fontSize: "0.78rem", fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: "1.55rem", fontWeight: 700, marginTop: "0.15rem", letterSpacing: "-0.02em" }}>{value}</div>
        </div>
        {analysis && (
          <button
            type="button"
            onClick={() => setInfoOpen((prev) => !prev)}
            aria-label={`Interpretación de ${label}`}
            aria-expanded={infoOpen}
            title="Ver interpretación sencilla"
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 999,
              border: `1px solid ${infoOpen ? accent : "var(--border)"}`,
              background: infoOpen ? `${accent}18` : "var(--surface2)",
              color: infoOpen ? accent : "var(--muted)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <InfoIcon />
          </button>
        )}
      </div>
      <div style={{ color: "var(--muted)", fontSize: "0.74rem", marginTop: "0.4rem", lineHeight: 1.35 }}>{hint}</div>
      {infoOpen && analysis && (
        <div
          style={{
            marginTop: "0.7rem",
            padding: "0.7rem 0.8rem",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: "0.8rem",
            lineHeight: 1.5,
            color: "var(--text)",
          }}
        >
          <div style={{ fontWeight: 650, fontSize: "0.76rem", color: accent, marginBottom: "0.35rem" }}>
            ¿Qué significa?
          </div>
          {analysis}
        </div>
      )}
    </div>
  );
}

function SemaforoBadge({ semaforoKey, label }: { semaforoKey: string; label: string }) {
  const color = SEMAFORO_COLORS[semaforoKey] ?? "#6c757d";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: 999,
        fontSize: "0.74rem",
        fontWeight: 600,
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

type CarouselNavProps = {
  slides: ReadonlyArray<{ label: string }>;
  activeIndex: number;
  onSelect: (index: number) => void;
};

function CarouselNav({ slides, activeIndex, onSelect }: CarouselNavProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        marginBottom: "1rem",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
        {slides.map((slide, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={slide.label}
              type="button"
              onClick={() => onSelect(index)}
              style={{
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "var(--surface2)" : "var(--surface)",
                color: active ? "var(--text)" : "var(--muted)",
                borderRadius: 999,
                padding: "0.35rem 0.85rem",
                fontSize: "0.82rem",
                fontWeight: active ? 650 : 500,
                cursor: "pointer",
              }}
            >
              {slide.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <button
          type="button"
          onClick={() => onSelect(Math.max(0, activeIndex - 1))}
          disabled={activeIndex <= 0}
          aria-label="Página anterior"
          style={{
            border: "1px solid var(--border)",
            background: "var(--surface)",
            borderRadius: 8,
            padding: "0.3rem 0.65rem",
            cursor: activeIndex <= 0 ? "default" : "pointer",
            opacity: activeIndex <= 0 ? 0.45 : 1,
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)", minWidth: 72, textAlign: "center" }}>
          {activeIndex + 1} / {slides.length}
        </span>
        <button
          type="button"
          onClick={() => onSelect(Math.min(slides.length - 1, activeIndex + 1))}
          disabled={activeIndex >= slides.length - 1}
          aria-label="Página siguiente"
          style={{
            border: "1px solid var(--border)",
            background: "var(--surface)",
            borderRadius: 8,
            padding: "0.3rem 0.65rem",
            cursor: activeIndex >= slides.length - 1 ? "default" : "pointer",
            opacity: activeIndex >= slides.length - 1 ? 0.45 : 1,
          }}
        >
          ›
        </button>
      </div>
    </div>
  );
}

type AiEstimationEfficiencyPanelProps = {
  loading: boolean;
  slice: AiEstimationFieldSliceData;
  projectTypeId: number | null;
  dateFrom: string;
  dateTo: string;
  onOpenDetail: (field: AiEstimationFieldKey, options?: AiEstimationTicketsDetailOptions & { title?: string }) => void;
};

function AiEstimationEfficiencyPanel({
  loading,
  slice,
  projectTypeId: _projectTypeId,
  dateFrom: _dateFrom,
  dateTo: _dateTo,
  onOpenDetail,
}: AiEstimationEfficiencyPanelProps) {
  const { summary, summaryErr, weekly, weeklyErr, topDeviations, topErr, field } = slice;

  const chartData = useMemo(() => {
    return (weekly?.rows ?? []).map((r) => ({
      ...r,
      chartLabel: r.period_label,
    }));
  }, [weekly]);

  const hasAnyErr = summaryErr || weeklyErr || topErr;
  const hasData = summary != null || weekly != null || topDeviations != null;

  const compliancePct = summary?.compliance_rate_pct;
  const avgDev = summary?.avg_deviation_pct;
  const efficiencyRatio = summary?.efficiency_ratio;
  const netHours = summary?.net_hours_vs_estimate;
  const kpiAnalyses = summary ? buildKpiAnalyses(summary) : null;

  return (
    <div>
      <p style={{ margin: "0 0 0.85rem", color: "var(--muted)", fontSize: "0.86rem", lineHeight: 1.45 }}>
        {slice.subtitle} Solo tickets creados en el rango. El tiempo ejecutado suma actiontime de tareas cuya fecha de
        inicio cae en el mismo rango. Los tiempos estimados usan formato H.MM de GLPI (ej. 0.50 = 50 min); los ejecutados
        y las diferencias se muestran como h:mm.
      </p>

      {summaryErr && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.86rem" }}>
          Error al cargar resumen de eficiencia IA: {summaryErr}
        </p>
      )}
      {weeklyErr && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.86rem" }}>
          Error al cargar tendencia semanal: {weeklyErr}
        </p>
      )}
      {topErr && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.86rem" }}>
          Error al cargar ranking de desvíos: {topErr}
        </p>
      )}

      {!hasAnyErr && loading && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem" }}>Cargando indicadores de estimación IA…</p>
      )}

      {!hasAnyErr && !loading && !hasData && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
          Pulse «Actualizar» con fechas válidas para cargar los indicadores.
        </p>
      )}

      {!summaryErr && summary && (
        <div style={{ marginTop: "0.75rem" }}>
          <h3 style={{ margin: "0 0 0.65rem", fontSize: "0.95rem", fontWeight: 650 }}>
            1 · Cumplimiento de la estimación IA
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: "0.75rem",
            }}
          >
            <KpiCard
              label="Tasa de cumplimiento"
              value={compliancePct != null ? `${compliancePct.toFixed(1)} %` : "—"}
              hint={`${summary.tickets_within_estimate} de ${summary.tickets_comparable} tickets comparables (creados en el rango, con estimación IA y tiempo imputado en el rango) resolvieron dentro del estimado.`}
              analysis={kpiAnalyses?.compliance}
              accent="#198754"
              onClick={
                summary.tickets_comparable > 0
                  ? () =>
                      onOpenDetail(field, {
                        comparableOnly: true,
                        title: "Tickets comparables (cumplimiento)",
                      })
                  : undefined
              }
            />
            <KpiCard
              label="Desviación promedio"
              value={fmtPct(avgDev)}
              hint="Media del % de desviación en tickets con estimación IA y tiempo registrado. Negativo = se resolvió más rápido."
              analysis={kpiAnalyses?.deviation}
              accent="#714b67"
            />
            <KpiCard
              label="Ratio eficiencia (estimado ÷ ejecutado)"
              value={efficiencyRatio != null ? efficiencyRatio.toFixed(2) : "—"}
              hint="Valores &gt; 1 indican que el equipo invirtió menos horas de las previstas por la IA. Solo tickets con ambos datos."
              analysis={kpiAnalyses?.efficiency}
              accent="#017e84"
            />
            <KpiCard
              label="Balance neto de horas"
              value={fmtDurationSigned(netHours)}
              hint="Horas estimadas − horas ejecutadas en tickets comparables. Positivo = ahorro respecto a la estimación IA."
              analysis={kpiAnalyses?.netHours}
              accent="#5b9bd5"
            />
            <KpiCard
              label="Cobertura de estimación IA"
              value={
                summary.total_tickets > 0
                  ? `${((summary.tickets_with_estimate / summary.total_tickets) * 100).toFixed(1)} %`
                  : "—"
              }
              hint={`${summary.tickets_with_estimate} de ${summary.total_tickets} tickets creados tienen estimación IA registrada.`}
              analysis={kpiAnalyses?.coverage}
              accent="#ed7d31"
              onClick={
                summary.tickets_with_estimate > 0
                  ? () => onOpenDetail(field, { title: "Todos los tickets del rango" })
                  : undefined
              }
            />
            <KpiCard
              label="Desvío significativo (&gt; 20 %)"
              value={
                summary.significant_deviation_rate_pct != null
                  ? `${summary.significant_deviation_rate_pct.toFixed(1)} %`
                  : "—"
              }
              hint={`${summary.tickets_significant_deviation} tickets superaron más del 20 % el tiempo estimado por IA.`}
              analysis={kpiAnalyses?.significant}
              accent="#dc3545"
              onClick={
                summary.tickets_significant_deviation > 0
                  ? () =>
                      onOpenDetail(field, {
                        semaforoKey: "significativo",
                        title: "Tickets con desvío significativo",
                      })
                  : undefined
              }
            />
          </div>

          <div style={{ marginTop: "1.1rem" }}>
            <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.88rem", fontWeight: 650, color: "var(--muted)" }}>
              Distribución por semáforo de cumplimiento
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {(summary.semaforo_breakdown ?? []).map((row) => {
                const pctBar = summary.total_tickets > 0 ? (row.count / summary.total_tickets) * 100 : 0;
                const color = SEMAFORO_COLORS[row.key] ?? "#6c757d";
                const clickable = row.count > 0 && row.key !== "sin_estimar";
                return (
                  <button
                    key={row.key}
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && onOpenDetail(field, { semaforoKey: row.key as AiEstimationSemaforoKey, title: row.label })}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(140px, 200px) 1fr auto",
                      gap: "0.65rem",
                      alignItems: "center",
                      background: "transparent",
                      border: "none",
                      padding: "0.2rem 0",
                      cursor: clickable ? "pointer" : "default",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: "0.82rem" }}>{row.label}</span>
                    <div
                      style={{
                        height: 10,
                        background: "var(--surface2)",
                        borderRadius: 999,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, pctBar)}%`,
                          height: "100%",
                          background: color,
                          borderRadius: 999,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: "0.82rem", fontWeight: 600, minWidth: 72, textAlign: "right" }}>
                      {row.count} ({row.pct.toFixed(1)} %)
                    </span>
                  </button>
                );
              })}
            </div>
            <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.76rem" }}>
              Total horas estimadas: {fmtDurationDecimal(summary.total_hours_estimated)} · Total horas ejecutadas:{" "}
              {fmtDurationDecimal(summary.total_hours_executed)} · Diferencia: {fmtDurationSigned(summary.hours_difference)}
            </p>
          </div>
        </div>
      )}

      {!weeklyErr && chartData.length > 0 && (
        <div style={{ marginTop: "1.35rem" }}>
          <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem", fontWeight: 650 }}>
            2 · Tendencia semanal: estimado vs ejecutado
          </h3>
          <p style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.82rem" }}>
            Barras: horas totales estimadas (IA) y ejecutadas por semana ISO de creación del ticket. Línea: desviación
            promedio % en tickets comparables de esa semana.
          </p>
          <div style={{ width: "100%", overflowX: "auto" }}>
            <ResponsiveContainer width="100%" height={380} minWidth={Math.max(520, chartData.length * 72)}>
              <ComposedChart data={chartData} margin={{ top: 16, right: 48, left: 4, bottom: 76 }}>
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
                  label={{
                    value: "Horas",
                    angle: -90,
                    position: "insideLeft",
                    fill: CHART_AXIS,
                    fontSize: 11,
                  }}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                  tickLine={{ stroke: CHART_AXIS }}
                  axisLine={{ stroke: CHART_AXIS }}
                  width={44}
                  tickFormatter={(v) => `${v} %`}
                />
                <Tooltip
                  contentStyle={{
                    background: CHART_TOOLTIP_BG,
                    border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                    borderRadius: 8,
                    fontSize: "0.82rem",
                  }}
                  labelFormatter={(_, items) => {
                    const pl = items?.[0]?.payload as (typeof chartData)[number];
                    const lab = String(pl?.period_label ?? pl?.chartLabel ?? "");
                    const range = formatIsoWeekRangeEs(
                      String(pl?.week_period_start ?? ""),
                      String(pl?.week_period_end ?? ""),
                    );
                    return range ? `${lab} (${range})` : lab;
                  }}
                  formatter={(value: number, name: string) => {
                    if (name.includes("%") || name.includes("desviación")) return [fmtPct(value), name];
                    if (name.includes("Cumplimiento")) return [`${value?.toFixed?.(1) ?? value} %`, name];
                    return [fmtDurationDecimal(value), name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "0.82rem" }} />
                <Bar
                  yAxisId="hours"
                  dataKey="total_hours_estimated"
                    name="Horas estimadas (IA)"
                    fill="#714b67"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={40}
                  />
                  <Bar
                    yAxisId="hours"
                    dataKey="total_hours_executed"
                    name="Horas ejecutadas"
                  fill="#017e84"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={40}
                />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="avg_deviation_pct"
                  name="Desviación prom. (%)"
                  stroke="#ed7d31"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!topErr && topDeviations && (
        <div style={{ marginTop: "1.35rem" }}>
          <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem", fontWeight: 650 }}>
            3 · Tickets con mayor desvío (sobreestimación IA)
          </h3>
          <p style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.82rem" }}>
            Top {topDeviations.limit}: tickets donde el tiempo ejecutado superó la estimación IA. Ordenados por
            diferencia en horas (ejecutado − estimado).
          </p>
          {topDeviations.rows.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.86rem", margin: 0 }}>
              No hay tickets con desvío positivo en el rango seleccionado.
            </p>
          ) : (
            <div style={{ overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead>
                  <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                    <th style={{ padding: "0.6rem 0.75rem" }}>#</th>
                    <th style={{ padding: "0.6rem 0.75rem" }}>Ticket</th>
                    <th style={{ padding: "0.6rem 0.75rem" }}>Técnico</th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Estimado</th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Ejecutado</th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Desvío</th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Desvío %</th>
                    <th style={{ padding: "0.6rem 0.75rem" }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {topDeviations.rows.map((r, i) => (
                    <tr key={r.ticket_id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.55rem 0.75rem", color: "var(--muted)" }}>{i + 1}</td>
                      <td style={{ padding: "0.55rem 0.75rem" }}>
                        <div style={{ fontWeight: 650 }}>{r.ticket_id}</div>
                        <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>
                          {r.titulo?.trim() || "—"}
                        </div>
                        <div style={{ fontSize: "0.74rem", color: "var(--muted)" }}>{r.fecha_creacion}</div>
                      </td>
                      <td style={{ padding: "0.55rem 0.75rem", fontSize: "0.82rem" }}>{r.tecnico ?? "—"}</td>
                      <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>
                        {fmtEstimated(r.horas_estimadas_raw, r.horas_estimadas)}
                      </td>
                      <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>{fmtDurationDecimal(r.horas_ejecutadas)}</td>
                      <td
                        style={{
                          padding: "0.55rem 0.75rem",
                          textAlign: "right",
                          fontWeight: 650,
                          color: "var(--danger-text)",
                        }}
                      >
                        {fmtDurationSigned(r.desvio_horas)}
                      </td>
                      <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>{fmtPct(r.desvio_pct)}</td>
                      <td style={{ padding: "0.55rem 0.75rem" }}>
                        <SemaforoBadge semaforoKey={r.semaforo_key} label={r.semaforo_label} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type AiEstimationEfficiencySectionProps = {
  loading: boolean;
  slices: AiEstimationFieldSliceData[];
  projectTypeId: number | null;
  dateFrom: string;
  dateTo: string;
};

/**
 * Bloque «Eficiencia de estimación con IA»: carrusel con dos fuentes de estimación
 * (tiempoestimadosolucinfield y tiempoestimadosoluciniafield).
 */
export function AiEstimationEfficiencySection(props: AiEstimationEfficiencySectionProps) {
  const { loading, slices, projectTypeId, dateFrom, dateTo } = props;

  const [activeSlide, setActiveSlide] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailRows, setDetailRows] = useState<AiEstimationTicketRow[]>([]);

  const safeSlide = slices.length > 0 ? Math.min(activeSlide, slices.length - 1) : 0;
  const activeSlice = slices[safeSlide];

  async function openDetail(
    estimateField: AiEstimationFieldKey,
    options?: AiEstimationTicketsDetailOptions & { title?: string },
  ) {
    if (!dateFrom || !dateTo) return;
    const { title, ...fetchOptions } = options ?? {};
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailErr(null);
    setDetailRows([]);
    setDetailTitle(title ?? "Detalle de tickets");
    try {
      const payload = await fetchAiEstimationTicketsDetail(projectTypeId, dateFrom, dateTo, {
        ...fetchOptions,
        estimateField,
      });
      setDetailRows(payload.rows);
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }

  if (!activeSlice) return null;

  return (
    <>
      <CollapsibleSection
        title="Eficiencia de estimación con IA"
        subtitle="Compara estimaciones de resolución frente al tiempo imputado en tareas del ticket dentro del rango de fechas de filtros. Use el carrusel para alternar entre el campo estándar y el campo generado con IA."
      >
        <CarouselNav slides={slices} activeIndex={safeSlide} onSelect={setActiveSlide} />

        <AiEstimationEfficiencyPanel
          key={activeSlice.field}
          loading={loading}
          slice={activeSlice}
          projectTypeId={projectTypeId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onOpenDetail={(field, options) => void openDetail(field, options)}
        />
      </CollapsibleSection>

      {detailOpen && (
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
          onClick={() => setDetailOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              background: "var(--surface)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              padding: "1.25rem 1.5rem",
              maxWidth: "1200px",
              width: "100%",
              maxHeight: "82vh",
              overflowY: "auto",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>{detailTitle}</h2>
                <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                  Rango {dateFrom} → {dateTo}
                  {!detailLoading && detailRows.length > 0 ? ` · ${detailRows.length} ticket(s)` : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "0.25rem 0.7rem",
                  color: "var(--muted)",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Cerrar
              </button>
            </div>

            {detailLoading && <p style={{ marginTop: "1rem", color: "var(--muted)" }}>Cargando tickets…</p>}
            {detailErr && (
              <p style={{ color: "var(--danger-text)", marginTop: "0.85rem", fontSize: "0.9rem" }}>Error: {detailErr}</p>
            )}
            {!detailLoading && !detailErr && (
              <div
                style={{
                  marginTop: "0.9rem",
                  overflowX: "auto",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                }}
              >
                {detailRows.length === 0 ? (
                  <p style={{ margin: "0.85rem", color: "var(--muted)", fontSize: "0.86rem" }}>Sin tickets en esta categoría.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                    <thead>
                      <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Ticket</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Estado</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Técnico</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Estimado IA</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Ejecutado</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Diferencia</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Desvío %</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Semáforo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((r) => (
                        <tr key={r.ticket_id} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "0.55rem 0.75rem" }}>
                            <div style={{ fontWeight: 650 }}>{r.ticket_id}</div>
                            <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{r.titulo?.trim() || "—"}</div>
                          </td>
                          <td style={{ padding: "0.55rem 0.75rem", fontSize: "0.82rem" }}>{r.estado}</td>
                          <td style={{ padding: "0.55rem 0.75rem", fontSize: "0.82rem" }}>{r.tecnico ?? "—"}</td>
                          <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>
                            {fmtEstimated(r.horas_estimadas_raw, r.horas_estimadas)}
                          </td>
                          <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>{fmtDurationDecimal(r.horas_ejecutadas)}</td>
                          <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>
                            {fmtDurationSigned(r.diferencia_horas)}
                          </td>
                          <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>{fmtPct(r.desviacion_pct)}</td>
                          <td style={{ padding: "0.55rem 0.75rem" }}>
                            <SemaforoBadge semaforoKey={r.semaforo_key} label={r.semaforo_label} />
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
