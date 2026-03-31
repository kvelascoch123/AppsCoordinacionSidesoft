import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table as DocxTable,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { saveAs } from "file-saver";
import {
  fetchDashboard,
  fetchSupportAnalysis,
  fetchManagementByAssignee,
  fetchManagementTicketDetail,
  fetchSupportProjects,
  fetchSupportReport,
  fetchTicketAnalysis,
  fetchTicketTime,
  type DashboardPayload,
  type SupportProject,
  type SupportAnalysisPayload,
  type ManagementByAssigneePayload,
  type ManagementTicketDetailPayload,
  type SupportReportPayload,
  type TicketAnalysis,
  type TicketTimeBreakdown,
} from "./api";

const COLORS = ["#3d9cf5", "#7c5cff", "#3ecf8e", "#f5a524", "#ef5b5b", "#5ec9e8"];

/** Texto / ejes sobre fondo oscuro (evita negro por defecto de Recharts) */
const CHART_TEXT = "#e8edf5";
const CHART_AXIS = "#9aa8bf";
const CHART_TOOLTIP_BG = "#131822";
const CHART_TOOLTIP_BORDER = "#2a3344";
type Page = "home" | "reports" | "analysis";

function fmtHours(h: number | null | undefined): string {
  if (h == null || Number.isNaN(h)) return "—";
  if (h < 24) return `${Math.round(h)} h`;
  const d = h / 24;
  return `${d.toFixed(1)} d`;
}

