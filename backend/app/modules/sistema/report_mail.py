"""
Envío automático del informe de soporte por proyecto.

Un correo por proyecto: Para = todos los solicitantes (glpi_tickets_users.type = requester) de los tickets
incluidos en el informe del período + destinatarios extra del proyecto; CC = CC global + CC del proyecto.

Control en BD:
- runs  (glpi_plugin_coorddash_report_runs): una fila por ejecución; `occurrence_key` único evita que la misma
  ocurrencia programada se ejecute dos veces aunque haya varios workers o reinicios.
- sends (glpi_plugin_coorddash_report_sends): una fila por proyecto y ejecución; el envío se «reclama» con un
  UPDATE condicional (pending|failed → sending) para que nunca se envíe dos veces en paralelo.
"""

import calendar
import base64
import html
import json
import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

from app.db import execute, fetch_all, fetch_one
from app.modules.sistema import mailer, survey
from app.modules.sistema.report_render import (
    hhmm_from_seconds,
    header_image_bytes,
    month_label,
    render_docx,
    render_html,
    render_pdf,
    report_filename,
)
from app.modules.sistema.schema import T_REPORT_PROJECTS, T_REPORT_RUNS, T_REPORT_SENDS
from app.modules.sistema.store import KEY_REPORT_SCHEDULE, get_setting, set_setting
from app.modules.soporte import reports
from app.modules.soporte.config import get_settings

log = logging.getLogger(__name__)

Frequency = Literal["monthly_day", "monthly_last_day", "monthly_last_business_day", "weekly", "daily"]
PeriodMode = Literal["current_month", "previous_month"]
AttachmentFormat = Literal["docx", "pdf", "both", "none"]

CATCH_UP_WINDOW = timedelta(hours=48)
RETRY_BACKOFF = [timedelta(minutes=15), timedelta(hours=1), timedelta(hours=4)]
STALE_SENDING_AFTER = timedelta(minutes=15)

