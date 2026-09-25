import logging
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.modules.soporte.config import get_settings
from app.modules.soporte.routes import router as coordination_router
from app.modules.soporte.billing_routes import router as billing_router
from app.modules.soporte.cost_centers_routes import router as cost_centers_router
from app.modules.sistema import auth
from app.modules.sistema.routes import auth_router, router as system_router, survey_router
from app.modules.sistema.schema import ensure_schema
from app.db import fetch_one
from app import llm
from app.modules.soporte import indicators, metrics, reports
from app.db import fetch_all

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await run_in_threadpool(ensure_schema)
    except Exception:  # noqa: BLE001 — la API sigue sirviendo los indicadores aunque falle la migración
        log.exception("No se pudieron crear/verificar las tablas glpi_plugin_coorddash_*")
    yield


app = FastAPI(
    title="GLPI Coordination Dashboard API",
    description="Indicadores operativos de tickets GLPI; escritura limitada a tipo de solicitud en informes.",
    version="1.0.0",
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def auth_guard(request: Request, call_next):
    """Toda la API /api/* exige sesión (salvo salud y login) y cabecera anti-CSRF en métodos de escritura."""
    path = request.url.path
    if not path.startswith("/api/") or not _settings.auth_enabled or request.method == "OPTIONS":
        return await call_next(request)
    if request.method not in _SAFE_METHODS and request.headers.get(auth.CSRF_HEADER) != "XMLHttpRequest":
        return JSONResponse({"detail": "Solicitud rechazada (falta cabecera X-Requested-With)."}, status_code=403)
    if auth.is_public_path(path):
        return await call_next(request)
    try:
        user = await run_in_threadpool(auth.user_from_request, request)
    except auth.AuthError as e:
        return JSONResponse({"detail": e.detail}, status_code=e.status)
    if user is None:
        return JSONResponse({"detail": "Sesión no válida o expirada."}, status_code=401)
    response = await call_next(request)
    if getattr(request.state, "session_needs_renewal", False):
        token, max_age = auth.issue_token(user)
        auth.set_session_cookie(response, token, max_age)
    return response


app.include_router(auth_router)
app.include_router(system_router)
app.include_router(survey_router)
app.include_router(coordination_router)
app.include_router(billing_router)
app.include_router(cost_centers_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/health/db")
def health_db():
    try:
        row = fetch_one("SELECT 1 AS ok")
        if not row or row.get("ok") != 1:
            raise HTTPException(status_code=503, detail="Base de datos no respondió")
        return {"status": "ok", "database": get_settings().db_name}
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error de conexión: " + str(e)) from e


@app.get("/api/dashboard")
def dashboard(project_type_id: Optional[int] = None):
    try:
        return metrics.build_dashboard_payload(project_type_id=project_type_id)
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al leer GLPI: " + str(e)) from e


@app.get("/api/kpis/summary")
def kpi_summary():
    try:
        s = get_settings()
        return {**metrics.get_summary(s), **metrics.get_stale_count_vs_threshold(s)}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get("/api/kpis/management-by-assignee")
def management_by_assignee(date_from: str, date_to: str):
    try:
        s = get_settings()
        return metrics.get_management_by_assignee_in_range(date_from=date_from, date_to=date_to, settings=s)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al leer gestión por técnico: " + str(e)) from e


@app.get("/api/kpis/management-ticket-detail")
def management_ticket_detail(date_from: str, date_to: str, user_id: int | None = None):
    try:
        s = get_settings()
        return metrics.get_management_ticket_detail_in_range(
            date_from=date_from,
            date_to=date_to,
            user_id=user_id,
            settings=s,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al leer detalle de tickets: " + str(e)) from e


@app.get("/api/tickets/{ticket_id}/analysis")
def ticket_analysis(
    ticket_id: int = Path(..., ge=1, description="ID del ticket en glpi_tickets"),
):
    """
    Analiza el contexto del ticket (título, descripción, seguimientos y tareas)
    usando un modelo de lenguaje (OpenAI) y devuelve un JSON estructurado.
    """
    try:
        return llm.analyze_ticket(ticket_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al analizar el ticket: " + str(e)) from e


@app.get("/api/tickets/{ticket_id}/time")
def ticket_time(
    ticket_id: int = Path(..., ge=1, description="ID del ticket en glpi_tickets"),
):
    """
    Devuelve el tiempo invertido (actiontime) en tareas del ticket, desglosado por técnico/usuario.
    """
    try:
        rows = fetch_all(
            """
            SELECT
                COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id) AS user_id,
                COALESCE(
                    NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                    u.name,
                    CONCAT('Usuario #', u.id)
                ) AS full_name,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickettasks tt
            LEFT JOIN glpi_users u ON u.id = COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id)
            WHERE tt.tickets_id = %s
            GROUP BY user_id, u.firstname, u.realname, u.name, u.id
            ORDER BY actiontime_total DESC
            """,
            (ticket_id,),
        )
        total = sum(int(r.get("actiontime_total") or 0) for r in rows)
        return {"ticket_id": ticket_id, "total_actiontime": total, "by_user": rows}
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al leer tiempos del ticket: " + str(e)) from e


@app.get("/api/reports/support/projects")
def support_projects():
    try:
        return {"projects": reports.list_projects()}
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al leer proyectos: " + str(e)) from e


@app.get("/api/indicators/project-types")
def indicators_project_types():
    """
    Tipos de proyecto (GLPI: glpi_projecttypes), alineado con el desplegable «Tipo» del proyecto.
    """
    try:
        return {"project_types": reports.list_project_types()}
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al leer tipos de proyecto: " + str(e)) from e


@app.get("/api/indicators/problems-support")
def indicators_problems_support(date_from: str, date_to: str):
    """Totales y estados de problemas GLPI; serie semanal de altas y de resoluciones/cierres en el rango."""
    try:
        return indicators.problems_support_indicators(date_from=date_from, date_to=date_to)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer indicadores de problemas GLPI: " + str(e),
        ) from e


@app.get("/api/indicators/tickets-resolved-in-range/detail")
def indicators_tickets_resolved_in_range_detail(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """Listado de tickets resueltos/cerrados en el rango (mismo alcance que los KPI de coordinación)."""
    try:
        return indicators.tickets_resolved_in_range_detail(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer detalle de tickets resueltos: " + str(e),
        ) from e


@app.get("/api/indicators/tickets-created-in-range/detail")
def indicators_tickets_created_in_range_detail(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    try:
        return indicators.tickets_created_in_range_detail(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer detalle de tickets creados: " + str(e),
        ) from e


@app.get("/api/indicators/tickets-open-now/detail")
def indicators_tickets_open_now_detail(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """Abiertos sin filtro de fecha; fecha_from/date_to aplican solo al tiempo de tareas devuelto."""
    try:
        return indicators.tickets_open_now_detail(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer detalle de tickets abiertos: " + str(e),
        ) from e


@app.get("/api/indicators/support-hours-by-project-and-category")
def indicators_support_hours_by_project_and_category(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
    granularity: Literal["week", "month"] = "month",
):
    """
    Horas de tareas en rango, por proyecto, categoría (fuente de solicitud) y periodo semanal ISO o mensual
    sobre la fecha de la tarea. Agregado; sin desglose por ticket.
    """
    try:
        return indicators.support_hours_by_project_category_month(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            granularity=granularity,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer horas de soporte por proyecto: " + str(e),
        ) from e


@app.get("/api/reports/support")
def support_report(project_id: int, date_from: str, date_to: str):
    try:
        return reports.support_report(project_id=project_id, date_from=date_from, date_to=date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al generar reporte de soporte: " + str(e)) from e


@app.get("/api/reports/support/ticket-tasks")
def support_report_ticket_tasks(
    ticket_id: int, project_id: int, date_from: str, date_to: str
):
    """
    Tareas (glpi_tickettasks) de un ticket: fecha, autor y duración, filtradas como el informe de soporte.
    """
    try:
        return {"tasks": reports.support_report_ticket_tasks(ticket_id, project_id, date_from, date_to)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer tareas del ticket: " + str(e),
        ) from e


@app.get("/api/reports/support/request-types")
def support_request_types():
    try:
        return {"request_types": reports.list_request_types()}
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al leer tipos de solicitud: " + str(e)) from e


class TicketRequestTypeUpdateItem(BaseModel):
    ticket_id: int = Field(..., ge=1)
    requesttypes_id: int = Field(..., ge=0)


class ApplyTicketRequestTypeBody(BaseModel):
    updates: list[TicketRequestTypeUpdateItem]


@app.post("/api/reports/support/tickets/request-type")
def apply_ticket_request_type(body: ApplyTicketRequestTypeBody):
    """
    Actualiza glpi_tickets.requesttypes_id por ticket.
    La marca facturable del informe depende del tipo (plugin Fields en requesttypes), no de una columna del ticket.
    """
    try:
        payload = [u.model_dump() for u in body.updates]
        return reports.apply_ticket_request_type_changes(payload)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al actualizar tipo de solicitud: " + str(e),
        ) from e


@app.get("/api/reports/support/analysis")
def support_analysis(project_id: int, date_from: str, date_to: str):
    try:
        return llm.analyze_project_tickets(project_id=project_id, date_from=date_from, date_to=date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al generar análisis general: " + str(e)) from e


@app.get("/api/reports/support/ticket-table-analysis")
def support_ticket_table_analysis(project_id: int, date_from: str, date_to: str):
    """
    Tickets creados en el rango, por proyecto, con resumen breve generado con IA
    (título, requerimiento, seguimientos, tareas).
    """
    try:
        return llm.analyze_tickets_per_ticket_table(project_id=project_id, date_from=date_from, date_to=date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al generar análisis por ticket: " + str(e),
        ) from e
