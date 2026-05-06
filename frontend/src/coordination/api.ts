/**
 * Cliente HTTP y tipos del menú «Indicadores coordinación» (`/api/indicators/coordination/*`).
 */
import type { IndicatorsSummaryKpisPayload, IndicatorsTicketKpiModalPayload } from "../indicatorsKpiTypes";

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
  /** Tickets distintos con tiempo registrado (tareas) en esa semana ISO. */
  tickets_worked: number;
  actiontime_seconds: number;
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

export type CoordinationAssigneeTicketsPerHourRow = {
  user_id: number;
  login: string | null;
  full_name: string;
  tickets_worked: number;
  actiontime_seconds: number;
  hours: number;
  /** Distinto null solo si hours > 0. */
  tickets_per_hour: number | null;
  /** Resueltos/cerrados con solvedate en el rango y técnico asignado en el ticket. */
  tickets_resolved_in_range: number;
  /** Media calendarística desde apertura GLPI (t.date) hasta solvedate, en horas. */
  avg_resolution_hours: number | null;
  /** Tickets resueltos en rango ÷ horas de actiontime en rango. */
  resolved_per_registered_hour: number | null;
};

export type CoordinationAssigneeTicketsPerHourPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  rows: CoordinationAssigneeTicketsPerHourRow[];
};

export async function fetchCoordinationAssigneeTicketsPerHour(
  projectTypeId: number | null,
  dateFrom: string,
  dateTo: string,
): Promise<CoordinationAssigneeTicketsPerHourPayload> {
  const u = new URL("/api/indicators/coordination/assignee-tickets-per-hour", window.location.origin);
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