DEFAULT_SUBJECT = "Informe de soporte técnico {proyecto} - {periodo}"
DEFAULT_BODY = (
    "Estimados,\n\n"
    "A continuación se presenta el informe de soporte técnico del proyecto {proyecto} correspondiente al período "
    "{periodo} (del {desde} al {hasta}).\n\n"
    "Ante cualquier consulta, puede responder a este correo."
)
# Plantilla anterior (antes de incluir el informe en el cuerpo); si sigue sin editar se reemplaza por la nueva.
_LEGACY_DEFAULT_BODY = (
    "Estimados,\n\n"
    "Adjuntamos el informe de soporte técnico del proyecto {proyecto} correspondiente al período {periodo} "
    "(del {desde} al {hasta}).\n\n"
    "Resumen:\n"
    "- Tickets atendidos: {total_tickets}\n"
    "- Tiempo total invertido: {total_horas}\n"
    "- Tiempo facturable: {horas_facturables}\n\n"
    "Ante cualquier consulta, puede responder a este correo.\n\n"
    "Saludos cordiales,\n"
    "Departamento de Atención al Cliente\n"
    "SIDESOFT CIA. LTDA."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------- configuración

class ScheduleConfig(BaseModel):
    enabled: bool = False
    frequency: Frequency = "monthly_last_business_day"
    day_of_month: int = Field(default=1, ge=1, le=31)
    weekday: int = Field(default=4, ge=0, le=6, description="0 = lunes … 6 = domingo")
    send_time: str = "18:00"
    timezone: str = "America/Guayaquil"
    period_mode: PeriodMode = "current_month"
    attachment_format: AttachmentFormat = "pdf"
    # El informe (resumen de tiempo y detalle de tickets) va en el cuerpo del correo, después del texto de la plantilla.
    embed_report_in_body: bool = True
    # Encuesta de satisfacción: bloque con enlace firmado a la página pública /encuesta.
    survey_enabled: bool = False
    survey_base_url: str = Field(default="", max_length=255, description="URL pública del panel, p. ej. https://soporte.sidesoft.com.ec")
    training_modules: List[str] = Field(default_factory=lambda: list(survey.DEFAULT_TRAINING_MODULES))
    skip_empty: bool = True
    cc: List[str] = Field(default_factory=list)
    bcc: List[str] = Field(default_factory=list)
    subject_template: str = DEFAULT_SUBJECT
    body_template: str = DEFAULT_BODY
    # Solicitantes con correo de estos dominios no reciben el informe (p. ej. personal interno que abrió el ticket).
    exclude_domains: List[str] = Field(default_factory=lambda: ["sidesoft.com.ec"])
    test_mode: bool = True
    test_recipients: List[str] = Field(default_factory=list)
    max_attempts: int = Field(default=3, ge=1, le=10)
    # UTC ISO; ocurrencias anteriores a esta marca no se envían (evita «recuperar» meses viejos al activar).
    active_since: Optional[str] = None

    @field_validator("send_time")
    @classmethod
    def _v_time(cls, v: str) -> str:
        try:
            t = datetime.strptime(v.strip(), "%H:%M").time()
        except ValueError as e:
            raise ValueError("Hora inválida (formato HH:MM).") from e
        return t.strftime("%H:%M")

    @field_validator("timezone")
    @classmethod
    def _v_tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as e:
            raise ValueError(f"Zona horaria desconocida: {v}") from e
        return v

    @field_validator("cc", "bcc", "test_recipients", mode="before")
    @classmethod
    def _v_emails(cls, v: Any) -> List[str]:
        return mailer.normalize_email_list(v)

    @field_validator("survey_base_url")
    @classmethod
    def _v_base_url(cls, v: str) -> str:
        v = (v or "").strip().rstrip("/")
        if v and not v.startswith(("http://", "https://")):
            raise ValueError("La URL pública de la encuesta debe empezar con http:// o https://")
        return v

    @field_validator("training_modules", mode="before")
    @classmethod
    def _v_modules(cls, v: Any) -> List[str]:
        items = v if isinstance(v, list) else str(v or "").split("\n")
        out = [str(x).strip() for x in items if str(x).strip() and str(x).strip() != survey.OTHER_MODULE]
        return list(dict.fromkeys(out))

    @field_validator("exclude_domains", mode="before")
    @classmethod
    def _v_domains(cls, v: Any) -> List[str]:
        items = v if isinstance(v, list) else str(v or "").replace(";", ",").split(",")
        return sorted({str(x).strip().lstrip("@").lower() for x in items if str(x).strip()})

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


def load_schedule() -> ScheduleConfig:
    raw = get_setting(KEY_REPORT_SCHEDULE) or {}
    if raw.get("body_template") == _LEGACY_DEFAULT_BODY:
        raw["body_template"] = DEFAULT_BODY
    try:
        return ScheduleConfig(**raw)
    except ValueError:
        log.exception("Configuración de programación inválida en BD; se usan valores por defecto.")
        return ScheduleConfig()


_TIMING_FIELDS = ("enabled", "frequency", "day_of_month", "weekday", "send_time", "timezone")


def save_schedule(new: ScheduleConfig, users_id: int) -> ScheduleConfig:
    old = load_schedule()
    data = new.model_dump()
    timing_changed = any(getattr(old, f) != getattr(new, f) for f in _TIMING_FIELDS)
    if new.enabled and (timing_changed or not old.active_since):
        # Al activar o cambiar el horario, solo cuentan ocurrencias futuras.
        data["active_since"] = _utcnow().isoformat(timespec="seconds")
    else:
        data["active_since"] = old.active_since
    set_setting(KEY_REPORT_SCHEDULE, data, users_id)
    return ScheduleConfig(**data)


# --------------------------------------------------------------------------- calendario

def _last_business_day(y: int, m: int) -> date:
    d = date(y, m, calendar.monthrange(y, m)[1])
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _matches(cfg: ScheduleConfig, d: date) -> bool:
    last = calendar.monthrange(d.year, d.month)[1]
    if cfg.frequency == "daily":
        return True
    if cfg.frequency == "weekly":
        return d.weekday() == cfg.weekday
    if cfg.frequency == "monthly_day":
        return d.day == min(cfg.day_of_month, last)
    if cfg.frequency == "monthly_last_day":
        return d.day == last
    return d == _last_business_day(d.year, d.month)


def _occurrences_around(cfg: ScheduleConfig, now_local: datetime) -> List[datetime]:
    hh, mm = (int(x) for x in cfg.send_time.split(":"))
    start = now_local.date() - timedelta(days=40)
    out = []
    for i in range(82):
        d = start + timedelta(days=i)
        if _matches(cfg, d):
            out.append(datetime.combine(d, time(hh, mm), tzinfo=cfg.tz))
    return out


def last_occurrence(cfg: ScheduleConfig, now_utc: Optional[datetime] = None) -> Optional[datetime]:
    now_local = (now_utc or datetime.now(timezone.utc)).astimezone(cfg.tz)
    past = [o for o in _occurrences_around(cfg, now_local) if o <= now_local]
    return past[-1] if past else None


def next_occurrence(cfg: ScheduleConfig, now_utc: Optional[datetime] = None) -> Optional[datetime]:
    now_local = (now_utc or datetime.now(timezone.utc)).astimezone(cfg.tz)
    fut = [o for o in _occurrences_around(cfg, now_local) if o > now_local]
    return fut[0] if fut else None


def period_for(cfg: ScheduleConfig, ref: date) -> Tuple[date, date]:
    if cfg.period_mode == "previous_month":
        last_prev = ref.replace(day=1) - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    return ref.replace(day=1), ref


def today_local(cfg: ScheduleConfig) -> date:
    return datetime.now(timezone.utc).astimezone(cfg.tz).date()


# --------------------------------------------------------------------------- proyectos

def list_projects_with_config() -> List[Dict[str, Any]]:
    rows = fetch_all(
        f"""
        SELECT p.id, p.name,
               COALESCE(c.is_active, 1) AS is_active,
               c.extra_to, c.extra_cc
        FROM glpi_projects p
        LEFT JOIN `{T_REPORT_PROJECTS}` c ON c.projects_id = p.id
        WHERE p.is_deleted = 0 AND COALESCE(p.name, '') <> ''
        ORDER BY p.name
        """
    )
    for r in rows:
        r["is_active"] = bool(r["is_active"])
        r["extra_to"] = mailer.normalize_email_list(r.get("extra_to"))
        r["extra_cc"] = mailer.normalize_email_list(r.get("extra_cc"))
    return rows


class ProjectConfigIn(BaseModel):
    is_active: bool = True
    extra_to: List[str] = Field(default_factory=list)
    extra_cc: List[str] = Field(default_factory=list)

    @field_validator("extra_to", "extra_cc", mode="before")
    @classmethod
    def _v_emails(cls, v: Any) -> List[str]:
        return mailer.normalize_email_list(v)


def save_project_config(project_id: int, data: ProjectConfigIn, users_id: int) -> None:
    if not fetch_one("SELECT id FROM glpi_projects WHERE id = %s AND is_deleted = 0", (project_id,)):
        raise ValueError("Proyecto no encontrado.")
    execute(
        f"""
        INSERT INTO `{T_REPORT_PROJECTS}`
            (projects_id, is_active, extra_to, extra_cc, users_id_mod, date_mod)
        VALUES (%s, %s, %s, %s, %s, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE
            is_active = VALUES(is_active), extra_to = VALUES(extra_to), extra_cc = VALUES(extra_cc),
            users_id_mod = VALUES(users_id_mod), date_mod = UTC_TIMESTAMP()
        """,
        (
            project_id, int(data.is_active), ", ".join(data.extra_to), ", ".join(data.extra_cc), users_id,
        ),
    )


def _project_row(project_id: int) -> Dict[str, Any]:
    for p in list_projects_with_config():
        if int(p["id"]) == project_id:
            return p
    raise ValueError(f"Proyecto {project_id} no encontrado.")


# --------------------------------------------------------------------------- destinatarios

def requester_recipients(ticket_ids: Sequence[int]) -> List[Dict[str, Any]]:
    """Solicitantes (activos) de los tickets, con su correo principal de GLPI o el correo alternativo del ticket."""
    ids = sorted({int(t) for t in ticket_ids if t})
    if not ids:
        return []
    req_type = int(get_settings().requester_link_type)
    placeholders = ", ".join(["%s"] * len(ids))
    rows = fetch_all(
        f"""
        SELECT
            tu.users_id,
            COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                NULLIF(TRIM(u.name), ''),
                ''
            ) AS name,
            COALESCE(
                (SELECT ue.email FROM glpi_useremails ue
                 WHERE ue.users_id = u.id AND COALESCE(ue.email, '') <> ''
                 ORDER BY ue.is_default DESC, ue.id ASC LIMIT 1),
                NULLIF(TRIM(tu.alternative_email), '')
            ) AS email,
            COUNT(DISTINCT tu.tickets_id) AS tickets
        FROM glpi_tickets_users tu
        LEFT JOIN glpi_users u ON u.id = tu.users_id
        WHERE tu.type = %s
          AND tu.tickets_id IN ({placeholders})
          AND (tu.users_id = 0 OR (u.is_active = 1 AND u.is_deleted = 0))
        GROUP BY tu.users_id, name, email
        """,
        (req_type, *ids),
    )
    out: List[Dict[str, Any]] = []
    seen = set()
    for r in rows:
        email = str(r.get("email") or "").strip()
        if not email or "@" not in email or email.lower() in seen:
            continue
        seen.add(email.lower())
        out.append({"users_id": int(r["users_id"] or 0), "name": r.get("name") or "", "email": email,
                    "tickets": int(r.get("tickets") or 0)})
    out.sort(key=lambda x: x["name"].lower() or x["email"].lower())
    return out


# --------------------------------------------------------------------------- armado del correo

class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _fmt_date(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def build_package(project_id: int, date_from: date, date_to: date, cfg: ScheduleConfig) -> Dict[str, Any]:
    """Datos del informe, destinatarios y asunto/cuerpo de un proyecto (sin adjuntos: ver `render_attachments`)."""
    project = _project_row(project_id)
    name = str(project["name"])
    report = reports.support_report(project_id, date_from.isoformat(), date_to.isoformat())
    rows = report["rows"]
    summary = report["summary"]

    excluded = set(cfg.exclude_domains)
    requesters = [
        r for r in requester_recipients([r["id"] for r in rows])
        if r["email"].rsplit("@", 1)[-1].lower() not in excluded
    ]
    to = mailer.normalize_email_list([r["email"] for r in requesters] + project["extra_to"])
    cc = [e for e in mailer.normalize_email_list(cfg.cc + project["extra_cc"]) if e.lower() not in {t.lower() for t in to}]

    variables = _SafeDict(
        proyecto=name,
        periodo=month_label(date_from),
        desde=_fmt_date(date_from),
        hasta=_fmt_date(date_to),
        total_tickets=len(rows),
        total_horas=hhmm_from_seconds(summary["total"]["seconds"]),
    )
    subject = (cfg.subject_template or DEFAULT_SUBJECT).format_map(variables).strip()
    body = (cfg.body_template or DEFAULT_BODY).format_map(variables)

    return {
        "project_id": project_id,
        "project_name": name,
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "tickets_count": len(rows),
        "summary": summary,
        "requesters": requesters,
        "to": to,
        "cc": cc,
        "bcc": list(cfg.bcc),
        "subject": subject,
        "body": body,
        "_report": report,
    }


def render_file(pkg: Dict[str, Any], fmt: str, issued: date) -> Tuple[str, bytes]:
    name, report = pkg["project_name"], pkg["_report"]
    if fmt == "pdf":
        return report_filename(name, "pdf"), render_pdf(name, report, issued)
    return report_filename(name, "docx"), render_docx(name, report, issued)


def render_attachments(pkg: Dict[str, Any], cfg: ScheduleConfig) -> List[Tuple[str, bytes]]:
    if cfg.attachment_format == "none":
        return []
    issued = today_local(cfg)
    fmts = ["docx", "pdf"] if cfg.attachment_format == "both" else [cfg.attachment_format]
    return [render_file(pkg, f, issued) for f in fmts]


LOGO_CID = "logo-sidesoft@coorddash"


def survey_block_html(pkg: Dict[str, Any], cfg: ScheduleConfig, send_id: int) -> str:
    """Invitación a la encuesta: cada número abre la encuesta con esa calificación preseleccionada."""
    if not (cfg.survey_enabled and cfg.survey_base_url):
        return ""
    d_from, d_to = date.fromisoformat(pkg["date_from"]), date.fromisoformat(pkg["date_to"])

    def url(score: Optional[int] = None) -> str:
        return html.escape(survey.survey_url(cfg.survey_base_url, pkg["project_id"], d_from, d_to, send_id, score))

    accent = "#1F4E78"
    cells = "".join(
        f'<td align="center" style="padding:0 3px"><a href="{url(n)}" '
        f'style="display:block;width:40px;padding:9px 0;border:1px solid #c9d6e3;border-radius:6px;background:#ffffff;'
        f'color:{accent};font-weight:bold;font-size:16px;text-decoration:none">{n}</a></td>'
        for n in range(6)
    )
    return f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px">
<tr><td style="background:#f4f7fb;border:1px solid #d9e2ec;border-left:4px solid {accent};padding:16px 18px;
               font-family:Calibri,'Segoe UI',Arial,sans-serif">
  <p style="margin:0 0 4px;font-size:16px;font-weight:bold;color:{accent}">Encuesta de satisfacción</p>
  <p style="margin:0 0 12px;font-size:14px;color:#1a1a1a">
    Su opinión nos ayuda a mejorar. ¿Cómo califica el <strong>tiempo de solución</strong> de sus requerimientos
    durante {html.escape(month_label(d_from))}? Seleccione una calificación para completar la encuesta
    (le tomará menos de un minuto).
  </p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>{cells}</tr></table>
  <table role="presentation" width="276" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px">
    <tr><td style="font-size:11px;color:#6c757d">0 = Muy lento</td>
        <td align="right" style="font-size:11px;color:#6c757d">5 = Muy rápido</td></tr>
  </table>
  <p style="margin:14px 0 0"><a href="{url()}" style="display:inline-block;background:{accent};color:#ffffff;
     padding:10px 18px;border-radius:6px;font-weight:bold;font-size:14px;text-decoration:none">Responder la encuesta</a></p>
</td></tr></table>"""


def email_html(
    pkg: Dict[str, Any], cfg: ScheduleConfig, *, logo_src: str, note: Optional[str] = None, send_id: int = 0
) -> str:
    """Cuerpo HTML: aviso de prueba + texto de la plantilla + encuesta (opcional) + informe (opcional)."""
    parts = [
        '<div style="font-family:Calibri,Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">'
    ]
    if note:
        parts.append(
            '<div style="background:#fff3cd;border:1px solid #e9a100;padding:8px 12px;margin-bottom:14px;'
            f'font-size:13px">{html.escape(note).replace(chr(10), "<br>")}</div>'
        )
    parts.append(f'<div style="margin-bottom:16px">{html.escape(pkg["body"]).replace(chr(10), "<br>")}</div>')
    parts.append(survey_block_html(pkg, cfg, send_id))
    if cfg.embed_report_in_body:
        parts.append(
            render_html(pkg["project_name"], pkg["_report"], today_local(cfg), logo_src)
        )
    parts.append("</div>")
    return "".join(parts)


def logo_data_uri() -> str:
    data = header_image_bytes()
    return "data:image/jpeg;base64," + base64.b64encode(data).decode() if data else ""


# --------------------------------------------------------------------------- ejecuciones

def _active_project_ids(only: Optional[Sequence[int]] = None) -> List[Tuple[int, str]]:
    projects = list_projects_with_config()
    if only is None:
        projects = [p for p in projects if p["is_active"]]
    else:
        # Envío manual de proyectos elegidos: se respeta la selección aunque estén excluidos del automático.
        wanted = {int(x) for x in only}
        projects = [p for p in projects if int(p["id"]) in wanted]
    return [(int(p["id"]), str(p["name"])) for p in projects]


def create_run(
    trigger: str,
    occurrence_key: str,
    period_from: date,
    period_to: date,
    test_mode: bool,
    project_ids: Optional[Sequence[int]] = None,
    users_id: int = 0,
) -> Optional[int]:
    """Crea la ejecución y sus filas de envío (una por proyecto). Devuelve None si la ocurrencia ya existía."""
    affected, run_id = execute(
        f"""
        INSERT IGNORE INTO `{T_REPORT_RUNS}`
            (trigger_type, occurrence_key, period_from, period_to, status, project_ids, test_mode,
             users_id_requested, date_creation)
        VALUES (%s, %s, %s, %s, 'queued', %s, %s, %s, UTC_TIMESTAMP())
        """,
        (
            trigger, occurrence_key, period_from, period_to,
            json.dumps(list(project_ids)) if project_ids is not None else None,
            int(test_mode), users_id,
        ),
    )
    if not affected:
        return None
    projects = _active_project_ids(project_ids)
    for pid, pname in projects:
        execute(
            f"""
            INSERT IGNORE INTO `{T_REPORT_SENDS}` (runs_id, projects_id, project_name, status, date_creation, date_mod)
            VALUES (%s, %s, %s, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP())
            """,
            (run_id, pid, pname),
        )
    execute(f"UPDATE `{T_REPORT_RUNS}` SET total_projects = %s WHERE id = %s", (len(projects), run_id))
    return run_id


def enqueue_manual_run(
    cfg: ScheduleConfig,
    users_id: int,
    project_ids: Optional[Sequence[int]],
    date_from: Optional[date],
    date_to: Optional[date],
) -> int:
    if date_from is None or date_to is None:
        date_from, date_to = period_for(cfg, today_local(cfg))
    if date_to < date_from:
        raise ValueError("La fecha hasta no puede ser menor que la fecha desde.")
    run_id = create_run(
        "manual", f"manual:{uuid.uuid4().hex}", date_from, date_to, cfg.test_mode, project_ids, users_id
    )
    assert run_id is not None
    return run_id


def enqueue_due_auto_run(cfg: ScheduleConfig, now_utc: Optional[datetime] = None) -> Optional[int]:
    """Si hay una ocurrencia programada vencida (dentro de la ventana de recuperación) sin ejecutar, la encola."""
    if not cfg.enabled:
        return None
    now_utc = now_utc or datetime.now(timezone.utc)
    occ = last_occurrence(cfg, now_utc)
    if occ is None or now_utc - occ > CATCH_UP_WINDOW:
        return None
    if cfg.active_since:
        since = datetime.fromisoformat(cfg.active_since).replace(tzinfo=timezone.utc)
        if occ < since:
            return None
    p_from, p_to = period_for(cfg, occ.date())
    # Envío real: una ejecución por día local (aunque se cambie la hora, no se reenvía a los clientes).
    # Modo prueba: una por fecha y hora, para poder probar varias veces al día sin bloquear el envío real.
    key = (
        f"auto-test:{occ.strftime('%Y-%m-%dT%H:%M')}" if cfg.test_mode else f"auto:{occ.date().isoformat()}"
    )
    if fetch_one(f"SELECT id FROM `{T_REPORT_RUNS}` WHERE occurrence_key = %s", (key,)):
        return None  # ya ejecutada (evita gastar ids AUTO_INCREMENT con INSERT IGNORE en cada ciclo)
    return create_run("auto", key, p_from, p_to, cfg.test_mode, None)


def _claim_send(send_id: int) -> bool:
    affected, _ = execute(
        f"""
        UPDATE `{T_REPORT_SENDS}`
        SET status = 'sending', attempts = attempts + 1, date_mod = UTC_TIMESTAMP()
        WHERE id = %s AND status IN ('pending', 'failed')
        """,
        (send_id,),
    )
    return affected == 1


def _finish_send(send_id: int, **fields: Any) -> None:
    cols = ", ".join(f"{k} = %s" for k in fields)
    execute(
        f"UPDATE `{T_REPORT_SENDS}` SET {cols}, date_mod = UTC_TIMESTAMP() WHERE id = %s",
        (*fields.values(), send_id),
    )


def process_send(send: Dict[str, Any], run: Dict[str, Any], cfg: ScheduleConfig) -> str:
    send_id = int(send["id"])
    if not _claim_send(send_id):
        return "busy"
    attempts = int(send.get("attempts") or 0) + 1
    try:
        pkg = build_package(int(send["projects_id"]), run["period_from"], run["period_to"], cfg)
        names = {r["email"].lower(): r["name"] for r in pkg["requesters"]}
        common = {
            "project_name": pkg["project_name"],
            "tickets_count": pkg["tickets_count"],
            "total_seconds": int(pkg["summary"]["total"]["seconds"]),
            "recipients_to": json.dumps(
                [{"email": e, "name": names.get(e.lower(), "")} for e in pkg["to"]], ensure_ascii=False
            ),
            "recipients_cc": json.dumps(pkg["cc"], ensure_ascii=False),
            "subject": pkg["subject"][:255],
        }
        if pkg["tickets_count"] == 0 and cfg.skip_empty:
            _finish_send(send_id, status="skipped", skip_reason="Sin tickets con tiempo registrado en el período.",
                         last_error=None, next_attempt_at=None, **common)
            return "skipped"
        test_mode = bool(run.get("test_mode"))
        if not pkg["to"] and not test_mode:
            _finish_send(send_id, status="skipped", skip_reason="Ningún solicitante tiene correo registrado en GLPI.",
                         last_error=None, next_attempt_at=None, **common)
            return "skipped"

        to, cc, bcc, subject, note = pkg["to"], pkg["cc"], pkg["bcc"], pkg["subject"], None
        if test_mode:
            if not cfg.test_recipients:
                raise ValueError("Modo prueba activo sin destinatarios de prueba configurados.")
            note = (
                "MODO PRUEBA - este correo no se envió al cliente.\n"
                f"Destinatarios reales: {', '.join(to) or '(ninguno)'}"
                + (f"\nCC reales: {', '.join(cc)}" if cc else "")
            )
            to, cc, bcc, subject = list(cfg.test_recipients), [], [], f"[PRUEBA] {subject}"
        text = f"{note}\n\n{pkg['body']}" if note else pkg["body"]
        logo = header_image_bytes()
        message_id = mailer.send_mail(
            to, subject, text,
            email_html(pkg, cfg, logo_src=f"cid:{LOGO_CID}" if logo else "", note=note, send_id=send_id),
            cc=cc, bcc=bcc, attachments=render_attachments(pkg, cfg),
            inline_images=[(LOGO_CID, logo, "jpeg")] if logo and cfg.embed_report_in_body else [],
        )
        _finish_send(send_id, status="sent", message_id=message_id[:255], date_sent=_utcnow(), last_error=None,
                     next_attempt_at=None, skip_reason=None, **common)
        return "sent"
    except Exception as e:  # noqa: BLE001 — se registra cualquier fallo para reintento
        log.exception("Fallo al enviar informe (send %s, proyecto %s)", send_id, send.get("projects_id"))
        next_at = None
        if attempts < cfg.max_attempts:
            next_at = _utcnow() + RETRY_BACKOFF[min(attempts - 1, len(RETRY_BACKOFF) - 1)]
        _finish_send(send_id, status="failed", last_error=f"{type(e).__name__}: {e}"[:2000], next_attempt_at=next_at)
        return "failed"


def refresh_run_status(run_id: int) -> None:
    c = fetch_one(
        f"""
        SELECT
            SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'skipped') AS skipped,
            SUM(status IN ('pending', 'sending')) AS open_, COUNT(*) AS total
        FROM `{T_REPORT_SENDS}` WHERE runs_id = %s
        """,
        (run_id,),
    ) or {}
    sent, failed, skipped, open_ = (int(c.get(k) or 0) for k in ("sent", "failed", "skipped", "open_"))
    if open_:
        status = "running"
    elif failed and not sent:
        status = "failed"
    elif failed:
        status = "partial"
    else:
        status = "done"
    execute(
        f"""
        UPDATE `{T_REPORT_RUNS}`
        SET status = %s, sent_count = %s, failed_count = %s, skipped_count = %s,
            date_end = CASE WHEN %s IN ('done', 'partial', 'failed') THEN UTC_TIMESTAMP() ELSE NULL END
        WHERE id = %s
        """,
        (status, sent, failed, skipped, status, run_id),
    )


def _get_run(run_id: int) -> Optional[Dict[str, Any]]:
    return fetch_one(f"SELECT * FROM `{T_REPORT_RUNS}` WHERE id = %s", (run_id,))


def execute_run(run_id: int, cfg: ScheduleConfig) -> None:
    run = _get_run(run_id)
    if not run:
        return
    execute(
        f"UPDATE `{T_REPORT_RUNS}` SET status = 'running', date_start = COALESCE(date_start, UTC_TIMESTAMP()) WHERE id = %s",
        (run_id,),
    )
    sends = fetch_all(
        f"SELECT * FROM `{T_REPORT_SENDS}` WHERE runs_id = %s AND status = 'pending' ORDER BY project_name",
        (run_id,),
    )
    for s in sends:
        process_send(s, run, cfg)
    refresh_run_status(run_id)


def process_queued_runs(cfg: ScheduleConfig) -> int:
    runs = fetch_all(f"SELECT id FROM `{T_REPORT_RUNS}` WHERE status = 'queued' ORDER BY id")
    for r in runs:
        execute_run(int(r["id"]), cfg)
    return len(runs)


def process_due_retries(cfg: ScheduleConfig) -> int:
    rows = fetch_all(
        f"""
        SELECT s.* FROM `{T_REPORT_SENDS}` s
        WHERE s.status = 'failed' AND s.next_attempt_at IS NOT NULL AND s.next_attempt_at <= UTC_TIMESTAMP()
        ORDER BY s.next_attempt_at
        LIMIT 50
        """
    )
    touched = set()
    for s in rows:
        run = _get_run(int(s["runs_id"]))
        if run:
            process_send(s, run, cfg)
            touched.add(int(s["runs_id"]))
    for rid in touched:
        refresh_run_status(rid)
    return len(rows)


def recover_stale_sending() -> int:
    """Envíos que quedaron en «sending» (worker detenido a mitad): se marcan fallidos SIN reintento automático,
    porque el correo pudo haber salido; se reintentan manualmente desde el historial."""
    cutoff = _utcnow() - STALE_SENDING_AFTER
    stale = fetch_all(
        f"SELECT id, runs_id FROM `{T_REPORT_SENDS}` WHERE status = 'sending' AND date_mod < %s", (cutoff,)
    )
    for s in stale:
        _finish_send(
            int(s["id"]), status="failed", next_attempt_at=None,
            last_error="Envío interrumpido (worker detenido durante el envío). Verifique antes de reintentar.",
        )
    for run_id in {int(s["runs_id"]) for s in stale}:
        refresh_run_status(run_id)
    return len(stale)


def retry_send(send_id: int) -> None:
    s = fetch_one(f"SELECT runs_id, status FROM `{T_REPORT_SENDS}` WHERE id = %s", (send_id,))
    if not s:
        raise ValueError("Envío no encontrado.")
    if s["status"] not in ("failed", "skipped"):
        raise ValueError("Solo se pueden reintentar envíos fallidos u omitidos.")
    execute(
        f"""
        UPDATE `{T_REPORT_SENDS}`
        SET status = 'pending', next_attempt_at = NULL, skip_reason = NULL, date_mod = UTC_TIMESTAMP()
        WHERE id = %s
        """,
        (send_id,),
    )
    execute(f"UPDATE `{T_REPORT_RUNS}` SET status = 'queued', date_end = NULL WHERE id = %s", (s["runs_id"],))


# --------------------------------------------------------------------------- consultas historial

def _iso_utc(v: Any) -> Optional[str]:
    if isinstance(v, datetime):
        return v.replace(tzinfo=timezone.utc).isoformat()
    return None


def list_runs(limit: int = 50) -> List[Dict[str, Any]]:
    rows = fetch_all(
        f"""
        SELECT r.*, COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.firstname,''),' ',COALESCE(u.realname,''))),''), u.name) AS requested_by
        FROM `{T_REPORT_RUNS}` r
        LEFT JOIN glpi_users u ON u.id = r.users_id_requested
        ORDER BY r.id DESC LIMIT %s
        """,
        (int(limit),),
    )
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "trigger": r["trigger_type"], "status": r["status"],
            "period_from": r["period_from"].isoformat(), "period_to": r["period_to"].isoformat(),
            "test_mode": bool(r["test_mode"]), "requested_by": r.get("requested_by"),
            "total_projects": r["total_projects"], "sent": r["sent_count"], "failed": r["failed_count"],
            "skipped": r["skipped_count"], "error": r.get("error"),
            "created_at": _iso_utc(r["date_creation"]), "started_at": _iso_utc(r["date_start"]),
            "finished_at": _iso_utc(r["date_end"]),
        })
    return out


def list_sends(run_id: int) -> List[Dict[str, Any]]:
    rows = fetch_all(f"SELECT * FROM `{T_REPORT_SENDS}` WHERE runs_id = %s ORDER BY project_name", (run_id,))
    out = []
    for s in rows:
        out.append({
            "id": s["id"], "project_id": s["projects_id"], "project_name": s["project_name"], "status": s["status"],
            "skip_reason": s.get("skip_reason"),
            "recipients_to": json.loads(s["recipients_to"]) if s.get("recipients_to") else [],
            "recipients_cc": json.loads(s["recipients_cc"]) if s.get("recipients_cc") else [],
            "subject": s.get("subject"), "tickets_count": s["tickets_count"],
            "total_hhmm": hhmm_from_seconds(s["total_seconds"]),
            "attempts": s["attempts"], "last_error": s.get("last_error"),
            "next_attempt_at": _iso_utc(s.get("next_attempt_at")), "sent_at": _iso_utc(s.get("date_sent")),
        })
    return out
