"""
Encuesta de satisfacción enviada con el informe de soporte.

El enlace del correo lleva el proyecto y el período en claro (`p`, `desde`, `hasta`, `s` = envío) más una firma
HMAC (`k`). La página pública /encuesta valida la firma antes de mostrar o guardar respuestas: así cada respuesta
queda asociada al proyecto correcto y nadie puede registrar respuestas para otro proyecto cambiando la URL.

Las respuestas solo se guardan con el POST del formulario (nunca al abrir el enlace), porque los filtros de
seguridad de Outlook/Gmail abren automáticamente los enlaces de los correos.
"""

import base64
import hashlib
import hmac
import threading
import time
from collections import defaultdict, deque
from datetime import date
from typing import Any, Deque, Dict, List, Optional
from urllib.parse import urlencode

from pydantic import BaseModel, Field, field_validator

from app.db import execute, fetch_all, fetch_one
from app.modules.sistema.report_render import month_label
from app.modules.sistema.schema import T_SURVEY_RESPONSES
from app.modules.soporte.config import get_settings

OTHER_MODULE = "Otro"
DEFAULT_TRAINING_MODULES = [
    "Facturación electrónica",
    "Cuentas por pagar / retenciones",
    "Cuentas por cobrar / cobranza",
    "Inventarios y bodegas",
    "Costos y producción",
    "Activos fijos",
    "Nómina",
    "Reportes / Business Intelligence",
]


class InvalidSurveyLink(ValueError):
    pass


# --------------------------------------------------------------------------- enlace firmado

def _key() -> bytes:
    secret = (get_settings().session_secret or "").encode()
    if len(secret) < 32:
        raise RuntimeError("DASHBOARD_SESSION_SECRET no configurado; es necesario para firmar los enlaces de la encuesta.")
    return hmac.new(secret, b"coorddash-survey-link-v1", hashlib.sha256).digest()


