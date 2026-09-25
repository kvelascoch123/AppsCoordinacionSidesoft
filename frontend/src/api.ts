export type DashboardPayload = {
  generated_for: {
    database: string;
    entity_filter: number | null;
    stale_hours_threshold: number;
  };
  meta: {
    status_labels: Record<string, string>;
    priority_labels: Record<string, string>;
  };
  summary: {
    open_total: number;
    unassigned_count: number;
    status_new_or_waiting: number;
    avg_open_hours: number | null;
    stale_over_threshold: number;
    max_stale_hours: number | null;
    threshold_hours: number;
  };
  by_assignee: { user_id: number; full_name: string; ticket_count: number }[];
  management_by_assignee: {
    user_id: number;
    full_name: string;
    managed_tickets: number;
    actiontime_total: number;
  }[];
  by_status: { status: number; cnt: number; status_label: string }[];
  by_priority: { priority: number; cnt: number; priority_label: string }[];
  unassigned_top: {
    id: number;
    name: string | null;
    priority: number;
    priority_label: string;
    fecha_apertura: string | null;
    hours_open: number;
    actiontime_total: number;
    project_name: string | null;
    hours_since_last_task: number | null;
    hours_since_last_client_comment: number | null;
    hours_since_last_assignee_comment: number | null;
    assignees: string | null;
  }[];
  stale_top: {
    id: number;
    name: string | null;
    status: number;
    priority: number;
    hours_without_public_followup: number;
    actiontime_total: number;
    assignees: string | null;
    status_label: string;
    priority_label: string;
  }[];
  by_project: {
    project_id: number;
    project_name: string | null;
    project_priority: number;
    open_tickets: number;
  }[];
};

