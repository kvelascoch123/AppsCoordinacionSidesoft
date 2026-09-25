import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { fetchKnowledgeBaseSummary, type KnowledgeBaseSummaryPayload } from "../coordination/api";
import { CollapsibleSection } from "./CollapsibleSection";

function defaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    from: first.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

function TotalCard({ value, hint }: { value: number; hint: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: "4px solid var(--accent)",
        borderRadius: "var(--radius)",
        padding: "1.1rem 1.25rem",
      }}
    >
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", fontWeight: 500 }}>
        Total base de conocimiento registradas
      </div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, marginTop: "0.2rem", letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.45rem" }}>{hint}</div>
    </div>
  );
}

const dateInputStyle: CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

/**
 * Bloque «Base de conocimiento registradas»: total y desglose por autor con rango de fechas propio.
 */
export function KnowledgeBaseSection() {
  const initialRange = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<KnowledgeBaseSummaryPayload | null>(null);

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setErr(null);
    try {
      setData(await fetchKnowledgeBaseSummary(dateFrom, dateTo));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <CollapsibleSection
      title="Base de conocimiento registradas"
      subtitle="Artículos creados en `glpi_knowbaseitems` según `date_creation`. El rango de fechas de esta sección es independiente de los filtros generales de la página. Respeta la entidad GLPI del backend; no aplica tipo de proyecto."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.85rem",
          marginTop: "0.75rem",
          alignItems: "end",
          maxWidth: 560,
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
            Fecha inicio
          </label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={dateInputStyle} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Fecha fin</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={dateInputStyle} />
        </div>
        <div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !dateFrom || !dateTo}
            style={{
              padding: "0.55rem 1rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading || !dateFrom || !dateTo ? 0.65 : 1,
            }}
          >
            {loading ? "Cargando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {err && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
          Error al cargar base de conocimiento: {err}
        </p>
      )}
      {!err && loading && !data && (
        <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando base de conocimiento…</p>
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
              value={data.total_items}
              hint={`Artículos con fecha de creación entre ${data.date_from} y ${data.date_to} (inclusive).`}
            />
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", fontWeight: 650 }}>Por autor</h3>
            {data.by_author.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: 0 }}>
                No hay artículos registrados en el rango seleccionado.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    maxWidth: 640,
                    borderCollapse: "collapse",
                    fontSize: "0.88rem",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "0.5rem 0.65rem" }}>Autor</th>
                      <th style={{ padding: "0.5rem 0.65rem" }}>Login</th>
                      <th style={{ padding: "0.5rem 0.65rem", textAlign: "right" }}>Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_author.map((row, idx) => (
                      <tr
                        key={row.user_id ?? `unknown-${idx}`}
                        style={{ borderBottom: "1px solid var(--border)" }}
                      >
                        <td style={{ padding: "0.55rem 0.65rem" }}>{row.author_name}</td>
                        <td style={{ padding: "0.55rem 0.65rem", color: "var(--muted)" }}>
                          {row.login ?? "—"}
                        </td>
                        <td style={{ padding: "0.55rem 0.65rem", textAlign: "right", fontWeight: 600 }}>
                          {row.item_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