def _signature(project_id: int, d_from: date, d_to: date, send_id: int) -> str:
    msg = f"{project_id}|{d_from.isoformat()}|{d_to.isoformat()}|{send_id}".encode()
    digest = hmac.new(_key(), msg, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")[:22]


def survey_url(base_url: str, project_id: int, d_from: date, d_to: date, send_id: int = 0,
               solution_score: Optional[int] = None) -> str:
    params = {
        "p": project_id,
        "desde": d_from.isoformat(),
        "hasta": d_to.isoformat(),
        "s": send_id,
        "k": _signature(project_id, d_from, d_to, send_id),
    }
    if solution_score is not None:
        params["ts"] = solution_score  # preselecciona «Tiempo de solución» (no guarda nada)
    return f"{base_url.rstrip('/')}/encuesta?{urlencode(params)}"


class SurveyLink(BaseModel):
    p: int = Field(..., ge=1)
    desde: date
    hasta: date
    s: int = Field(default=0, ge=0)
    k: str = Field(..., min_length=10, max_length=64)

    def verify(self) -> None:
        expected = _signature(self.p, self.desde, self.hasta, self.s)
        if not hmac.compare_digest(expected, self.k):
            raise InvalidSurveyLink("El enlace de la encuesta no es válido.")


# --------------------------------------------------------------------------- contexto público

def survey_context(link: SurveyLink, training_modules: List[str]) -> Dict[str, Any]:
    link.verify()
    project = fetch_one("SELECT id, name FROM glpi_projects WHERE id = %s AND is_deleted = 0", (link.p,))
    if not project:
        raise InvalidSurveyLink("El proyecto de esta encuesta ya no está disponible.")
    return {
        "project_name": project["name"],
        "period_label": month_label(link.desde),
        "date_from": link.desde.isoformat(),
        "date_to": link.hasta.isoformat(),
        "training_modules": training_modules or DEFAULT_TRAINING_MODULES,
        "other_module": OTHER_MODULE,
    }


# --------------------------------------------------------------------------- respuestas

class SurveyAnswers(BaseModel):
    score_solution_time: int = Field(..., ge=0, le=5)
    score_response_time: int = Field(..., ge=0, le=5)
    score_quality: int = Field(..., ge=0, le=5)
    needs_training: bool
    training_module: Optional[str] = Field(default=None, max_length=120)
    training_other: Optional[str] = Field(default=None, max_length=200)
    respondent_name: Optional[str] = Field(default=None, max_length=150)
    observations: Optional[str] = Field(default=None, max_length=3000)

    @field_validator("training_module", "training_other", "respondent_name", "observations", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Optional[str]:
        v = str(v or "").strip()
        return v or None


class SubmitBody(BaseModel):
    link: SurveyLink
    answers: SurveyAnswers


_RL_MAX, _RL_WINDOW = 20, 3600
_rl_lock = threading.Lock()
_rl: Dict[str, Deque[float]] = defaultdict(deque)


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    with _rl_lock:
        q = _rl[ip]
        while q and now - q[0] > _RL_WINDOW:
            q.popleft()
        if len(q) >= _RL_MAX:
            return True
        q.append(now)
        return False


def submit_response(body: SubmitBody, training_modules: List[str], ip: str, user_agent: str) -> None:
    body.link.verify()
    if _rate_limited(ip):
        raise ValueError("Se recibieron demasiadas respuestas desde su conexión. Intente nuevamente más tarde.")
    a = body.answers
    module: Optional[str] = None
    if a.needs_training:
        allowed = training_modules or DEFAULT_TRAINING_MODULES
        if a.training_module == OTHER_MODULE:
            if not a.training_other:
                raise ValueError("Indique el módulo o proceso en el que requiere capacitación.")
            module = f"{OTHER_MODULE}: {a.training_other}"
        elif a.training_module in allowed:
            module = a.training_module
        else:
            raise ValueError("Seleccione el módulo o proceso en el que requiere capacitación.")
    project = fetch_one("SELECT name FROM glpi_projects WHERE id = %s", (body.link.p,))
    execute(
        f"""
        INSERT INTO `{T_SURVEY_RESPONSES}`
            (projects_id, project_name, period_from, period_to, sends_id, score_solution_time, score_response_time,
             score_quality, needs_training, training_module, respondent_name, observations, ip_address, user_agent,
             date_creation)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP())
        """,
        (
            body.link.p, project["name"] if project else None, body.link.desde, body.link.hasta, body.link.s,
            a.score_solution_time, a.score_response_time, a.score_quality, int(a.needs_training), module,
            a.respondent_name, a.observations, ip[:45], (user_agent or "")[:255],
        ),
    )


# --------------------------------------------------------------------------- consulta (panel)

def list_responses(project_id: Optional[int], date_from: Optional[date], date_to: Optional[date]) -> Dict[str, Any]:
    where, params = ["1=1"], []
    if project_id:
        where.append("projects_id = %s")
        params.append(project_id)
    if date_from:
        where.append("date_creation >= %s")
        params.append(date_from)
    if date_to:
        where.append("date_creation < DATE_ADD(%s, INTERVAL 1 DAY)")
        params.append(date_to)
    cond = " AND ".join(where)
    rows = fetch_all(
        f"""
        SELECT id, projects_id, project_name, period_from, period_to, score_solution_time, score_response_time,
               score_quality, needs_training, training_module, respondent_name, observations, date_creation
        FROM `{T_SURVEY_RESPONSES}` WHERE {cond} ORDER BY date_creation DESC, id DESC LIMIT 1000
        """,
        tuple(params),
    )
    summary = fetch_all(
        f"""
        SELECT projects_id, MAX(project_name) AS project_name, COUNT(*) AS responses,
               ROUND(AVG(score_solution_time), 2) AS avg_solution_time,
               ROUND(AVG(score_response_time), 2) AS avg_response_time,
               ROUND(AVG(score_quality), 2) AS avg_quality,
               SUM(needs_training) AS training_requests
        FROM `{T_SURVEY_RESPONSES}` WHERE {cond}
        GROUP BY projects_id ORDER BY project_name
        """,
        tuple(params),
    )
    out_rows = []
    for r in rows:
        out_rows.append({
            **r,
            "needs_training": bool(r["needs_training"]),
            "period_from": r["period_from"].isoformat(),
            "period_to": r["period_to"].isoformat(),
            "date_creation": r["date_creation"].isoformat() + "+00:00",
        })
    for s in summary:
        for k in ("avg_solution_time", "avg_response_time", "avg_quality"):
            s[k] = float(s[k]) if s[k] is not None else None
        s["training_requests"] = int(s["training_requests"] or 0)
    return {"responses": out_rows, "summary": summary}
