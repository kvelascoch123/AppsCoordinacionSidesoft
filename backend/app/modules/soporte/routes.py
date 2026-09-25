"""
Rutas HTTP exclusivas del menú «Indicadores coordinación».

La lógica de coordinación está en `coordination_indicators`; KPI compartidos en `indicators`.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.modules.soporte import ai_estimation_indicators as ai_estimation
from app.modules.soporte import ai_usage_indicators as ai_usage
from app.modules.soporte import coordination_indicators as coordination
from app.modules.soporte import indicators as indicators_service
from app.modules.soporte import knowbase_indicators as knowbase

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
    """Serie semanal: creados; resueltos/gestionados/pausados/reabiertos vía glpi_logs; abiertos; fuera de SLA."""
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


@router.get("/resolved-effort-by-resolution")
def coordination_resolved_effort_by_resolution(
    date_from: str, date_to: str, project_type_id: Optional[int] = None
):
    """Horas históricas del ticket atribuidas a la semana ISO de solvedate/closedate; promedio h/ticket resuelto."""
    try:
        return coordination.coordination_resolved_effort_by_resolution(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer esfuerzo por resolución: " + str(e),
        ) from e


@router.get("/ticket-time-pareto")
def coordination_ticket_time_pareto(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
    top_n: int = Query(40, ge=5, le=100),
):
    """Pareto 80-20 de tickets por actiontime en el rango; series semanal y mensual de concentración."""
    try:
        return coordination.coordination_ticket_time_pareto(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            top_n=top_n,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer indicador 80-20 de tickets: " + str(e),
        ) from e


@router.get("/weekly-assignee-performance")
def coordination_weekly_assignee_performance(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """Semanas ISO: asignaciones (log), cierres como asignado y esfuerzo en tareas (`actiontime`) por técnico; ver `coordination_indicators.coordination_weekly_assignee_performance`."""
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


@router.get("/weekly-technician-evolution")
def coordination_weekly_technician_evolution(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """Semanas ISO: tickets creados (como asignado), gestionados (tareas) y tiempo imputado por técnico."""
    try:
        return coordination.coordination_weekly_technician_evolution(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer evolución semanal por técnico: " + str(e),
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


@router.get("/ai-estimation/summary")
def coordination_ai_estimation_summary(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
    estimate_field: Optional[str] = Query(default=None),
):
    """KPIs de eficiencia: estimación IA vs tiempo ejecutado (campo plugin configurable)."""
    try:
        return ai_estimation.ai_estimation_efficiency_summary(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            estimate_field=estimate_field,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer eficiencia de estimación IA: " + str(e),
        ) from e


@router.get("/ai-estimation/weekly")
def coordination_ai_estimation_weekly(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
    estimate_field: Optional[str] = Query(default=None),
):
    """Serie semanal ISO: horas estimadas vs ejecutadas y desviación promedio."""
    try:
        return ai_estimation.ai_estimation_weekly_evolution(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            estimate_field=estimate_field,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer evolución semanal de estimación IA: " + str(e),
        ) from e


@router.get("/ai-estimation/top-deviations")
def coordination_ai_estimation_top_deviations(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
    limit: int = Query(default=10, ge=1, le=50),
    estimate_field: Optional[str] = Query(default=None),
):
    """Ranking de tickets con mayor desvío positivo (se tardaron más de lo estimado)."""
    try:
        return ai_estimation.ai_estimation_top_deviations(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
            estimate_field=estimate_field,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer ranking de desvíos: " + str(e),
        ) from e


@router.get("/ai-estimation/tickets")
def coordination_ai_estimation_tickets(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
    semaforo_key: Optional[str] = Query(default=None),
    estimate_field: Optional[str] = Query(default=None),
    comparable_only: bool = Query(default=False),
):
    """Detalle por ticket con estimación IA; filtro opcional por categoría de semáforo."""
    try:
        return ai_estimation.ai_estimation_tickets_detail(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            semaforo_key=semaforo_key,
            estimate_field=estimate_field,
            comparable_only=comparable_only,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer detalle de tickets con estimación IA: " + str(e),
        ) from e


@router.get("/ai-usage/summary")
def coordination_ai_usage_summary(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """Adopción de IA (campo «¿Aplica IA?») y cumplimiento de estimación Sí vs No."""
    try:
        return ai_usage.ai_usage_summary(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer resumen de uso de IA: " + str(e),
        ) from e


@router.get("/ai-usage/weekly")
def coordination_ai_usage_weekly(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """Serie semanal ISO: tickets con Sí / No / sin registrar en «¿Aplica IA?»."""
    try:
        return ai_usage.ai_usage_weekly_evolution(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer evolución semanal de uso de IA: " + str(e),
        ) from e


@router.get("/ai-usage/by-status")
def coordination_ai_usage_by_status(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
):
    """Matriz estado GLPI × valor de «¿Aplica IA?»."""
    try:
        return ai_usage.ai_usage_by_status(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer uso de IA por estado: " + str(e),
        ) from e


@router.get("/ai-usage/tickets")
def coordination_ai_usage_tickets(
    date_from: str,
    date_to: str,
    project_type_id: Optional[int] = None,
    aplica_ia_key: Optional[str] = Query(default=None),
):
    """Detalle por ticket con «¿Aplica IA?»; filtro opcional si | no | sin_dato."""
    try:
        return ai_usage.ai_usage_tickets_detail(
            project_type_id=project_type_id,
            date_from=date_from,
            date_to=date_to,
            aplica_ia_key=aplica_ia_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer detalle de tickets con uso de IA: " + str(e),
        ) from e


@router.get("/knowledge-base/summary")
def coordination_knowledge_base_summary(
    date_from: str,
    date_to: str,
):
    """Artículos de base de conocimiento creados en el rango; total y desglose por autor."""
    try:
        return knowbase.knowbase_registered_summary(
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer base de conocimiento registrada: " + str(e),
        ) from e
