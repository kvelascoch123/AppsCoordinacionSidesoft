import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchCostCenterHours,
  fetchKpiVariables,
  type CostCenterHoursPayload,
  type KpiVariablesPayload,
} from "../../../api";
import { CostCentersDataTable } from "./CostCentersDataTable";
import { KpiVariablesSection } from "./KpiVariablesSection";

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

export function CostCentersPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }, []);

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);

  const [hoursData, setHoursData] = useState<CostCenterHoursPayload | null>(null);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [hoursErr, setHoursErr] = useState<string | null>(null);

  const [kpiData, setKpiData] = useState<KpiVariablesPayload | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiErr, setKpiErr] = useState<string | null>(null);

  const loading = hoursLoading || kpiLoading;

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo) return;

    setHoursLoading(true);
    setKpiLoading(true);
    setHoursErr(null);
    setKpiErr(null);

    const hoursPromise = fetchCostCenterHours(dateFrom, dateTo)
      .then((res) => {
        setHoursData(res);
      })
      .catch((e) => {
        setHoursData(null);
        setHoursErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setHoursLoading(false));

    const kpiPromise = fetchKpiVariables(dateFrom, dateTo)
      .then((res) => {
        setKpiData(res);
      })
      .catch((e) => {
        setKpiData(null);
        setKpiErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setKpiLoading(false));

    await Promise.all([hoursPromise, kpiPromise]);
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
          subtitle="Rango de fechas compartido por el cálculo de variables KPI y la distribución por centros de costo."
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
              Desde
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
              disabled={loading || !dateFrom || !dateTo}
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
      </section>

      <KpiVariablesSection data={kpiData} loading={kpiLoading} err={kpiErr} />

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "1.2rem",
        }}
      >
        <SectionTitle
          title="Distribución por proyecto y consultor"
          subtitle="Horas laboradas = tiempo en decimal (2 decimales). % = horas del consultor sobre el total del proyecto en las filas actuales (se redistribuye al quitar o restaurar)."
        />
        {hoursErr && (
          <p style={{ color: "var(--danger-text)", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>{hoursErr}</p>
        )}
        {hoursLoading && !hoursData && (
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Cargando datos…</p>
        )}
        {hoursData && (
          <CostCentersDataTable
            rows={hoursData.rows}
            dateFrom={hoursData.date_from}
            dateTo={hoursData.date_to}
          />
        )}
        {hoursData && hoursData.count === 0 && !hoursLoading && (
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.75rem" }}>
            No hay tareas con tiempo en el rango seleccionado.
          </p>
        )}
      </section>
    </div>
  );
}
