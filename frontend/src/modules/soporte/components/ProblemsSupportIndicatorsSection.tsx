import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { IndicatorsProblemsSupportPayload } from "../../../api";
import { formatIsoWeekRangeEs, IsoWeekAxisTick } from "../chartIsoWeekAxis";

const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header style={{ marginBottom: "0.9rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>{title}</h2>
      {subtitle && (
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.88rem" }}>{subtitle}</p>
      )}
    </header>
  );
}

function TotalCard({ value, hint }: { value: number; hint: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid var(--border)`,
        borderLeft: `4px solid var(--accent)`,
        borderRadius: "var(--radius)",
        padding: "1.1rem 1.25rem",
      }}
    >
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", fontWeight: 500 }}>Total problemas (existencias)</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, marginTop: "0.2rem", letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.45rem" }}>{hint}</div>
    </div>
  );
}

export type ProblemsSupportIndicatorsSectionProps = {
  loading: boolean;
  err: string | null;
  data: IndicatorsProblemsSupportPayload | null;
};

/**
 * Bloque «Problemas GLPI»: totales, por estado y serie semanal (altas vs resueltos/cerrados).
 * Usado en Indicadores e Indicadores coordinación (misma API; no depende del tipo de proyecto).
 */
export function ProblemsSupportIndicatorsSection(props: ProblemsSupportIndicatorsSectionProps) {
  const { loading, err, data } = props;

  const chartData = useMemo(() => {
    return (data?.weekly_rows ?? []).map((r) => ({
      ...r,
      chartLabel: r.period_label,
    }));
  }, [data]);

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1.2rem",
      }}
    >
      <SectionHeader
        title="Problemas GLPI (Asistencia)"
        subtitle="Inventario actual en `glpi_problems` y desglose por estado ITIL (variables GLPI_STATUS_*). La serie semanal usa las fechas de filtro: creaciones por fecha de alta; resoluciones por semana ISO de `COALESCE(closedate, solvedate)` en problemas resueltos o cerrados. Respeta la entidad GLPI del backend; no aplica tipo de proyecto."
      />
      {err && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Error al cargar problemas: {err}</p>
      )}
      {!err && loading && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando problemas GLPI…</p>
      )}
      {!err && !loading && !data && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
          Aún no hay datos de problemas. Pulse «Actualizar» en esta vista (con fechas válidas) para cargarlos.
        </p>
      )}
      {!err && !loading && data && (
        <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "0.85rem",
            }}
          >
            <TotalCard
              value={data.total_problems}
              hint="No borrados (`is_deleted = 0`). Instantáneo; no limitado por el rango de fechas."
            />
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", fontWeight: 650 }}>Por estado</h3>
            {data.by_status.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: 0 }}>No hay problemas en el alcance.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    maxWidth: 560,
                    borderCollapse: "collapse",
                    fontSize: "0.88rem",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "0.5rem 0.65rem" }}>Estado</th>
                      <th style={{ padding: "0.5rem 0.65rem", textAlign: "right" }}>Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_status.map((row) => (
                      <tr key={row.status_id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "0.55rem 0.65rem" }}>{row.status_label}</td>
                        <td style={{ padding: "0.55rem 0.65rem", textAlign: "right", fontWeight: 600 }}>
                          {row.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem", fontWeight: 650 }}>
              Por semana ISO (en el rango de fechas)
            </h3>
            <p style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.82rem" }}>
              Línea azul: altas en la semana. Línea naranja: en resuelto/cerrado con fecha efectiva de cierre en esa semana.
            </p>
            {chartData.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: 0 }}>
                No hay semanas ISO entre las fechas seleccionadas.
              </p>
            ) : (
              <div style={{ width: "100%" }}>
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={chartData} margin={{ top: 12, right: 16, left: 4, bottom: 76 }}>
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
                      allowDecimals={false}
                      tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        background: CHART_TOOLTIP_BG,
                        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                        borderRadius: 8,
                        fontSize: "0.82rem",
                        color: CHART_TEXT,
                      }}
                      formatter={(value: number, name: string) => [value, name]}
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
                    <Legend wrapperStyle={{ color: CHART_TEXT, fontSize: "0.82rem" }} />
                    <Line
                      type="monotone"
                      dataKey="problems_created"
                      name="Creados en la semana"
                      stroke="#017e84"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="problems_resolved_or_closed"
                      name="Resueltos / cerrados (fecha efectiva)"
                      stroke="#ed7d31"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
