/** Cliente de /api/system/* (Configuraciones del sistema; requiere perfil administrador). */

export type SmtpSecurity = "none" | "starttls" | "ssl";

export type SmtpConfig = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  from_email: string;
  from_name: string;
  reply_to: string;
  timeout_seconds: number;
  password_set: boolean;
};

export type SmtpConfigIn = Omit<SmtpConfig, "password_set"> & { password: string | null };

export type Frequency = "monthly_day" | "monthly_last_day" | "monthly_last_business_day" | "weekly" | "daily";

export type ScheduleConfig = {
  enabled: boolean;
  frequency: Frequency;
  day_of_month: number;
  weekday: number;
  send_time: string;
  timezone: string;
  period_mode: "current_month" | "previous_month";
  attachment_format: "docx" | "pdf" | "both" | "none";
  embed_report_in_body: boolean;
  survey_enabled: boolean;
  survey_base_url: string;
  training_modules: string[];
  skip_empty: boolean;
  cc: string[];
  bcc: string[];
  subject_template: string;
  body_template: string;
  exclude_domains: string[];
  test_mode: boolean;
  test_recipients: string[];
  max_attempts: number;
  active_since: string | null;
};

export type SchedulePayload = {
  config: ScheduleConfig;
  next_run_at: string | null;
  next_period: { from: string; to: string } | null;
  worker_heartbeat: string | null;
  server_now: string;
};

export type ReportProject = {
  id: number;
  name: string;
  is_active: boolean;
  extra_to: string[];
  extra_cc: string[];
};

export type ProjectConfigIn = Omit<ReportProject, "id" | "name">;

export type ReportPreview = {
  project_id: number;
  project_name: string;
  date_from: string;
  date_to: string;
  tickets_count: number;
  summary: { total: { seconds: number } };
  requesters: { users_id: number; name: string; email: string; tickets: number }[];
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  /** Cuerpo HTML exactamente como se enviará (informe completo incluido). */
  html: string;
  test_mode: boolean;
  test_recipients: string[];
};

export type RunStatus = "queued" | "running" | "done" | "partial" | "failed";

export type ReportRun = {
  id: number;
  trigger: "auto" | "manual";
  status: RunStatus;
  period_from: string;
  period_to: string;
  test_mode: boolean;
  requested_by: string | null;
  total_projects: number;
  sent: number;
  failed: number;
  skipped: number;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type SendStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type ReportSend = {
  id: number;
  project_id: number;
  project_name: string | null;
  status: SendStatus;
  skip_reason: string | null;
  recipients_to: { email: string; name: string }[];
  recipients_cc: string[];
  subject: string | null;
  tickets_count: number;
  total_hhmm: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = t || res.statusText;
    try {
      const j = JSON.parse(t) as { detail?: unknown };
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg?: string }) => d.msg ?? "").join("; ");
    } catch {
      /* texto plano */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const put = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });
const post = (body: unknown = {}): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const fetchSmtp = () => request<SmtpConfig>("/api/system/smtp");
export const saveSmtp = (cfg: SmtpConfigIn) => request<SmtpConfig>("/api/system/smtp", put(cfg));
export const fetchSmtpGlpiDefaults = () =>
  request<Omit<SmtpConfig, "password_set" | "timeout_seconds">>("/api/system/smtp/glpi-defaults");
export const sendSmtpTest = (to: string) => request<{ ok: boolean; to: string[] }>("/api/system/smtp/test", post({ to }));

export const fetchSchedule = () => request<SchedulePayload>("/api/system/report-mail/schedule");
export const saveSchedule = (cfg: ScheduleConfig) => request<SchedulePayload>("/api/system/report-mail/schedule", put(cfg));

export const fetchReportProjects = () =>
  request<{ projects: ReportProject[] }>("/api/system/report-mail/projects").then((r) => r.projects);
export const saveReportProject = (id: number, cfg: ProjectConfigIn) =>
  request<{ ok: boolean }>(`/api/system/report-mail/projects/${id}`, put(cfg));

function periodQuery(projectId: number, from?: string, to?: string): URLSearchParams {
  const q = new URLSearchParams({ project_id: String(projectId) });
  if (from && to) {
    q.set("date_from", from);
    q.set("date_to", to);
  }
  return q;
}

export const fetchReportPreview = (projectId: number, from?: string, to?: string) =>
  request<ReportPreview>(`/api/system/report-mail/preview?${periodQuery(projectId, from, to)}`);

export async function downloadReportPreviewFile(
  projectId: number,
  format: "docx" | "pdf",
  from?: string,
  to?: string,
): Promise<void> {
  const q = periodQuery(projectId, from, to);
  q.set("format", format);
  const res = await fetch(`/api/system/report-mail/preview/file?${q}`);
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const filename = m ? decodeURIComponent(m[1]) : `informe.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const createManualRun = (body: { project_ids: number[] | null; date_from?: string; date_to?: string }) =>
  request<{ run_id: number; test_mode: boolean }>("/api/system/report-mail/runs", post(body));
export const fetchRuns = () => request<{ runs: ReportRun[] }>("/api/system/report-mail/runs").then((r) => r.runs);
export const fetchRunSends = (runId: number) =>
  request<{ sends: ReportSend[] }>(`/api/system/report-mail/runs/${runId}/sends`).then((r) => r.sends);
export type SurveyResponse = {
  id: number;
  projects_id: number;
  project_name: string | null;
  period_from: string;
  period_to: string;
  score_solution_time: number;
  score_response_time: number;
  score_quality: number;
  needs_training: boolean;
  training_module: string | null;
  respondent_name: string | null;
  observations: string | null;
  date_creation: string;
};

export type SurveySummary = {
  projects_id: number;
  project_name: string | null;
  responses: number;
  avg_solution_time: number | null;
  avg_response_time: number | null;
  avg_quality: number | null;
  training_requests: number;
};

export function fetchSurveys(f: { projectId?: number; from?: string; to?: string }) {
  const q = new URLSearchParams();
  if (f.projectId) q.set("project_id", String(f.projectId));
  if (f.from) q.set("date_from", f.from);
  if (f.to) q.set("date_to", f.to);
  return request<{ responses: SurveyResponse[]; summary: SurveySummary[] }>(`/api/system/surveys?${q}`);
}

export const retrySend = (sendId: number) => request<{ ok: boolean }>(`/api/system/report-mail/sends/${sendId}/retry`, post());
