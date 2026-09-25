import { useState } from "react";

import { HistoryTab } from "./HistoryTab";
import { ProjectsTab } from "./ProjectsTab";
import { ScheduleTab } from "./ScheduleTab";
import { SmtpTab } from "./SmtpTab";
import { SurveysTab } from "./SurveysTab";

const TABS = [
  { id: "schedule", label: "Envío automático de informes" },
  { id: "projects", label: "Proyectos" },
  { id: "history", label: "Historial de envíos" },
  { id: "surveys", label: "Encuestas" },
  { id: "smtp", label: "Correo SMTP" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SystemSettingsPage() {
  const [tab, setTab] = useState<TabId>("schedule");
  return (
    <div>
      <div className="sys-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "schedule" && <ScheduleTab />}
      {tab === "projects" && <ProjectsTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "surveys" && <SurveysTab />}
      {tab === "smtp" && <SmtpTab />}
    </div>
  );
}
