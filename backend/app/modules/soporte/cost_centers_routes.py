"""API «Variables y Centros de costo» (horas GLPI por proyecto / consultor)."""

from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query

from app.modules.soporte.cost_centers_data import list_cost_center_hours, list_cost_center_tickets
from app.modules.soporte.kpi_variables_data import list_kpi_variables

router = APIRouter(prefix="/api/cost-centers", tags=["Variables y Centros de costo"])


@router.get("/hours")
def cost_center_hours(
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD inclusive"),
) -> Dict[str, Any]:
    try:
        return list_cost_center_hours(date_from=date_from, date_to=date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al consultar horas por centro de costo: " + str(e),
        ) from e


@router.get("/hours/tickets")
def cost_center_hours_tickets(
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD inclusive"),
    proyecto: str = Query(..., description="Nombre de proyecto de la fila (incl. '(sin proyecto)')"),
    asignado: str = Query(..., description="Consultor de la fila (incl. '(sin asignado)')"),
) -> Dict[str, Any]:
    try:
        return list_cost_center_tickets(
            date_from=date_from,
            date_to=date_to,
            proyecto=proyecto,
            asignado=asignado,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al consultar tickets por centro de costo: " + str(e),
        ) from e


@router.get("/kpi-variables")
def cost_center_kpi_variables(
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD inclusive"),
) -> Dict[str, Any]:
    try:
        return list_kpi_variables(date_from=date_from, date_to=date_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al consultar KPI de variables: " + str(e),
        ) from e
