import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchBillingEvolutionByCostCenter,
  fetchBillingEvolutionPaidStatus,
  fetchBillingInvoices,
  fetchBillingTerceros,
  type BillingEvolutionPayload,
  type BillingInvoicesPayload,
} from "../api";

import { BillingInvoicesDataTable } from "./BillingInvoicesDataTable";
const EVOLUTION_STACK_COLORS = [
  "#0ea5e9",
  "#22c55e",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
  "#ef4444",
  "#eab308",
  "#06b6d4",
  "#a855f7",
  "#84cc16",
];
const EVOLUTION_MAX_SERIES = 11;

const PAYMENT_NET_BAR_FILLS: Record<string, string> = {
  Pagado: "#22c55e",
  "No pagado": "#f97316",
  "Diferencia (pag. − impag.)": "#0ea5e9",
};



function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header style={{ marginBottom: "0.9rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>{title}</h2>
      {subtitle && (
        <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.88rem" }}>{subtitle}</p>
      )}
    </header>
  );
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMonthKey(periodKey: string): string {
  const [y, m] = periodKey.split("-").map((x) => Number(x));
  if (!y || !m) return periodKey;
  return new Date(y, m - 1, 1).toLocaleDateString("es-EC", { month: "short", year: "numeric" });
}

type BuildGroupedOptions = {
  barFillOverrides?: Record<string, string>;
  preserveSeriesOrder?: boolean;
};

function buildGroupedSeries(ev: BillingEvolutionPayload, options?: BuildGroupedOptions) {
  const { barFillOverrides, preserveSeriesOrder = false } = options ?? {};
  const { cost_centers, rows } = ev;
  if (!cost_centers.length || !rows.length) {
    return { data: [] as Record<string, string | number>[], bars: [] as { dataKey: string; name: string; fill: string }[] };
  }

  const totals = cost_centers.map((_, i) => rows.reduce((s, r) => s + (r.amounts[i] ?? 0), 0));
  const idxOrdered = preserveSeriesOrder ? cost_centers.map((_, i) => i) : cost_centers.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
  const topCount = Math.min(EVOLUTION_MAX_SERIES, idxOrdered.length);
  const topIdx = idxOrdered.slice(0, topCount);
  const otherIdx = idxOrdered.slice(topCount);

  const bars = topIdx.map((ccIdx, seriesPos) => {
    const name = cost_centers[ccIdx] || "(centro de costo)";
    return {
      dataKey: `s${seriesPos}`,
      name,
      fill: barFillOverrides?.[name] ?? EVOLUTION_STACK_COLORS[seriesPos % EVOLUTION_STACK_COLORS.length],
    };
  });
  if (otherIdx.length) {
    const otherName = `Otros (${otherIdx.length})`;
    bars.push({
      dataKey: "s_other",
      name: otherName,
      fill: barFillOverrides?.[otherName] ?? "#64748b",
    });
  }

  const data = rows.map((row) => {
    const d: Record<string, string | number> = {
      period_key: row.period_key,
      label: fmtMonthKey(row.period_key),
      total: row.total_usd,
    };
    topIdx.forEach((ccIdx, seriesPos) => {
      d[`s${seriesPos}`] = row.amounts[ccIdx] ?? 0;
    });
    if (otherIdx.length) {
      d.s_other = otherIdx.reduce((s, ui) => s + (row.amounts[ui] ?? 0), 0);
    }
    return d;
  });

  return { data, bars };
}

function EvolutionUsdChart({
  evolution,
  emptyHint,
  barFillOverrides,
  preserveSeriesOrder,
}: {
  evolution: BillingEvolutionPayload | null;
  emptyHint?: string;
  barFillOverrides?: Record<string, string>;
  preserveSeriesOrder?: boolean;
}) {
  const { data, bars } = useMemo(
    () =>
      evolution ? buildGroupedSeries(evolution, { barFillOverrides, preserveSeriesOrder }) : { data: [], bars: [] },
    [evolution, barFillOverrides, preserveSeriesOrder],
  );

  if (!evolution) return null;

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <p style={{ margin: "0 0 0.65rem", fontSize: "0.86rem", color: "var(--muted)" }}>
        Total en rango: <strong style={{ color: "var(--text)" }}>{fmtMoney(evolution.grand_total_usd)}</strong>
        {evolution.tercero_filter ? (
          <span>
            {" "}
            · Tercero: <strong style={{ color: "var(--text)" }}>{evolution.tercero_filter}</strong>
          </span>
        ) : null}
      </p>
      {data.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>{emptyHint ?? "Sin datos agregados para el rango."}</p>
      ) : (
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }} barGap={2} barCategoryGap="18%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" stroke="var(--muted)" tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <YAxis
                stroke="var(--muted)"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickFormatter={(v) =>
                  typeof v === "number"
                    ? v >= 1_000_000
                      ? `${(v / 1_000_000).toFixed(1)}M`
                      : v >= 1000
                        ? `${(v / 1000).toFixed(0)}k`
                        : `${v}`
                    : `${v}`
                }
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                }}
                formatter={(value: unknown) => [fmtMoney(Number(value)), ""]}
                labelFormatter={(label, payload) => {
                  const pk = payload?.[0]?.payload?.period_key;
                  return typeof pk === "string" && pk.length ? pk : String(label ?? "");
                }}
              />
              <Legend wrapperStyle={{ fontSize: "11px", color: "var(--muted)" }} />
              {bars.map((b) => (
                <Bar key={b.dataKey} dataKey={b.dataKey} name={b.name} fill={b.fill} maxBarSize={36} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function BillingIndicatorsPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }, []);

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [data, setData] = useState<BillingInvoicesPayload | null>(null);
  const [terceros, setTerceros] = useState<string[]>([]);
  const [evolutionGeneral, setEvolutionGeneral] = useState<BillingEvolutionPayload | null>(null);
  const [evolutionPaid, setEvolutionPaid] = useState<BillingEvolutionPayload | null>(null);
  const [evolutionPaidTercero, setEvolutionPaidTercero] = useState<BillingEvolutionPayload | null>(null);
  const [evolutionFiltered, setEvolutionFiltered] = useState<BillingEvolutionPayload | null>(null);
  const [selectedTercero, setSelectedTercero] = useState("");
  const [appliedTercero, setAppliedTercero] = useState("");
  const appliedTerceroRef = useRef("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errCostCenterEvolution, setErrCostCenterEvolution] = useState<string | null>(null);
  const [errPaidEvolution, setErrPaidEvolution] = useState<string | null>(null);
  const [errPaidTerceroEvolution, setErrPaidTerceroEvolution] = useState<string | null>(null);
  const [errTerceroEvolution, setErrTerceroEvolution] = useState<string | null>(null);
  const [errTercerosList, setErrTercerosList] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setErrCostCenterEvolution(null);
    setErrPaidEvolution(null);
    setErrPaidTerceroEvolution(null);
    setErrTerceroEvolution(null);
    setErrTercerosList(null);

    try {
      const inv = await fetchBillingInvoices(dateFrom, dateTo || undefined);
      setData(inv);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setData(null);
      setTerceros([]);
      setEvolutionGeneral(null);
      setEvolutionPaid(null);
      setEvolutionPaidTercero(null);
      setEvolutionFiltered(null);
      setLoading(false);
      return;
    }

    if (!dateTo) {
      setTerceros([]);
      setEvolutionGeneral(null);
      setEvolutionPaid(null);
      setEvolutionPaidTercero(null);
      setEvolutionFiltered(null);
      setLoading(false);
      return;
    }

    setEvolutionGeneral(null);
    setEvolutionPaid(null);
    setEvolutionPaidTercero(null);

    try {
      setTerceros((await fetchBillingTerceros(dateFrom, dateTo)).terceros);
    } catch (e) {
      setTerceros([]);
      setErrTercerosList(e instanceof Error ? e.message : String(e));
    }

    try {
      setEvolutionGeneral(await fetchBillingEvolutionByCostCenter(dateFrom, dateTo));
    } catch (e) {
      setEvolutionGeneral(null);
      setErrCostCenterEvolution(e instanceof Error ? e.message : String(e));
    }

    try {
      setEvolutionPaid(await fetchBillingEvolutionPaidStatus(dateFrom, dateTo));
    } catch (e) {
      setEvolutionPaid(null);
      setErrPaidEvolution(e instanceof Error ? e.message : String(e));
    }

    const ap = appliedTerceroRef.current.trim();
    if (ap) {
      try {
        setEvolutionFiltered(await fetchBillingEvolutionByCostCenter(dateFrom, dateTo, ap));
        setErrTerceroEvolution(null);
      } catch (e) {
        setEvolutionFiltered(null);
        setErrTerceroEvolution(e instanceof Error ? e.message : String(e));
      }
      try {
        setEvolutionPaidTercero(await fetchBillingEvolutionPaidStatus(dateFrom, dateTo, ap));
        setErrPaidTerceroEvolution(null);
      } catch (e) {
        setEvolutionPaidTercero(null);
        setErrPaidTerceroEvolution(e instanceof Error ? e.message : String(e));
      }
    } else {
      setEvolutionFiltered(null);
      setEvolutionPaidTercero(null);
      setErrTerceroEvolution(null);
      setErrPaidTerceroEvolution(null);
    }

    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
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
          subtitle="PostgreSQL configurado con variables BILLING_PG_* (.env del compose). Solo lectura."
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
              Desde (dateinvoiced)
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
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
            <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
              Hasta (inclusive)
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
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
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || !dateFrom}
              style={{
                background: "var(--accent)",
                color: "var(--on-accent)",
                border: "none",
                borderRadius: 8,
                padding: "0.5rem 0.95rem",
                fontWeight: 700,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
        </div>
        {!dateTo && (
          <p style={{ marginTop: "0.75rem", color: "var(--muted)", fontSize: "0.82rem" }}>
            Indique «Hasta» para cargar los gráficos de evolución (centro de costo y pagado / no pagado según{' '}
            <code style={{ fontSize: "0.8em" }}>ispaid</code>) y la lista de sugerencias de terceros.
          </p>
        )}
      </section>

      {dateTo && (
        <>
          <section
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "1.2rem",
            }}
          >
            <SectionTitle
              title="Evolución mensual (facturación por centro de costo)"
              subtitle="Este gráfico es siempre global (todos los terceros): total factura por mes, una barra por centro de coste, agrupadas por mes."
            />
            {errCostCenterEvolution && !loading && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>{errCostCenterEvolution}</p>
            )}
            {loading && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando evolución por centro de costo…</p>
            )}
            {!loading && !errCostCenterEvolution && evolutionGeneral && (
              <EvolutionUsdChart
                evolution={evolutionGeneral}
                emptyHint="No hay montos agrupados en el rango (o no aparecen centros de costo en las facturas filtradas)."
              />
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
              title="Evolución mensual (pagado vs no pagado)"
              subtitle="Por mes, tres barras: (1) total en facturas marcadas como pagadas, (2) facturas no pagadas más las sin marca clara en Pagada, (3) diferencia (1) − (2). Basado en `ispaid` como en el listado."
            />
            {errPaidEvolution && !loading && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>{errPaidEvolution}</p>
            )}
            {!loading && !errPaidEvolution && evolutionPaid && (
              <EvolutionUsdChart
                evolution={evolutionPaid}
                barFillOverrides={PAYMENT_NET_BAR_FILLS}
                preserveSeriesOrder
                emptyHint="Sin facturas en el rango."
              />
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
              title="Evolución por tercero (centro de costo)"
              subtitle="Mismo indicador que el primero, filtrado al tercero que aplique aquí. También alimenta la sección siguiente (pagado vs no pagado por ese tercero). El valor del campo no cambia el gráfico hasta pulsar «Aplicar tercero»."
            />
            {appliedTercero ? (
              <p style={{ marginTop: "0.5rem", fontSize: "0.88rem", color: "var(--text)" }}>
                Tercero aplicado: <strong>{appliedTercero}</strong>
              </p>
            ) : null}
            <div style={{ marginTop: "0.75rem", maxWidth: 440 }}>
              <label
                style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}
                htmlFor="billing-tercero-filter"
              >
                Buscar / elegir tercero
              </label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  id="billing-tercero-filter"
                  list="billing-tercero-options"
                  value={selectedTercero}
                  onChange={(e) => setSelectedTercero(e.target.value)}
                  placeholder={terceros.length ? "Nombre exacto de bp.name como en Openbravo…" : errTercerosList ? "(Lista no disponible)" : "…"}
                  style={{
                    flex: "1 1 240px",
                    minWidth: 200,
                    padding: "0.5rem",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface2)",
                    color: "var(--text)",
                  }}
                />
                <datalist id="billing-tercero-options">
                  {terceros.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <button
                  type="button"
                  disabled={loading}
                  title="Guarde vacío para quitar el filtro solo en este bloque."
                  style={{
                    background: "var(--accent)",
                    color: "var(--on-accent)",
                    border: "none",
                    borderRadius: 8,
                    padding: "0.5rem 0.85rem",
                    fontWeight: 600,
                    cursor: loading ? "wait" : "pointer",
                    opacity: loading ? 0.75 : 1,
                  }}
                  onClick={() => {
                    const v = selectedTercero.trim();
                    appliedTerceroRef.current = v;
                    setAppliedTercero(v);
                    void load();
                  }}
                >
                  Aplicar tercero
                </button>
              </div>
              {errTercerosList && (
                <p style={{ marginTop: "0.55rem", color: "var(--danger-text)", fontSize: "0.82rem" }}>{errTercerosList}</p>
              )}
            </div>
            {!appliedTercero ? (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.75rem" }}>
                Elija un tercero de la lista o escriba el nombre exacto de <code>bp.name</code> y pulse «Aplicar tercero».
              </p>
            ) : null}
            {errTerceroEvolution && !loading && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>{errTerceroEvolution}</p>
            )}
            {!loading && appliedTercero && evolutionFiltered ? (
              <EvolutionUsdChart evolution={evolutionFiltered} />
            ) : null}
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
              title="Evolución por tercero (pagado vs no pagado)"
              subtitle="Igual lógica que el indicador global de pagado / no pagado, pero solo las facturas del mismo tercero aplicado arriba (sin nuevo filtro)."
            />
            {!appliedTercero ? (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                Primero aplique un tercero en la sección anterior.
              </p>
            ) : null}
            {errPaidTerceroEvolution && !loading && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>{errPaidTerceroEvolution}</p>
            )}
            {!loading && appliedTercero && !errPaidTerceroEvolution && evolutionPaidTercero ? (
              <EvolutionUsdChart
                evolution={evolutionPaidTercero}
                barFillOverrides={PAYMENT_NET_BAR_FILLS}
                preserveSeriesOrder
                emptyHint="Sin facturas de ese tercero en el rango."
              />
            ) : null}
          </section>
        </>
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
          title="Detalle de facturas"
          subtitle={`Tabla con filtros por columna, ordenación y buscador global. Mismos criterios de documento que el backend. Totales cargados en el servidor: ${data?.count ?? "—"}.`}
        />
        {err && (
          <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>{err}</p>
        )}
        {loading && <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando…</p>}
        {!loading && !err && data &&
          (data.rows.length === 0 ? (
            <p style={{ color: "var(--muted)", marginTop: "0.75rem" }}>Sin resultados para el rango indicado.</p>
          ) : (
            <BillingInvoicesDataTable rows={data.rows} />
          ))}
      </section>
    </div>
  );
}
