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
  fetchAiUsageTicketsDetail,
  type AiUsageByStatusPayload,
  type AiUsageKey,
  type AiUsageSummaryPayload,
  type AiUsageTicketRow,
  type AiUsageWeeklyPayload,
} from "../coordination/api";
import { CollapsibleSection } from "./CollapsibleSection";
import { formatIsoWeekRangeEs, IsoWeekAxisTick } from "../chartIsoWeekAxis";

const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";

const USAGE_COLORS: Record<string, string> = {
  si: "#714b67",
  no: "#6c757d",
  sin_dato: "#adb5bd",
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)} %`;
}

function fmtHours(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)} h`;
}

function KpiCard({
  label,
  value,
  hint,
  accent = "var(--accent)",
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: string;
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      style={{
        textAlign: "left",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${accent}`,
        borderRadius: "var(--radius)",
        padding: "1rem 1.15rem",
        cursor: clickable ? "pointer" : "default",
        width: "100%",
      }}
    >
      <div style={{ color: "var(--muted)", fontSize: "0.78rem", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: "1.55rem", fontWeight: 700, marginTop: "0.15rem", letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ color: "var(--muted)", fontSize: "0.74rem", marginTop: "0.4rem", lineHeight: 1.35 }}>{hint}</div>
    </button>
  );
}

function AiBadge({ aplicaIaKey, label }: { aplicaIaKey: string; label: string }) {
  const color = USAGE_COLORS[aplicaIaKey] ?? "#6c757d";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.55rem",
        borderRadius: 999,
        fontSize: "0.74rem",
        fontWeight: 600,
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
      }}
    >
      {label}
    </span>
  );
}

export type AiUsageSectionProps = {
  loading: boolean;
  summaryErr: string | null;
  weeklyErr: string | null;
  byStatusErr: string | null;
  summary: AiUsageSummaryPayload | null;
  weekly: AiUsageWeeklyPayload | null;
  byStatus: AiUsageByStatusPayload | null;
  projectTypeId: number | null;
  dateFrom: string;
  dateTo: string;
};

/**
 * Bloque «Uso de IA en tickets»: campo «¿Aplica IA?» (plugin Fields), adopción, tendencia y detalle.
 */
export function AiUsageSection(props: AiUsageSectionProps) {
  const { loading, summaryErr, weeklyErr, byStatusErr, summary, weekly, byStatus, projectTypeId, dateFrom, dateTo } =
    props;

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailRows, setDetailRows] = useState<AiUsageTicketRow[]>([]);

  const chartData = useMemo(
    () =>
      (weekly?.rows ?? []).map((r) => ({
        ...r,
        chartLabel: r.period_label,
      })),
    [weekly],
  );

  const statusPivot = useMemo(() => {
    const rows = byStatus?.rows ?? [];
    const byStatusId = new Map<
      number,
      { status_id: number; estado_label: string; si: number; no: number; sin_dato: number; total: number }
    >();
    for (const r of rows) {
      let row = byStatusId.get(r.status_id);
      if (!row) {
        row = { status_id: r.status_id, estado_label: r.estado_label, si: 0, no: 0, sin_dato: 0, total: 0 };
        byStatusId.set(r.status_id, row);
      }
      const key = r.aplica_ia_key as AiUsageKey;
      if (key === "si") row.si = r.ticket_count;
      else if (key === "no") row.no = r.ticket_count;
      else row.sin_dato = r.ticket_count;
      row.total += r.ticket_count;
    }
    return [...byStatusId.values()].sort((a, b) => a.status_id - b.status_id);
  }, [byStatus]);

  const hasAnyErr = summaryErr || weeklyErr || byStatusErr;
  const hasData = summary != null || weekly != null || byStatus != null;

  async function openDetail(aplicaIaKey?: AiUsageKey, title?: string) {
    if (!dateFrom || !dateTo) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailErr(null);
    setDetailRows([]);
    setDetailTitle(title ?? "Detalle de tickets");
    try {
      const payload = await fetchAiUsageTicketsDetail(projectTypeId, dateFrom, dateTo, aplicaIaKey);
      setDetailRows(payload.rows);
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <>
      <CollapsibleSection
        title="Uso de IA en tickets"
        subtitle="Basado en el campo «¿Aplica IA?» del plugin GLPI Fields (`plugin_fields_aplicaiafielddropdowns_id`: 1 = Sí, 0 = No). Solo tickets creados en el rango de fechas. Incluye cruce con estimación de tiempo IA cuando está disponible."
      >
        {summaryErr && (
          <p style={{ color: "var(--danger-text)", fontSize: "0.86rem" }}>Error al cargar resumen: {summaryErr}</p>
        )}
        {weeklyErr && (
          <p style={{ color: "var(--danger-text)", fontSize: "0.86rem" }}>Error al cargar tendencia semanal: {weeklyErr}</p>
        )}
        {byStatusErr && (
          <p style={{ color: "var(--danger-text)", fontSize: "0.86rem" }}>Error al cargar desglose por estado: {byStatusErr}</p>
        )}

        {!hasAnyErr && loading && (
          <p style={{ color: "var(--muted)", fontSize: "0.86rem" }}>Cargando indicadores de uso de IA…</p>
        )}

        {!hasAnyErr && !loading && !hasData && (
          <p style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
            Pulse «Actualizar» con fechas válidas para cargar los indicadores.
          </p>
        )}

        {!summaryErr && summary && (
          <div style={{ marginTop: "0.75rem" }}>
            <h3 style={{ margin: "0 0 0.65rem", fontSize: "0.95rem", fontWeight: 650 }}>
              1 · Adopción y cobertura de IA
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                gap: "0.75rem",
              }}
            >
              <KpiCard
                label="Tasa de adopción IA"
                value={fmtPct(summary.adoption_rate_pct)}
                hint={`${summary.tickets_ai_yes} de ${summary.total_tickets} tickets creados en el rango tienen «Sí aplica IA».`}
                accent="#714b67"
                onClick={summary.tickets_ai_yes > 0 ? () => void openDetail("si", "Tickets con IA = Sí") : undefined}
              />
              <KpiCard
                label="Tickets con IA = Sí"
                value={String(summary.tickets_ai_yes)}
                hint="Marcados explícitamente como aplicables a IA en el formulario del ticket."
                accent="#714b67"
                onClick={summary.tickets_ai_yes > 0 ? () => void openDetail("si", "Tickets con IA = Sí") : undefined}
              />
              <KpiCard
                label="Tickets con IA = No"
                value={String(summary.tickets_ai_no)}
                hint="Marcados como no aplicables a IA."
                accent="#6c757d"
                onClick={summary.tickets_ai_no > 0 ? () => void openDetail("no", "Tickets con IA = No") : undefined}
              />
              <KpiCard
                label="Sin registrar"
                value={String(summary.tickets_ai_unset)}
                hint="Sin valor en el campo o sin registro en el plugin Fields."
                accent="#adb5bd"
                onClick={
                  summary.tickets_ai_unset > 0 ? () => void openDetail("sin_dato", "Tickets sin registrar IA") : undefined
                }
              />
              <KpiCard
                label="Tasa entre declarados"
                value={fmtPct(summary.declared_rate_pct)}
                hint={`De los tickets con Sí o No explícito (${summary.tickets_ai_yes + summary.tickets_ai_no}), % con IA = Sí.`}
                accent="#017e84"
              />
              <KpiCard
                label="Con estimación IA (Sí)"
                value={String(summary.tickets_ai_with_estimate)}
                hint="Tickets con IA = Sí que además tienen tiempo estimado de solución registrado."
                accent="#5b9bd5"
              />
            </div>

            <div style={{ marginTop: "1rem" }}>
              <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.88rem", fontWeight: 650, color: "var(--muted)" }}>
                Distribución «¿Aplica IA?»
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                {(summary.aplica_ia_breakdown ?? []).map((row) => {
                  const pctBar = summary.total_tickets > 0 ? (row.count / summary.total_tickets) * 100 : 0;
                  const color = USAGE_COLORS[row.key] ?? "#6c757d";
                  const clickable = row.count > 0;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && void openDetail(row.key, row.label)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(130px, 180px) 1fr auto",
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
                      <div style={{ height: 10, background: "var(--surface2)", borderRadius: 999, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, pctBar)}%`,
                            height: "100%",
                            background: color,
                            borderRadius: 999,
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
              <button
                type="button"
                onClick={() => void openDetail(undefined, "Todos los tickets del rango")}
                style={{
                  marginTop: "0.65rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.78rem",
                  color: "var(--accent)",
                  cursor: "pointer",
                }}
              >
                Ver listado completo de tickets
              </button>
            </div>

            {(summary.ai_compliance_rate_pct != null || summary.no_ai_compliance_rate_pct != null) && (
              <div
                style={{
                  marginTop: "1.1rem",
                  padding: "0.85rem 1rem",
                  background: "var(--surface2)",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                }}
              >
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.88rem", fontWeight: 650 }}>
                  Cumplimiento de estimación: IA Sí vs No
                </h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem", fontSize: "0.84rem" }}>
                  <div>
                    <strong style={{ color: "#714b67" }}>Con IA = Sí:</strong>{" "}
                    {fmtPct(summary.ai_compliance_rate_pct)} cumplimiento
                    {summary.tickets_ai_comparable > 0
                      ? ` (${summary.tickets_ai_within_estimate}/${summary.tickets_ai_comparable} comparables)`
                      : " (sin tickets comparables)"}
                  </div>
                  <div>
                    <strong style={{ color: "#6c757d" }}>Con IA = No:</strong>{" "}
                    {fmtPct(summary.no_ai_compliance_rate_pct)} cumplimiento
                    {summary.tickets_no_ai_comparable > 0
                      ? ` (${summary.tickets_no_ai_within_estimate}/${summary.tickets_no_ai_comparable} comparables)`
                      : " (sin tickets comparables)"}
                  </div>
                </div>
                <p style={{ margin: "0.45rem 0 0", color: "var(--muted)", fontSize: "0.76rem" }}>
                  Comparables = tienen estimación IA y tiempo ejecutado registrado en tareas.
                </p>
              </div>
            )}
          </div>
        )}

        {!weeklyErr && chartData.length > 0 && (
          <div style={{ marginTop: "1.35rem" }}>
            <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem", fontWeight: 650 }}>
              2 · Evolución semanal del uso de IA
            </h3>
            <p style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.82rem" }}>
              Barras apiladas por semana ISO de creación. Línea: tasa de adopción (% Sí sobre total de la semana).
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
                    yAxisId="count"
                    allowDecimals={false}
                    tick={{ fill: CHART_TEXT, fontSize: 11 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    width={40}
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
                  />
                  <Legend wrapperStyle={{ fontSize: "0.82rem" }} />
                  <Bar
                    yAxisId="count"
                    dataKey="tickets_ai_yes"
                    name="IA = Sí"
                    stackId="usage"
                    fill={USAGE_COLORS.si}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="tickets_ai_no"
                    name="IA = No"
                    stackId="usage"
                    fill={USAGE_COLORS.no}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="tickets_ai_unset"
                    name="Sin registrar"
                    stackId="usage"
                    fill={USAGE_COLORS.sin_dato}
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="adoption_rate_pct"
                    name="Adopción IA (%)"
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

        {!byStatusErr && statusPivot.length > 0 && (
          <div style={{ marginTop: "1.35rem" }}>
            <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem", fontWeight: 650 }}>
              3 · Uso de IA por estado del ticket
            </h3>
            <p style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.82rem" }}>
              Estado actual de los tickets creados en el rango, desglosado por valor de «¿Aplica IA?».
            </p>
            <div style={{ overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 520 }}>
                <thead>
                  <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                    <th style={{ padding: "0.6rem 0.75rem" }}>Estado</th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right", color: USAGE_COLORS.si }}>IA = Sí</th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right", color: USAGE_COLORS.no }}>IA = No</th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right", color: USAGE_COLORS.sin_dato }}>
                      Sin registrar
                    </th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Total</th>
                    <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>% IA Sí</th>
                  </tr>
                </thead>
                <tbody>
                  {statusPivot.map((r) => (
                    <tr key={r.status_id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.55rem 0.75rem", fontWeight: 600 }}>{r.estado_label}</td>
                      <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>{r.si}</td>
                      <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>{r.no}</td>
                      <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>{r.sin_dato}</td>
                      <td style={{ padding: "0.55rem 0.75rem", textAlign: "right", fontWeight: 650 }}>{r.total}</td>
                      <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>
                        {r.total > 0 ? fmtPct((r.si / r.total) * 100) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
                        <th style={{ padding: "0.6rem 0.75rem" }}>Fecha</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Estado</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>¿Aplica IA?</th>
                        <th style={{ padding: "0.6rem 0.75rem" }}>Técnico</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Estimado IA</th>
                        <th style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>Ejecutado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((r) => (
                        <tr key={r.ticket_id} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "0.55rem 0.75rem" }}>
                            <div style={{ fontWeight: 650 }}>{r.ticket_id}</div>
                            <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{r.titulo?.trim() || "—"}</div>
                          </td>
                          <td style={{ padding: "0.55rem 0.75rem", fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                            {r.fecha_ticket}
                          </td>
                          <td style={{ padding: "0.55rem 0.75rem", fontSize: "0.82rem" }}>{r.estado}</td>
                          <td style={{ padding: "0.55rem 0.75rem" }}>
                            <AiBadge aplicaIaKey={r.aplica_ia_key} label={r.aplica_ia_label} />
                          </td>
                          <td style={{ padding: "0.55rem 0.75rem", fontSize: "0.82rem" }}>{r.tecnico ?? "—"}</td>
                          <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>
                            {r.horas_estimadas != null ? fmtHours(r.horas_estimadas) : "—"}
                          </td>
                          <td style={{ padding: "0.55rem 0.75rem", textAlign: "right" }}>{fmtHours(r.horas_ejecutadas)}</td>
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
