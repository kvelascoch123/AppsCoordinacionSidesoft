"""Rutas de autenticación y de «Configuraciones del sistema» (solo perfil administrador)."""

import logging
from datetime import date, datetime, timezone
from typing import List, Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.modules.sistema import auth, mailer, report_mail, survey
from app.modules.sistema.auth import CurrentUser, require_admin
from app.modules.sistema.store import KEY_WORKER_HEARTBEAT, SecretKeyMissing, get_setting
from app.modules.soporte.config import get_settings

log = logging.getLogger(__name__)

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])
router = APIRouter(prefix="/api/system", tags=["sistema"])
survey_router = APIRouter(prefix="/api/survey", tags=["encuesta"])  # público (sin sesión)


# --------------------------------------------------------------------------- auth

class LoginBody(BaseModel):
    login: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=1024)


@auth_router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    ip = request.client.host if request.client else "?"
    try:
        user = auth.authenticate(body.login, body.password, ip)
        token, max_age = auth.issue_token(user)
    except auth.AuthError as e:
        log.info("Login fallido para %r desde %s: %s", body.login, ip, e.detail)
        raise HTTPException(status_code=e.status, detail=e.detail) from e
    auth.set_session_cookie(response, token, max_age)
    log.info("Login correcto: %s (%s) desde %s", user.login, user.role, ip)
    return {"user": user.to_public()}


@auth_router.post("/logout")
def logout(response: Response):
    auth.clear_session_cookie(response)
    return {"ok": True}


@auth_router.get("/me")
def me(user: CurrentUser = Depends(auth.require_user)):
    return {"user": user.to_public(), "auth_enabled": get_settings().auth_enabled}


# --------------------------------------------------------------------------- SMTP

def _secret_error(e: SecretKeyMissing) -> HTTPException:
    return HTTPException(status_code=500, detail=str(e))


@router.get("/smtp")
def get_smtp(_: CurrentUser = Depends(require_admin)):
    return mailer.load_smtp_public()


@router.put("/smtp")
def put_smtp(body: mailer.SmtpConfigIn, user: CurrentUser = Depends(require_admin)):
    try:
        return mailer.save_smtp(body, user.id)
    except SecretKeyMissing as e:
        raise _secret_error(e) from e


@router.get("/smtp/glpi-defaults")
def smtp_glpi_defaults(_: CurrentUser = Depends(require_admin)):
    return mailer.glpi_smtp_defaults()


class SmtpTestBody(BaseModel):
    to: str = Field(..., min_length=3, max_length=255)


@router.post("/smtp/test")
def smtp_test(body: SmtpTestBody, user: CurrentUser = Depends(require_admin)):
    to = mailer.normalize_email_list(body.to)
    if not to:
        raise HTTPException(status_code=400, detail="Correo de destino inválido.")
    try:
        mailer.send_mail(
            to,
            "Prueba de configuración SMTP - Coordinación GLPI",
            f"Correo de prueba enviado por {user.full_name} desde «Configuraciones del sistema».\n"
            "Si lo recibió, la configuración SMTP es correcta.",
        )
    except (mailer.SmtpNotConfigured, SecretKeyMissing) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 — se devuelve el error del servidor SMTP al administrador
        raise HTTPException(status_code=502, detail=f"El servidor SMTP rechazó el envío: {type(e).__name__}: {e}") from e
    return {"ok": True, "to": to}


# --------------------------------------------------------------------------- programación

