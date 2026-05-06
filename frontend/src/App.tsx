import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchDashboard,
  fetchSupportAnalysis,
  fetchTicketTableAnalysis,
  fetchManagementByAssignee,
  fetchManagementTicketDetail,
   applySupportTicketRequestTypes,
  fetchSupportProjects,
  fetchSupportReport,
  fetchSupportReportTicketTasks,
  fetchSupportRequestTypes,
  fetchTicketAnalysis,
  fetchTicketTime,
  fetchProjectTypes,
  fetchIndicatorsTimeTicketsByProject,
  fetchIndicatorsTimeTicketsDetail,
  fetchIndicatorsCreatedTicketsByPeriod,
  fetchIndicatorsSummaryKpis,
  fetchIndicatorsWeeklyResolutionEffort,
  fetchIndicatorsTicketsByRequestType,
  fetchIndicatorsTicketsByProjectForRequestType,
  fetchIndicatorsTicketsCreatedDetailForRequestTypeProject,
  fetchSupportHoursByProjectAndCategory,
  type DashboardPayload,
  type SupportProject,
  type SupportAnalysisPayload,
  type TicketTableAnalysisPayload,
  type ManagementByAssigneePayload,
  type ManagementTicketDetailPayload,
  type SupportReportPayload,
  type SupportRequestType,
  type SupportReportRow,
  type SupportReportTicketTask,
  type TicketAnalysis,
  type TicketTimeBreakdown,
  type ProjectType,
  type IndicatorsTimeTicketsPayload,
  type IndicatorsTimeTicketsRow,
  type IndicatorsTicketDetailPayload,
  type IndicatorsCreatedTicketsByPeriodPayload,
  type IndicatorsWeeklyResolutionPayload,
  type IndicatorsTicketsByRequestTypePayload,
  type IndicatorsTicketsByProjectForRequestTypePayload,
  type IndicatorsTicketsByProjectForRequestTypeRow,
  type IndicatorsRtCreatedTicketsDetailPayload,
  type IndicatorsSummaryKpisPayload,
  type SupportHoursByProjectPayload,
} from "./api";
import { CoordIndicatorsPage } from "./coordination";
import { BillingIndicatorsPage } from "./billing";
import { exportSupportReportDocx, SupportReportPrintPreview } from "./supportReportDocument";

const COLORS = ["#714b67", "#017e84", "#5b9bd5", "#ed7d31", "#70ad47", "#9e480e"];

/** Recharts sobre tema claro (estilo Odoo) */
const CHART_TEXT = "#212529";
const CHART_AXIS = "#6c757d";
const CHART_GRID = "#e9ecef";
const CHART_TOOLTIP_BG = "#ffffff";
const CHART_TOOLTIP_BORDER = "#dee2e6";
type Page =
  | "home"
  | "reports"
  | "analysis"
  | "indicators"
  | "coordIndicators"
  | "supportHours"
  | "billingIndicators";

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

