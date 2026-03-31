from fastapi import FastAPI, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import fetch_one
from app import llm, metrics, reports
from app.db import fetch_all

app = FastAPI(
    title="GLPI Coordination Dashboard API",
    description="Indicadores operativos de tickets GLPI (solo lectura).",
    version="1.0.0",
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
def dashboard():
    try:
        return metrics.build_dashboard_payload()
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


@app.get("/api/reports/support")
def support_report(project_id: int, date_from: str, date_to: str):
    try:
        return reports.support_report(project_id=project_id, date_from=date_from, date_to=date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al generar reporte de soporte: " + str(e)) from e


@app.get("/api/reports/support/analysis")
def support_analysis(project_id: int, date_from: str, date_to: str):
    try:
        return llm.analyze_project_tickets(project_id=project_id, date_from=date_from, date_to=date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail="Error al generar análisis general: " + str(e)) from e