function fmtActiontime(seconds: number | null | undefined): string {
  const s = Number(seconds ?? 0);
  if (!Number.isFinite(s) || s <= 0) return "—";
  const hours = s / 3600;
  if (hours < 1) return `${Math.round((s / 60) * 10) / 10} min`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "default" | "warn" | "danger";
}) {
  const border =
    accent === "warn" ? "var(--warn)" : accent === "danger" ? "var(--danger)" : "var(--accent)";
  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid var(--border)`,
        borderLeft: `4px solid ${border}`,
        borderRadius: "var(--radius)",
        padding: "1.1rem 1.25rem",
      }}
    >
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, marginTop: "0.2rem", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {hint && (
        <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.45rem" }}>{hint}</div>
      )}
    </div>
  );
}

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

function Table({
  columns,
  rows,
  empty,
}: {
  columns: { key: string; label: string; render?: (row: Record<string, unknown>) => ReactNode }[];
  rows: Record<string, unknown>[];
  empty: string;
}) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();

  const filteredRows =
    query === ""
      ? rows
      : rows.filter((row) =>
          columns.some((c) => {
            const raw = row[c.key];
            if (raw === null || raw === undefined) return false;
            return String(raw).toLowerCase().includes(query);
          }),
        );

  if (!filteredRows.length) {
    return (
      <div>
        <div style={{ marginBottom: "0.6rem" }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por cualquier columna…"
            style={{
              width: "100%",
              maxWidth: "260px",
              padding: "0.4rem 0.6rem",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "rgba(11, 18, 30, 0.85)",
              color: "var(--text)",
              fontSize: "0.8rem",
            }}
          />
        </div>
        <p style={{ color: "var(--muted)", fontSize: "0.86rem" }}>{empty}</p>
      </div>
    );
  }
  return (
    <div>
      <div style={{ marginBottom: "0.6rem", display: "flex", justifyContent: "flex-end" }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por cualquier columna…"
          style={{
            width: "100%",
            maxWidth: "260px",
            padding: "0.4rem 0.6rem",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "rgba(11, 18, 30, 0.85)",
            color: "var(--text)",
            fontSize: "0.8rem",
          }}
        />
      </div>
      <div style={{ overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
          <thead>
            <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
              {columns.map((c) => (
                <th key={c.key} style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 600 }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, i) => (
              <tr
                key={i}
                style={{
                  borderTop: "1px solid var(--border)",
                  background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                }}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: "0.55rem 0.85rem", verticalAlign: "top" }}>
                    {c.render ? c.render(row) : String(row[c.key] ?? "—")}
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

function monthLabel(dateIso: string): string {
  const dt = new Date(`${dateIso}T00:00:00`);
  return dt.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
}

async function exportSupportWord(report: SupportReportPayload, projectName: string): Promise<void> {
  const titleMonth = monthLabel(report.date_from);
  const makeHeaderCell = (text: string, widthPct: number) =>
    new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: "1F4E78" },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })],
        }),
      ],
    });

  const makeDataCell = (text: string, widthPct: number, align: any = AlignmentType.LEFT) =>
    new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
      },
      children: [
        new Paragraph({
          alignment: align,
          children: [new TextRun({ text, size: 20 })],
        }),
      ],
    });

  const rows = [
    new TableRow({
      children: [
        makeHeaderCell("TICKET", 10),
        makeHeaderCell("TITULO", 45),
        makeHeaderCell("TIPO", 15),
        makeHeaderCell("ESTADO", 15),
        makeHeaderCell("TIEMPO", 15),
      ],
    }),
    ...report.rows.map(
      (r) =>
        new TableRow({
          children: [
            makeDataCell(String(r.id), 10, AlignmentType.CENTER),
            makeDataCell(String(r.titulo || ""), 45, AlignmentType.LEFT),
            makeDataCell(String(r.tipo_solicitud || ""), 15, AlignmentType.CENTER),
            makeDataCell(String(r.estado_ticket || ""), 15, AlignmentType.CENTER),
            makeDataCell(String(r.tiempo_horas_minutos || ""), 15, AlignmentType.CENTER),
          ],
        }),
    ),
  ];

  const doc = new Document({
    creator: "GLPI Coordination Dashboard",
    description: "Informe profesional de soporte",
    title: `Informe de Soporte ${projectName}`,
    sections: [
      {
        properties: {
          page: {
            margin: { top: 900, bottom: 900, left: 900, right: 900 },
          },
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [new TextRun({ text: "INFORME DE MANTENIMIENTO Y SOPORTE", bold: true, color: "1F4E78" })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: projectName, bold: true, size: 26 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 260 },
            children: [new TextRun({ text: `Quito, ${new Date().toLocaleDateString("es-EC")}`, size: 22, color: "4A5568" })],
          }),
          new Paragraph({
            spacing: { before: 120, after: 80 },
            children: [new TextRun({ text: "Antecedente", bold: true, color: "1F4E78", size: 24 })],
          }),
          new Paragraph(
            {
              spacing: { after: 180 },
              children: [
                new TextRun({
                  text: `En relación al soporte técnico y mantenimiento del sistema ${projectName}, se emite el informe de horas de atención registradas en GLPI para el periodo ${titleMonth}.`,
                  size: 22,
                }),
              ],
            },
          ),
          new Paragraph({
            spacing: { before: 120, after: 100 },
            children: [new TextRun({ text: `Resumen general del tiempo aplicado en soporte - ${titleMonth}`, bold: true, color: "1F4E78", size: 24 })],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Tiempo total invertido en soporte técnico: ", bold: true }),
              new TextRun(`${report.summary.total.hours} horas ${report.summary.total.minutes} minutos (${report.summary.total.hhmm})`),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Tiempo facturable: ", bold: true }),
              new TextRun(`${report.summary.facturable.hours} horas ${report.summary.facturable.minutes} minutos (${report.summary.facturable.hhmm})`),
            ],
          }),
          new Paragraph({
            spacing: { after: 160 },
            children: [
              new TextRun({ text: "Tiempo no facturable: ", bold: true }),
              new TextRun(`${report.summary.no_facturable.hours} horas ${report.summary.no_facturable.minutes} minutos (${report.summary.no_facturable.hhmm})`),
            ],
          }),
          new Paragraph({
            spacing: { before: 140, after: 120 },
            children: [new TextRun({ text: `Detalle de los tickets atendidos - ${titleMonth}`, bold: true, color: "1F4E78", size: 24 })],
          }),
          new DocxTable({
            rows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
          }),
          new Paragraph({
            spacing: { before: 180, after: 180 },
            children: [
              new TextRun({
                text: "Nota: Los tiempos presentados corresponden a registros en GLPI dentro del periodo seleccionado.",
                size: 20,
                color: "4A5568",
                italics: true,
              }),
            ],
          }),
          new Paragraph({ spacing: { before: 260 }, children: [new TextRun({ text: "Atentamente,", bold: true })] }),
          new Paragraph({ children: [new TextRun("DEPARTAMENTO DE ATENCIÓN AL CLIENTE")] }),
          new Paragraph({ children: [new TextRun("SIDESOFT CIA. LTDA.")] }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `INFORME_SOPORTE_${projectName.replace(/\s+/g, "_").toUpperCase()}.docx`);
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<TicketAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoadingFor, setAnalysisLoadingFor] = useState<number | null>(null);
  const [timeBreakdown, setTimeBreakdown] = useState<TicketTimeBreakdown | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [timeLoadingFor, setTimeLoadingFor] = useState<number | null>(null);
  const [projects, setProjects] = useState<SupportProject[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [report, setReport] = useState<SupportReportPayload | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [generalAnalysis, setGeneralAnalysis] = useState<SupportAnalysisPayload | null>(null);
  const [generalAnalysisLoading, setGeneralAnalysisLoading] = useState(false);
  const [generalAnalysisErr, setGeneralAnalysisErr] = useState<string | null>(null);
  const [mgmtFrom, setMgmtFrom] = useState<string>("");
  const [mgmtTo, setMgmtTo] = useState<string>("");
  const [mgmtLoading, setMgmtLoading] = useState(false);
  const [mgmtErr, setMgmtErr] = useState<string | null>(null);
  const [mgmtData, setMgmtData] = useState<ManagementByAssigneePayload | null>(null);
  const [ticketDetailOpen, setTicketDetailOpen] = useState(false);
  const [ticketDetail, setTicketDetail] = useState<ManagementTicketDetailPayload | null>(null);
  const [ticketDetailErr, setTicketDetailErr] = useState<string | null>(null);
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false);
  const [ticketDetailTechName, setTicketDetailTechName] = useState<string>("Todos");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await fetchDashboard());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAnalyzeTicket = useCallback(async (ticketId: number) => {
    setAnalysisError(null);
    setAnalysis(null);
    setAnalysisLoadingFor(ticketId);
    try {
      const result = await fetchTicketAnalysis(ticketId);
      setAnalysis(result);
    } catch (e) {
      setAnalysisError(
        e instanceof Error
          ? e.message
          : "No se pudo obtener el análisis. Verifique que el backend tenga configurado OPENAI_API_KEY."
      );
    } finally {
      setAnalysisLoadingFor(null);
    }
  }, []);

  const handleShowTime = useCallback(async (ticketId: number) => {
    setTimeError(null);
    setTimeBreakdown(null);
    setTimeLoadingFor(ticketId);
    try {
      const result = await fetchTicketTime(ticketId);
      setTimeBreakdown(result);
    } catch (e) {
      setTimeError(e instanceof Error ? e.message : String(e));
    } finally {
      setTimeLoadingFor(null);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    setDateFrom(first.toISOString().slice(0, 10));
    setDateTo(today.toISOString().slice(0, 10));
    setMgmtFrom(first.toISOString().slice(0, 10));
    setMgmtTo(today.toISOString().slice(0, 10));
    fetchSupportProjects()
      .then((p) => {
        setProjects(p);
        if (p.length) setProjectId(p[0].id);
      })
      .catch(() => {
        // no-op
      });
  }, []);

  const runManagementByAssignee = useCallback(async () => {
    if (!mgmtFrom || !mgmtTo) return;
    setMgmtLoading(true);
    setMgmtErr(null);
    try {
      const r = await fetchManagementByAssignee(mgmtFrom, mgmtTo);
      setMgmtData(r);
    } catch (e) {
      setMgmtErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMgmtLoading(false);
    }
  }, [mgmtFrom, mgmtTo]);

  const openTicketDetailModal = useCallback(async (userId?: number, techName?: string) => {
    if (!mgmtFrom || !mgmtTo) return;
    setTicketDetailOpen(true);
    setTicketDetailErr(null);
    setTicketDetail(null);
    setTicketDetailTechName(techName || "Todos");
    setTicketDetailLoading(true);
    try {
      const r = await fetchManagementTicketDetail(mgmtFrom, mgmtTo, userId);
      setTicketDetail(r);
    } catch (e) {
      setTicketDetailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTicketDetailLoading(false);
    }
  }, [mgmtFrom, mgmtTo]);

  useEffect(() => {
    if (page === "home" && mgmtFrom && mgmtTo) {
      runManagementByAssignee();
    }
  }, [page, mgmtFrom, mgmtTo, runManagementByAssignee]);

  const selectedProjectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? "PROYECTO",
    [projects, projectId],
  );

  const runSupportReport = useCallback(async () => {
    if (!projectId || !dateFrom || !dateTo) return;
    setReportLoading(true);
    setReportErr(null);
    try {
      const r = await fetchSupportReport(projectId, dateFrom, dateTo);
      setReport(r);
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReportLoading(false);
    }
  }, [projectId, dateFrom, dateTo]);

  const runGeneralAnalysis = useCallback(async () => {
    if (!projectId || !dateFrom || !dateTo) return;
    setGeneralAnalysisLoading(true);
    setGeneralAnalysisErr(null);
    try {
      const res = await fetchSupportAnalysis(projectId, dateFrom, dateTo);
      setGeneralAnalysis(res);
    } catch (e) {
      setGeneralAnalysisErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneralAnalysisLoading(false);
    }
  }, [projectId, dateFrom, dateTo]);

  return (
    <>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 700 }}>Coordinación operativa GLPI</h1>
          <p style={{ margin: "0.4rem 0 0", color: "var(--muted)", maxWidth: "640px", fontSize: "0.95rem" }}>
            Indicadores y reportes de soporte.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setPage("home")}
            style={{
              background: page === "home" ? "var(--accent)" : "transparent",
              color: page === "home" ? "#061019" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "0.45rem 0.8rem",
              fontWeight: 600,
            }}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => setPage("reports")}
            style={{
              background: page === "reports" ? "var(--accent)" : "transparent",
              color: page === "reports" ? "#061019" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "0.45rem 0.8rem",
              fontWeight: 600,
            }}
          >
            Informes Soporte
          </button>
          <button
            type="button"
            onClick={() => setPage("analysis")}
            style={{
              background: page === "analysis" ? "var(--accent)" : "transparent",
              color: page === "analysis" ? "#061019" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "0.45rem 0.8rem",
              fontWeight: 600,
            }}
          >
            Analisis
          </button>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            style={{
              background: "var(--accent)",
              color: "#061019",
              border: "none",
              borderRadius: "8px",
              padding: "0.55rem 1rem",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              fontFamily: "var(--font)",
            }}
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </header>

      {page === "home" && err && (
        <div
          style={{
            background: "rgba(239, 91, 91, 0.12)",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius)",
            padding: "1rem 1.2rem",
            marginBottom: "1.5rem",
            color: "#ffc9c9",
          }}
        >
          <strong>Error: </strong>
          {err}
        </div>
      )}

      {page === "home" && !data && loading && <p style={{ color: "var(--muted)" }}>Cargando datos desde GLPI…</p>}

      {page === "home" && data && (
        <>
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginTop: "-1rem", marginBottom: "1.25rem" }}>
            Base: <span style={{ color: "var(--text)" }}>{data.generated_for.database}</span>
            {data.generated_for.entity_filter != null && (
              <>
                {" "}
                · Entidad filtrada: <span style={{ color: "var(--text)" }}>{data.generated_for.entity_filter}</span>
              </>
            )}{" "}
            · Umbral sin seguimiento:{" "}
            <span style={{ color: "var(--text)" }}>{data.generated_for.stale_hours_threshold} h</span>
          </p>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "1rem",
              marginBottom: "2rem",
            }}
          >
            <KpiCard label="Tickets abiertos" value={data.summary.open_total} />
            <KpiCard
              label="Sin asignar"
              value={data.summary.unassigned_count}
              hint="Sin técnico en glpi_tickets_users"
              accent={data.summary.unassigned_count > 0 ? "warn" : "default"}
            />
            <KpiCard
              label="Nuevos / en espera"
              value={data.summary.status_new_or_waiting}
              hint="Estados 1 y 4 (alto riesgo de estancamiento)"
              accent={data.summary.status_new_or_waiting > 5 ? "warn" : "default"}
            />
            <KpiCard label="Antigüedad media (cola abierta)" value={fmtHours(data.summary.avg_open_hours)} />
            <KpiCard
              label="Sin seguimiento público (≥ umbral)"
              value={data.summary.stale_over_threshold}
              hint={`Más de ${data.summary.threshold_hours} h sin ITILFollowup público`}
              accent={data.summary.stale_over_threshold > 0 ? "danger" : "default"}
            />
            <KpiCard label="Peor caso (h sin seguimiento)" value={fmtHours(data.summary.max_stale_hours)} />
          </section>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: "1.5rem",
              marginBottom: "2rem",
            }}
          >
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "1.25rem",
                minHeight: "320px",
              }}
            >
              <SectionTitle
                title="Carga por asignado"
                subtitle="Tickets abiertos por técnico (relación tipo asignado)"
              />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.by_assignee} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3344" />
                  <XAxis
                    dataKey="full_name"
                    tick={{ fill: CHART_TEXT, fontSize: 11 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    angle={-28}
                    textAnchor="end"
                    height={70}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fill: CHART_TEXT, fontSize: 11 }}
                    tickLine={{ stroke: CHART_AXIS }}
                    axisLine={{ stroke: CHART_AXIS }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: CHART_TOOLTIP_BG,
                      border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                      borderRadius: 8,
                      color: CHART_TEXT,
                    }}
                    labelStyle={{ color: CHART_TEXT }}
                    itemStyle={{ color: CHART_TEXT }}
                  />
                  <Bar dataKey="ticket_count" name="Tickets" radius={[6, 6, 0, 0]}>
                    {data.by_assignee.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "1.25rem",
                minHeight: "320px",
              }}
            >
              <SectionTitle title="Distribución por estado" subtitle="Solo tickets aún abiertos" />
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={data.by_status}
                    dataKey="cnt"
                    nameKey="status_label"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {data.by_status.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: CHART_TOOLTIP_BG,
                      border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                      borderRadius: 8,
                      color: CHART_TEXT,
                    }}
                    labelStyle={{ color: CHART_TEXT }}
                    itemStyle={{ color: CHART_TEXT }}
                  />
                  <Legend
                    wrapperStyle={{
                      color: CHART_TEXT,
                      fontSize: "0.8rem",
                    }}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: "1.5rem",
              marginBottom: "2rem",
            }}
          >
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" }}>
              <SectionTitle title="Prioridad de tickets abiertos" subtitle="Para focalizar según criticidad operativa" />
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.by_priority} layout="vertical" margin={{ left: 12, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3344" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: "#8b98ad", fontSize: 11 }} />
                  <YAxis type="category" dataKey="priority_label" width={100} tick={{ fill: "#8b98ad", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#131822", border: "1px solid #2a3344" }} />
                  <Bar dataKey="cnt" name="Tickets" fill="#7c5cff" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" }}>
              <SectionTitle
                title="Proyectos con más tickets abiertos"
                subtitle="Vínculo Ticket ↔ Proyecto (prioridad del proyecto en GLPI)"
              />
              <Table
                columns={[
                  { key: "project_name", label: "Proyecto" },
                  { key: "project_priority", label: "Prioridad" },
                  { key: "open_tickets", label: "Abiertos" },
                ]}
                rows={data.by_project as unknown as Record<string, unknown>[]}
                empty="No hay tickets abiertos enlazados a proyectos."
              />
            </div>
          </div>

          <div style={{ marginBottom: "2rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" }}>
            <SectionTitle
              title="Gestión por técnico (tickets y horas)"
              subtitle="Cuántos tickets gestionó cada técnico/asignado y tiempo total registrado en tareas"
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.7rem", marginBottom: "0.8rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: 4 }}>Desde</label>
                <input
                  type="date"
                  value={mgmtFrom}
                  onChange={(e) => setMgmtFrom(e.target.value)}
                  style={{ width: "100%", padding: "0.45rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: 4 }}>Hasta</label>
                <input
                  type="date"
                  value={mgmtTo}
                  onChange={(e) => setMgmtTo(e.target.value)}
                  style={{ width: "100%", padding: "0.45rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  type="button"
                  onClick={runManagementByAssignee}
                  disabled={mgmtLoading}
                  style={{ background: "var(--accent)", color: "#061019", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
                >
                  {mgmtLoading ? "Consultando..." : "Aplicar filtro"}
                </button>
              </div>
            </div>
            {mgmtData && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.7rem", marginBottom: "0.8rem" }}>
                <button
                  type="button"
                  onClick={() => openTicketDetailModal(undefined, "Todos")}
                  disabled={ticketDetailLoading}
                  style={{
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: ticketDetailLoading ? "wait" : "pointer",
                  }}
                  title="Ver detalle por ticket"
                >
                  <KpiCard
                    label="Tickets atendidos (rango)"
                    value={ticketDetailLoading ? "Cargando..." : mgmtData.totals.tickets_attended}
                    hint="Click para ver detalle por ticket"
                  />
                </button>
                <KpiCard label="Tiempo total invertido (rango)" value={fmtActiontime(mgmtData.totals.actiontime_total)} />
              </div>
            )}
            {mgmtErr && <p style={{ color: "#ffc9c9", marginTop: 0 }}>Error: {mgmtErr}</p>}
            <Table
              columns={[
                { key: "full_name", label: "Técnico / Asignado" },
                {
                  key: "managed_tickets",
                  label: "Tickets gestionados",
                  render: (r) => (
                    <button
                      type="button"
                      onClick={() =>
                        openTicketDetailModal(Number(r.user_id), String(r.full_name || "Sin nombre"))
                      }
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: 999,
                        padding: "0.15rem 0.6rem",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "var(--text)",
                        cursor: "pointer",
                      }}
                      title="Ver tickets gestionados por este técnico"
                    >
                      {String(r.managed_tickets ?? 0)}
                    </button>
                  ),
                },
                {
                  key: "actiontime_total",
                  label: "Tiempo invertido",
                  render: (r) => <strong>{fmtActiontime(Number(r.actiontime_total))}</strong>,
                },
              ]}
              rows={
                ((mgmtData?.rows ?? data.management_by_assignee) as unknown as Record<string, unknown>[])
              }
              empty="No hay registros de gestión para el rango seleccionado."
            />
          </div>

          {ticketDetailOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(3, 6, 15, 0.75)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 55,
              }}
              onClick={() => {
                setTicketDetailOpen(false);
                setTicketDetail(null);
              }}
            >
              <div
                style={{
                  background: "var(--surface)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  padding: "1.25rem 1.5rem",
                  maxWidth: "880px",
                  width: "100%",
                  maxHeight: "82vh",
                  overflowY: "auto",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                      Detalle de tickets atendidos
                    </h2>
                    <p style={{ margin: "0.3rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                      Técnico: <span style={{ color: "var(--text)", fontWeight: 650 }}>{ticketDetailTechName}</span> ·{" "}
                      Rango {ticketDetail?.date_from ?? mgmtFrom} a {ticketDetail?.date_to ?? mgmtTo} · Total tickets:{" "}
                      <span style={{ color: "var(--text)", fontWeight: 650 }}>
                        {ticketDetail?.count ?? 0}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTicketDetailOpen(false);
                      setTicketDetail(null);
                    }}
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

                {ticketDetailLoading && <p style={{ marginTop: "0.9rem", color: "var(--muted)" }}>Cargando detalle de tickets...</p>}
                {ticketDetailErr && <p style={{ color: "#ffc9c9", marginTop: "0.8rem" }}>Error: {ticketDetailErr}</p>}

                {ticketDetail && (
                  <div style={{ marginTop: "0.9rem", overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                      <thead>
                        <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Ticket</th>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Título</th>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Estado</th>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Tiempo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ticketDetail.rows.map((r, i) => (
                          <tr
                            key={`${r.ticket_id}-${i}`}
                            style={{
                              borderTop: "1px solid var(--border)",
                              background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                            }}
                          >
                            <td style={{ padding: "0.55rem 0.85rem" }}>{r.ticket_id}</td>
                            <td style={{ padding: "0.55rem 0.85rem" }}>{r.titulo || "—"}</td>
                            <td style={{ padding: "0.55rem 0.85rem" }}>{r.estado_ticket}</td>
                            <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{fmtActiontime(r.actiontime_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ marginBottom: "2rem" }}>
            <SectionTitle
              title="Cola sin asignación (top por antigüedad)"
              subtitle="Tickets abiertos sin fila de asignado en GLPI"
            />
            <Table
              columns={[
                { key: "id", label: "ID" },
                { key: "name", label: "Título" },
                { key: "priority", label: "Prio", render: (r) => String(r.priority) },
                {
                  key: "hours_open",
                  label: "Horas abierto",
                  render: (r) => fmtHours(Number(r.hours_open)),
                },
                {
                  key: "actiontime_total",
                  label: "Tiempo gestión",
                  render: (r) => {
                    const tid = Number(r.id);
                    const secs = Number(r.actiontime_total ?? 0);
                    return (
                      <button
                        type="button"
                        onClick={() => handleShowTime(tid)}
                        style={{
                          background: "transparent",
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          padding: "0.2rem 0.65rem",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          color: "var(--text)",
                          cursor: timeLoadingFor === tid ? "wait" : "pointer",
                          opacity: timeLoadingFor === tid ? 0.7 : 1,
                        }}
                        title="Ver detalle por asignado"
                      >
                        {timeLoadingFor === tid ? "Cargando…" : fmtActiontime(secs)}
                      </button>
                    );
                  },
                },
                {
                  key: "analyze",
                  label: "Análisis IA",
                  render: (r) => (
                    <button
                      type="button"
                      onClick={() => handleAnalyzeTicket(Number(r.id))}
                      style={{
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: 999,
                        padding: "0.25rem 0.75rem",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        color: "#061019",
                        cursor: analysisLoadingFor === Number(r.id) ? "wait" : "pointer",
                        opacity: analysisLoadingFor === Number(r.id) ? 0.7 : 1,
                      }}
                    >
                      {analysisLoadingFor === Number(r.id) ? "Analizando…" : "Analizar"}
                    </button>
                  ),
                },
              ]}
              rows={data.unassigned_top as unknown as Record<string, unknown>[]}
              empty="No hay tickets sin asignar."
            />
          </div>

          <div>
            <SectionTitle
              title="Mayor tiempo sin seguimiento público"
              subtitle="Horas desde último ITILFollowup no privado (o desde alta si no existe); prioriza coordinación y desbloqueos"
            />
            <Table
              columns={[
                { key: "id", label: "ID" },
                { key: "name", label: "Título" },
                { key: "assignees", label: "Asignados", render: (r) => String(r.assignees || "—") },
                { key: "priority_label", label: "Prioridad" },
                { key: "status_label", label: "Estado" },
                {
                  key: "hours_without_public_followup",
                  label: "h sin seguimiento",
                  render: (r) => <strong>{fmtHours(Number(r.hours_without_public_followup))}</strong>,
                },
                {
                  key: "actiontime_total",
                  label: "Tiempo gestión",
                  render: (r) => {
                    const tid = Number(r.id);
                    const secs = Number(r.actiontime_total ?? 0);
                    return (
                      <button
                        type="button"
                        onClick={() => handleShowTime(tid)}
                        style={{
                          background: "transparent",
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          padding: "0.2rem 0.65rem",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          color: "var(--text)",
                          cursor: timeLoadingFor === tid ? "wait" : "pointer",
                          opacity: timeLoadingFor === tid ? 0.7 : 1,
                        }}
                        title="Ver detalle por asignado"
                      >
                        {timeLoadingFor === tid ? "Cargando…" : fmtActiontime(secs)}
                      </button>
                    );
                  },
                },
                {
                  key: "analyze",
                  label: "Análisis IA",
                  render: (r) => (
                    <button
                      type="button"
                      onClick={() => handleAnalyzeTicket(Number(r.id))}
                      style={{
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: 999,
                        padding: "0.25rem 0.75rem",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        color: "#061019",
                        cursor: analysisLoadingFor === Number(r.id) ? "wait" : "pointer",
                        opacity: analysisLoadingFor === Number(r.id) ? 0.7 : 1,
                      }}
                    >
                      {analysisLoadingFor === Number(r.id) ? "Analizando…" : "Analizar"}
                    </button>
                  ),
                },
              ]}
              rows={data.stale_top as unknown as Record<string, unknown>[]}
              empty="No hay datos o la cola está al día."
            />
          </div>

          {analysis && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(3, 6, 15, 0.75)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 40,
              }}
              onClick={() => setAnalysis(null)}
            >
              <div
                style={{
                  background: "var(--surface)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  padding: "1.5rem 1.75rem",
                  maxWidth: "720px",
                  width: "100%",
                  maxHeight: "80vh",
                  overflowY: "auto",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div>
                    <div
                      style={{
                        fontSize: "0.78rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--muted)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      Ticket #{analysis.ticket_id}
                    </div>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: "1.1rem",
                        fontWeight: 600,
                      }}
                    >
                      {analysis.title || "Sin título"}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAnalysis(null)}
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

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)",
                    gap: "1.2rem",
                    marginTop: "1.1rem",
                  }}
                >
                  <div>
                    <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.95rem" }}>Resumen</h3>
                    <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text)" }}>{analysis.summary}</p>

                    <h3 style={{ margin: "0.9rem 0 0.25rem", fontSize: "0.95rem" }}>Causas probables</h3>
                    <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.88rem" }}>
                      {analysis.probable_causes?.map((c, i) => (
                        <li key={i} style={{ marginBottom: "0.15rem" }}>
                          {c}
                        </li>
                      ))}
                    </ul>

                    <h3 style={{ margin: "0.9rem 0 0.25rem", fontSize: "0.95rem" }}>Acciones sugeridas</h3>
                    <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.88rem" }}>
                      {analysis.suggested_actions?.map((c, i) => (
                        <li key={i} style={{ marginBottom: "0.15rem" }}>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div
                    style={{
                      borderLeft: "1px solid var(--border)",
                      paddingLeft: "1rem",
                      fontSize: "0.85rem",
                      color: "var(--muted)",
                    }}
                  >
                    <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.9rem" }}>Módulo / área afectada</h3>
                    <p style={{ margin: 0, color: "var(--text)" }}>{analysis.module}</p>

                    <h3 style={{ margin: "0.9rem 0 0.25rem", fontSize: "0.9rem" }}>Criticidad</h3>
                    <p style={{ margin: 0 }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.12rem 0.55rem",
                          borderRadius: 999,
                          background:
                            analysis.criticality === "Alta"
                              ? "rgba(239,91,91,0.18)"
                              : analysis.criticality === "Media"
                              ? "rgba(245,165,36,0.2)"
                              : "rgba(62,207,142,0.18)",
                          color:
                            analysis.criticality === "Alta"
                              ? "#ffc9c9"
                              : analysis.criticality === "Media"
                              ? "#ffe8b0"
                              : "#b0f3d4",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                        }}
                      >
                        {analysis.criticality}
                      </span>
                    </p>
                    <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>{analysis.criticality_reason}</p>

                    {analysis.notes && (
                      <>
                        <h3 style={{ margin: "0.9rem 0 0.25rem", fontSize: "0.9rem" }}>Notas</h3>
                        <p style={{ margin: 0, fontSize: "0.85rem" }}>{analysis.notes}</p>
                      </>
                    )}
                  </div>
                </div>

                {analysisError && (
                  <p style={{ marginTop: "1rem", color: "#ffc9c9", fontSize: "0.82rem" }}>Error: {analysisError}</p>
                )}
              </div>
            </div>
          )}

          {timeBreakdown && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(3, 6, 15, 0.75)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 45,
              }}
              onClick={() => setTimeBreakdown(null)}
            >
              <div
                style={{
                  background: "var(--surface)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  padding: "1.25rem 1.5rem",
                  maxWidth: "620px",
                  width: "100%",
                  maxHeight: "75vh",
                  overflowY: "auto",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                      Tiempo invertido — Ticket #{timeBreakdown.ticket_id}
                    </h2>
                    <p style={{ margin: "0.3rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                      Total: <span style={{ color: "var(--text)", fontWeight: 650 }}>{fmtActiontime(timeBreakdown.total_actiontime)}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTimeBreakdown(null)}
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

                <div style={{ marginTop: "1rem" }}>
                  <div style={{ overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                      <thead>
                        <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Asignado</th>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Tiempo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {timeBreakdown.by_user.map((u, i) => (
                          <tr
                            key={`${u.user_id}-${i}`}
                            style={{
                              borderTop: "1px solid var(--border)",
                              background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                            }}
                          >
                            <td style={{ padding: "0.55rem 0.85rem" }}>{u.full_name || `Usuario #${u.user_id}`}</td>
                            <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{fmtActiontime(u.actiontime_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {timeError && (
                    <p style={{ marginTop: "0.9rem", color: "#ffc9c9", fontSize: "0.82rem" }}>Error: {timeError}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {page === "reports" && (
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.2rem" }}>
          <SectionTitle title="Informes Soporte" subtitle="Seleccione proyecto y rango de fechas para generar informe en Word" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Proyecto</label>
              <select
                value={projectId ?? ""}
                onChange={(e) => setProjectId(Number(e.target.value))}
                style={{ width: "100%", padding: "0.5rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Desde</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Hasta</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem" }}>
            <button
              type="button"
              onClick={runSupportReport}
              disabled={reportLoading || !projectId}
              style={{ background: "var(--accent)", color: "#061019", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
            >
              {reportLoading ? "Generando..." : "Consultar"}
            </button>
            <button
              type="button"
              onClick={() => report && exportSupportWord(report, selectedProjectName)}
              disabled={!report}
              style={{ background: "#3ecf8e", color: "#07140d", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
            >
              Exportar Word
            </button>
          </div>
          {reportErr && <p style={{ color: "#ffc9c9" }}>Error: {reportErr}</p>}
          {report && (
            <div style={{ marginTop: "1rem" }}>
              <p style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
                Resumen: Total {report.summary.total.hhmm} · Facturable {report.summary.facturable.hhmm} · No facturable {report.summary.no_facturable.hhmm}
              </p>
              <Table
                columns={[
                  { key: "id", label: "Ticket" },
                  { key: "titulo", label: "Título" },
                  { key: "tipo_solicitud", label: "Tipo" },
                  { key: "estado_ticket", label: "Estado" },
                  { key: "tiempo_horas_minutos", label: "Tiempo" },
                ]}
                rows={report.rows as unknown as Record<string, unknown>[]}
                empty="Sin resultados para el filtro."
              />
            </div>
          )}
        </section>
      )}

      {page === "analysis" && (
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.2rem" }}>
          <SectionTitle
            title="Análisis Inteligente General"
            subtitle="Diagnóstico consolidado de tickets gestionados por proyecto y rango de fechas"
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.8rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Proyecto</label>
              <select
                value={projectId ?? ""}
                onChange={(e) => setProjectId(Number(e.target.value))}
                style={{ width: "100%", padding: "0.5rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Desde</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Hasta</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
              />
            </div>
          </div>
          <div style={{ marginTop: "0.8rem" }}>
            <button
              type="button"
              onClick={runGeneralAnalysis}
              disabled={generalAnalysisLoading || !projectId}
              style={{ background: "var(--accent)", color: "#061019", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
            >
              {generalAnalysisLoading ? "Analizando..." : "Ejecutar análisis general"}
            </button>
          </div>

          {generalAnalysisErr && <p style={{ color: "#ffc9c9", marginTop: "0.8rem" }}>Error: {generalAnalysisErr}</p>}

          {generalAnalysis && (
            <div style={{ marginTop: "1rem", display: "grid", gap: "0.8rem" }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem" }}>
                <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>Tickets analizados</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{generalAnalysis.report_total_tickets}</div>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem" }}>
                <h3 style={{ margin: "0 0 0.35rem" }}>Resumen ejecutivo</h3>
                <p style={{ margin: 0 }}>{generalAnalysis.summary}</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem" }}>
                <h3 style={{ margin: "0 0 0.35rem" }}>Módulos afectados</h3>
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  {generalAnalysis.modules_affected?.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem" }}>
                <h3 style={{ margin: "0 0 0.35rem" }}>Principales motivos de soporte</h3>
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  {generalAnalysis.main_support_drivers?.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem" }}>
                <h3 style={{ margin: "0 0 0.35rem" }}>Lectura de criticidad</h3>
                <p style={{ margin: 0 }}>{generalAnalysis.criticality_overview}</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.9rem" }}>
                <h3 style={{ margin: "0 0 0.35rem" }}>Recomendaciones</h3>
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  {generalAnalysis.recommendations?.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
