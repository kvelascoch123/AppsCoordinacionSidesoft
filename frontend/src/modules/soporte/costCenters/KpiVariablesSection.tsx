import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import type {
  KpiDatosRow,
  KpiResumenClienteTecnicoRow,
  KpiResumenTecnicoGlobalRow,
  KpiVariablesPayload,
} from "../../../api";
import { downloadExcelWorkbook, excelNum2, type ExcelDecimal, type ExcelSheet } from "./excelExport";

type TabId = "datos" | "clienteTecnico" | "tecnicoGlobal";

const TABS: { id: TabId; label: string }[] = [
  { id: "datos", label: "Datos" },
  { id: "clienteTecnico", label: "Resumen Cliente-Técnico" },
  { id: "tecnicoGlobal", label: "Resumen Técnico Global" },
];

function dashOrNum(v: number | "--" | null | undefined): ExcelDecimal | string {
  if (v === "--" || v == null) return "--";
  return excelNum2(v);
}

function buildKpiExcelSheets(data: KpiVariablesPayload): ExcelSheet[] {
  return [
    {
      name: "Datos",
      headers: [
        "Fecha",
        "Cliente",
        "Técnico",
        "ID_Ticket",
        "Cerrado_por_cliente",
        "Calificación",
        "Ticket calificado",
        "Tipo_SLA",
        "Dentro_SLA",
        "Reapertura",
        "Estado",
        "tecnico_id",
        "total_seconds",
        "tiempo_horas_minutos",
        "EVALUADO PARA KPI CIERRE TICKET",
      ],
      rows: data.datos.map((r) => [
        r.fecha ?? "",
        r.cliente,
        r.tecnico,
        r.id_ticket,
        r.cerrado_por_cliente,
        r.calificacion,
        r.ticket_calificado,
        r.tipo_sla,
        r.dentro_sla,
        r.reapertura,
        r.estado,
        r.tecnico_id ?? "",
        r.total_seconds,
        r.tiempo_horas_minutos,
        r.evaluado_kpi_cierre,
      ]),
    },
    {
      name: "Resumen_Cliente_Técnico",
      headers: [
        "Técnico",
        "Cliente",
        "Total Tickets",
        "Total tickets a evaluar",
        "Tickets cerrados por cliente",
        "% Cierre por cliente",
        "Cumple KPI 25%",
        "Variable KPI - % Tickets cerrados por el cliente (25%)",
        "Tickets calificados",
        "% Tickets calificados",
        "Cumple KPI Calificación 20 %",
        "Variable KPI -Calificación proporcional 20%",
        "Tickets dentro de SLA",
        "% Cumplimiento SLA",
        "Cumple KPI SLA > 30%",
        "Variable KPI: Cumplimiento SLA > 70 (30%)",
        "Tickets reaperturas",
        "% Reaperturas",
        "Cumple KPI < 25 %",
        "Variable KPI - Reapertura de tickets - (25%)",
        "Total seg GLPi",
        "Total horas",
      ],
      rows: data.resumen_cliente_tecnico.map((r) => [
        r.tecnico,
        r.cliente,
        r.total_tickets,
        r.total_tickets_evaluar,
        r.tickets_cerrados_cliente,
        dashOrNum(r.pct_cierre_cliente),
        r.cumple_kpi_cierre_25,
        dashOrNum(r.variable_kpi_cierre_25),
        r.tickets_calificados,
        dashOrNum(r.pct_tickets_calificados),
        r.cumple_kpi_calificacion_20,
        dashOrNum(r.variable_kpi_calificacion_20),
        r.tickets_dentro_sla,
        dashOrNum(r.pct_cumplimiento_sla),
        r.cumple_kpi_sla,
        dashOrNum(r.variable_kpi_sla_30),
        r.tickets_reaperturas,
        excelNum2(r.pct_reaperturas),
        r.cumple_kpi_reapertura,
        excelNum2(r.variable_kpi_reapertura_25),
        r.total_seg_glpi,
        excelNum2(r.total_horas),
      ]),
    },
    {
      name: "Resumen_Técnico_Global",
      headers: [
        "Técnico",
        "Total Tickets",
        "Total tickets a evaluar cierre",
        "Tickets cerrados por cliente",
        "% Cierre global",
        "Cumple KPI > 25 %",
        "Valor 25 %",
        "Tickets calificados",
        "% Tickets calificados",
        "Cumple KPI > 20%",
        "Alterno contra Cierre de tickets",
        "Valor 20%",
        "Tickets dentro de SLA",
        "% Cumplimiento SLA > 30 %",
        "Cumple KPI",
        "Valor 30%",
        "Tickets reaperturas",
        "% Reaperturas",
        "Cumple KPI < 25 %",
        "Valor 25%",
        "TOTAL % VARIABLE",
        "TIEMPO GLPI",
        "TIEMPO EN HORAS",
        "% Soporte Fin de Semana 10 %",
        "VARIABLE FINAL",
      ],
      rows: data.resumen_tecnico_global.map((r) => [
        r.tecnico,
        r.total_tickets,
        r.total_tickets_evaluar_cierre,
        r.tickets_cerrados_cliente,
        excelNum2(r.pct_cierre_global),
        r.cumple_kpi_cierre_25,
        excelNum2(r.valor_25),
        r.tickets_calificados,
        excelNum2(r.pct_tickets_calificados),
        r.cumple_kpi_calificacion_20,
        excelNum2(r.alterno_contra_cierre),
        excelNum2(r.valor_20),
        r.tickets_dentro_sla,
        excelNum2(r.pct_cumplimiento_sla),
        r.cumple_kpi_sla,
        excelNum2(r.valor_30),
        r.tickets_reaperturas,
        excelNum2(r.pct_reaperturas),
        r.cumple_kpi_reapertura,
        excelNum2(r.valor_25_reapertura),
        excelNum2(r.total_pct_variable),
        r.tiempo_glpi_seg,
        excelNum2(r.tiempo_horas),
        excelNum2(r.pct_soporte_finde_10),
        excelNum2(r.variable_final),
      ]),
    },
  ];
}


