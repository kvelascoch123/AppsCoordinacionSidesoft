import type { ReactNode } from "react";

export type Notice = { kind: "ok" | "err" | "warn"; text: string } | null;

export function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <div className={`sys-msg sys-msg-${notice.kind}`}>{notice.text}</div>;
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Fecha/hora ISO → texto local (Ecuador) legible. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });
}

/** yyyy-mm-dd → dd/mm/yyyy */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function emailsToText(list: string[]): string {
  return list.join(", ");
}

export function textToEmails(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const BADGES: Record<string, { cls: string; label: string }> = {
  queued: { cls: "sys-badge-info", label: "En cola" },
  running: { cls: "sys-badge-info", label: "En curso" },
  done: { cls: "sys-badge-ok", label: "Completado" },
  partial: { cls: "sys-badge-warn", label: "Parcial" },
  failed: { cls: "sys-badge-err", label: "Fallido" },
  pending: { cls: "sys-badge-info", label: "Pendiente" },
  sending: { cls: "sys-badge-info", label: "Enviando" },
  sent: { cls: "sys-badge-ok", label: "Enviado" },
  skipped: { cls: "", label: "Omitido" },
};

export function StatusBadge({ status }: { status: string }) {
  const b = BADGES[status] ?? { cls: "", label: status };
  return <span className={`sys-badge ${b.cls}`}>{b.label}</span>;
}

export function Card({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="sys-card">
      <h2>{title}</h2>
      {hint && <p className="sys-hint">{hint}</p>}
      {children}
    </section>
  );
}