/** Horas en formato decimal (p. ej. 1,813) → «1 h 49 min». No es «1 h y 81 min». */
function fmtDecimalHoursAsHm(decimalHours: number | null | undefined): string {
  if (decimalHours == null || Number.isNaN(decimalHours) || decimalHours < 0) return "—";
  const totalMinutes = Math.round(decimalHours * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  if (hh === 0) return `${mm} min`;
  if (mm === 0) return `${hh} h`;
  return `${hh} h ${mm} min`;
}

/** period_key YYYY-MM → «enero 2026» (es-ES) */
function formatSupportHoursMonth(periodKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) return periodKey;
  const d = new Date(`${periodKey}-01T12:00:00`);
  if (Number.isNaN(d.getTime())) return periodKey;
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
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
              background: "var(--input-bg)",
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
            background: "var(--input-bg)",
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

function formatTiempoHorasMinutos(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} horas ${m} minutos`;
}

function isFacturableValue(v: unknown): boolean {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return ["1", "si", "sí", "true", "t", "y", "yes"].includes(s);
}

function secondsToSummaryPart(totalSeconds: number): {
  hours: number;
  minutes: number;
  hhmm: string;
  seconds: number;
} {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return {
    hours,
    minutes,
    hhmm: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    seconds: sec,
  };
}

function computeSupportReportSummary(rows: SupportReportRow[]): SupportReportPayload["summary"] {
  let total = 0;
  let facturable = 0;
  let noFacturable = 0;
  for (const r of rows) {
    const sec = Math.max(0, Math.floor(Number(r.tiempo_numerico) || 0));
    total += sec;
    if (isFacturableValue(r.facturable)) facturable += sec;
    else noFacturable += sec;
  }
  return {
    total: secondsToSummaryPart(total),
    facturable: secondsToSummaryPart(facturable),
    no_facturable: secondsToSummaryPart(noFacturable),
  };
}

/** Fila de informe: puede ser un duplicado local con control de tipo/tiempo (no existe en API). */
type SupportReportDraftRow = SupportReportRow & {
  rowUid: string;
  isSplit: boolean;
  parentRowUid: string | null;
  /** Total segundos del ticket (API). Solo fila raíz; se reparten las líneas isSplit. */
  poolSeconds: number;
};

function newDraftRowUid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function findRootForTicketId(rows: SupportReportDraftRow[], ticketId: number): SupportReportDraftRow | undefined {
  return rows.find((r) => r.id === ticketId && !r.isSplit);
}

/**
 * Ajusta `tiempo_numerico` / `tiempo_horas_minutos` en raíces = pool − sum(splits) y en splits mantiene su parte.
 */
function recomputeRootDisplayFields(rows: SupportReportDraftRow[]): SupportReportDraftRow[] {
  return rows.map((r) => {
    if (r.isSplit) {
      const sec = Math.max(0, Math.floor(r.tiempo_numerico));
      return { ...r, tiempo_numerico: sec, tiempo_horas_minutos: formatTiempoHorasMinutos(sec) };
    }
    const taken = rows
      .filter((s) => s.isSplit && s.parentRowUid === r.rowUid)
      .reduce((a, s) => a + Math.max(0, Math.floor(s.tiempo_numerico)), 0);
    const eff = Math.max(0, r.poolSeconds - taken);
    return { ...r, tiempo_numerico: eff, tiempo_horas_minutos: formatTiempoHorasMinutos(eff) };
  });
}

function materializeApiRowsToDraft(rows: SupportReportRow[]): SupportReportDraftRow[] {
  return recomputeRootDisplayFields(
    rows.map((r) => {
      const sec = Math.max(0, Math.floor(Number(r.tiempo_numerico) || 0));
      return {
        ...r,
        requesttypes_id: Math.max(0, Math.floor(Number(r.requesttypes_id) || 0)),
        poolSeconds: sec,
        tiempo_numerico: sec,
        tiempo_horas_minutos: formatTiempoHorasMinutos(sec),
        solicitante: pickSolicitanteFromApiRow(r),
        rowUid: newDraftRowUid(),
        isSplit: false,
        parentRowUid: null,
      } satisfies SupportReportDraftRow;
    }),
  );
}

/** Para Word/PDF: solo filas soportadas por la API, sin metadatos de borrador. */
function draftRowToApiShape(r: SupportReportDraftRow): SupportReportRow {
  const { rowUid, isSplit, parentRowUid, poolSeconds, ...rest } = r;
  return rest;
}

function downloadTicketTableAnalysisExcel(payload: TicketTableAnalysisPayload) {
  const esc = (s: string) => {
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = ["ID", "Título", "Tipo", "Fecha", "Solicitante", "Tiempo invertido", "Contexto (IA)"];
  const lines = [head.join(";")];
  for (const r of payload.rows) {
    lines.push(
      [
        String(r.id),
        esc(r.titulo),
        esc(r.tipo_solicitud),
        esc(r.fecha_ticket ?? ""),
        esc(r.solicitante ?? ""),
        esc(r.tiempo_horas_minutos),
        esc(r.contexto_corto),
      ].join(";"),
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  const safe = (payload.project_name || "proyecto").replace(/[\\/]+/g, "-").slice(0, 48);
  a.href = URL.createObjectURL(blob);
  a.download = `analisis-por-ticket-${safe}-${payload.date_from}-${payload.date_to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function pickSolicitanteFromApiRow(r: SupportReportRow): string | null {
  const ext = r as SupportReportRow & Record<string, unknown>;
  const v = ext.solicitante ?? ext.SOLICITANTE ?? ext.Solicitante;
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
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
  const [supportDraftRows, setSupportDraftRows] = useState<SupportReportDraftRow[] | null>(null);
  const [supportReportTableFilter, setSupportReportTableFilter] = useState("");
  const [supportRequestTypes, setSupportRequestTypes] = useState<SupportRequestType[]>([]);
  const [supportRequestTypeBaseline, setSupportRequestTypeBaseline] = useState<Record<number, number>>({});
  const [supportSaveLoading, setSupportSaveLoading] = useState(false);
  const [supportSaveMessage, setSupportSaveMessage] = useState<string | null>(null);
  const [supportHourlyRate, setSupportHourlyRate] = useState("0");
  const [supportIvaPercent, setSupportIvaPercent] = useState("15");
  const [supportContractHours, setSupportContractHours] = useState("8");
  const [supportTaskModalOpen, setSupportTaskModalOpen] = useState(false);
  const [supportTaskModalRow, setSupportTaskModalRow] = useState<SupportReportRow | null>(null);
  const [supportTaskModalLoading, setSupportTaskModalLoading] = useState(false);
  const [supportTaskModalErr, setSupportTaskModalErr] = useState<string | null>(null);
  const [supportTaskModalTasks, setSupportTaskModalTasks] = useState<SupportReportTicketTask[]>([]);
  const [generalAnalysis, setGeneralAnalysis] = useState<SupportAnalysisPayload | null>(null);
  const [generalAnalysisLoading, setGeneralAnalysisLoading] = useState(false);
  const [generalAnalysisErr, setGeneralAnalysisErr] = useState<string | null>(null);
  const [ticketTableAnalysis, setTicketTableAnalysis] = useState<TicketTableAnalysisPayload | null>(null);
  const [ticketTableLoading, setTicketTableLoading] = useState(false);
  const [ticketTableErr, setTicketTableErr] = useState<string | null>(null);
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
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [projectTypesErr, setProjectTypesErr] = useState<string | null>(null);
  const [projectTypesLoading, setProjectTypesLoading] = useState(false);
  /** Tipo de proyecto GLPI (glpi_projects.projecttypes_id / glpi_projecttypes); aplica a futuros indicadores de esta página. */
  const [indicatorsProjectTypeId, setIndicatorsProjectTypeId] = useState<number | null>(null);
  const [indicatorsDateFrom, setIndicatorsDateFrom] = useState<string>("");
  const [indicatorsDateTo, setIndicatorsDateTo] = useState<string>("");
  const [indicatorsTimeTickets, setIndicatorsTimeTickets] = useState<IndicatorsTimeTicketsPayload | null>(null);
  const [indicatorsTimeTicketsLoading, setIndicatorsTimeTicketsLoading] = useState(false);
  const [indicatorsTimeTicketsErr, setIndicatorsTimeTicketsErr] = useState<string | null>(null);
  const [indicatorsDetailOpen, setIndicatorsDetailOpen] = useState(false);
  const [indicatorsDetailContext, setIndicatorsDetailContext] = useState<{ project_name: string } | null>(null);
  const [indicatorsDetail, setIndicatorsDetail] = useState<IndicatorsTicketDetailPayload | null>(null);
  const [indicatorsDetailLoading, setIndicatorsDetailLoading] = useState(false);
  const [indicatorsDetailErr, setIndicatorsDetailErr] = useState<string | null>(null);
  const [indicatorsVolumeOpen, setIndicatorsVolumeOpen] = useState(false);
  const [indicatorsVolumeContext, setIndicatorsVolumeContext] = useState<{
    project_id: number;
    project_name: string;
  } | null>(null);
  const [indicatorsVolumeGranularity, setIndicatorsVolumeGranularity] = useState<"week" | "month">("week");
  const [indicatorsVolumeData, setIndicatorsVolumeData] = useState<IndicatorsCreatedTicketsByPeriodPayload | null>(null);
  const [indicatorsVolumeLoading, setIndicatorsVolumeLoading] = useState(false);
  const [indicatorsVolumeErr, setIndicatorsVolumeErr] = useState<string | null>(null);
  const [indicatorsKpis, setIndicatorsKpis] = useState<IndicatorsSummaryKpisPayload | null>(null);
  const [indicatorsKpisErr, setIndicatorsKpisErr] = useState<string | null>(null);
  const [indicatorsTicketsByRequestType, setIndicatorsTicketsByRequestType] =
    useState<IndicatorsTicketsByRequestTypePayload | null>(null);
  const [indicatorsTicketsByRequestTypeErr, setIndicatorsTicketsByRequestTypeErr] = useState<string | null>(null);
  const [indicatorsWeeklyResolution, setIndicatorsWeeklyResolution] =
    useState<IndicatorsWeeklyResolutionPayload | null>(null);
  const [indicatorsWeeklyResolutionErr, setIndicatorsWeeklyResolutionErr] = useState<string | null>(null);
  const [indicatorsRtBreakdownOpen, setIndicatorsRtBreakdownOpen] = useState(false);
  const [indicatorsRtBreakdownContext, setIndicatorsRtBreakdownContext] = useState<{
    requesttypes_id: number;
    request_type_name: string;
  } | null>(null);
  const [indicatorsRtBreakdownData, setIndicatorsRtBreakdownData] =
    useState<IndicatorsTicketsByProjectForRequestTypePayload | null>(null);
  const [indicatorsRtBreakdownLoading, setIndicatorsRtBreakdownLoading] = useState(false);
  const [indicatorsRtBreakdownErr, setIndicatorsRtBreakdownErr] = useState<string | null>(null);
  const [indicatorsRtTicketListOpen, setIndicatorsRtTicketListOpen] = useState(false);
  const [indicatorsRtTicketListData, setIndicatorsRtTicketListData] =
    useState<IndicatorsRtCreatedTicketsDetailPayload | null>(null);
  const [indicatorsRtTicketListLoading, setIndicatorsRtTicketListLoading] = useState(false);
  const [indicatorsRtTicketListErr, setIndicatorsRtTicketListErr] = useState<string | null>(null);
  const [supportHoursData, setSupportHoursData] = useState<SupportHoursByProjectPayload | null>(null);
  const [supportHoursLoading, setSupportHoursLoading] = useState(false);
  const [supportHoursErr, setSupportHoursErr] = useState<string | null>(null);
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
    setIndicatorsDateFrom(first.toISOString().slice(0, 10));
    setIndicatorsDateTo(today.toISOString().slice(0, 10));
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

  useEffect(() => {
    if (!report) {
      setSupportDraftRows(null);
      setSupportRequestTypeBaseline({});
      return;
    }
    const baseline: Record<number, number> = {};
    for (const r of report.rows as SupportReportRow[]) {
      baseline[r.id] = Math.max(0, Math.floor(Number(r.requesttypes_id) || 0));
    }
    setSupportRequestTypeBaseline(baseline);
    setSupportDraftRows(materializeApiRowsToDraft(report.rows as SupportReportRow[]));
    setSupportSaveMessage(null);
  }, [report]);

  useEffect(() => {
    if (page !== "reports") return;
    fetchSupportRequestTypes()
      .then(setSupportRequestTypes)
      .catch(() => {
        /* No vaciar: un fallo tras “Consultar” dejaba solo el tipo de las filas del informe */
      });
  }, [page]);

  useEffect(() => {
    if (page !== "indicators" && page !== "supportHours" && page !== "coordIndicators") return;
    setProjectTypesLoading(true);
    setProjectTypesErr(null);
    fetchProjectTypes()
      .then((types) => {
        setProjectTypes(types);
        setIndicatorsProjectTypeId((prev) => {
          if (prev != null && types.some((t) => t.id === prev)) return prev;
          return null;
        });
      })
      .catch((e) => {
        setProjectTypesErr(e instanceof Error ? e.message : String(e));
        setProjectTypes([]);
        setIndicatorsProjectTypeId(null);
      })
      .finally(() => setProjectTypesLoading(false));
  }, [page]);

  const loadIndicatorsPageData = useCallback(async () => {
    if (!indicatorsDateFrom || !indicatorsDateTo) return;
    setIndicatorsTimeTicketsLoading(true);
    setIndicatorsTimeTicketsErr(null);
    setIndicatorsKpisErr(null);
    setIndicatorsTicketsByRequestTypeErr(null);
    setIndicatorsWeeklyResolutionErr(null);
    try {
      const [payload, kpis, byRequestType, weekly] = await Promise.all([
        fetchIndicatorsTimeTicketsByProject(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
        fetchIndicatorsSummaryKpis(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
        fetchIndicatorsTicketsByRequestType(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
        fetchIndicatorsWeeklyResolutionEffort(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
      ]);
      setIndicatorsTimeTickets(payload);
      setIndicatorsKpis(kpis);
      setIndicatorsTicketsByRequestType(byRequestType);
      setIndicatorsWeeklyResolution(weekly);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setIndicatorsTimeTicketsErr(msg);
      setIndicatorsKpisErr(msg);
      setIndicatorsTicketsByRequestTypeErr(msg);
      setIndicatorsWeeklyResolutionErr(msg);
      setIndicatorsTimeTickets(null);
      setIndicatorsKpis(null);
      setIndicatorsTicketsByRequestType(null);
      setIndicatorsWeeklyResolution(null);
    } finally {
      setIndicatorsTimeTicketsLoading(false);
    }
  }, [indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo]);

  const loadSupportHours = useCallback(async () => {
    if (!indicatorsDateFrom || !indicatorsDateTo) return;
    setSupportHoursLoading(true);
    setSupportHoursErr(null);
    try {
      setSupportHoursData(
        await fetchSupportHoursByProjectAndCategory(
          indicatorsProjectTypeId,
          indicatorsDateFrom,
          indicatorsDateTo,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSupportHoursErr(msg);
      setSupportHoursData(null);
    } finally {
      setSupportHoursLoading(false);
    }
  }, [indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo]);

  const openIndicatorsHorasDetail = useCallback(
    async (row: IndicatorsTimeTicketsRow) => {
      if (!indicatorsDateFrom || !indicatorsDateTo) return;
      setIndicatorsDetailContext({ project_name: row.project_name });
      setIndicatorsDetailOpen(true);
      setIndicatorsDetail(null);
      setIndicatorsDetailErr(null);
      setIndicatorsDetailLoading(true);
      try {
        setIndicatorsDetail(
          await fetchIndicatorsTimeTicketsDetail(
            row.project_id,
            indicatorsProjectTypeId,
            indicatorsDateFrom,
            indicatorsDateTo,
          ),
        );
      } catch (e) {
        setIndicatorsDetailErr(e instanceof Error ? e.message : String(e));
      } finally {
        setIndicatorsDetailLoading(false);
      }
    },
    [indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo],
  );

  const refreshIndicatorsVolume = useCallback(async () => {
    if (!indicatorsVolumeContext || !indicatorsDateFrom || !indicatorsDateTo) {
      return;
    }
    setIndicatorsVolumeLoading(true);
    setIndicatorsVolumeErr(null);
    try {
      setIndicatorsVolumeData(
        await fetchIndicatorsCreatedTicketsByPeriod(
          indicatorsVolumeContext.project_id,
          indicatorsProjectTypeId,
          indicatorsDateFrom,
          indicatorsDateTo,
          indicatorsVolumeGranularity,
        ),
      );
    } catch (e) {
      setIndicatorsVolumeErr(e instanceof Error ? e.message : String(e));
      setIndicatorsVolumeData(null);
    } finally {
      setIndicatorsVolumeLoading(false);
    }
  }, [
    indicatorsVolumeContext,
    indicatorsProjectTypeId,
    indicatorsDateFrom,
    indicatorsDateTo,
    indicatorsVolumeGranularity,
  ]);

  const openIndicatorsVolumeModal = useCallback(
    (row: IndicatorsTimeTicketsRow, initialGranularity: "week" | "month" = "week") => {
      if (!indicatorsDateFrom || !indicatorsDateTo) return;
      setIndicatorsVolumeContext({ project_id: row.project_id, project_name: row.project_name });
      setIndicatorsVolumeGranularity(initialGranularity);
      setIndicatorsVolumeData(null);
      setIndicatorsVolumeErr(null);
      setIndicatorsVolumeOpen(true);
      setIndicatorsVolumeLoading(true);
      void (async () => {
        try {
          setIndicatorsVolumeData(
            await fetchIndicatorsCreatedTicketsByPeriod(
              row.project_id,
              indicatorsProjectTypeId,
              indicatorsDateFrom,
              indicatorsDateTo,
              initialGranularity,
            ),
          );
        } catch (e) {
          setIndicatorsVolumeErr(e instanceof Error ? e.message : String(e));
          setIndicatorsVolumeData(null);
        } finally {
          setIndicatorsVolumeLoading(false);
        }
      })();
    },
    [indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo],
  );

  useEffect(() => {
    if (page !== "indicators") return;
    if (!indicatorsDateFrom || !indicatorsDateTo) return;
    void loadIndicatorsPageData();
  }, [page, indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo, loadIndicatorsPageData]);

  useEffect(() => {
    if (page !== "supportHours") return;
    if (!indicatorsDateFrom || !indicatorsDateTo) return;
    void loadSupportHours();
  }, [page, indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo, loadSupportHours]);

  const supportHoursTotalSeconds = useMemo(
    () => (supportHoursData?.rows ?? []).reduce((a, r) => a + (r.actiontime_seconds ?? 0), 0),
    [supportHoursData],
  );

  const indicatorsRequestTypeChartData = useMemo(() => {
    const rows = indicatorsTicketsByRequestType?.rows ?? [];
    return rows.map((r) => ({
      ...r,
      label:
        r.request_type_name.length > 42 ? `${r.request_type_name.slice(0, 39)}…` : r.request_type_name,
    }));
  }, [indicatorsTicketsByRequestType]);

  const indicatorsRtBreakdownChartData = useMemo(() => {
    const rows = indicatorsRtBreakdownData?.rows ?? [];
    return rows.map((r) => ({
      ...r,
      label: r.project_name.length > 36 ? `${r.project_name.slice(0, 33)}…` : r.project_name,
    }));
  }, [indicatorsRtBreakdownData]);

  const indicatorsRtBreakdownTotals = useMemo(() => {
    const rows = indicatorsRtBreakdownData?.rows ?? [];
    const totalTickets = rows.reduce((s, r) => s + r.ticket_count, 0);
    const totalSeconds = rows.reduce((s, r) => s + (r.actiontime_seconds ?? 0), 0);
    return { totalTickets, totalSeconds };
  }, [indicatorsRtBreakdownData]);

  const indicatorsWeeklyResolutionChartData = useMemo(() => {
    return (indicatorsWeeklyResolution?.rows ?? []).map((r) => ({
      ...r,
      chartLabel: r.period_label,
      avgHours: r.avg_hours_per_resolved,
    }));
  }, [indicatorsWeeklyResolution]);

  const openIndicatorsRtTicketListFromBreakdownBar = useCallback(
    (chartRow: IndicatorsTicketsByProjectForRequestTypeRow & { label: string }) => {
      if (chartRow.ticket_count <= 0) return;
      const rid =
        indicatorsRtBreakdownData?.requesttypes_id ?? indicatorsRtBreakdownContext?.requesttypes_id;
      if (rid == null || !indicatorsDateFrom || !indicatorsDateTo) return;
      setIndicatorsRtTicketListOpen(true);
      setIndicatorsRtTicketListData(null);
      setIndicatorsRtTicketListErr(null);
      setIndicatorsRtTicketListLoading(true);
      void (async () => {
        try {
          setIndicatorsRtTicketListData(
            await fetchIndicatorsTicketsCreatedDetailForRequestTypeProject(
              chartRow.project_id,
              rid,
              indicatorsProjectTypeId,
              indicatorsDateFrom,
              indicatorsDateTo,
            ),
          );
        } catch (e) {
          setIndicatorsRtTicketListErr(e instanceof Error ? e.message : String(e));
          setIndicatorsRtTicketListData(null);
        } finally {
          setIndicatorsRtTicketListLoading(false);
        }
      })();
    },
    [
      indicatorsRtBreakdownData?.requesttypes_id,
      indicatorsRtBreakdownContext?.requesttypes_id,
      indicatorsProjectTypeId,
      indicatorsDateFrom,
      indicatorsDateTo,
    ],
  );

  const openIndicatorsRtBreakdownModal = useCallback(
    (row: { requesttypes_id: number; request_type_name: string }) => {
      if (!indicatorsDateFrom || !indicatorsDateTo) return;
      setIndicatorsRtBreakdownContext({
        requesttypes_id: row.requesttypes_id,
        request_type_name: row.request_type_name,
      });
      setIndicatorsRtBreakdownOpen(true);
      setIndicatorsRtBreakdownData(null);
      setIndicatorsRtBreakdownErr(null);
      setIndicatorsRtBreakdownLoading(true);
      void (async () => {
        try {
          setIndicatorsRtBreakdownData(
            await fetchIndicatorsTicketsByProjectForRequestType(
              row.requesttypes_id,
              indicatorsProjectTypeId,
              indicatorsDateFrom,
              indicatorsDateTo,
            ),
          );
        } catch (e) {
          setIndicatorsRtBreakdownErr(e instanceof Error ? e.message : String(e));
          setIndicatorsRtBreakdownData(null);
        } finally {
          setIndicatorsRtBreakdownLoading(false);
        }
      })();
    },
    [indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo],
  );

  const supportDraftSummary = useMemo(
    () => (supportDraftRows ? computeSupportReportSummary(supportDraftRows) : null),
    [supportDraftRows],
  );

  const supportReportFilteredIndices = useMemo(() => {
    if (!supportDraftRows) return [];
    const q = supportReportTableFilter.trim().toLowerCase();
    if (!q) return supportDraftRows.map((_, i) => i);
    return supportDraftRows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) =>
        [String(r.id), r.titulo, r.tipo_solicitud, r.estado_ticket, r.solicitante, r.tiempo_horas_minutos].some((x) =>
          String(x ?? "")
            .toLowerCase()
            .includes(q),
        ),
      )
      .map(({ i }) => i);
  }, [supportDraftRows, supportReportTableFilter]);

  const supportRequestTypeOptions = useMemo(() => {
    const list: SupportRequestType[] = supportRequestTypes.map((x) => ({ ...x }));
    const seen = new Set(list.map((x) => x.id));
    for (const r of supportDraftRows ?? []) {
      const rid = Math.max(0, Math.floor(Number(r.requesttypes_id) || 0));
      if (!seen.has(rid)) {
        list.push({
          id: rid,
          name: r.tipo_solicitud || (rid === 0 ? "Sin tipo" : `Tipo #${rid}`),
          facturable: isFacturableValue(r.facturable),
        });
        seen.add(rid);
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [supportRequestTypes, supportDraftRows]);

  const supportPendingRequestTypeChanges = useMemo(() => {
    if (!supportDraftRows) return [];
    return supportDraftRows
      .filter((r) => !r.isSplit && supportRequestTypeBaseline[r.id] !== r.requesttypes_id)
      .map((r) => ({ ticket_id: r.id, requesttypes_id: r.requesttypes_id }));
  }, [supportDraftRows, supportRequestTypeBaseline]);

  const updateDraftRequestType = useCallback((rowIndex: number, requesttypesId: number, types: SupportRequestType[]) => {
    setSupportDraftRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const cur = { ...next[rowIndex] };
      if (!cur) return prev;
      cur.requesttypes_id = requesttypesId;
      const rt = types.find((x) => x.id === requesttypesId);
      if (rt) {
        cur.tipo_solicitud = rt.name;
        cur.facturable = rt.facturable ? "1" : "0";
      }
      next[rowIndex] = cur;
      return next;
    });
  }, []);

  /** Quita un ticket del listado y totales del informe (no modifica GLPI). Si quita la raíz, quita todos los duplicados del mismo ticket. */
  const removeSupportDraftRow = useCallback((rowIndex: number, ticketId: number) => {
    setSupportDraftRows((prev) => {
      if (!prev) return null;
      const row = prev[rowIndex];
      if (!row) return prev;
      let next: SupportReportDraftRow[];
      if (!row.isSplit) {
        next = prev.filter(
          (r) => r.rowUid !== row.rowUid && !(r.isSplit && r.parentRowUid === row.rowUid),
        );
      } else {
        next = prev.filter((_, i) => i !== rowIndex);
      }
      if (!next.some((r) => r.id === ticketId)) {
        setSupportRequestTypeBaseline((b) => {
          const n = { ...b };
          delete n[ticketId];
          return n;
        });
      }
      return recomputeRootDisplayFields(next);
    });
  }, []);

  /** Inserta un duplicado local debajo: comparte el pool de horas del ticket; el duplicado tiene tiempo y tipo editables. */
  const duplicateSupportDraftRow = useCallback((atIndex: number) => {
    setSupportDraftRows((prev) => {
      if (!prev) return null;
      const src = prev[atIndex];
      if (!src) return prev;
      const root = findRootForTicketId(prev, src.id);
      if (!root) return prev;
      const newRow: SupportReportDraftRow = {
        ...src,
        rowUid: newDraftRowUid(),
        isSplit: true,
        parentRowUid: root.rowUid,
        poolSeconds: 0,
        tiempo_numerico: 0,
        tiempo_horas_minutos: formatTiempoHorasMinutos(0),
      };
      const next = [...prev];
      next.splice(atIndex + 1, 0, newRow);
      return recomputeRootDisplayFields(next);
    });
  }, []);

  const updateSplitRowTime = useCallback((rowIndex: number, totalSeconds: number) => {
    setSupportDraftRows((prev) => {
      if (!prev) return null;
      const row = prev[rowIndex];
      if (!row?.isSplit || !row.parentRowUid) return prev;
      const root = prev.find((r) => r.rowUid === row.parentRowUid);
      if (!root) return prev;
      const otherTaken = prev
        .filter(
          (s) => s.isSplit && s.parentRowUid === root.rowUid && s.rowUid !== row.rowUid,
        )
        .reduce((a, s) => a + Math.max(0, Math.floor(s.tiempo_numerico)), 0);
      const cap = Math.max(0, root.poolSeconds - otherTaken);
      const newSec = Math.min(Math.max(0, Math.floor(totalSeconds)), cap);
      return recomputeRootDisplayFields(
        prev.map((r, i) =>
          i === rowIndex
            ? { ...r, tiempo_numerico: newSec, tiempo_horas_minutos: formatTiempoHorasMinutos(newSec) }
            : r,
        ),
      );
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
      fetchSupportRequestTypes()
        .then(setSupportRequestTypes)
        .catch(() => {});
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReportLoading(false);
    }
  }, [projectId, dateFrom, dateTo]);

  const runSaveSupportRequestTypes = useCallback(async () => {
    if (!supportPendingRequestTypeChanges.length) return;
    setSupportSaveLoading(true);
    setSupportSaveMessage(null);
    try {
      const res = await applySupportTicketRequestTypes(supportPendingRequestTypeChanges);
      let msg = `Se actualizaron ${res.updated} ticket(s) en GLPI (glpi_tickets.requesttypes_id).`;
      if (res.errors?.length) msg += ` ${res.errors.join("; ")}`;
      setSupportSaveMessage(msg);
      await runSupportReport();
    } catch (e) {
      setSupportSaveMessage(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSupportSaveLoading(false);
    }
  }, [supportPendingRequestTypeChanges, runSupportReport]);

  const openSupportTicketTasksModal = useCallback(
    async (row: SupportReportRow) => {
      if (!projectId || !dateFrom || !dateTo) return;
      setSupportTaskModalRow(row);
      setSupportTaskModalOpen(true);
      setSupportTaskModalErr(null);
      setSupportTaskModalTasks([]);
      setSupportTaskModalLoading(true);
      try {
        const data = await fetchSupportReportTicketTasks(row.id, projectId, dateFrom, dateTo);
        setSupportTaskModalTasks(data.tasks);
      } catch (e) {
        setSupportTaskModalErr(e instanceof Error ? e.message : String(e));
      } finally {
        setSupportTaskModalLoading(false);
      }
    },
    [projectId, dateFrom, dateTo],
  );

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

  const runTicketTableAnalysis = useCallback(async () => {
    if (!projectId || !dateFrom || !dateTo) return;
    setTicketTableLoading(true);
    setTicketTableErr(null);
    try {
      const res = await fetchTicketTableAnalysis(projectId, dateFrom, dateTo);
      setTicketTableAnalysis(res);
    } catch (e) {
      setTicketTableErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTicketTableLoading(false);
    }
  }, [projectId, dateFrom, dateTo]);

  const pageMeta = useMemo(() => {
    switch (page) {
      case "home":
        return {
          title: "Tablero",
          subtitle: "Indicadores de la cola GLPI, carga por técnico y seguimiento operativo.",
        };
      case "reports":
        return {
          title: "Informes de soporte",
          subtitle: "Informes en Word por proyecto y rango de fechas.",
        };
      case "analysis":
        return {
          title: "Análisis inteligente",
          subtitle: "Diagnóstico general y análisis por ticket (contexto con IA), con exportación a Excel.",
        };
      case "indicators":
        return {
          title: "Indicadores",
          subtitle:
            "El resumen numérico es global en GLPI; fechas y tipo de proyecto filtran el gráfico y los detalles por proyecto.",
        };
      case "coordIndicators":
        return {
          title: "Indicadores coordinación",
          subtitle:
            "Mismos filtros que Indicadores: totales de tickets creados, resueltos, abiertos y fuera de SLA (TTR); pulse cada cifra para el listado con proyecto, solicitante y tiempo en el rango.",
        };
      case "supportHours":
        return {
          title: "Horas Soporte",
          subtitle:
            "Horas de tareas por proyecto, categoría de ticket (fuente de solicitud) y mes, en el rango elegido. Sin desglose por ticket.",
        };
      case "billingIndicators":
        return {
          title: "Indicadores de facturación",
          subtitle:
            "Facturas de venta (PostgreSQL/Openbravo) filtradas por fecha, tipo de documento y centro de coste; conexión BILLING_PG_*.",
        };
    }
  }, [page]);

  return (
    <div className="odoo-shell">
      <header className="odoo-navbar">
        <div className="odoo-navbar-brand">
          <span className="odoo-navbar-logo">G</span>
          <div>
            <div className="odoo-navbar-title">Coordinación GLPI</div>
            <div className="odoo-navbar-sub">Panel operativo</div>
          </div>
        </div>
        <div className="odoo-navbar-actions">
          <button
            type="button"
            className="odoo-btn odoo-btn-navbar"
            onClick={() => load()}
            disabled={loading}
          >
            {loading ? "Actualizando…" : "Actualizar datos"}
          </button>
        </div>
      </header>
      <div className="odoo-body">
        <aside className="odoo-sidebar">
          <div className="odoo-sidebar-label">Menú</div>
          <nav className="odoo-sidebar-nav" aria-label="Navegación principal">
            <button
              type="button"
              className={page === "home" ? "odoo-nav-active" : undefined}
              onClick={() => setPage("home")}
            >
              Inicio
            </button>
            <button
              type="button"
              className={page === "reports" ? "odoo-nav-active" : undefined}
              onClick={() => setPage("reports")}
            >
              Informes de soporte
            </button>
            <button
              type="button"
              className={page === "analysis" ? "odoo-nav-active" : undefined}
              onClick={() => setPage("analysis")}
            >
              Análisis
            </button>
            <button
              type="button"
              className={page === "indicators" ? "odoo-nav-active" : undefined}
              onClick={() => setPage("indicators")}
            >
              Indicadores
            </button>
            <button
              type="button"
              className={page === "coordIndicators" ? "odoo-nav-active" : undefined}
              onClick={() => setPage("coordIndicators")}
            >
              Indicadores coordinación
            </button>
            <button
              type="button"
              className={page === "supportHours" ? "odoo-nav-active" : undefined}
              onClick={() => setPage("supportHours")}
            >
              Horas Soporte
            </button>
            <button
              type="button"
              className={page === "billingIndicators" ? "odoo-nav-active" : undefined}
              onClick={() => setPage("billingIndicators")}
            >
              Indicadores de facturación
            </button>
          </nav>
        </aside>
        <main className="odoo-content">
          <div className="odoo-content-header">
            <h1>{pageMeta.title}</h1>
            <p>{pageMeta.subtitle}</p>
          </div>

      {page === "home" && err && (
        <div
          style={{
            background: "rgba(220, 53, 69, 0.08)",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius)",
            padding: "1rem 1.2rem",
            marginBottom: "1.5rem",
            color: "var(--danger-text)",
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
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: CHART_AXIS, fontSize: 11 }} />
                  <YAxis type="category" dataKey="priority_label" width={100} tick={{ fill: CHART_AXIS, fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: CHART_TOOLTIP_BG,
                      border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                      borderRadius: 4,
                      color: CHART_TEXT,
                    }}
                    labelStyle={{ color: CHART_TEXT }}
                    itemStyle={{ color: CHART_TEXT }}
                  />
                  <Bar dataKey="cnt" name="Tickets" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
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
                  style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
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
            {mgmtErr && <p style={{ color: "var(--danger-text)", marginTop: 0 }}>Error: {mgmtErr}</p>}
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
                background: "rgba(33, 37, 41, 0.45)",
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
                {ticketDetailErr && <p style={{ color: "var(--danger-text)", marginTop: "0.8rem" }}>Error: {ticketDetailErr}</p>}

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
                        color: "var(--on-accent)",
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
                        color: "var(--on-accent)",
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
                background: "rgba(33, 37, 41, 0.45)",
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
                              ? "var(--danger-text)"
                              : analysis.criticality === "Media"
                              ? "#664d03"
                              : "#0f5132",
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
                  <p style={{ marginTop: "1rem", color: "var(--danger-text)", fontSize: "0.82rem" }}>Error: {analysisError}</p>
                )}
              </div>
            </div>
          )}

          {timeBreakdown && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(33, 37, 41, 0.45)",
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
                    <p style={{ marginTop: "0.9rem", color: "var(--danger-text)", fontSize: "0.82rem" }}>Error: {timeError}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {page === "reports" && (
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.2rem" }}>
          <SectionTitle
            title="Informes Soporte"
            subtitle="El tipo mostrado es el de GLPI (glpi_requesttypes / requesttypes_id), igual que en su configuración. Solo esa columna es editable; al guardar se actualiza glpi_tickets.requesttypes_id y el facturable del informe según el plugin Fields del tipo."
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.8rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={runSupportReport}
              disabled={reportLoading || !projectId}
              style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
            >
              {reportLoading ? "Generando..." : "Consultar"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!report || !supportDraftRows) return;
                const exportRows = supportDraftRows.map(draftRowToApiShape);
                const summary = computeSupportReportSummary(exportRows);
                const hourly = parseFloat(supportHourlyRate.replace(",", ".")) || 0;
                const iva = parseFloat(supportIvaPercent.replace(",", ".")) || 0;
                const contractH = parseFloat(supportContractHours.replace(",", ".")) || 0;
                void exportSupportReportDocx(report, selectedProjectName, exportRows, summary, {
                  hourlyRate: hourly,
                  ivaPercent: iva,
                  contractHours: contractH,
                });
              }}
              disabled={!report || supportDraftRows === null}
              style={{ background: "var(--ok)", color: "var(--on-accent)", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
            >
              Exportar Word
            </button>
            <button
              type="button"
              onClick={() => {
                if (!report || !supportDraftRows) return;
                const exportRows = supportDraftRows.map(draftRowToApiShape);
                const summary = computeSupportReportSummary(exportRows);
                const hourly = parseFloat(supportHourlyRate.replace(",", ".")) || 0;
                const iva = parseFloat(supportIvaPercent.replace(",", ".")) || 0;
                const contractH = parseFloat(supportContractHours.replace(",", ".")) || 0;
                void import("./supportReportPdf").then(({ exportSupportReportPdf }) =>
                  exportSupportReportPdf(report, selectedProjectName, exportRows, summary, {
                    hourlyRate: hourly,
                    ivaPercent: iva,
                    contractHours: contractH,
                  }),
                );
              }}
              disabled={!report || supportDraftRows === null}
              style={{ background: "#c53030", color: "var(--on-accent)", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
            >
              Exportar PDF
            </button>
            <button
              type="button"
              onClick={() => report && setSupportDraftRows(materializeApiRowsToDraft(report.rows as SupportReportRow[]))}
              disabled={!report}
              style={{
                background: "var(--surface2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.5rem 0.95rem",
                fontWeight: 600,
              }}
            >
              Restaurar desde GLPI
            </button>
            <button
              type="button"
              onClick={() => runSaveSupportRequestTypes()}
              disabled={!report || supportPendingRequestTypeChanges.length === 0 || supportSaveLoading}
              style={{
                background: supportPendingRequestTypeChanges.length ? "#017e84" : "var(--surface2)",
                color: supportPendingRequestTypeChanges.length ? "var(--on-accent)" : "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.5rem 0.95rem",
                fontWeight: 700,
              }}
            >
              {supportSaveLoading
                ? "Guardando…"
                : `Guardar cambios${supportPendingRequestTypeChanges.length ? ` (${supportPendingRequestTypeChanges.length})` : ""}`}
            </button>
          </div>
          {supportSaveMessage && (
            <p style={{ marginTop: "0.65rem", fontSize: "0.86rem", color: "var(--text)" }}>{supportSaveMessage}</p>
          )}
          <p style={{ marginTop: "0.35rem", fontSize: "0.78rem", color: "var(--muted)" }}>
            Tipos de solicitud cargados desde GLPI: {supportRequestTypes.length}
            {supportRequestTypes.length <= 1 && supportDraftRows && supportDraftRows.length > 0 && (
              <span> — Si faltan opciones, abra /api/reports/support/request-types o revise el contenedor API</span>
            )}
          </p>
          {reportErr && <p style={{ color: "var(--danger-text)" }}>Error: {reportErr}</p>}
          {report && supportDraftRows !== null && supportDraftSummary && (
            <div style={{ marginTop: "1rem" }}>
              <div style={{ marginBottom: "0.6rem", maxWidth: 320 }}>
                <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: 4 }}>Filtrar filas</label>
                <input
                  type="text"
                  value={supportReportTableFilter}
                  onChange={(e) => setSupportReportTableFilter(e.target.value)}
                  placeholder="ID, título, tipo, estado…"
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.55rem",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: "var(--input-bg)",
                    color: "var(--text)",
                    fontSize: "0.82rem",
                  }}
                />
              </div>
              {supportDraftRows.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
                  {report.rows.length > 0
                    ? "No quedan filas en el listado del informe. Puede volver a cargar con «Restaurar desde GLPI»."
                    : "No hay tickets en el periodo consultado."}
                </p>
              ) : !supportReportFilteredIndices.length ? (
                <p style={{ color: "var(--muted)", fontSize: "0.86rem" }}>Ninguna fila coincide con el filtro.</p>
              ) : (
                <div style={{ width: "100%", overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)", boxSizing: "border-box" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "3.5%" }} />
                      <col style={{ width: "3.5%" }} />
                      <col style={{ width: "5.5%" }} />
                      <col style={{ width: "22%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "16%" }} />
                    </colgroup>
                    <thead>
                      <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                        <th
                          style={{ padding: "0.55rem 0.4rem", color: "var(--muted)", fontWeight: 600, textAlign: "center", width: "2rem" }}
                          aria-label="Quitar de la lista"
                          title="Quita solo del listado del informe; no elimina en GLPI"
                        >
                          ×
                        </th>
                        <th
                          style={{ padding: "0.55rem 0.4rem", color: "var(--muted)", fontWeight: 600, textAlign: "center" }}
                          title="Duplicar: partida con tiempo y tipo propios (reparte el total del ticket)"
                          aria-label="Duplicar fila"
                        >
                          ⧉
                        </th>
                        <th style={{ padding: "0.55rem 0.65rem", color: "var(--muted)", fontWeight: 600 }}>Ticket</th>
                        <th style={{ padding: "0.55rem 0.65rem", color: "var(--muted)", fontWeight: 600 }}>Título</th>
                        <th style={{ padding: "0.55rem 0.65rem", color: "var(--muted)", fontWeight: 600 }}>Tipo</th>
                        <th style={{ padding: "0.55rem 0.65rem", color: "var(--muted)", fontWeight: 600 }}>Estado</th>
                        <th style={{ padding: "0.55rem 0.65rem", color: "var(--muted)", fontWeight: 600 }}>Solicitante</th>
                        <th style={{ padding: "0.55rem 0.65rem", color: "var(--muted)", fontWeight: 600 }}>Tiempo</th>
                        <th style={{ padding: "0.55rem 0.65rem", color: "var(--muted)", fontWeight: 600 }}>Facturable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supportReportFilteredIndices.map((rowIndex, displayIdx) => {
                        const row = supportDraftRows[rowIndex];
                        const rtMeta = supportRequestTypeOptions.find((x) => x.id === row.requesttypes_id);
                        const facturableShown = rtMeta ? rtMeta.facturable : isFacturableValue(row.facturable);
                        const dirty =
                          !row.isSplit && supportRequestTypeBaseline[row.id] !== row.requesttypes_id;
                        const secDisplay = Math.max(0, Math.floor(row.tiempo_numerico));
                        const timeH = Math.floor(secDisplay / 3600);
                        const timeM = Math.floor((secDisplay % 3600) / 60);
                        const sel: CSSProperties = {
                          width: "100%",
                          padding: "0.3rem 0.4rem",
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                          background: "var(--input-bg)",
                          color: "var(--text)",
                          fontSize: "0.8rem",
                          cursor: "pointer",
                        };
                        const splitTimeInput: CSSProperties = {
                          width: "3rem",
                          padding: "0.25rem 0.35rem",
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                          background: "var(--input-bg)",
                          color: "var(--text)",
                          fontSize: "0.78rem",
                          textAlign: "right",
                        };
                        return (
                          <tr
                            key={row.rowUid}
                            title={row.isSplit ? "Partida duplicada: el tiempo se reparte con la fila principal del mismo ticket." : undefined}
                            style={{
                              borderTop: "1px solid var(--border)",
                              background: dirty
                                ? "var(--accent-dim)"
                                : displayIdx % 2
                                  ? "rgba(0,0,0,0.02)"
                                  : "transparent",
                            }}
                          >
                            <td style={{ padding: "0.35rem 0.4rem", textAlign: "center", verticalAlign: "middle" }}>
                              <button
                                type="button"
                                onClick={() => {
                                  removeSupportDraftRow(rowIndex, row.id);
                                  if (supportTaskModalRow?.id === row.id) {
                                    setSupportTaskModalOpen(false);
                                    setSupportTaskModalRow(null);
                                    setSupportTaskModalTasks([]);
                                    setSupportTaskModalErr(null);
                                  }
                                }}
                                title="Quitar del listado del informe (no elimina en GLPI)"
                                aria-label={`Quitar ticket ${row.id} del listado`}
                                style={{
                                  background: "var(--surface2)",
                                  border: "1px solid var(--border)",
                                  borderRadius: 6,
                                  width: "1.75rem",
                                  height: "1.75rem",
                                  padding: 0,
                                  lineHeight: 1,
                                  cursor: "pointer",
                                  color: "var(--danger-text, #c44)",
                                  fontSize: "1.05rem",
                                  fontWeight: 700,
                                }}
                              >
                                ×
                              </button>
                            </td>
                            <td style={{ padding: "0.3rem 0.35rem", textAlign: "center", verticalAlign: "middle" }}>
                              <button
                                type="button"
                                onClick={() => duplicateSupportDraftRow(rowIndex)}
                                title="Duplicar: nueva partida con tiempo y tipo editables; descuenta del total mostrado en la fila principal"
                                aria-label={`Duplicar fila ticket ${row.id}`}
                                style={{
                                  background: "var(--surface2)",
                                  border: "1px solid var(--border)",
                                  borderRadius: 6,
                                  width: "1.75rem",
                                  height: "1.75rem",
                                  padding: 0,
                                  lineHeight: 1,
                                  cursor: "pointer",
                                  color: "var(--accent)",
                                  fontSize: "0.95rem",
                                }}
                              >
                                ⧉
                              </button>
                            </td>
                            <td style={{ padding: "0.45rem 0.65rem", fontWeight: 600 }}>{row.id}</td>
                            <td style={{ padding: "0.45rem 0.65rem", verticalAlign: "top", wordBreak: "break-word" }}>{row.titulo ?? "—"}</td>
                            <td style={{ padding: "0.45rem 0.65rem", verticalAlign: "top" }}>
                              <select
                                value={row.requesttypes_id}
                                onChange={(e) =>
                                  updateDraftRequestType(rowIndex, Number(e.target.value), supportRequestTypeOptions)
                                }
                                style={sel}
                              >
                                {supportRequestTypeOptions.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ padding: "0.45rem 0.65rem", verticalAlign: "top" }}>{row.estado_ticket ?? "—"}</td>
                            <td style={{ padding: "0.45rem 0.65rem", verticalAlign: "top", wordBreak: "break-word" }}>
                              {row.solicitante?.trim() ? row.solicitante : "—"}
                            </td>
                            <td style={{ padding: "0.45rem 0.65rem", verticalAlign: "top" }}>
                              {row.isSplit ? (
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                    gap: "0.25rem 0.4rem",
                                    justifyContent: "flex-start",
                                  }}
                                >
                                  <input
                                    type="number"
                                    min={0}
                                    value={timeH}
                                    onChange={(e) => {
                                      const nh = Math.max(0, Math.floor(parseFloat(e.target.value) || 0));
                                      const cur = Math.max(0, Math.floor(row.tiempo_numerico));
                                      const nm = Math.floor((cur % 3600) / 60);
                                      updateSplitRowTime(rowIndex, nh * 3600 + nm * 60);
                                    }}
                                    style={splitTimeInput}
                                    aria-label="Horas (partida)"
                                  />
                                  <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>h</span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={59}
                                    value={timeM}
                                    onChange={(e) => {
                                      const nm = Math.min(59, Math.max(0, Math.floor(parseFloat(e.target.value) || 0)));
                                      const cur = Math.max(0, Math.floor(row.tiempo_numerico));
                                      const nh = Math.floor(cur / 3600);
                                      updateSplitRowTime(rowIndex, nh * 3600 + nm * 60);
                                    }}
                                    style={{ ...splitTimeInput, width: "2.5rem" }}
                                    aria-label="Minutos (partida)"
                                  />
                                  <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>min</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void openSupportTicketTasksModal(draftRowToApiShape(row))}
                                  title="Ver fechas y autores de cada tarea con tiempo en este periodo"
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: 0,
                                    margin: 0,
                                    cursor: "pointer",
                                    color: "var(--accent)",
                                    textDecoration: "underline",
                                    textUnderlineOffset: 2,
                                    font: "inherit",
                                    fontSize: "inherit",
                                    textAlign: "left",
                                  }}
                                >
                                  {row.tiempo_horas_minutos}
                                </button>
                              )}
                            </td>
                            <td style={{ padding: "0.45rem 0.65rem", verticalAlign: "top", fontWeight: 600 }}>
                              {facturableShown ? "Sí" : "No"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: "1.35rem" }}>
                <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginBottom: "0.75rem" }}>
                  <strong style={{ color: "var(--text)" }}>Vista previa del documento</strong> — Mismo diseño que el informe Word (encabezado,
                  tablas, costos y cierre). Horas contrato, tarifa e IVA se reflejan al exportar Word.
                </p>
                <SupportReportPrintPreview
                  projectName={selectedProjectName}
                  dateFromIso={report.date_from}
                  summary={supportDraftSummary}
                  rows={supportDraftRows.map(draftRowToApiShape)}
                  contractHoursStr={supportContractHours}
                  onContractHoursChange={setSupportContractHours}
                  hourlyRateStr={supportHourlyRate}
                  ivaPercentStr={supportIvaPercent}
                  onHourlyRateChange={setSupportHourlyRate}
                  onIvaPercentChange={setSupportIvaPercent}
                />
              </div>
            </div>
          )}

          {supportTaskModalOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(33, 37, 41, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 55,
              }}
              onClick={() => {
                setSupportTaskModalOpen(false);
                setSupportTaskModalRow(null);
                setSupportTaskModalTasks([]);
                setSupportTaskModalErr(null);
              }}
            >
              <div
                style={{
                  background: "var(--surface)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  padding: "1.25rem 1.5rem",
                  maxWidth: "720px",
                  width: "100%",
                  maxHeight: "82vh",
                  overflowY: "auto",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                }}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="support-task-modal-title"
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div>
                    <h2 id="support-task-modal-title" style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                      Tiempos del ticket {supportTaskModalRow?.id ?? "—"}
                    </h2>
                    <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                      {supportTaskModalRow?.titulo ? (
                        <span style={{ color: "var(--text)" }}>{supportTaskModalRow.titulo}</span>
                      ) : (
                        "—"
                      )}
                      {report && (
                        <>
                          {" "}
                          · Periodo {report.date_from} → {report.date_to}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSupportTaskModalOpen(false);
                      setSupportTaskModalRow(null);
                      setSupportTaskModalTasks([]);
                      setSupportTaskModalErr(null);
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

                {supportTaskModalLoading && (
                  <p style={{ marginTop: "0.9rem", color: "var(--muted)" }}>Cargando tareas…</p>
                )}
                {supportTaskModalErr && (
                  <p style={{ color: "var(--danger-text)", marginTop: "0.8rem" }}>Error: {supportTaskModalErr}</p>
                )}
                {!supportTaskModalLoading && supportTaskModalTasks.length === 0 && !supportTaskModalErr && (
                  <p style={{ marginTop: "0.85rem", color: "var(--muted)", fontSize: "0.86rem" }}>
                    No hay tareas con tiempo en este periodo para este ticket y proyecto.
                  </p>
                )}
                {supportTaskModalTasks.length > 0 && (
                  <div
                    style={{ marginTop: "0.9rem", overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
                  >
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                      <thead>
                        <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>
                            Fecha de registro
                          </th>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>
                            Usuario
                          </th>
                          <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Tiempo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supportTaskModalTasks.map((t, i) => (
                          <tr
                            key={`${t.task_id}-${i}`}
                            style={{
                              borderTop: "1px solid var(--border)",
                              background: i % 2 ? "rgba(0,0,0,0.02)" : "transparent",
                            }}
                          >
                            <td style={{ padding: "0.55rem 0.85rem", whiteSpace: "nowrap" }}>
                              {t.fecha_registro ?? "—"}
                            </td>
                            <td style={{ padding: "0.55rem 0.85rem", wordBreak: "break-word" }}>{t.usuario_creador}</td>
                            <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{t.tiempo_horas_minutos}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {page === "analysis" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.15rem" }}>
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
              style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700 }}
            >
              {generalAnalysisLoading ? "Analizando..." : "Ejecutar análisis general"}
            </button>
          </div>

          {generalAnalysisErr && <p style={{ color: "var(--danger-text)", marginTop: "0.8rem" }}>Error: {generalAnalysisErr}</p>}

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

        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "1.2rem",
          }}
        >
          <SectionTitle
            title="Análisis por ticket"
            subtitle="Tickets dados de alta en el rango de fechas, vinculados al proyecto (misma lógica que en informes de soporte). El tiempo mostrado suma tareas cuyo registro o inicio entra en el periodo. La columna de contexto usa IA (OpenAI) a partir de título, requerimiento, seguimientos y tareas."
          />
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 0.85rem" }}>
            Mismo proyecto, desde y hasta que la sección anterior. La exportación genera un CSV UTF-8 (se abre con Excel o LibreOffice).
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={runTicketTableAnalysis}
              disabled={ticketTableLoading || !projectId}
              style={{
                background: "var(--accent)",
                color: "var(--on-accent)",
                border: "none",
                borderRadius: 8,
                padding: "0.5rem 0.95rem",
                fontWeight: 700,
              }}
            >
              {ticketTableLoading ? "Analizando…" : "Ejecutar análisis por ticket"}
            </button>
            <button
              type="button"
              onClick={() => ticketTableAnalysis && downloadTicketTableAnalysisExcel(ticketTableAnalysis)}
              disabled={!ticketTableAnalysis?.rows?.length}
              style={{
                background: "var(--surface2)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.5rem 0.95rem",
                fontWeight: 600,
              }}
            >
              Exportar a Excel
            </button>
          </div>

          {ticketTableErr && (
            <p style={{ color: "var(--danger-text)", marginTop: "0.8rem" }}>Error: {ticketTableErr}</p>
          )}

          {ticketTableAnalysis && (
            <div style={{ marginTop: "1rem" }}>
              {ticketTableAnalysis.truncated && (
                <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: "0 0 0.75rem" }}>
                  Hay {ticketTableAnalysis.total_in_range} tickets en el rango; se analizan como máximo 100. Exporte a
                  Excel para conservar el mismo corte.
                </p>
              )}
              {ticketTableAnalysis.total_in_range === 0 && (
                <p style={{ color: "var(--muted)", margin: 0 }}>No hay tickets creados en el rango para este proyecto.</p>
              )}
              {ticketTableAnalysis.rows.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.88rem",
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                        <th style={{ padding: "0.5rem 0.65rem", whiteSpace: "nowrap" }}>Ticket</th>
                        <th style={{ padding: "0.5rem 0.65rem" }}>Título</th>
                        <th style={{ padding: "0.5rem 0.65rem" }}>Tipo</th>
                        <th style={{ padding: "0.5rem 0.65rem", whiteSpace: "nowrap" }}>Fecha</th>
                        <th style={{ padding: "0.5rem 0.65rem" }}>Solicitante</th>
                        <th style={{ padding: "0.5rem 0.65rem", whiteSpace: "nowrap" }}>Tiempo</th>
                        <th style={{ padding: "0.5rem 0.65rem", minWidth: 220 }}>Contexto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ticketTableAnalysis.rows.map((r) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "0.55rem 0.65rem", fontWeight: 700 }}>#{r.id}</td>
                          <td style={{ padding: "0.55rem 0.65rem", wordBreak: "break-word" }}>{r.titulo || "—"}</td>
                          <td style={{ padding: "0.55rem 0.65rem", wordBreak: "break-word" }}>{r.tipo_solicitud || "—"}</td>
                          <td style={{ padding: "0.55rem 0.65rem", whiteSpace: "nowrap" }}>{r.fecha_ticket ?? "—"}</td>
                          <td style={{ padding: "0.55rem 0.65rem" }}>{r.solicitante ?? "—"}</td>
                          <td style={{ padding: "0.55rem 0.65rem" }}>{r.tiempo_horas_minutos}</td>
                          <td style={{ padding: "0.55rem 0.65rem", color: "var(--text)" }}>{r.contexto_corto}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
        </div>
      )}

      {page === "indicators" && (
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
              subtitle="Fechas y tipo de proyecto aplican al resumen numérico, al gráfico principal y a los modales relacionados. «Todos los tipos» muestra totales globales de tickets (sin exigir proyecto); al elegir un tipo, el resumen solo cuenta tickets vinculados a proyectos de ese tipo."
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
                <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Fecha inicio</label>
                <input
                  type="date"
                  value={indicatorsDateFrom}
                  onChange={(e) => setIndicatorsDateFrom(e.target.value)}
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
                <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>Fecha fin</label>
                <input
                  type="date"
                  value={indicatorsDateTo}
                  onChange={(e) => setIndicatorsDateTo(e.target.value)}
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
              <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
                  Tipo de proyecto
                </label>
                {projectTypesLoading && (
                  <p style={{ color: "var(--muted)", fontSize: "0.86rem", margin: 0 }}>Cargando tipos…</p>
                )}
                {projectTypesErr && (
                  <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", margin: 0 }}>Error: {projectTypesErr}</p>
                )}
                {!projectTypesLoading && !projectTypesErr && (
                  <select
                    value={indicatorsProjectTypeId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setIndicatorsProjectTypeId(v === "" ? null : Number(v));
                    }}
                    disabled={!projectTypes.length}
                    style={{
                      width: "100%",
                      maxWidth: "480px",
                      padding: "0.55rem 0.65rem",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--surface2)",
                      color: "var(--text)",
                      fontSize: "0.9rem",
                    }}
                  >
                    {!projectTypes.length ? (
                      <option value="">No hay tipos de proyecto en GLPI</option>
                    ) : (
                      <>
                        <option value="">Todos los tipos</option>
                        {projectTypes.map((pt) => (
                          <option key={pt.id} value={pt.id}>
                            {pt.name}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void loadIndicatorsPageData()}
                  disabled={indicatorsTimeTicketsLoading || !indicatorsDateFrom || !indicatorsDateTo}
                  style={{
                    background: "var(--accent)",
                    color: "var(--on-accent)",
                    border: "none",
                    borderRadius: 8,
                    padding: "0.5rem 0.95rem",
                    fontWeight: 700,
                    cursor: indicatorsTimeTicketsLoading ? "wait" : "pointer",
                  }}
                >
                  {indicatorsTimeTicketsLoading ? "Cargando…" : "Actualizar"}
                </button>
              </div>
            </div>
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
              title="Resumen"
              subtitle="Creados y resueltos usan el rango de fechas de arriba; abiertos es el estado actual del ticket (sin filtrar por fecha de alta). Si eligió un tipo de proyecto, solo se incluyen tickets con proyecto resuelto de ese tipo (misma lógica que el gráfico). «Todos los tipos» = cola global sin exigir vínculo a proyecto. La entidad GLPI del backend, si está definida, acota todos los conteos."
            />
            {indicatorsKpisErr && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Error: {indicatorsKpisErr}</p>
            )}
            {indicatorsTimeTicketsLoading && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando totales…</p>
            )}
            {!indicatorsTimeTicketsLoading && !indicatorsKpisErr && indicatorsKpis && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "1.25rem",
                  marginTop: "1rem",
                }}
              >
                {(
                  [
                    {
                      label: "Total de tickets creados:",
                      cardTitle: "Total de tickets creados",
                      value: indicatorsKpis.tickets_created_in_range,
                    },
                    {
                      label: "Total tickets resueltos:",
                      cardTitle: "Total tickets resueltos",
                      value: indicatorsKpis.tickets_resolved_in_range,
                    },
                    {
                      label: "Total tickets abiertos:",
                      cardTitle: "Tickets abiertos",
                      value: indicatorsKpis.tickets_open_now,
                    },
                  ] as const
                ).map((k) => (
                  <div
                    key={k.cardTitle}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      gap: "0.85rem",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 auto",
                        alignSelf: "center",
                        fontSize: "0.88rem",
                        color: "var(--text)",
                        maxWidth: "42%",
                      }}
                    >
                      {k.label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: "0.65rem 0.85rem",
                        position: "relative",
                      }}
                    >
                      <div
                        title={k.cardTitle}
                        style={{
                          fontSize: "0.72rem",
                          color: "var(--muted)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          paddingRight: "1.25rem",
                        }}
                      >
                        {k.cardTitle}
                      </div>
                      <div style={{ fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.15, marginTop: "0.15rem" }}>
                        {k.value}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
              title="Tiempo y total de tickets por proyecto"
              subtitle="Proyecto según plugin Fields (ticket o solicitante). Horas: tiempo registrado en tareas con begin/date en el rango (puede incluir tickets creados antes). Barra azul: total de tickets dados de alta en el rango, tengan o no tareas en ese periodo."
            />
            {indicatorsTimeTicketsErr && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.5rem" }}>Error: {indicatorsTimeTicketsErr}</p>
            )}
            {!indicatorsTimeTicketsLoading && indicatorsTimeTickets && !indicatorsTimeTickets.rows.length && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.75rem" }}>
                No hay datos: no hay proyectos con tiempo de tareas en el rango ni tickets creados en el rango (según
                los filtros actuales).
              </p>
            )}
            {indicatorsTimeTickets && indicatorsTimeTickets.rows.length > 0 && (
              <p style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.5rem" }}>
                Pulse la barra verde (horas) para ver tickets, asignados y tiempo invertido en tareas. Pulse la barra
                azul (tickets creados en el rango) para un gráfico de altas por semana o por mes usando el mismo
                rango de fechas de arriba.
              </p>
            )}
            {indicatorsTimeTickets && indicatorsTimeTickets.rows.length > 0 && (
              <div style={{ marginTop: "1rem", width: "100%", minHeight: 380 }}>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart
                    data={indicatorsTimeTickets.rows.map((r) => ({
                      ...r,
                      label: r.project_name,
                    }))}
                    margin={{ top: 12, right: 16, left: 4, bottom: 72 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      angle={-32}
                      textAnchor="end"
                      height={68}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      tickLine={{ stroke: CHART_AXIS }}
                      axisLine={{ stroke: CHART_AXIS }}
                      allowDecimals
                    />
                    <Tooltip
                      contentStyle={{
                        background: CHART_TOOLTIP_BG,
                        border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                        borderRadius: 8,
                        color: CHART_TEXT,
                      }}
                      labelStyle={{ color: CHART_TEXT }}
                      formatter={(value: number, name: string) => {
                        if (name === "Horas (tareas en rango)") return [`${value} h`, name];
                        if (name === "Tickets creados en rango") return [value, name];
                        return [value, name];
                      }}
                    />
                    <Legend wrapperStyle={{ color: CHART_TEXT, fontSize: "0.82rem" }} />
                    <Bar dataKey="horas" name="Horas (tareas en rango)" fill="#70ad47" radius={[5, 5, 0, 0]} maxBarSize={28}>
                      {indicatorsTimeTickets.rows.map((entry, index) => (
                        <Cell
                          key={`horas-${entry.project_id}-${index}`}
                          cursor="pointer"
                          fill="#70ad47"
                          onClick={() => void openIndicatorsHorasDetail(entry)}
                        />
                      ))}
                    </Bar>
                    <Bar dataKey="total_tickets" name="Tickets creados en rango" fill="#5b9bd5" radius={[5, 5, 0, 0]} maxBarSize={28}>
                      {indicatorsTimeTickets.rows.map((entry, index) => (
                        <Cell
                          key={`tickets-${entry.project_id}-${index}`}
                          cursor="pointer"
                          fill="#5b9bd5"
                          onClick={() => openIndicatorsVolumeModal(entry)}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
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
              title="Tickets por fuente de solicitud (categoría)"
              subtitle="Total de tickets dados de alta en el rango (fecha de apertura en GLPI), agrupados por el campo «Fuente de solicitud». Solo tickets vinculados a un proyecto, con el mismo criterio que el gráfico principal (plugin Fields o, si no aplica, itils_projects). Respeta tipo de proyecto y fechas de los filtros."
            />
            <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.78rem" }}>
              Pulse una barra para ver cuántos tickets de esa categoría corresponden a cada proyecto.
            </p>
            {indicatorsTicketsByRequestTypeErr && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                Error: {indicatorsTicketsByRequestTypeErr}
              </p>
            )}
            {indicatorsTimeTicketsLoading && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando…</p>
            )}
            {!indicatorsTimeTicketsLoading &&
              !indicatorsTicketsByRequestTypeErr &&
              indicatorsTicketsByRequestType &&
              !indicatorsTicketsByRequestType.rows.length && (
                <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.75rem" }}>
                  No hay tickets en el rango con proyecto asignado (según los filtros actuales).
                </p>
              )}
            {!indicatorsTimeTicketsLoading &&
              !indicatorsTicketsByRequestTypeErr &&
              indicatorsRequestTypeChartData.length > 0 && (
                <div style={{ width: "100%", marginTop: "0.75rem" }}>
                  <ResponsiveContainer
                    width="100%"
                    height={Math.min(720, Math.max(280, indicatorsRequestTypeChartData.length * 32))}
                  >
                    <BarChart
                      layout="vertical"
                      data={indicatorsRequestTypeChartData}
                      margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        stroke={CHART_AXIS}
                        tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={148}
                        stroke={CHART_AXIS}
                        tick={{ fill: CHART_TEXT, fontSize: 11 }}
                      />
                      <Tooltip
                        contentStyle={{
                          background: CHART_TOOLTIP_BG,
                          border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                          borderRadius: 8,
                          fontSize: "0.82rem",
                        }}
                        formatter={(value: number) => [value, "Tickets"]}
                        labelFormatter={(label, items) => {
                          const row = items?.[0]?.payload as { request_type_name?: string } | undefined;
                          return row?.request_type_name ?? String(label);
                        }}
                      />
                      <Bar dataKey="ticket_count" name="Tickets" radius={[0, 4, 4, 0]}>
                        {indicatorsRequestTypeChartData.map((entry, i) => (
                          <Cell
                            key={`rt-${entry.requesttypes_id}-${i}`}
                            fill={COLORS[i % COLORS.length]}
                            cursor="pointer"
                            onClick={() => openIndicatorsRtBreakdownModal(entry)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
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
              title="Evolución semanal: esfuerzo medio por ticket resuelto"
              subtitle="Por cada semana ISO del rango: se suma el tiempo registrado en tareas con fecha en esa semana y se cuenta cuántos tickets pasaron a resuelto/cerrado con fecha de solución en esa semana. El indicador es el cociente (horas totales ÷ resueltos); mide carga de trabajo media por cierre, no el lapso calendario desde la apertura. Mismo alcance de proyecto que el gráfico principal. En el eje vertical, los valores son horas decimales (p. ej. 1,813 h ≈ 1 h 49 min, no «1 h y 81 min»)."
            />
            {indicatorsWeeklyResolutionErr && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>
                Error: {indicatorsWeeklyResolutionErr}
              </p>
            )}
            {indicatorsTimeTicketsLoading && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando…</p>
            )}
            {!indicatorsTimeTicketsLoading &&
              !indicatorsWeeklyResolutionErr &&
              indicatorsWeeklyResolution &&
              !indicatorsWeeklyResolution.rows.length && (
                <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.75rem" }}>
                  No hay semanas con tiempo de tareas ni tickets resueltos en el rango (según filtros).
                </p>
              )}
            {!indicatorsTimeTicketsLoading &&
              !indicatorsWeeklyResolutionErr &&
              indicatorsWeeklyResolutionChartData.length > 0 && (
                <div style={{ width: "100%", marginTop: "1rem" }}>
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart
                      data={indicatorsWeeklyResolutionChartData}
                      margin={{ top: 12, right: 16, left: 4, bottom: 64 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                      <XAxis
                        dataKey="chartLabel"
                        tick={{ fill: CHART_TEXT, fontSize: 10 }}
                        tickLine={{ stroke: CHART_AXIS }}
                        axisLine={{ stroke: CHART_AXIS }}
                        angle={-30}
                        textAnchor="end"
                        height={58}
                        interval={0}
                      />
                      <YAxis
                        tick={{ fill: CHART_TEXT, fontSize: 11 }}
                        tickLine={{ stroke: CHART_AXIS }}
                        axisLine={{ stroke: CHART_AXIS }}
                        tickFormatter={(v) => `${v} h`}
                        width={48}
                      />
                      <Tooltip
                        contentStyle={{
                          background: CHART_TOOLTIP_BG,
                          border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                          borderRadius: 8,
                          fontSize: "0.82rem",
                          color: CHART_TEXT,
                        }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.[0]) return null;
                          const pl = payload[0].payload as (typeof indicatorsWeeklyResolutionChartData)[number];
                          return (
                            <div style={{ padding: "0.35rem 0.5rem" }}>
                              <div style={{ fontWeight: 650, marginBottom: 6 }}>{pl.period_label}</div>
                              <div>
                                Promedio:{" "}
                                {pl.avg_hours_per_resolved != null ? (
                                  <>
                                    <strong>{fmtDecimalHoursAsHm(pl.avg_hours_per_resolved)}</strong> por ticket
                                    resuelto
                                    <span
                                      style={{
                                        color: "var(--muted)",
                                        fontWeight: 400,
                                        display: "block",
                                        marginTop: 4,
                                        fontSize: "0.78rem",
                                      }}
                                    >
                                      En el gráfico, «h» son horas decimales ({pl.avg_hours_per_resolved} h = fracción
                                      de hora, no minutos tras la coma).
                                    </span>
                                  </>
                                ) : (
                                  "— (sin resueltos en la semana)"
                                )}
                              </div>
                              <div style={{ color: "var(--muted)", marginTop: 4, fontSize: "0.78rem" }}>
                                Resueltos en la semana: {pl.tickets_resolved} · Tiempo total en tareas:{" "}
                                {fmtActiontime(pl.actiontime_seconds)}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Legend wrapperStyle={{ color: CHART_TEXT, fontSize: "0.82rem" }} />
                      <Line
                        type="monotone"
                        dataKey="avgHours"
                        name="Horas medias por ticket resuelto"
                        stroke="#714b67"
                        strokeWidth={2}
                        dot={{ r: 4, fill: "#714b67" }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
          </section>
        </div>
      )}

      {page === "coordIndicators" && (
        <CoordIndicatorsPage
          indicatorsDateFrom={indicatorsDateFrom}
          indicatorsDateTo={indicatorsDateTo}
          setIndicatorsDateFrom={setIndicatorsDateFrom}
          setIndicatorsDateTo={setIndicatorsDateTo}
          indicatorsProjectTypeId={indicatorsProjectTypeId}
          setIndicatorsProjectTypeId={setIndicatorsProjectTypeId}
          projectTypes={projectTypes}
          projectTypesLoading={projectTypesLoading}
          projectTypesErr={projectTypesErr}
        />
      )}

      {page === "billingIndicators" && <BillingIndicatorsPage />}

      {page === "supportHours" && (
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
              subtitle="Fechas y tipo de proyecto. El tiempo se atribuye al mes del registro de la tarea (inicio o fecha de la tarea) si cae en el rango. La categoría es la fuente de solicitud del ticket (glpi_requesttypes), igual que en Indicadores."
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
                  value={indicatorsDateFrom}
                  onChange={(e) => setIndicatorsDateFrom(e.target.value)}
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
                  Hasta
                </label>
                <input
                  type="date"
                  value={indicatorsDateTo}
                  onChange={(e) => setIndicatorsDateTo(e.target.value)}
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
              <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                <label style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)", marginBottom: 4 }}>
                  Tipo de proyecto
                </label>
                {projectTypesLoading && (
                  <p style={{ color: "var(--muted)", fontSize: "0.86rem", margin: 0 }}>Cargando tipos…</p>
                )}
                {projectTypesErr && (
                  <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", margin: 0 }}>Error: {projectTypesErr}</p>
                )}
                {!projectTypesLoading && !projectTypesErr && (
                  <select
                    value={indicatorsProjectTypeId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setIndicatorsProjectTypeId(v === "" ? null : Number(v));
                    }}
                    disabled={!projectTypes.length}
                    style={{
                      width: "100%",
                      maxWidth: "480px",
                      padding: "0.55rem 0.65rem",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--surface2)",
                      color: "var(--text)",
                      fontSize: "0.9rem",
                    }}
                  >
                    {!projectTypes.length ? (
                      <option value="">No hay tipos de proyecto en GLPI</option>
                    ) : (
                      <>
                        <option value="">Todos los tipos</option>
                        {projectTypes.map((pt) => (
                          <option key={pt.id} value={pt.id}>
                            {pt.name}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void loadSupportHours()}
                  disabled={supportHoursLoading || !indicatorsDateFrom || !indicatorsDateTo}
                  style={{
                    background: "var(--accent)",
                    color: "var(--on-accent)",
                    border: "none",
                    borderRadius: 8,
                    padding: "0.5rem 0.95rem",
                    fontWeight: 700,
                    cursor: supportHoursLoading ? "wait" : "pointer",
                  }}
                >
                  {supportHoursLoading ? "Cargando…" : "Actualizar"}
                </button>
              </div>
            </div>
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
              title="Horas por proyecto, categoría y mes"
              subtitle="Cada fila agrega el tiempo de todas las tareas en ese cruce (no se listan tickets)."
            />
            {supportHoursErr && (
              <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Error: {supportHoursErr}</p>
            )}
            {supportHoursLoading && (
              <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.65rem" }}>Cargando…</p>
            )}
            {!supportHoursLoading && !supportHoursErr && supportHoursData && (
              <div style={{ marginTop: "0.9rem" }}>
                {supportHoursData.rows.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: "0.88rem", margin: 0 }}>
                    No hay tareas con tiempo en el rango (o sin proyecto resuelto con los filtros actuales).
                  </p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "0.88rem",
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                          <th style={{ padding: "0.5rem 0.65rem" }}>Proyecto</th>
                          <th style={{ padding: "0.5rem 0.65rem" }}>Categoría (fuente de solicitud)</th>
                          <th style={{ padding: "0.5rem 0.65rem", whiteSpace: "nowrap" }}>Mes</th>
                          <th style={{ padding: "0.5rem 0.65rem", textAlign: "right" }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supportHoursData.rows.map((r, i) => (
                          <tr key={`${r.project_id}-${r.requesttypes_id}-${r.period_key}-${i}`} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "0.55rem 0.65rem", fontWeight: 600 }}>{r.project_name}</td>
                            <td style={{ padding: "0.55rem 0.65rem" }}>{r.request_type_name}</td>
                            <td style={{ padding: "0.55rem 0.65rem", textTransform: "capitalize" }}>
                              {formatSupportHoursMonth(r.period_key)}
                            </td>
                            <td style={{ padding: "0.55rem 0.65rem", textAlign: "right", fontWeight: 600 }}>{fmtActiontime(r.actiontime_seconds)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: "2px solid var(--border)" }}>
                          <td colSpan={3} style={{ padding: "0.6rem 0.65rem", fontWeight: 700 }}>
                            Total en rango
                          </td>
                          <td style={{ padding: "0.6rem 0.65rem", textAlign: "right", fontWeight: 700 }}>
                            {fmtActiontime(supportHoursTotalSeconds)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
            {indicatorsVolumeOpen && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(33, 37, 41, 0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 61,
                }}
                onClick={() => {
                  setIndicatorsVolumeOpen(false);
                  setIndicatorsVolumeContext(null);
                  setIndicatorsVolumeData(null);
                  setIndicatorsVolumeErr(null);
                }}
              >
                <div
                  style={{
                    background: "var(--surface)",
                    borderRadius: "16px",
                    border: "1px solid var(--border)",
                    padding: "1.25rem 1.5rem",
                    maxWidth: "920px",
                    width: "100%",
                    maxHeight: "88vh",
                    overflowY: "auto",
                    boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                        Tickets creados — {indicatorsVolumeData?.project_name ?? indicatorsVolumeContext?.project_name ?? "…"}
                      </h2>
                      <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                        Conteo por fecha de alta en GLPI (creación del ticket), mismo vínculo proyecto–ticket que el
                        gráfico principal.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIndicatorsVolumeOpen(false);
                        setIndicatorsVolumeContext(null);
                        setIndicatorsVolumeData(null);
                        setIndicatorsVolumeErr(null);
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

                  <p style={{ margin: "1rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                    Periodo (mismas fechas que en la página):{" "}
                    <strong style={{ color: "var(--text)" }}>
                      {indicatorsDateFrom && indicatorsDateTo
                        ? `${new Date(`${indicatorsDateFrom}T12:00:00`).toLocaleDateString("es-ES", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })} — ${new Date(`${indicatorsDateTo}T12:00:00`).toLocaleDateString("es-ES", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}`
                        : "—"}
                    </strong>
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: "0.75rem",
                      marginTop: "0.85rem",
                      alignItems: "end",
                    }}
                  >
                    <div>
                      <label style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginBottom: 4 }}>
                        Agrupar
                      </label>
                      <select
                        value={indicatorsVolumeGranularity}
                        onChange={(e) => setIndicatorsVolumeGranularity(e.target.value === "month" ? "month" : "week")}
                        style={{
                          width: "100%",
                          padding: "0.45rem",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface2)",
                          color: "var(--text)",
                        }}
                      >
                        <option value="week">Por semana (ISO)</option>
                        <option value="month">Por mes</option>
                      </select>
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => void refreshIndicatorsVolume()}
                        disabled={
                          indicatorsVolumeLoading ||
                          !indicatorsVolumeContext ||
                          !indicatorsDateFrom ||
                          !indicatorsDateTo
                        }
                        style={{
                          width: "100%",
                          background: "var(--accent)",
                          color: "var(--on-accent)",
                          border: "none",
                          borderRadius: 8,
                          padding: "0.5rem 0.75rem",
                          fontWeight: 700,
                          cursor: indicatorsVolumeLoading ? "wait" : "pointer",
                        }}
                      >
                        {indicatorsVolumeLoading ? "Cargando…" : "Actualizar gráfico"}
                      </button>
                    </div>
                  </div>

                  {indicatorsVolumeErr && (
                    <p style={{ color: "var(--danger-text)", fontSize: "0.86rem", marginTop: "0.75rem" }}>
                      Error: {indicatorsVolumeErr}
                    </p>
                  )}

                  {indicatorsVolumeLoading && (
                    <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "0.85rem" }}>Cargando datos…</p>
                  )}

                  {indicatorsVolumeData && !indicatorsVolumeLoading && indicatorsVolumeData.rows.length === 0 && (
                    <p style={{ color: "var(--muted)", fontSize: "0.86rem", marginTop: "1rem" }}>
                      No hay tickets creados en ese rango para este proyecto.
                    </p>
                  )}

                  {indicatorsVolumeData && indicatorsVolumeData.rows.length > 0 && (
                    <div style={{ marginTop: "1.1rem", width: "100%", minHeight: 300 }}>
                      <ResponsiveContainer width="100%" height={340}>
                        <BarChart
                          data={indicatorsVolumeData.rows.map((r) => ({
                            ...r,
                            label: r.period_label,
                          }))}
                          margin={{ top: 8, right: 12, left: 4, bottom: 56 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: CHART_TEXT, fontSize: 11 }}
                            tickLine={{ stroke: CHART_AXIS }}
                            axisLine={{ stroke: CHART_AXIS }}
                            angle={-28}
                            textAnchor="end"
                            height={52}
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
                            formatter={(v: number) => [v, "Tickets creados"]}
                          />
                          <Bar dataKey="ticket_count" name="Tickets creados" fill="#5b9bd5" radius={[6, 6, 0, 0]} maxBarSize={48} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            )}

            {indicatorsDetailOpen && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(33, 37, 41, 0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 60,
                }}
                onClick={() => {
                  setIndicatorsDetailOpen(false);
                  setIndicatorsDetailContext(null);
                  setIndicatorsDetail(null);
                  setIndicatorsDetailErr(null);
                }}
              >
                <div
                  style={{
                    background: "var(--surface)",
                    borderRadius: "16px",
                    border: "1px solid var(--border)",
                    padding: "1.25rem 1.5rem",
                    maxWidth: "960px",
                    width: "100%",
                    maxHeight: "82vh",
                    overflowY: "auto",
                    boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                        Tiempo por ticket —{" "}
                        {indicatorsDetail?.project_name ?? indicatorsDetailContext?.project_name ?? "…"}
                      </h2>
                      <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                        Rango: {indicatorsDetail?.date_from ?? indicatorsDateFrom} →{" "}
                        {indicatorsDetail?.date_to ?? indicatorsDateTo}
                        {indicatorsDetail && (
                          <>
                            {" "}
                            · {indicatorsDetail.rows.length} ticket(s)
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIndicatorsDetailOpen(false);
                        setIndicatorsDetailContext(null);
                        setIndicatorsDetail(null);
                        setIndicatorsDetailErr(null);
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

                  {indicatorsDetailLoading && (
                    <p style={{ marginTop: "1rem", color: "var(--muted)" }}>Cargando tickets…</p>
                  )}
                  {indicatorsDetailErr && (
                    <p style={{ color: "var(--danger-text)", marginTop: "0.85rem" }}>Error: {indicatorsDetailErr}</p>
                  )}
                  {indicatorsDetail && !indicatorsDetailLoading && (
                    <div style={{ marginTop: "0.9rem", overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                      {indicatorsDetail.rows.length === 0 ? (
                        <p style={{ margin: "0.85rem", color: "var(--muted)", fontSize: "0.86rem" }}>
                          No hay tareas con tiempo registrado en este rango para este proyecto.
                        </p>
                      ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                          <thead>
                            <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                              <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Ticket</th>
                              <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Título</th>
                              <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>
                                Asignados
                              </th>
                              <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Tiempo en rango</th>
                            </tr>
                          </thead>
                          <tbody>
                            {indicatorsDetail.rows.map((r, i) => (
                              <tr
                                key={`${r.ticket_id}-${i}`}
                                style={{
                                  borderTop: "1px solid var(--border)",
                                  background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                                }}
                              >
                                <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{r.ticket_id}</td>
                                <td style={{ padding: "0.55rem 0.85rem" }}>{r.titulo?.trim() ? r.titulo : "—"}</td>
                                <td style={{ padding: "0.55rem 0.85rem", fontSize: "0.82rem" }}>
                                  {r.assignees?.trim() ? r.assignees : "—"}
                                </td>
                                <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{fmtActiontime(r.actiontime_seconds)}</td>
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
          {indicatorsRtBreakdownOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(33, 37, 41, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 62,
              }}
              onClick={() => {
                setIndicatorsRtBreakdownOpen(false);
                setIndicatorsRtBreakdownContext(null);
                setIndicatorsRtBreakdownData(null);
                setIndicatorsRtBreakdownErr(null);
                setIndicatorsRtTicketListOpen(false);
                setIndicatorsRtTicketListData(null);
                setIndicatorsRtTicketListErr(null);
              }}
            >
              <div
                style={{
                  background: "var(--surface)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  padding: "1.25rem 1.5rem",
                  maxWidth: "920px",
                  width: "100%",
                  maxHeight: "88vh",
                  overflowY: "auto",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                      Por proyecto —{" "}
                      {indicatorsRtBreakdownData?.request_type_name ??
                        indicatorsRtBreakdownContext?.request_type_name ??
                        "…"}
                    </h2>
                    <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                      Fuente de solicitud y tipo de proyecto: mismos filtros que arriba.{" "}
                      <strong>Horas (verde):</strong> tiempo registrado en tareas cuyo inicio o fecha cae entre{" "}
                      {indicatorsDateFrom} y {indicatorsDateTo}, solo tickets de esta categoría (puede incluir tickets
                      dados de alta fuera del rango).{" "}
                      <strong>Tickets (azul):</strong> altas en GLPI en el rango (fecha de creación del ticket).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIndicatorsRtBreakdownOpen(false);
                      setIndicatorsRtBreakdownContext(null);
                      setIndicatorsRtBreakdownData(null);
                      setIndicatorsRtBreakdownErr(null);
                      setIndicatorsRtTicketListOpen(false);
                      setIndicatorsRtTicketListData(null);
                      setIndicatorsRtTicketListErr(null);
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

                {!indicatorsRtBreakdownLoading &&
                  !indicatorsRtBreakdownErr &&
                  indicatorsRtBreakdownData &&
                  indicatorsRtBreakdownData.rows.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "0.85rem",
                        marginTop: "1rem",
                      }}
                    >
                      <div
                        style={{
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderLeft: "4px solid #5b9bd5",
                          borderRadius: 10,
                          padding: "0.75rem 1rem",
                        }}
                      >
                        <div style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 600 }}>
                          Total tickets (creados en rango)
                        </div>
                        <div style={{ fontSize: "1.55rem", fontWeight: 800, marginTop: "0.2rem", lineHeight: 1.15 }}>
                          {indicatorsRtBreakdownTotals.totalTickets}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.35rem" }}>
                          Suma de todos los proyectos · misma categoría y filtros
                        </div>
                      </div>
                      <div
                        style={{
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderLeft: "4px solid #70ad47",
                          borderRadius: 10,
                          padding: "0.75rem 1rem",
                        }}
                      >
                        <div style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 600 }}>
                          Total horas (tareas en rango)
                        </div>
                        <div style={{ fontSize: "1.55rem", fontWeight: 800, marginTop: "0.2rem", lineHeight: 1.15 }}>
                          {indicatorsRtBreakdownTotals.totalSeconds <= 0
                            ? "0 h"
                            : fmtActiontime(indicatorsRtBreakdownTotals.totalSeconds)}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.35rem" }}>
                          Tiempo registrado en el periodo, agregado entre proyectos
                        </div>
                      </div>
                    </div>
                  )}

                {indicatorsRtBreakdownLoading && (
                  <p style={{ marginTop: "1rem", color: "var(--muted)" }}>Cargando desglose…</p>
                )}
                {indicatorsRtBreakdownErr && (
                  <p style={{ color: "var(--danger-text)", marginTop: "0.85rem" }}>Error: {indicatorsRtBreakdownErr}</p>
                )}
                {!indicatorsRtBreakdownLoading &&
                  !indicatorsRtBreakdownErr &&
                  indicatorsRtBreakdownData &&
                  !indicatorsRtBreakdownData.rows.length && (
                    <p style={{ color: "var(--muted)", marginTop: "0.85rem" }}>
                      No hay datos: ningún ticket de esta categoría con proyecto en el rango (ni altas ni tareas con tiempo
                      registrado en las fechas indicadas).
                    </p>
                  )}
                {!indicatorsRtBreakdownLoading &&
                  !indicatorsRtBreakdownErr &&
                  indicatorsRtBreakdownChartData.length > 0 && (
                    <div style={{ width: "100%", marginTop: "1rem" }}>
                      <p style={{ margin: "0 0 0.5rem", color: "var(--muted)", fontSize: "0.78rem" }}>
                        Misma lógica temporal que el gráfico principal: horas según tareas en el periodo; tickets según
                        fecha de creación del ticket. Pulse la barra <strong>azul</strong> (tickets) si hay conteo &gt; 0
                        para ver el listado de esos tickets.
                      </p>
                      <ResponsiveContainer
                        width="100%"
                        height={Math.min(720, Math.max(280, indicatorsRtBreakdownChartData.length * 36))}
                      >
                        <BarChart
                          layout="vertical"
                          data={indicatorsRtBreakdownChartData}
                          margin={{ top: 8, right: 28, left: 8, bottom: 8 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                          <XAxis
                            type="number"
                            allowDecimals
                            stroke={CHART_AXIS}
                            tick={{ fill: CHART_TEXT, fontSize: 11 }}
                          />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={132}
                            stroke={CHART_AXIS}
                            tick={{ fill: CHART_TEXT, fontSize: 11 }}
                          />
                          <Tooltip
                            contentStyle={{
                              background: CHART_TOOLTIP_BG,
                              border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                              borderRadius: 8,
                              fontSize: "0.82rem",
                              color: CHART_TEXT,
                            }}
                            labelStyle={{ color: CHART_TEXT }}
                            formatter={(value: number, name: string) => {
                              if (name === "Horas (tareas en rango)") return [`${value} h`, name];
                              if (name === "Tickets creados en rango") return [value, name];
                              return [value, name];
                            }}
                            labelFormatter={(label, items) => {
                              const row = items?.[0]?.payload as { project_name?: string } | undefined;
                              return row?.project_name ?? String(label);
                            }}
                          />
                          <Legend wrapperStyle={{ color: CHART_TEXT, fontSize: "0.82rem" }} />
                          <Bar
                            dataKey="horas"
                            name="Horas (tareas en rango)"
                            fill="#70ad47"
                            radius={[0, 4, 4, 0]}
                            maxBarSize={22}
                          />
                          <Bar
                            dataKey="ticket_count"
                            name="Tickets creados en rango"
                            fill="#5b9bd5"
                            radius={[0, 4, 4, 0]}
                            maxBarSize={22}
                          >
                            {indicatorsRtBreakdownChartData.map((row, i) => (
                              <Cell
                                key={`rt-tickets-${row.project_id}-${i}`}
                                fill="#5b9bd5"
                                cursor={row.ticket_count > 0 ? "pointer" : "default"}
                                onClick={() => openIndicatorsRtTicketListFromBreakdownBar(row)}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
              </div>
            </div>
          )}

          {indicatorsRtTicketListOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(33, 37, 41, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 63,
              }}
              onClick={() => {
                setIndicatorsRtTicketListOpen(false);
                setIndicatorsRtTicketListData(null);
                setIndicatorsRtTicketListErr(null);
              }}
            >
              <div
                style={{
                  background: "var(--surface)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  padding: "1.25rem 1.5rem",
                  maxWidth: "960px",
                  width: "100%",
                  maxHeight: "85vh",
                  overflowY: "auto",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
                      Tickets del conteo — {indicatorsRtTicketListData?.project_name ?? "…"}
                    </h2>
                    <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                      Fuente: {indicatorsRtTicketListData?.request_type_name ?? "…"} · Alta del ticket en{" "}
                      {indicatorsRtTicketListData?.date_from ?? indicatorsDateFrom} →{" "}
                      {indicatorsRtTicketListData?.date_to ?? indicatorsDateTo}. La columna de tiempo suma las tareas
                      registradas en ese mismo rango de fechas.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIndicatorsRtTicketListOpen(false);
                      setIndicatorsRtTicketListData(null);
                      setIndicatorsRtTicketListErr(null);
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

                {indicatorsRtTicketListLoading && (
                  <p style={{ marginTop: "1rem", color: "var(--muted)" }}>Cargando tickets…</p>
                )}
                {indicatorsRtTicketListErr && (
                  <p style={{ color: "var(--danger-text)", marginTop: "0.85rem" }}>Error: {indicatorsRtTicketListErr}</p>
                )}
                {indicatorsRtTicketListData && !indicatorsRtTicketListLoading && (
                  <div style={{ marginTop: "0.9rem", overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                    {indicatorsRtTicketListData.rows.length === 0 ? (
                      <p style={{ margin: "0.85rem", color: "var(--muted)", fontSize: "0.86rem" }}>
                        No hay tickets que coincidan con este conteo.
                      </p>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                        <thead>
                          <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                            <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>N.º ticket</th>
                            <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Título</th>
                            <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>Asignados</th>
                            <th style={{ padding: "0.65rem 0.85rem", color: "var(--muted)", fontWeight: 650 }}>
                              Tiempo en rango
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {indicatorsRtTicketListData.rows.map((r, i) => (
                            <tr
                              key={`${r.ticket_id}-${i}`}
                              style={{
                                borderTop: "1px solid var(--border)",
                                background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                              }}
                            >
                              <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>{r.ticket_id}</td>
                              <td style={{ padding: "0.55rem 0.85rem" }}>{r.titulo?.trim() ? r.titulo : "—"}</td>
                              <td style={{ padding: "0.55rem 0.85rem", fontSize: "0.82rem" }}>
                                {r.assignees?.trim() ? r.assignees : "—"}
                              </td>
                              <td style={{ padding: "0.55rem 0.85rem", fontWeight: 650 }}>
                                {fmtActiontime(r.actiontime_seconds)}
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
        </main>
      </div>
    </div>
  );
}
