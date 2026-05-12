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
  tickets_resolved: number;
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

export type CoordinationWeeklyAssigneeRow = {
  user_id: number;
  full_name: string;
  /** Login GLPI (glpi_users.name), si viene del backend. */
  login?: string | null;
  /** Tickets distintos con tiempo registrado (tareas) en esa semana ISO (técnico de la tarea). */
  tickets_worked: number;
  actiontime_seconds: number;
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
