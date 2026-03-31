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
    status: number;
    priority: number;
    hours_open: number;
    actiontime_total: number;
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

export async function fetchDashboard(): Promise<DashboardPayload> {
  const res = await fetch("/api/dashboard");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

export type SupportProject = { id: number; name: string };
export type SupportReportRow = {
  id: number;
  titulo: string;
  proyecto: string | null;
  tipo_solicitud: string;
  solvedate: string | null;
  estado_ticket: string;
  tiempo_numerico: number;
  tiempo_horas_minutos: string;
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