def _schedule_payload(cfg: report_mail.ScheduleConfig) -> dict:
    nxt = report_mail.next_occurrence(cfg) if cfg.enabled else None
    period = report_mail.period_for(cfg, nxt.date()) if nxt else None
    hb = get_setting(KEY_WORKER_HEARTBEAT) or {}
    return {
        "config": cfg.model_dump(),
        "next_run_at": nxt.isoformat() if nxt else None,
        "next_period": {"from": period[0].isoformat(), "to": period[1].isoformat()} if period else None,
        "worker_heartbeat": hb.get("at"),
        "server_now": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/report-mail/schedule")
def get_schedule(_: CurrentUser = Depends(require_admin)):
    return _schedule_payload(report_mail.load_schedule())


@router.put("/report-mail/schedule")
def put_schedule(body: report_mail.ScheduleConfig, user: CurrentUser = Depends(require_admin)):
    if body.test_mode and body.enabled and not body.test_recipients:
        raise HTTPException(status_code=400, detail="En modo prueba indique al menos un destinatario de prueba.")
    return _schedule_payload(report_mail.save_schedule(body, user.id))


# --------------------------------------------------------------------------- proyectos

@router.get("/report-mail/projects")
def get_projects(_: CurrentUser = Depends(require_admin)):
    return {"projects": report_mail.list_projects_with_config()}


@router.put("/report-mail/projects/{project_id}")
def put_project(project_id: int, body: report_mail.ProjectConfigIn, user: CurrentUser = Depends(require_admin)):
    try:
        report_mail.save_project_config(project_id, body, user.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"ok": True}


# --------------------------------------------------------------------------- vista previa

def _period(cfg: report_mail.ScheduleConfig, date_from: Optional[date], date_to: Optional[date]):
    if date_from and date_to:
        if date_to < date_from:
            raise HTTPException(status_code=400, detail="La fecha hasta no puede ser menor que la fecha desde.")
        return date_from, date_to
    return report_mail.period_for(cfg, report_mail.today_local(cfg))


@router.get("/report-mail/preview")
def preview(
    project_id: int,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    _: CurrentUser = Depends(require_admin),
):
    cfg = report_mail.load_schedule()
    d_from, d_to = _period(cfg, date_from, date_to)
    try:
        pkg = report_mail.build_package(project_id, d_from, d_to, cfg)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    pkg["html"] = report_mail.email_html(pkg, cfg, logo_src=report_mail.logo_data_uri())
    pkg.pop("_report", None)
    pkg["test_mode"] = cfg.test_mode
    pkg["test_recipients"] = cfg.test_recipients
    return pkg


@router.get("/report-mail/preview/file")
def preview_file(
    project_id: int,
    format: Literal["docx", "pdf"] = "pdf",
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    _: CurrentUser = Depends(require_admin),
):
    cfg = report_mail.load_schedule()
    d_from, d_to = _period(cfg, date_from, date_to)
    try:
        pkg = report_mail.build_package(project_id, d_from, d_to, cfg)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    filename, data = report_mail.render_file(pkg, format, report_mail.today_local(cfg))
    media = "application/pdf" if format == "pdf" else (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


# --------------------------------------------------------------------------- ejecuciones

class ManualRunBody(BaseModel):
    project_ids: Optional[List[int]] = Field(default=None, description="None = todos los proyectos activos")
    date_from: Optional[date] = None
    date_to: Optional[date] = None


@router.post("/report-mail/runs")
def create_manual_run(body: ManualRunBody, user: CurrentUser = Depends(require_admin)):
    cfg = report_mail.load_schedule()
    if cfg.test_mode and not cfg.test_recipients:
        raise HTTPException(status_code=400, detail="Modo prueba activo sin destinatarios de prueba configurados.")
    if body.project_ids is not None and not body.project_ids:
        raise HTTPException(status_code=400, detail="Seleccione al menos un proyecto.")
    try:
        run_id = report_mail.enqueue_manual_run(cfg, user.id, body.project_ids, body.date_from, body.date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"run_id": run_id, "test_mode": cfg.test_mode}


@router.get("/report-mail/runs")
def get_runs(limit: int = Query(50, ge=1, le=200), _: CurrentUser = Depends(require_admin)):
    return {"runs": report_mail.list_runs(limit)}


@router.get("/report-mail/runs/{run_id}/sends")
def get_run_sends(run_id: int, _: CurrentUser = Depends(require_admin)):
    return {"sends": report_mail.list_sends(run_id)}


@router.post("/report-mail/sends/{send_id}/retry")
def post_retry(send_id: int, _: CurrentUser = Depends(require_admin)):
    try:
        report_mail.retry_send(send_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


# --------------------------------------------------------------------------- encuesta (pública)

@survey_router.get("/context")
def survey_context(p: int, desde: date, hasta: date, k: str, s: int = 0):
    try:
        link = survey.SurveyLink(p=p, desde=desde, hasta=hasta, s=s, k=k)
        return survey.survey_context(link, report_mail.load_schedule().training_modules)
    except (survey.InvalidSurveyLink, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e) or "El enlace de la encuesta no es válido.") from e


@survey_router.post("/responses")
def survey_submit(body: survey.SubmitBody, request: Request):
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "")
    try:
        survey.submit_response(
            body, report_mail.load_schedule().training_modules, ip, request.headers.get("user-agent", "")
        )
    except survey.InvalidSurveyLink as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"ok": True}


# --------------------------------------------------------------------------- encuesta (panel)

@router.get("/surveys")
def get_surveys(
    project_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    _: CurrentUser = Depends(require_admin),
):
    return survey.list_responses(project_id, date_from, date_to)