function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("es-EC", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtDashNum(v: number | "--" | null | undefined, digits = 4): string {
  if (v === "--" || v == null) return "--";
  if (Number.isNaN(v)) return "—";
  return v.toLocaleString("es-EC", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPctRatio(v: number | "--" | null | undefined): string {
  if (v === "--" || v == null) return "--";
  return `${(v * 100).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function fmtPctPoints(v: number | "--" | null | undefined): string {
  if (v === "--" || v == null) return "--";
  return fmtNum(v, 2);
}

function cumpleTone(v: string | undefined): CSSProperties {
  if (v === "CUMPLE") return { color: "var(--ok)", fontWeight: 650 };
  if (v === "NO CUMPLE") return { color: "var(--danger-text)", fontWeight: 650 };
  return { color: "var(--muted)" };
}

type Col<T> = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
};

function SimpleTable<T extends object>({
  rows,
  columns,
  emptyText,
}: {
  rows: T[];
  columns: Col<T>[];
  emptyText: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      Object.values(row as Record<string, unknown>).some((v) =>
        String(v ?? "").toLowerCase().includes(needle),
      ),
    );
  }, [rows, q]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          alignItems: "center",
          marginBottom: "0.65rem",
        }}
      >
        <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          Buscar
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar filas…"
            style={{
              display: "block",
              marginTop: 4,
              minWidth: 220,
              padding: "0.4rem 0.5rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--text)",
            }}
          />
        </label>
        <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          Mostrando {filtered.length} de {rows.length}
        </span>
      </div>
      <div
        style={{
          maxHeight: 520,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", minWidth: 1100 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    background: "var(--surface2)",
                    padding: "0.45rem 0.5rem",
                    textAlign: c.align ?? "left",
                    whiteSpace: "nowrap",
                    fontWeight: 650,
                  }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{ padding: "0.9rem", color: "var(--muted)" }}>
                  {emptyText}
                </td>
              </tr>
            )}
            {filtered.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: "0.35rem 0.5rem",
                      textAlign: c.align ?? "left",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined,
                    }}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const datosCols: Col<KpiDatosRow>[] = [
  { key: "fecha", header: "Fecha", render: (r) => r.fecha ?? "—" },
  { key: "cliente", header: "Cliente", render: (r) => r.cliente },
  { key: "tecnico", header: "Técnico", render: (r) => r.tecnico },
  { key: "id_ticket", header: "ID Ticket", align: "right", render: (r) => r.id_ticket },
  { key: "cerrado", header: "Cerrado por cliente", render: (r) => r.cerrado_por_cliente },
  { key: "calif", header: "Calificación", align: "right", render: (r) => r.calificacion },
  { key: "calificado", header: "Ticket calificado", render: (r) => r.ticket_calificado },
  { key: "sla", header: "Tipo SLA", render: (r) => r.tipo_sla },
  { key: "dentro", header: "Dentro SLA", render: (r) => r.dentro_sla },
  { key: "reap", header: "Reapertura", render: (r) => r.reapertura },
  { key: "estado", header: "Estado", render: (r) => r.estado },
  { key: "seg", header: "Segundos", align: "right", render: (r) => r.total_seconds },
  { key: "tiempo", header: "Tiempo", render: (r) => r.tiempo_horas_minutos },
  {
    key: "eval",
    header: "Evaluado KPI cierre",
    render: (r) => (
      <span style={{ fontWeight: 650, color: r.evaluado_kpi_cierre === "Sí" ? "var(--ok)" : "var(--muted)" }}>
        {r.evaluado_kpi_cierre}
      </span>
    ),
  },
];

const clienteTecnicoCols: Col<KpiResumenClienteTecnicoRow>[] = [
  { key: "tecnico", header: "Técnico", render: (r) => r.tecnico },
  { key: "cliente", header: "Cliente", render: (r) => r.cliente },
  { key: "tt", header: "Total tickets", align: "right", render: (r) => r.total_tickets },
  { key: "te", header: "Tickets a evaluar", align: "right", render: (r) => r.total_tickets_evaluar },
  { key: "tc", header: "Cerrados por cliente", align: "right", render: (r) => r.tickets_cerrados_cliente },
  { key: "pc", header: "% Cierre", align: "right", render: (r) => fmtPctRatio(r.pct_cierre_cliente) },
  {
    key: "cc",
    header: "Cumple KPI 25%",
    render: (r) => <span style={cumpleTone(String(r.cumple_kpi_cierre_25))}>{r.cumple_kpi_cierre_25}</span>,
  },
  {
    key: "vc",
    header: "Var. cierre 25%",
    align: "right",
    render: (r) => fmtPctPoints(r.variable_kpi_cierre_25),
  },
  { key: "tq", header: "Calificados", align: "right", render: (r) => r.tickets_calificados },
  { key: "pq", header: "% Calificados", align: "right", render: (r) => fmtPctRatio(r.pct_tickets_calificados) },
  {
    key: "cq",
    header: "Cumple KPI 20%",
    render: (r) => (
      <span style={cumpleTone(String(r.cumple_kpi_calificacion_20))}>{r.cumple_kpi_calificacion_20}</span>
    ),
  },
  {
    key: "vq",
    header: "Var. calificación 20%",
    align: "right",
    render: (r) => fmtPctPoints(r.variable_kpi_calificacion_20),
  },
  { key: "ts", header: "Dentro SLA", align: "right", render: (r) => r.tickets_dentro_sla },
  { key: "ps", header: "% SLA", align: "right", render: (r) => fmtPctRatio(r.pct_cumplimiento_sla) },
  {
    key: "cs",
    header: "Cumple KPI SLA",
    render: (r) => <span style={cumpleTone(String(r.cumple_kpi_sla))}>{r.cumple_kpi_sla}</span>,
  },
  {
    key: "vs",
    header: "Var. SLA 30%",
    align: "right",
    render: (r) => fmtPctPoints(r.variable_kpi_sla_30),
  },
  { key: "tr", header: "Reaperturas", align: "right", render: (r) => r.tickets_reaperturas },
  { key: "pr", header: "% Reaperturas", align: "right", render: (r) => fmtNum(r.pct_reaperturas, 2) },
  {
    key: "cr",
    header: "Cumple KPI <25%",
    render: (r) => <span style={cumpleTone(r.cumple_kpi_reapertura)}>{r.cumple_kpi_reapertura}</span>,
  },
  {
    key: "vr",
    header: "Var. reapertura 25%",
    align: "right",
    render: (r) => fmtNum(r.variable_kpi_reapertura_25, 0),
  },
  { key: "seg", header: "Total seg GLPI", align: "right", render: (r) => r.total_seg_glpi },
  { key: "horas", header: "Total horas", align: "right", render: (r) => fmtNum(r.total_horas, 4) },
];

const tecnicoGlobalCols: Col<KpiResumenTecnicoGlobalRow>[] = [
  { key: "tecnico", header: "Técnico", render: (r) => r.tecnico },
  { key: "tt", header: "Total tickets", align: "right", render: (r) => r.total_tickets },
  {
    key: "te",
    header: "Tickets a evaluar cierre",
    align: "right",
    render: (r) => r.total_tickets_evaluar_cierre,
  },
  { key: "tc", header: "Cerrados por cliente", align: "right", render: (r) => r.tickets_cerrados_cliente },
  { key: "pc", header: "% Cierre global", align: "right", render: (r) => fmtPctRatio(r.pct_cierre_global) },
  {
    key: "cc",
    header: "Cumple KPI >25%",
    render: (r) => <span style={cumpleTone(r.cumple_kpi_cierre_25)}>{r.cumple_kpi_cierre_25}</span>,
  },
  { key: "v25", header: "Valor 25%", align: "right", render: (r) => fmtDashNum(r.valor_25, 4) },
  { key: "tq", header: "Calificados", align: "right", render: (r) => r.tickets_calificados },
  { key: "pq", header: "% Calificados", align: "right", render: (r) => fmtPctRatio(r.pct_tickets_calificados) },
  {
    key: "cq",
    header: "Cumple KPI >20%",
    render: (r) => (
      <span style={cumpleTone(r.cumple_kpi_calificacion_20)}>{r.cumple_kpi_calificacion_20}</span>
    ),
  },
  { key: "alt", header: "Alterno vs cierre", align: "right", render: (r) => fmtPctRatio(r.alterno_contra_cierre) },
  { key: "v20", header: "Valor 20%", align: "right", render: (r) => fmtDashNum(r.valor_20, 4) },
  { key: "ts", header: "Dentro SLA", align: "right", render: (r) => r.tickets_dentro_sla },
  { key: "ps", header: "% SLA", align: "right", render: (r) => fmtPctRatio(r.pct_cumplimiento_sla) },
  {
    key: "cs",
    header: "Cumple KPI SLA",
    render: (r) => <span style={cumpleTone(r.cumple_kpi_sla)}>{r.cumple_kpi_sla}</span>,
  },
  { key: "v30", header: "Valor 30%", align: "right", render: (r) => fmtDashNum(r.valor_30, 4) },
  { key: "tr", header: "Reaperturas", align: "right", render: (r) => r.tickets_reaperturas },
  { key: "pr", header: "% Reaperturas", align: "right", render: (r) => fmtPctRatio(r.pct_reaperturas) },
  {
    key: "cr",
    header: "Cumple KPI <25%",
    render: (r) => <span style={cumpleTone(r.cumple_kpi_reapertura)}>{r.cumple_kpi_reapertura}</span>,
  },
  { key: "vr", header: "Valor 25% reap.", align: "right", render: (r) => fmtDashNum(r.valor_25_reapertura, 4) },
  { key: "tot", header: "TOTAL % VARIABLE", align: "right", render: (r) => fmtPctRatio(r.total_pct_variable) },
  { key: "seg", header: "Tiempo GLPI (seg)", align: "right", render: (r) => r.tiempo_glpi_seg },
  { key: "horas", header: "Tiempo horas", align: "right", render: (r) => fmtNum(r.tiempo_horas, 4) },
  {
    key: "finde",
    header: "% Soporte finde 10%",
    align: "right",
    render: (r) => fmtPctRatio(r.pct_soporte_finde_10),
  },
  {
    key: "final",
    header: "VARIABLE FINAL",
    align: "right",
    render: (r) => <strong>{fmtPctRatio(r.variable_final)}</strong>,
  },
];

export function KpiVariablesSection({
  data,
  loading,
  err,
}: {
  data: KpiVariablesPayload | null;
  loading: boolean;
  err: string | null;
}) {
  const [tab, setTab] = useState<TabId>("datos");

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1.2rem",
      }}
    >
      <header
        style={{
          marginBottom: "0.9rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>Cálculo de variables KPI</h2>
          <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.88rem" }}>
            Tres vistas al estilo Excel: Datos, Resumen Cliente-Técnico y Resumen Técnico Global (mismas
            fórmulas del libro de KPI).
          </p>
        </div>
        <button
          type="button"
          disabled={!data || loading}
          onClick={() => {
            if (!data) return;
            downloadExcelWorkbook(
              `kpi-variables-${data.date_from}-${data.date_to}.xls`,
              buildKpiExcelSheets(data),
            );
          }}
          style={{
            background: "var(--accent)",
            color: "var(--on-accent)",
            border: "none",
            borderRadius: 8,
            padding: "0.5rem 0.95rem",
            fontWeight: 700,
            cursor: !data || loading ? "not-allowed" : "pointer",
            opacity: !data || loading ? 0.55 : 1,
            whiteSpace: "nowrap",
          }}
        >
          Descargar Excel
        </button>
      </header>

      <div
        role="tablist"
        aria-label="Hojas KPI"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 0,
          borderBottom: "1px solid var(--border)",
          marginBottom: "0.9rem",
        }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          const count =
            data == null
              ? null
              : t.id === "datos"
                ? data.counts.datos
                : t.id === "clienteTecnico"
                  ? data.counts.resumen_cliente_tecnico
                  : data.counts.resumen_tecnico_global;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{
                border: "1px solid transparent",
                borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                background: active ? "rgba(113, 75, 103, 0.08)" : "transparent",
                color: active ? "var(--accent)" : "var(--muted)",
                fontWeight: active ? 700 : 550,
                padding: "0.55rem 0.9rem",
                cursor: "pointer",
                borderRadius: "6px 6px 0 0",
                fontSize: "0.86rem",
              }}
            >
              {t.label}
              {count != null ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {err && (
        <p style={{ color: "var(--danger-text)", fontSize: "0.9rem", margin: "0 0 0.75rem" }}>{err}</p>
      )}
      {loading && !data && (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Cargando KPI…</p>
      )}

      {data && tab === "datos" && (
        <SimpleTable rows={data.datos} columns={datosCols} emptyText="Sin filas de datos en el rango." />
      )}
      {data && tab === "clienteTecnico" && (
        <SimpleTable
          rows={data.resumen_cliente_tecnico}
          columns={clienteTecnicoCols}
          emptyText="Sin resumen cliente-técnico."
        />
      )}
      {data && tab === "tecnicoGlobal" && (
        <SimpleTable
          rows={data.resumen_tecnico_global}
          columns={tecnicoGlobalCols}
          emptyText="Sin resumen técnico global."
        />
      )}
    </section>
  );
}
