/**
 * Cliente HTTP y tipos del menú «Indicadores coordinación» (`/api/indicators/coordination/*`).
 */
import type { IndicatorsSummaryKpisPayload, IndicatorsTicketKpiModalPayload } from "../../../indicatorsKpiTypes";

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

export type CoordinationSummaryKpisPayload = IndicatorsSummaryKpisPayload & {
  tickets_started_now: number;
  tickets_not_started_now: number;
  tickets_waiting_now: number;
  tickets_reopened_now: number;
  /** Creados en el rango con plazo TTR (`time_to_resolve`) de GLPI incumplido (todos los estados). */
  tickets_out_of_sla_in_range: number;
};

export async function fetchCoordinationSummaryKpis(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<CoordinationSummaryKpisPayload> {
  const u = new URL("/api/indicators/coordination/summary", window.location.origin);
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

export type CoordinationWeeklyEvolutionRow = {
  period_sort: number;
  period_label: string;
  /** Lunes y domingo de la semana ISO (YYYY-MM-DD). */
  week_period_start: string;
  week_period_end: string;
  /** Creados en el rango (semana ISO de `t.date`) que siguen sin estado resuelto/cerrado (misma base que la serie Creados). */
  tickets_open_snapshot: number;
  /** Estado efectivo al corte semanal (glpi_logs, opción GLPI_TICKET_LOG_SO_STATUS): cuántos no estaban resueltos/cerrados entonces. */
  tickets_open_historic_logs: number;
  tickets_created: number;
  /** Transiciones a «En espera» registradas en glpi_logs. */
  tickets_paused_events: number;
  /** Reaperturas detectadas en glpi_logs (misma opción de estado que KPI reabiertos). */
  tickets_reopened_events: number;
  /** Transiciones en glpi_logs hacia resuelto/cerrado (no usa solvedate). */
  tickets_resolved: number;
  /** Transiciones en glpi_logs desde Nuevo hacia En curso, Planificado o En espera. */
  tickets_managed_events: number;
  /** Suma de actiontime (s) en la misma semana ISO sobre tickets gestionados esa semana. */
  actiontime_managed_seconds: number;
  /** Suma de actiontime (s) en la misma semana ISO sobre tickets resueltos esa semana. */
  actiontime_resolved_seconds: number;
  /** Creados en el rango con incumplimiento TTR actual, por semana de creación. */
  tickets_out_of_sla: number;
};

export type CoordinationWeeklyEvolutionPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  rows: CoordinationWeeklyEvolutionRow[];
};

export async function fetchCoordinationWeeklyEvolution(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<CoordinationWeeklyEvolutionPayload> {
  const u = new URL("/api/indicators/coordination/weekly-evolution", window.location.origin);
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

/** Esfuerzo histórico del ticket atribuido a la semana ISO de COALESCE(solvedate, closedate). */
export type CoordinationResolvedEffortRow = {
  period_sort: number;
  period_label: string;
  week_period_start: string;
  week_period_end: string;
  /** Tickets resuelto/cerrado con fecha de resolución en esa semana ISO. */
  tickets_resolved: number;
  /** Suma de actiontime de todas las tareas del ticket (histórico, sin filtrar por fecha de tarea). */
  actiontime_total_seconds: number;
  /** actiontime_total_seconds / 3600 / tickets_resolved. */
  avg_hours_per_ticket: number;
};

export type CoordinationResolvedEffortPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  rows: CoordinationResolvedEffortRow[];
};

export async function fetchCoordinationResolvedEffortByResolution(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<CoordinationResolvedEffortPayload> {
  const u = new URL("/api/indicators/coordination/resolved-effort-by-resolution", window.location.origin);
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

/** Pareto 80-20 de tickets por tiempo de consumo (actiontime en el rango). */
export type CoordinationTicketTimeParetoTopTicket = {
  rank: number;
  ticket_id: number;
  ticket_name: string;
  project_name?: string | null;
  actiontime_seconds: number;
  pct_of_total: number;
  cumulative_pct: number;
};

export type CoordinationTicketTimeParetoStats = {
  tickets_with_time: number;
  actiontime_total_seconds: number;
  tickets_for_80pct: number;
  pct_tickets_for_80: number;
  actiontime_80pct_seconds: number;
  pct_hours_in_top_20pct_tickets: number;
};

export type CoordinationTicketTimeParetoPeriodRow = CoordinationTicketTimeParetoStats & {
  period_sort: number;
  period_label: string;
  week_period_start: string;
  week_period_end: string;
};

export type CoordinationTicketTimeParetoPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  range: CoordinationTicketTimeParetoStats & {
    top_tickets: CoordinationTicketTimeParetoTopTicket[];
  };
  weeks: CoordinationTicketTimeParetoPeriodRow[];
  months: CoordinationTicketTimeParetoPeriodRow[];
};

export async function fetchCoordinationTicketTimePareto(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<CoordinationTicketTimeParetoPayload> {
  const u = new URL("/api/indicators/coordination/ticket-time-pareto", window.location.origin);
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

export type CoordinationWeeklyAssigneeRow = {
  user_id: number;
  full_name: string;
  /** Login GLPI (glpi_users.name), si viene del backend. */
  login?: string | null;
  /** Tickets distintos con tiempo registrado (tareas) en esa semana ISO (técnico de la tarea). */
  tickets_worked: number;
  actiontime_seconds: number;
  /**
   * Tickets distintos con evento en `glpi_logs` en esa semana ISO que asignan al técnico
   * (`GLPI_LOG_ASSIGNEE_TECH_SEARCH_OPTION`). Carga entrante; independiente de resolución o imputación.
   */
  tickets_assigned_in_week: number;
  /** Tickets distintos con tareas en la semana donde el usuario es también asignado del ticket (`glpi_tickets_users`). */
  tickets_assignee_worked: number;
  actiontime_assignee_seconds: number;
  /** Cierres resuelto/cerrado en esa semana ISO (`solvedate`) figurando como asignado del ticket. */
  tickets_resolved_assignee: number;
  /** Suma de `actiontime` del técnico en esos tickets cerrados esa semana (tareas que caen en el rango de filtros). */
  actiontime_on_resolved_assignee_seconds: number;
};

export type CoordinationWeeklyAssigneeSeriesItem = {
  user_id: number;
  login: string;
  full_name: string;
  chart_key: string;
};

export type CoordinationWeeklyAssigneeWeekBlock = {
  period_sort: number;
  period_label: string;
  week_period_start: string;
  week_period_end: string;
  assignees: CoordinationWeeklyAssigneeRow[];
};

export type CoordinationWeeklyAssigneePerformancePayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  /** Series fijas cuando el API filtra por GLPI_COORD_PERFORMANCE_LOGINS; vacío si se devuelven todos los técnicos. */
  assignee_series: CoordinationWeeklyAssigneeSeriesItem[];
  weeks: CoordinationWeeklyAssigneeWeekBlock[];
};

export async function fetchCoordinationWeeklyAssigneePerformance(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<CoordinationWeeklyAssigneePerformancePayload> {
  const u = new URL("/api/indicators/coordination/weekly-assignee-performance", window.location.origin);
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

export type CoordinationWeeklyTechnicianRow = {
  user_id: number;
  full_name: string;
  login?: string | null;
  /** Tickets creados en la semana ISO con el técnico como asignado del ticket. */
  tickets_created: number;
  /** Tickets distintos con tareas imputadas en la semana (técnico de la tarea). */
  tickets_managed: number;
  actiontime_seconds: number;
  /** actiontime del técnico en la misma semana ISO sobre tickets con evento gestionado (logs). */
  actiontime_managed_seconds?: number;
  /** actiontime del técnico en la misma semana ISO sobre tickets con evento resuelto/cerrado (logs). */
  actiontime_resolved_seconds?: number;
};

export type CoordinationWeeklyTechnicianSeriesItem = {
  user_id: number;
  login: string;
  full_name: string;
  chart_key: string;
};

export type CoordinationWeeklyTechnicianWeekBlock = {
  period_sort: number;
  period_label: string;
  week_period_start: string;
  week_period_end: string;
  technicians: CoordinationWeeklyTechnicianRow[];
};

export type CoordinationWeeklyTechnicianEvolutionPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  summary: {
    tickets_created_team: number;
    tickets_managed_team: number;
    actiontime_seconds_team: number;
  };
  technician_series: CoordinationWeeklyTechnicianSeriesItem[];
  technician_totals: CoordinationWeeklyTechnicianRow[];
  weeks: CoordinationWeeklyTechnicianWeekBlock[];
};

export async function fetchCoordinationWeeklyTechnicianEvolution(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<CoordinationWeeklyTechnicianEvolutionPayload> {
  const u = new URL("/api/indicators/coordination/weekly-technician-evolution", window.location.origin);
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

export type CoordinationWeeklyRequestTypeRow = {
  period_sort: string;
  period_label: string;
  /** Lunes y domingo ISO (YYYY-MM-DD); solo granularidad week. */
  week_period_start?: string;
  week_period_end?: string;
  requesttypes_id: number;
  request_type_name: string;
  ticket_count: number;
};

/** Misma forma que Indicadores «por periodo» con granularity fija week; alcance de proyecto igual que coordinación. */
export type CoordinationWeeklyTicketsByRequestTypePayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  /** Proyecto GLPI filtrado en la consulta; null = todos. */
  project_id: number | null;
  granularity: "week";
  /** Reservado; siempre vacío (todas las fuentes). */
  request_type_allowlist_applied: string[];
  rows: CoordinationWeeklyRequestTypeRow[];
};

export async function fetchCoordinationWeeklyTicketsByRequestType(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  projectId?: number | null,
): Promise<CoordinationWeeklyTicketsByRequestTypePayload> {
  const u = new URL("/api/indicators/coordination/weekly-tickets-by-request-type", window.location.origin);
  if (projectTypeId != null) u.searchParams.set("project_type_id", String(projectTypeId));
  if (projectId != null && projectId >= 1) u.searchParams.set("project_id", String(projectId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type CoordinationWeeklyRtDetailPayload = IndicatorsTicketKpiModalPayload & {
  project_id: number | null;
  period_sort: number;
  requesttypes_id: number;
  request_type_name: string;
};

/** Tickets de una celda del gráfico (semana ISO + fuente); tiempo en tareas acotado al rango de filtros. */
export async function fetchCoordinationWeeklyTicketsByRequestTypeDetail(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  periodSort: number,
  requesttypesId: number,
  projectId?: number | null,
): Promise<CoordinationWeeklyRtDetailPayload> {
  const u = new URL(
    "/api/indicators/coordination/weekly-tickets-by-request-type/detail",
    window.location.origin,
  );
  if (projectTypeId != null) u.searchParams.set("project_type_id", String(projectTypeId));
  if (projectId != null && projectId >= 1) u.searchParams.set("project_id", String(projectId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  u.searchParams.set("period_sort", String(periodSort));
  u.searchParams.set("requesttypes_id", String(requesttypesId));
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export async function fetchCoordinationTicketsOutOfSlaDetail(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<IndicatorsTicketKpiModalPayload> {
  return fetchTicketKpiDetail(
    "/api/indicators/coordination/tickets-out-of-sla/detail",
    projectTypeId,
    dateFrom,
    dateTo,
  );
}

export type CoordinationTicketBucketKind = "started" | "not_started" | "waiting" | "reopened";

export type CoordinationBucketDetailPayload = IndicatorsTicketKpiModalPayload & {
  bucket: string;
};

export async function fetchCoordinationTicketBucketDetail(
  bucket: CoordinationTicketBucketKind,
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<CoordinationBucketDetailPayload> {
  const enc = encodeURIComponent(bucket);
  return fetchTicketKpiDetail(
    `/api/indicators/coordination/tickets-detail/${enc}`,
    projectTypeId,
    dateFrom,
    dateTo,
  ) as Promise<CoordinationBucketDetailPayload>;
}

export type AiEstimationFieldKey = "tiempoestimadosolucinfield" | "tiempoestimadosoluciniafield";

export const AI_ESTIMATION_FIELD_SLICES: ReadonlyArray<{
  field: AiEstimationFieldKey;
  label: string;
  subtitle: string;
}> = [
  {
    field: "tiempoestimadosolucinfield",
    label: "Tiempo estimado de solución",
    subtitle:
      "Compara la estimación de resolución (campo «Tiempo estimado de solución» en GLPI Fields) frente al tiempo imputado en tareas del ticket dentro del rango de fechas de filtros.",
  },
  {
    field: "tiempoestimadosoluciniafield",
    label: "Tiempo estimado de solución (IA)",
    subtitle:
      "Compara la estimación generada con IA (campo «Tiempo estimado de solución IA» en GLPI Fields) frente al tiempo imputado en tareas del ticket dentro del rango de fechas de filtros.",
  },
];

export type AiEstimationSemaforoKey =
  | "sin_estimar"
  | "sin_tiempo"
  | "dentro"
  | "leve"
  | "significativo";

export type AiEstimationSemaforoRow = {
  key: AiEstimationSemaforoKey;
  label: string;
  count: number;
  pct: number;
};

export type AiEstimationSummaryPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  estimate_field?: AiEstimationFieldKey;
  total_tickets: number;
  tickets_with_estimate: number;
  tickets_with_time: number;
  tickets_comparable: number;
  tickets_within_estimate: number;
  tickets_minor_deviation: number;
  tickets_significant_deviation: number;
  compliance_rate_pct: number | null;
  minor_deviation_rate_pct: number | null;
  significant_deviation_rate_pct: number | null;
  avg_deviation_pct: number | null;
  total_hours_estimated: number;
  total_hours_executed: number;
  hours_difference: number;
  efficiency_ratio: number | null;
  net_hours_vs_estimate: number | null;
  semaforo_breakdown: AiEstimationSemaforoRow[];
};

export type AiEstimationWeeklyRow = {
  period_sort: number;
  period_label: string;
  week_period_start: string;
  week_period_end: string;
  total_tickets: number;
  tickets_estimated: number;
  tickets_with_time: number;
  tickets_comparable: number;
  tickets_within_estimate: number;
  compliance_rate_pct: number | null;
  total_hours_estimated: number;
  total_hours_executed: number;
  hours_difference: number;
  avg_deviation_pct: number | null;
};

export type AiEstimationWeeklyPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  estimate_field?: AiEstimationFieldKey;
  rows: AiEstimationWeeklyRow[];
};

export type AiEstimationTopDeviationRow = {
  ticket_id: number;
  titulo: string;
  fecha_creacion: string;
  tecnico: string | null;
  horas_estimadas_raw?: string | null;
  horas_estimadas: number;
  horas_ejecutadas: number;
  desvio_horas: number;
  desvio_pct: number | null;
  semaforo_key: string;
  semaforo_label: string;
};

export type AiEstimationTopDeviationsPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  estimate_field?: AiEstimationFieldKey;
  limit: number;
  rows: AiEstimationTopDeviationRow[];
};

export type AiEstimationTicketRow = {
  ticket_id: number;
  titulo: string;
  fecha_creacion: string;
  semana_iso: number | null;
  estado: string;
  tipo: string;
  solicitante: string | null;
  tecnico: string | null;
  horas_estimadas_raw?: string | null;
  horas_estimadas: number | null;
  horas_ejecutadas: number;
  cantidad_tareas: number;
  diferencia_horas: number | null;
  desviacion_pct: number | null;
  semaforo_key: string;
  semaforo_label: string;
};

export type AiEstimationTicketsDetailPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  estimate_field?: AiEstimationFieldKey;
  semaforo_key: string | null;
  comparable_only?: boolean;
  rows: AiEstimationTicketRow[];
};

export type AiEstimationTicketsDetailOptions = {
  semaforoKey?: AiEstimationSemaforoKey;
  estimateField?: AiEstimationFieldKey;
  comparableOnly?: boolean;
};

async function fetchAiEstimationEndpoint<T>(
  path: string,
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  extra?: Record<string, string>,
): Promise<T> {
  const u = new URL(path, window.location.origin);
  if (projectTypeId != null) u.searchParams.set("project_type_id", String(projectTypeId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  }
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export function fetchAiEstimationSummary(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  estimateField?: AiEstimationFieldKey,
): Promise<AiEstimationSummaryPayload> {
  const extra = estimateField ? { estimate_field: estimateField } : undefined;
  return fetchAiEstimationEndpoint("/api/indicators/coordination/ai-estimation/summary", projectTypeId, dateFrom, dateTo, extra);
}

export function fetchAiEstimationWeekly(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  estimateField?: AiEstimationFieldKey,
): Promise<AiEstimationWeeklyPayload> {
  const extra = estimateField ? { estimate_field: estimateField } : undefined;
  return fetchAiEstimationEndpoint("/api/indicators/coordination/ai-estimation/weekly", projectTypeId, dateFrom, dateTo, extra);
}

export function fetchAiEstimationTopDeviations(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  limit = 10,
  estimateField?: AiEstimationFieldKey,
): Promise<AiEstimationTopDeviationsPayload> {
  const extra: Record<string, string> = { limit: String(limit) };
  if (estimateField) extra.estimate_field = estimateField;
  return fetchAiEstimationEndpoint("/api/indicators/coordination/ai-estimation/top-deviations", projectTypeId, dateFrom, dateTo, extra);
}

export function fetchAiEstimationTicketsDetail(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  options?: AiEstimationTicketsDetailOptions,
): Promise<AiEstimationTicketsDetailPayload> {
  const extra: Record<string, string> = {};
  if (options?.semaforoKey) extra.semaforo_key = options.semaforoKey;
  if (options?.estimateField) extra.estimate_field = options.estimateField;
  if (options?.comparableOnly) extra.comparable_only = "true";
  return fetchAiEstimationEndpoint("/api/indicators/coordination/ai-estimation/tickets", projectTypeId, dateFrom, dateTo, extra);
}

export type AiEstimationFieldSliceData = {
  field: AiEstimationFieldKey;
  label: string;
  subtitle: string;
  summary: AiEstimationSummaryPayload | null;
  summaryErr: string | null;
  weekly: AiEstimationWeeklyPayload | null;
  weeklyErr: string | null;
  topDeviations: AiEstimationTopDeviationsPayload | null;
  topErr: string | null;
};

export type AiUsageKey = "si" | "no" | "sin_dato";

export type AiUsageBreakdownRow = {
  key: AiUsageKey;
  label: string;
  count: number;
  pct: number;
};

export type AiUsageSummaryPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  total_tickets: number;
  tickets_ai_yes: number;
  tickets_ai_no: number;
  tickets_ai_unset: number;
  adoption_rate_pct: number | null;
  declared_rate_pct: number | null;
  tickets_ai_with_estimate: number;
  tickets_ai_comparable: number;
  tickets_ai_within_estimate: number;
  ai_compliance_rate_pct: number | null;
  tickets_no_ai_comparable: number;
  tickets_no_ai_within_estimate: number;
  no_ai_compliance_rate_pct: number | null;
  aplica_ia_breakdown: AiUsageBreakdownRow[];
};

export type AiUsageWeeklyRow = {
  period_sort: number;
  period_label: string;
  week_period_start: string;
  week_period_end: string;
  total_tickets: number;
  tickets_ai_yes: number;
  tickets_ai_no: number;
  tickets_ai_unset: number;
  adoption_rate_pct: number | null;
  declared_rate_pct: number | null;
};

export type AiUsageWeeklyPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  rows: AiUsageWeeklyRow[];
};

export type AiUsageByStatusRow = {
  status_id: number;
  estado_label: string;
  aplica_ia_key: string;
  aplica_ia_label: string;
  ticket_count: number;
};

export type AiUsageByStatusPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  rows: AiUsageByStatusRow[];
};

export type AiUsageTicketRow = {
  ticket_id: number;
  fecha_ticket: string;
  estado: string;
  tipo: string;
  solicitante: string | null;
  tecnico: string | null;
  titulo: string;
  aplica_ia_id: number | null;
  aplica_ia_key: string;
  aplica_ia_label: string;
  horas_estimadas: number | null;
  horas_ejecutadas: number;
};

export type AiUsageTicketsDetailPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  aplica_ia_key: string | null;
  rows: AiUsageTicketRow[];
};

async function fetchAiUsageEndpoint<T>(
  path: string,
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  extra?: Record<string, string>,
): Promise<T> {
  const u = new URL(path, window.location.origin);
  if (projectTypeId != null) u.searchParams.set("project_type_id", String(projectTypeId));
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  }
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export function fetchAiUsageSummary(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<AiUsageSummaryPayload> {
  return fetchAiUsageEndpoint("/api/indicators/coordination/ai-usage/summary", projectTypeId, dateFrom, dateTo);
}

export function fetchAiUsageWeekly(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<AiUsageWeeklyPayload> {
  return fetchAiUsageEndpoint("/api/indicators/coordination/ai-usage/weekly", projectTypeId, dateFrom, dateTo);
}

export function fetchAiUsageByStatus(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<AiUsageByStatusPayload> {
  return fetchAiUsageEndpoint("/api/indicators/coordination/ai-usage/by-status", projectTypeId, dateFrom, dateTo);
}

export function fetchAiUsageTicketsDetail(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
  aplicaIaKey?: AiUsageKey,
): Promise<AiUsageTicketsDetailPayload> {
  const extra: Record<string, string> = {};
  if (aplicaIaKey) extra.aplica_ia_key = aplicaIaKey;
  return fetchAiUsageEndpoint("/api/indicators/coordination/ai-usage/tickets", projectTypeId, dateFrom, dateTo, extra);
}

export type KnowledgeBaseAuthorRow = {
  user_id: number | null;
  login: string | null;
  author_name: string;
  item_count: number;
};

export type KnowledgeBaseSummaryPayload = {
  date_from: string;
  date_to: string;
  total_items: number;
  by_author: KnowledgeBaseAuthorRow[];
};

export async function fetchKnowledgeBaseSummary(
  dateFrom: string,
  dateTo: string,
): Promise<KnowledgeBaseSummaryPayload> {
  const u = new URL("/api/indicators/coordination/knowledge-base/summary", window.location.origin);
  u.searchParams.set("date_from", dateFrom);
  u.searchParams.set("date_to", dateTo);
  const res = await fetch(`${u.pathname}${u.search}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}