export async function fetchDashboard(projectTypeId?: number | null): Promise<DashboardPayload> {
  const url = new URL("/api/dashboard", window.location.origin);
  if (projectTypeId != null) url.searchParams.set("project_type_id", String(projectTypeId));
  const res = await fetch(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type SupportProject = { id: number; name: string };
export type SupportReportRow = {
  id: number;
  /** glpi_tickets.requesttypes_id — tipo de solicitud (en muchos GLPI equivale a la “categoría” operativa) */
  requesttypes_id: number;
  titulo: string;
  proyecto: string | null;
  tipo_solicitud: string;
  /** Plugin Fields sobre requesttypes */
  facturable?: string | number | boolean | null;
  solvedate: string | null;
  estado_ticket: string;
  /** Nombre del solicitante (glpi_tickets_users type=1) */
  solicitante?: string | null;
  tiempo_numerico: number;
  tiempo_horas_minutos: string;
};

export type SupportRequestType = {
  id: number;
  name: string;
  facturable: boolean;
};

export type SupportReportPayload = {
  date_from: string;
  date_to: string;
  project_id: number;
  rows: SupportReportRow[];
  summary: {
    total: { hours: number; minutes: number; hhmm: string; seconds: number };
    facturable: { hours: number; minutes: number; hhmm: string; seconds: number };
    no_facturable: { hours: number; minutes: number; hhmm: string; seconds: number };
  };
};

export async function fetchSupportProjects(): Promise<SupportProject[]> {
  const res = await fetch("/api/reports/support/projects");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const payload = (await res.json()) as { projects: SupportProject[] };
  return payload.projects;
}

export type ProjectType = { id: number; name: string };

export async function fetchProjectTypes(): Promise<ProjectType[]> {
  const res = await fetch("/api/indicators/project-types");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const payload = (await res.json()) as { project_types: ProjectType[] };
  return payload.project_types;
}

export type SupportHoursByProjectRow = {
  project_id: number;
  project_name: string;
  requesttypes_id: number;
  request_type_name: string;
  period_key: string;
  actiontime_seconds: number;
  horas: number;
};

export type SupportHoursByProjectPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  granularity?: "week" | "month";
  rows: SupportHoursByProjectRow[];
};

export async function fetchSupportHoursByProjectAndCategory(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  granularity: "week" | "month" = "month",
): Promise<SupportHoursByProjectPayload> {
  const u = new URL("/api/indicators/support-hours-by-project-and-category", window.location.origin);
  if (projectTypeId != null) u.searchParams.set("project_type_id", String(projectTypeId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  u.searchParams.set("granularity", granularity);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type {
  IndicatorsResolvedInRangeDetailPayload,
  IndicatorsResolvedInRangeRow,
  IndicatorsSummaryKpisPayload,
  IndicatorsTicketKpiModalPayload,
  IndicatorsTicketKpiModalRow,
} from "./indicatorsKpiTypes";

import type { IndicatorsTicketKpiModalPayload } from "./indicatorsKpiTypes";

async function fetchTicketKpiDetail(
  path: string,
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<IndicatorsTicketKpiModalPayload> {
  const u = new URL(path, window.location.origin);
  if (projectTypeId != null) u.searchParams.set("project_type_id", String(projectTypeId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export async function fetchIndicatorsTicketsResolvedInRangeDetail(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<IndicatorsTicketKpiModalPayload> {
  return fetchTicketKpiDetail(
    "/api/indicators/tickets-resolved-in-range/detail",
    projectTypeId,
    dateFrom,
    dateTo,
  );
}

export async function fetchIndicatorsTicketsCreatedInRangeDetail(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<IndicatorsTicketKpiModalPayload> {
  return fetchTicketKpiDetail(
    "/api/indicators/tickets-created-in-range/detail",
    projectTypeId,
    dateFrom,
    dateTo,
  );
}

export async function fetchIndicatorsTicketsOpenNowDetail(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<IndicatorsTicketKpiModalPayload> {
  return fetchTicketKpiDetail("/api/indicators/tickets-open-now/detail", projectTypeId, dateFrom, dateTo);
}

export type IndicatorsProblemsStatusRow = {
  status_id: number;
  status_label: string;
  count: number;
};

export type IndicatorsProblemsWeeklyRow = {
  period_sort: number;
  period_label: string;
  week_period_start: string;
  week_period_end: string;
  problems_created: number;
  problems_resolved_or_closed: number;
};

export type IndicatorsProblemsSupportPayload = {
  date_from: string;
  date_to: string;
  total_problems: number;
  by_status: IndicatorsProblemsStatusRow[];
  weekly_rows: IndicatorsProblemsWeeklyRow[];
};

export async function fetchIndicatorsProblemsSupport(
  dateFrom: string,
  dateTo: string,
): Promise<IndicatorsProblemsSupportPayload> {
  const u = new URL("/api/indicators/problems-support", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export async function fetchSupportRequestTypes(): Promise<SupportRequestType[]> {
  const res = await fetch("/api/reports/support/request-types");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const payload = (await res.json()) as { request_types: SupportRequestType[] };
  return payload.request_types;
}

export async function applySupportTicketRequestTypes(
  updates: { ticket_id: number; requesttypes_id: number }[],
): Promise<{ updated: number; errors: string[] }> {
  const res = await fetch("/api/reports/support/tickets/request-type", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export async function fetchSupportReport(
  projectId: number,
  dateFrom: string,
  dateTo: string,
): Promise<SupportReportPayload> {
  const u = new URL("/api/reports/support", window.location.origin);
  u.searchParams.set("project_id", String(projectId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type SupportReportTicketTask = {
  task_id: number;
  fecha_registro: string | null;
  usuario_creador: string;
  actiontime: number;
  tiempo_horas_minutos: string;
};

export async function fetchSupportReportTicketTasks(
  ticketId: number,
  projectId: number,
  dateFrom: string,
  dateTo: string,
): Promise<{ tasks: SupportReportTicketTask[] }> {
  const u = new URL("/api/reports/support/ticket-tasks", window.location.origin);
  u.searchParams.set("ticket_id", String(ticketId));
  u.searchParams.set("project_id", String(projectId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type SupportAnalysisPayload = {
  project_id: number;
  date_from: string;
  date_to: string;
  summary: string;
  total_tickets: number;
  modules_affected: string[];
  main_support_drivers: string[];
  criticality_overview: string;
  recommendations: string[];
  ticket_ids: number[];
  report_total_tickets: number;
};

export async function fetchSupportAnalysis(
  projectId: number,
  dateFrom: string,
  dateTo: string,
): Promise<SupportAnalysisPayload> {
  const u = new URL("/api/reports/support/analysis", window.location.origin);
  u.searchParams.set("project_id", String(projectId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type TicketTableAnalysisRow = {
  id: number;
  titulo: string;
  /** Mismo criterio que el informe: glpi_requesttypes (requesttypes_id) */
  tipo_solicitud: string;
  fecha_ticket: string | null;
  solicitante: string | null;
  actiontime_seconds: number;
  tiempo_horas_minutos: string;
  contexto_corto: string;
};

export type TicketTableAnalysisPayload = {
  project_id: number;
  project_name: string;
  date_from: string;
  date_to: string;
  rows: TicketTableAnalysisRow[];
  total_in_range: number;
  truncated: boolean;
};

export async function fetchTicketTableAnalysis(
  projectId: number,
  dateFrom: string,
  dateTo: string,
): Promise<TicketTableAnalysisPayload> {
  const u = new URL("/api/reports/support/ticket-table-analysis", window.location.origin);
  u.searchParams.set("project_id", String(projectId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type ManagementByAssigneePayload = {
  date_from: string;
  date_to: string;
  totals: {
    tickets_attended: number;
    actiontime_total: number;
  };
  rows: {
    user_id: number;
    full_name: string;
    managed_tickets: number;
    actiontime_total: number;
  }[];
};

export async function fetchManagementByAssignee(
  dateFrom: string,
  dateTo: string,
): Promise<ManagementByAssigneePayload> {
  const u = new URL("/api/kpis/management-by-assignee", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type ManagementTicketDetailPayload = {
  date_from: string;
  date_to: string;
  user_id?: number | null;
  count: number;
  rows: {
    ticket_id: number;
    titulo: string | null;
    estado_ticket: string;
    actiontime_total: number;
  }[];
};

export async function fetchManagementTicketDetail(
  dateFrom: string,
  dateTo: string,
  userId?: number,
): Promise<ManagementTicketDetailPayload> {
  const u = new URL("/api/kpis/management-ticket-detail", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  if (typeof userId === "number") {
    u.searchParams.set("user_id", String(userId));
  }
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type TicketAnalysis = {
  ticket_id: number;
  title: string;
  summary: string;
  module: string;
  criticality: string;
  criticality_reason: string;
  probable_causes: string[];
  suggested_actions: string[];
  notes?: string;
};

export async function fetchTicketAnalysis(ticketId: number): Promise<TicketAnalysis> {
  const res = await fetch(`/api/tickets/${ticketId}/analysis`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type TicketTimeBreakdown = {
  ticket_id: number;
  total_actiontime: number;
  by_user: { user_id: number; full_name: string | null; actiontime_total: number }[];
};

export async function fetchTicketTime(ticketId: number): Promise<TicketTimeBreakdown> {
  const res = await fetch(`/api/tickets/${ticketId}/time`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type BillingInvoiceRow = {
  tercero?: string | null;
  documentno?: string | null;
  poreference?: string | null;
  dateinvoiced?: string | null;
  grandtotal?: number | null;
  /** Boolean en JSON o, según BD, otros tipos antes de serializar. */
  ispaid?: boolean | string | null;
  totalpaid?: number | null;
  centro_costo?: string | null;
  usuario1?: string | null;
  description?: string | null;
  valor_pendiente?: number | null;
};

export type BillingInvoicesPayload = {
  date_from: string;
  date_to: string | null;
  count: number;
  rows: BillingInvoiceRow[];
};

export async function fetchBillingInvoices(dateFrom: string, dateTo?: string | null): Promise<BillingInvoicesPayload> {
  const u = new URL("/api/billing/invoices", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  if (dateTo) u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type BillingEvolutionPayload = {
  date_from: string;
  date_to: string;
  tercero_filter: string | null;
  cost_centers: string[];
  rows: { period_key: string; amounts: number[]; total_usd: number }[];
  grand_total_usd: number;
};

export async function fetchBillingEvolutionByCostCenter(
  dateFrom: string,
  dateTo: string,
  tercero?: string | null,
): Promise<BillingEvolutionPayload> {
  const u = new URL("/api/billing/evolution-by-cost-center", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  if (tercero) u.searchParams.set("tercero", tercero);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export async function fetchBillingEvolutionPaidStatus(
  dateFrom: string,
  dateTo: string,
  tercero?: string | null,
): Promise<BillingEvolutionPayload> {
  const u = new URL("/api/billing/evolution-paid-status", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  if (tercero) u.searchParams.set("tercero", tercero);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export async function fetchBillingTerceros(dateFrom: string, dateTo: string): Promise<{ terceros: string[] }> {
  const u = new URL("/api/billing/terceros", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type CostCenterHoursRow = {
  proyecto: string;
  centro_costo: string | null;
  asignado: string;
  tiempo_horas_minutos: string;
  horas_laboradas: number;
  pct_participacion: number;
  total_seconds: number;
};

export type CostCenterHoursPayload = {
  date_from: string;
  date_to: string;
  count: number;
  rows: CostCenterHoursRow[];
};

export async function fetchCostCenterHours(
  dateFrom: string,
  dateTo: string,
): Promise<CostCenterHoursPayload> {
  const u = new URL("/api/cost-centers/hours", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type CostCenterTicketRow = {
  ticket: number;
  titulo: string | null;
  fecha: string | null;
  estado: string;
  proyecto: string;
  centro_costo: string | null;
  asignado: string;
  tiempo_horas_minutos: string;
  horas_laboradas: number;
  total_seconds: number;
};

export type CostCenterTicketsPayload = {
  date_from: string;
  date_to: string;
  proyecto: string;
  asignado: string;
  count: number;
  total_seconds: number;
  horas_laboradas: number;
  tickets: CostCenterTicketRow[];
};

export async function fetchCostCenterTickets(
  dateFrom: string,
  dateTo: string,
  proyecto: string,
  asignado: string,
): Promise<CostCenterTicketsPayload> {
  const u = new URL("/api/cost-centers/hours/tickets", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  u.searchParams.set("proyecto", proyecto);
  u.searchParams.set("asignado", asignado);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type KpiDatosRow = {
  fecha: string | null;
  cliente: string;
  tecnico: string;
  id_ticket: number;
  cerrado_por_cliente: string;
  calificacion: number;
  ticket_calificado: string;
  tipo_sla: string;
  dentro_sla: string;
  reapertura: string;
  estado: string;
  tecnico_id: number | null;
  total_seconds: number;
  tiempo_horas_minutos: string;
  evaluado_kpi_cierre: string;
};

export type KpiResumenClienteTecnicoRow = {
  tecnico: string;
  cliente: string;
  total_tickets: number;
  total_tickets_evaluar: number;
  tickets_cerrados_cliente: number;
  pct_cierre_cliente: number | "--";
  cumple_kpi_cierre_25: string;
  variable_kpi_cierre_25: number | "--";
  tickets_calificados: number;
  pct_tickets_calificados: number | "--";
  cumple_kpi_calificacion_20: string;
  variable_kpi_calificacion_20: number | "--";
  tickets_dentro_sla: number;
  pct_cumplimiento_sla: number | "--";
  cumple_kpi_sla: string;
  variable_kpi_sla_30: number | "--";
  tickets_reaperturas: number;
  pct_reaperturas: number;
  cumple_kpi_reapertura: string;
  variable_kpi_reapertura_25: number;
  total_seg_glpi: number;
  total_horas: number;
};

export type KpiResumenTecnicoGlobalRow = {
  tecnico: string;
  total_tickets: number;
  total_tickets_evaluar_cierre: number;
  tickets_cerrados_cliente: number;
  pct_cierre_global: number;
  cumple_kpi_cierre_25: string;
  valor_25: number;
  tickets_calificados: number;
  pct_tickets_calificados: number;
  cumple_kpi_calificacion_20: string;
  alterno_contra_cierre: number;
  valor_20: number;
  tickets_dentro_sla: number;
  pct_cumplimiento_sla: number;
  cumple_kpi_sla: string;
  valor_30: number;
  tickets_reaperturas: number;
  pct_reaperturas: number;
  cumple_kpi_reapertura: string;
  valor_25_reapertura: number;
  total_pct_variable: number;
  tiempo_glpi_seg: number;
  tiempo_horas: number;
  pct_soporte_finde_10: number;
  variable_final: number;
};

export type KpiVariablesPayload = {
  date_from: string;
  date_to: string;
  datos: KpiDatosRow[];
  resumen_cliente_tecnico: KpiResumenClienteTecnicoRow[];
  resumen_tecnico_global: KpiResumenTecnicoGlobalRow[];
  counts: {
    datos: number;
    resumen_cliente_tecnico: number;
    resumen_tecnico_global: number;
  };
};

export async function fetchKpiVariables(
  dateFrom: string,
  dateTo: string,
): Promise<KpiVariablesPayload> {
  const u = new URL("/api/cost-centers/kpi-variables", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type {
  CoordinationBucketDetailPayload,
  CoordinationSummaryKpisPayload,
  CoordinationTicketBucketKind,
  CoordinationWeeklyAssigneePerformancePayload,
  CoordinationWeeklyAssigneeRow,
  CoordinationWeeklyAssigneeSeriesItem,
  CoordinationWeeklyAssigneeWeekBlock,
  CoordinationWeeklyEvolutionPayload,
  CoordinationWeeklyEvolutionRow,
  CoordinationWeeklyRequestTypeRow,
  CoordinationWeeklyTicketsByRequestTypePayload,
} from "./modules/soporte/coordination/api";

export {
  fetchCoordinationSummaryKpis,
  fetchCoordinationTicketBucketDetail,
  fetchCoordinationTicketsOutOfSlaDetail,
  fetchCoordinationWeeklyAssigneePerformance,
  fetchCoordinationWeeklyEvolution,
  fetchCoordinationWeeklyTicketsByRequestType,
} from "./modules/soporte/coordination/api";
