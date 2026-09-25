import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  fetchTicketTime,
  fetchProjectTypes,
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
  type TicketTimeBreakdown,
  type ProjectType,
  type SupportHoursByProjectPayload,
} from "./api";
import {
  CoordIndicatorsPage,
  exportSupportReportDocx,
  SupportReportPrintPreview,
} from "./modules/soporte";
import { BillingIndicatorsPage } from "./billing";
import { CostCentersPage } from "./modules/soporte/costCenters";
import { SystemSettingsPage } from "./modules/sistema";
import type { SessionUser } from "./auth/session";

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
  | "coordIndicators"
  | "supportHours"
  | "billingIndicators"
  | "costCenters"
  | "systemSettings";

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

const SUPPORT_MENU_PAGES: readonly Page[] = [
  "home",
  "reports",
  "analysis",
  "coordIndicators",
  "supportHours",
  "billingIndicators",
  "costCenters",
];

function isSupportMenuPage(p: Page): boolean {
  return SUPPORT_MENU_PAGES.includes(p);
}

export default function App({
  user,
  authEnabled,
  onLogout,
}: {
  user: SessionUser;
  authEnabled: boolean;
  onLogout: () => void;
}) {
  const [page, setPage] = useState<Page>("home");
  const [menuOpen, setMenuOpen] = useState({
    soporte: true,
    desarrollo: false,
    customizaciones: false,
    configuraciones: false,
  });
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
  /** Tipo de proyecto GLPI para Coordinación y Horas Soporte (desplegable compartido). */
  const [indicatorsProjectTypeId, setIndicatorsProjectTypeId] = useState<number | null>(null);
  /** Tipo de proyecto para el Tablero (Inicio) — filtro independiente del de Coordinación. */
  const [homeProjectTypeId, setHomeProjectTypeId] = useState<number | null>(null);
  const homeProjectTypeIdRef = useRef<number | null>(null);
  homeProjectTypeIdRef.current = homeProjectTypeId;
  const [indicatorsDateFrom, setIndicatorsDateFrom] = useState<string>("");
  const [indicatorsDateTo, setIndicatorsDateTo] = useState<string>("");
  const [supportHoursData, setSupportHoursData] = useState<SupportHoursByProjectPayload | null>(null);
  const [supportHoursLoading, setSupportHoursLoading] = useState(false);
  const [supportHoursErr, setSupportHoursErr] = useState<string | null>(null);
  const [unassignedSortCols, setUnassignedSortCols] = useState<{ col: string; dir: "asc" | "desc" }[]>([{ col: "hours_open", dir: "desc" }]);
  const [unassignedTextFilter, setUnassignedTextFilter] = useState<string>("");
  const [unassignedPriorityFilters, setUnassignedPriorityFilters] = useState<string[]>([]);
  const load = useCallback(async (ptId?: number | null) => {
    setLoading(true);
    setErr(null);
    try {
      setData(await fetchDashboard(ptId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (page === "home") void load(homeProjectTypeId);
  }, [homeProjectTypeId, page, load]);

  useEffect(() => {
    if (isSupportMenuPage(page)) {
      setMenuOpen((prev) => ({ ...prev, soporte: true }));
    } else if (page === "systemSettings") {
      setMenuOpen((prev) => ({ ...prev, configuraciones: true }));
    }
  }, [page]);

  const toggleMenuSection = useCallback((key: keyof typeof menuOpen) => {
    setMenuOpen((prev) => ({ ...prev, [key]: !prev[key] }));
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
    load(homeProjectTypeIdRef.current);
    const t = setInterval(() => load(homeProjectTypeIdRef.current), 120_000);
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
    if (page !== "supportHours" && page !== "coordIndicators" && page !== "home") return;
    if (projectTypes.length > 0) return; // already loaded
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
  }, [page, projectTypes.length]);

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

  useEffect(() => {
    if (page !== "supportHours") return;
    if (!indicatorsDateFrom || !indicatorsDateTo) return;
    void loadSupportHours();
  }, [page, indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo, loadSupportHours]);

  const supportHoursTotalSeconds = useMemo(
    () => (supportHoursData?.rows ?? []).reduce((a, r) => a + (r.actiontime_seconds ?? 0), 0),
    [supportHoursData],
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
      case "coordIndicators":
        return {
          title: "Indicadores coordinación",
          subtitle:
            "Totales de tickets creados, resueltos, abiertos y fuera de SLA (TTR); mismos filtros de fechas y tipo de proyecto. Pulse cada cifra para el listado con proyecto, solicitante y tiempo en el rango.",
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
      case "costCenters":
        return {
          title: "Variables y Centros de costo",
          subtitle:
            "KPI de variables (Datos / Cliente-Técnico / Técnico Global) y distribución de horas por proyecto y centro de costo; filtros de fecha compartidos.",
        };
      case "systemSettings":
        return {
          title: "Configuraciones del sistema",
          subtitle:
            "Envío automático del informe de soporte por proyecto a los solicitantes de los tickets, y servidor de correo SMTP.",
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
            onClick={() => load(homeProjectTypeIdRef.current)}
            disabled={loading}
          >
            {loading ? "Actualizando…" : "Actualizar datos"}
          </button>
          {authEnabled && (
            <>
              <div className="odoo-navbar-user" title={user.profiles.join(", ")}>
                {user.full_name}
                <div style={{ opacity: 0.8, fontSize: "0.7rem" }}>{user.role === "admin" ? "Administrador" : user.login}</div>
              </div>
              <button type="button" className="odoo-btn odoo-btn-navbar" onClick={onLogout}>
                Cerrar sesión
              </button>
            </>
          )}
        </div>
      </header>
      <div className="odoo-body">
        <aside className="odoo-sidebar">
          <div className="odoo-sidebar-label">Menú</div>
          <nav className="odoo-sidebar-nav" aria-label="Navegación principal">
            <div className="odoo-nav-group">
              <button
                type="button"
                className={`odoo-nav-group-toggle${isSupportMenuPage(page) ? " odoo-nav-group-has-active" : ""}`}
                aria-expanded={menuOpen.soporte}
                onClick={() => toggleMenuSection("soporte")}
              >
                <span>Soporte</span>
                <span className="odoo-nav-chevron" aria-hidden>
                  ▸
                </span>
              </button>
              {menuOpen.soporte && (
                <div className="odoo-nav-sub">
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
                  <button
                    type="button"
                    className={page === "costCenters" ? "odoo-nav-active" : undefined}
                    onClick={() => setPage("costCenters")}
                  >
                    Variables y Centros de costo
                  </button>
                </div>
              )}
            </div>
            <div className="odoo-nav-group">
              <button
                type="button"
                className="odoo-nav-group-toggle"
                aria-expanded={menuOpen.desarrollo}
                onClick={() => toggleMenuSection("desarrollo")}
              >
                <span>Desarrollo</span>
                <span className="odoo-nav-chevron" aria-hidden>
                  ▸
                </span>
              </button>
              {menuOpen.desarrollo && (
                <div className="odoo-nav-sub">
                  <div className="odoo-nav-placeholder">Sin entradas por añadir.</div>
                </div>
              )}
            </div>
            <div className="odoo-nav-group">
              <button
                type="button"
                className="odoo-nav-group-toggle"
                aria-expanded={menuOpen.customizaciones}
                onClick={() => toggleMenuSection("customizaciones")}
              >
                <span>Customizaciones</span>
                <span className="odoo-nav-chevron" aria-hidden>
                  ▸
                </span>
              </button>
              {menuOpen.customizaciones && (
                <div className="odoo-nav-sub">
                  <div className="odoo-nav-placeholder">Sin entradas por añadir.</div>
                </div>
              )}
            </div>
            {user.role === "admin" && (
              <div className="odoo-nav-group">
                <button
                  type="button"
                  className={`odoo-nav-group-toggle${page === "systemSettings" ? " odoo-nav-group-has-active" : ""}`}
                  aria-expanded={menuOpen.configuraciones}
                  onClick={() => toggleMenuSection("configuraciones")}
                >
                  <span>Configuraciones del sistema</span>
                  <span className="odoo-nav-chevron" aria-hidden>
                    ▸
                  </span>
                </button>
                {menuOpen.configuraciones && (
                  <div className="odoo-nav-sub">
                    <button
                      type="button"
                      className={page === "systemSettings" ? "odoo-nav-active" : undefined}
                      onClick={() => setPage("systemSettings")}
                    >
                      Correo e informes automáticos
                    </button>
                  </div>
                )}
              </div>
            )}
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
          {/* Barra de filtros del Tablero */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "1rem",
              flexWrap: "wrap",
              marginTop: "-0.5rem",
              marginBottom: "1.5rem",
              padding: "0.85rem 1rem",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label
                htmlFor="home-project-type"
                style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}
              >
                Tipo de proyecto
              </label>
              <select
                id="home-project-type"
                value={homeProjectTypeId ?? ""}
                onChange={(e) => {
                  const val = e.target.value === "" ? null : Number(e.target.value);
                  setHomeProjectTypeId(val);
                  void load(val);
                }}
                style={{
                  padding: "0.45rem 2rem 0.45rem 0.7rem",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  minWidth: "240px",
                }}
              >
                <option value="">Todos los tipos</option>
                {projectTypes.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.name}
                  </option>
                ))}
              </select>
            </div>
            {projectTypesLoading && (
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Cargando tipos…</span>
            )}
            {projectTypesErr && (
              <span style={{ fontSize: "0.8rem", color: "var(--danger-text)" }}>Error tipos: {projectTypesErr}</span>
            )}
            {homeProjectTypeId != null && (
              <button
                type="button"
                onClick={() => { setHomeProjectTypeId(null); void load(null); }}
                style={{
                  padding: "0.45rem 0.85rem",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--muted)",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                Todos los tipos ×
              </button>
            )}
          </div>

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

          {/* Cola de tickets abiertos */}
          <div style={{ marginBottom: "2rem" }}>
            <SectionTitle
              title="Cola de tickets activos (nuevo, en curso, planificado, en espera)"
              subtitle="Estados operativos · ordenar por columna (clic acumula criterios) · filtros acumulables"
            />
            {(() => {
              const HOURS_THRESHOLD = 4;

              // ── Prioridades disponibles ──
              const availablePriorities = Array.from(
                new Set(data.unassigned_top.map((r) => r.priority_label).filter(Boolean))
              );
              const PRIORITY_ORDER: Record<string, number> = {
                "Muy alta": 5, "Alta": 4, "Media": 3, "Baja": 2, "Muy baja": 1,
              };

              const togglePriority = (p: string) =>
                setUnassignedPriorityFilters((prev) =>
                  prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
                );

              // ── Proyectos disponibles ──
              const availableProjects = Array.from(
                new Set(data.unassigned_top.map((r) => r.project_name).filter((v): v is string => !!v))
              ).sort();

              // ── Filtrado ──
              const textLower = unassignedTextFilter.toLowerCase().trim();
              const filteredRows = data.unassigned_top.filter((r) => {
                if (unassignedPriorityFilters.length > 0 && !unassignedPriorityFilters.includes(r.priority_label))
                  return false;
                if (textLower) {
                  const haystack = [
                    String(r.id),
                    r.name ?? "",
                    r.project_name ?? "",
                    r.assignees ?? "",
                    r.priority_label,
                  ]
                    .join(" ")
                    .toLowerCase();
                  if (!haystack.includes(textLower)) return false;
                }
                return true;
              });

              // ── Ordenación multi-columna ──
              const sortableRows = [...filteredRows].sort((a, b) => {
                for (const { col, dir } of unassignedSortCols) {
                  const dirMult = dir === "asc" ? 1 : -1;
                  const va = (a as Record<string, unknown>)[col] ?? -Infinity;
                  const vb = (b as Record<string, unknown>)[col] ?? -Infinity;
                  let cmp = 0;
                  if (typeof va === "number" && typeof vb === "number") {
                    cmp = (va - vb) * dirMult;
                  } else {
                    cmp = String(va).localeCompare(String(vb)) * dirMult;
                  }
                  if (cmp !== 0) return cmp;
                }
                return 0;
              });

              // Clic en cabecera: si es nueva columna la prepende; si es la primaria alterna dir; si es secundaria la promueve
              const toggleSort = (col: string) =>
                setUnassignedSortCols((prev) => {
                  const idx = prev.findIndex((s) => s.col === col);
                  if (idx === -1) return [{ col, dir: "desc" }, ...prev];
                  if (idx === 0) return [{ col, dir: prev[0].dir === "asc" ? "desc" : "asc" }, ...prev.slice(1)];
                  return [prev[idx], ...prev.filter((_, i) => i !== idx)];
                });

              const sortIndicator = (col: string) => {
                const idx = unassignedSortCols.findIndex((s) => s.col === col);
                if (idx === -1) return " ⇅";
                const arrow = unassignedSortCols[idx].dir === "asc" ? "▲" : "▼";
                return unassignedSortCols.length > 1 ? ` ${arrow}${idx + 1}` : ` ${arrow}`;
              };

              const thStyle = (col: string): CSSProperties => ({
                padding: "0.55rem 0.75rem",
                color: "var(--muted)",
                fontWeight: 650,
                textAlign: "left",
                whiteSpace: "nowrap",
                cursor: "pointer",
                userSelect: "none",
                background: unassignedSortCols.some((s) => s.col === col) ? "rgba(113,75,103,0.08)" : undefined,
              });

              const hoursCell = (val: number | null | undefined): CSSProperties => ({
                padding: "0.5rem 0.75rem",
                fontWeight: val != null && val > HOURS_THRESHOLD ? 700 : undefined,
                color: val != null && val > HOURS_THRESHOLD ? "var(--danger-text, #dc3545)" : undefined,
              });

              const priorityChipStyle = (label: string, active: boolean) => {
                const accent = label === "Muy alta" || label === "Alta" ? "#dc3545" : label === "Media" ? "#f57c00" : "#555";
                return {
                  padding: "0.22rem 0.65rem",
                  borderRadius: 999,
                  border: `1px solid ${active ? accent : "var(--border)"}`,
                  background: active ? `${accent}18` : "transparent",
                  color: active ? accent : "var(--muted)",
                  fontSize: "0.78rem",
                  fontWeight: active ? 700 : 400,
                  cursor: "pointer",
                  userSelect: "none" as const,
                };
              };

              const hasFilters = unassignedTextFilter || unassignedPriorityFilters.length > 0;
              const hasMultiSort = unassignedSortCols.length > 1;

              return (
                <>
                  {/* Barra de filtros */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.6rem",
                      alignItems: "center",
                      marginBottom: "0.75rem",
                      padding: "0.65rem 0.85rem",
                      background: "var(--surface2)",
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Buscar por ID, proyecto, título, asignado…"
                      value={unassignedTextFilter}
                      onChange={(e) => setUnassignedTextFilter(e.target.value)}
                      style={{
                        flex: "1 1 180px",
                        minWidth: "150px",
                        padding: "0.3rem 0.65rem",
                        border: "1px solid var(--border)",
                        borderRadius: 999,
                        background: "var(--surface)",
                        color: "var(--text)",
                        fontSize: "0.83rem",
                        outline: "none",
                      }}
                    />
                    <span style={{ fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                      Prioridad:
                    </span>
                    {availablePriorities
                      .sort((a, b) => (PRIORITY_ORDER[b] ?? 0) - (PRIORITY_ORDER[a] ?? 0))
                      .map((p) => (
                        <button key={p} type="button" style={priorityChipStyle(p, unassignedPriorityFilters.includes(p))} onClick={() => togglePriority(p)}>
                          {p}
                        </button>
                      ))}
                    {availableProjects.length > 0 && (
                      <>
                        <span style={{ fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "nowrap" }}>Proyecto:</span>
                        {availableProjects.map((proj) => (
                          <button
                            key={proj}
                            type="button"
                            style={priorityChipStyle(proj, unassignedTextFilter === proj)}
                            onClick={() => setUnassignedTextFilter((prev) => (prev === proj ? "" : proj))}
                          >
                            {proj}
                          </button>
                        ))}
                      </>
                    )}
                    {(hasFilters || hasMultiSort) && (
                      <button
                        type="button"
                        onClick={() => {
                          setUnassignedTextFilter("");
                          setUnassignedPriorityFilters([]);
                          setUnassignedSortCols([{ col: "hours_open", dir: "desc" }]);
                        }}
                        style={{
                          marginLeft: "auto",
                          padding: "0.22rem 0.65rem",
                          borderRadius: 999,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--muted)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                        }}
                      >
                        Limpiar todo ×
                      </button>
                    )}
                    <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                      {sortableRows.length} / {data.unassigned_top.length} tickets
                    </span>
                  </div>

                  {/* Tabla */}
                  <div style={{ overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                      <thead>
                        <tr style={{ background: "var(--surface2)" }}>
                          <th style={thStyle("id")} onClick={() => toggleSort("id")}>ID{sortIndicator("id")}</th>
                          <th style={thStyle("project_name")} onClick={() => toggleSort("project_name")}>Proyecto{sortIndicator("project_name")}</th>
                          <th style={{ ...thStyle("name"), minWidth: "180px" }} onClick={() => toggleSort("name")}>Título{sortIndicator("name")}</th>
                          <th style={thStyle("priority")} onClick={() => toggleSort("priority")}>Prioridad{sortIndicator("priority")}</th>
                          <th style={thStyle("fecha_apertura")} onClick={() => toggleSort("fecha_apertura")}>Fecha apertura{sortIndicator("fecha_apertura")}</th>
                          <th style={thStyle("hours_open")} onClick={() => toggleSort("hours_open")}>Horas abierto{sortIndicator("hours_open")}</th>
                          <th style={thStyle("hours_since_last_task")} onClick={() => toggleSort("hours_since_last_task")}>H. última gestión{sortIndicator("hours_since_last_task")}</th>
                          <th style={thStyle("hours_since_last_client_comment")} onClick={() => toggleSort("hours_since_last_client_comment")}>H. últ. comentario cliente{sortIndicator("hours_since_last_client_comment")}</th>
                          <th style={thStyle("hours_since_last_assignee_comment")} onClick={() => toggleSort("hours_since_last_assignee_comment")}>H. últ. comentario asignado{sortIndicator("hours_since_last_assignee_comment")}</th>
                          <th style={thStyle("actiontime_total")} onClick={() => toggleSort("actiontime_total")}>Tiempo gestión{sortIndicator("actiontime_total")}</th>
                          <th style={{ ...thStyle("assignees"), cursor: "default", userSelect: "none" }}>Asignado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortableRows.length === 0 && (
                          <tr>
                            <td colSpan={11} style={{ padding: "1rem", color: "var(--muted)", textAlign: "center" }}>
                              {hasFilters ? "Sin resultados para los filtros aplicados." : "No hay tickets abiertos."}
                            </td>
                          </tr>
                        )}
                        {sortableRows.map((r, i) => (
                          <tr
                            key={r.id}
                            style={{
                              borderTop: "1px solid var(--border)",
                              background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                            }}
                          >
                            <td style={{ padding: "0.5rem 0.75rem" }}>{r.id}</td>
                            <td style={{ padding: "0.5rem 0.75rem", color: "var(--muted)" }}>{r.project_name ?? "—"}</td>
                            <td style={{ padding: "0.5rem 0.75rem" }}>{r.name ?? "—"}</td>
                            <td style={{ padding: "0.5rem 0.75rem" }}>{r.priority_label}</td>
                            <td style={{ padding: "0.5rem 0.75rem", color: "var(--muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                              {r.fecha_apertura ?? "—"}
                            </td>
                            <td style={hoursCell(r.hours_open)}>{fmtHours(r.hours_open)}</td>
                            <td style={hoursCell(r.hours_since_last_task)}>
                              {r.hours_since_last_task != null ? fmtHours(r.hours_since_last_task) : "—"}
                            </td>
                            <td style={hoursCell(r.hours_since_last_client_comment)}>
                              {r.hours_since_last_client_comment != null ? fmtHours(r.hours_since_last_client_comment) : "—"}
                            </td>
                            <td style={hoursCell(r.hours_since_last_assignee_comment)}>
                              {r.hours_since_last_assignee_comment != null ? fmtHours(r.hours_since_last_assignee_comment) : "—"}
                            </td>
                            <td style={{ padding: "0.5rem 0.75rem" }}>
                              <button
                                type="button"
                                onClick={() => handleShowTime(r.id)}
                                style={{
                                  background: "transparent",
                                  border: "1px solid var(--border)",
                                  borderRadius: 999,
                                  padding: "0.2rem 0.65rem",
                                  fontSize: "0.78rem",
                                  fontWeight: 600,
                                  color: "var(--text)",
                                  cursor: timeLoadingFor === r.id ? "wait" : "pointer",
                                  opacity: timeLoadingFor === r.id ? 0.7 : 1,
                                }}
                                title="Ver detalle por asignado"
                              >
                                {timeLoadingFor === r.id ? "Cargando…" : fmtActiontime(Number(r.actiontime_total))}
                              </button>
                            </td>
                            <td style={{ padding: "0.5rem 0.75rem", color: "var(--muted)", fontSize: "0.82rem" }}>
                              {r.assignees ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>

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
              ]}
              rows={data.stale_top as unknown as Record<string, unknown>[]}
              empty="No hay datos o la cola está al día."
            />
          </div>

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
                void import("./modules/soporte/reports/supportReportPdf").then(({ exportSupportReportPdf }) =>
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

      {page === "costCenters" && <CostCentersPage />}

      {page === "systemSettings" && user.role === "admin" && <SystemSettingsPage />}

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
              subtitle="Fechas y tipo de proyecto. El tiempo se atribuye al mes del registro de la tarea (inicio o fecha de la tarea) si cae en el rango. La categoría es la fuente de solicitud del ticket (glpi_requesttypes)."
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
        </main>
      </div>
    </div>
  );
}
