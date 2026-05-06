"""
Rutas HTTP exclusivas del menú «Indicadores coordinación».

La lógica está en `app.coordination_indicators` (lectura GLPI); KPI compartidos siguen en `app.indicators`.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException

from app import coordination_indicators as coordination

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
    """Semanas ISO del rango: tickets con tiempo registrado y suma actiontime por técnico; mismo alcance que coordinación."""
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


@router.get("/assignee-tickets-per-hour")
def coordination_assignee_tickets_per_hour(date_from: str, date_to: str, project_type_id: Optional[int] = None):
    """Rango completo: trabajo en tareas (t/h), resueltos en rango como asignado, tiempo medio hasta solvedate y resueltos/h registrada."""
    try:
        return coordination.coordination_assignee_tickets_per_hour_analysis(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer análisis tickets/hora por asignado: " + str(e),
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
