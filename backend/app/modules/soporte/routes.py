"""
Rutas HTTP exclusivas del menú «Indicadores coordinación».

La lógica de coordinación está en `coordination_indicators`; KPI compartidos en `indicators`.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.modules.soporte import coordination_indicators as coordination
from app.modules.soporte import indicators as indicators_service

router = APIRouter(prefix="/api/indicators/coordination", tags=["Indicadores coordinación"])


@router.get("/summary")
def coordination_summary(date_from: str, date_to: str, project_type_id: Optional[int] = None):
    """Agregados ampliados para la vista «Indicadores coordinación»: estados instantáneos y reabiertos (log GLPI)."""
    try:
        return coordination.coordination_summary_kpis(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer KPIs de coordinación: " + str(e),
        ) from e


@router.get("/weekly-evolution")
def coordination_weekly_evolution(date_from: str, date_to: str, project_type_id: Optional[int] = None):
    """Serie semanal: creados, resueltos, abiertos por cohorte, abiertos vía histórico de logs, pausados/reabiertos en logs, fuera de SLA."""
    try:
        return coordination.coordination_weekly_evolution(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer evolución semanal de coordinación: " + str(e),
        ) from e


@router.get("/weekly-assignee-performance")
def coordination_weekly_assignee_performance(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """Semanas ISO: tiempo en tareas por técnico y, por rol asignado (`glpi_tickets_users`), trabajo imputado y cierres por semana ISO."""
    try:
        return coordination.coordination_weekly_assignee_performance(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer rendimiento semanal por asignado: " + str(e),
        ) from e


@router.get("/weekly-tickets-by-request-type/detail")
def coordination_weekly_tickets_by_request_type_detail(
    date_from: str,
    date_to: str,
    period_sort: int = Query(..., ge=190000, le=299953),
    requesttypes_id: int = Query(..., ge=0),
    project_type_id: Optional[int] = None,
    project_id: Optional[int] = Query(default=None, ge=1),
):
    """Listado de tickets de una celda del gráfico (semana ISO + fuente); mismo alcance que el agregado semanal."""
    try:
        return indicators_service.tickets_by_request_type_week_detail(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            period_sort=period_sort,
            requesttypes_id=requesttypes_id,
            project_id=project_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer detalle por fuente y semana: " + str(e),
        ) from e


@router.get("/weekly-tickets-by-request-type")
def coordination_weekly_tickets_by_request_type(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
    project_id: Optional[int] = Query(default=None, ge=1),
):
    """Tickets dados de alta en el rango, por semana ISO y fuente de solicitud (misma resolución de proyecto que Indicadores)."""
    try:
        return indicators_service.tickets_by_request_type_by_period(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            granularity="week",
            project_id=project_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer tickets por fuente de solicitud (semanal): " + str(e),
        ) from e


@router.get("/tickets-out-of-sla/detail")
def coordination_tickets_out_of_sla_detail(date_from: str, date_to: str, project_type_id: Optional[int] = None):
    """Tickets creados en el rango con TTR (`time_to_resolve`) incumplido; todos los estados."""
    try:
        return coordination.coordination_tickets_out_of_sla_detail(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer detalle fuera de SLA: " + str(e),
        ) from e


@router.get("/tickets-detail/{bucket}")
def coordination_tickets_bucket_detail(
    bucket: str,
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """started | not_started | waiting | reopened."""
    try:
        return coordination.coordination_ticket_bucket_detail(
            bucket=bucket,
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer detalle de coordinación: " + str(e),
        ) from e
