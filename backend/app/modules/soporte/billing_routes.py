"""API «Indicadores de facturación» (PostgreSQL / Openbravo)."""

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query

from app.modules.soporte.billing_data import (
    billing_usd_evolution_by_cost_center_month,
    billing_usd_evolution_by_payment_status_month,
    list_billing_invoices,
    list_billing_terceros,
)
from app.modules.soporte.billing_pg import billing_pg_ready, fetch_billing_rows

router = APIRouter(prefix="/api/billing", tags=["Indicadores de facturación"])


def _billing_disabled_detail() -> str:
    return (
        "Indicadores de facturación deshabilitados o sin configuración: establezca BILLING_PG_ENABLED=true "
        "y BILLING_PG_HOST, BILLING_PG_DATABASE, usuario y contraseña en el entorno (.env)."
    )


@router.get("/terceros")
def billing_terceros(
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD inclusive"),
) -> Dict[str, Any]:
    if not billing_pg_ready():
        raise HTTPException(status_code=503, detail=_billing_disabled_detail())
    try:
        names = list_billing_terceros(date_from=date_from, date_to=date_to)
        return {"date_from": date_from, "date_to": date_to, "terceros": names}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer terceros: " + str(e),
        ) from e


@router.get("/evolution-by-cost-center")
def billing_evolution_by_cost_center(
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD inclusive"),
    tercero: Optional[str] = Query(None, description="Si se indica, solo facturas de este tercero (bp.name)"),
) -> Dict[str, Any]:
    if not billing_pg_ready():
        raise HTTPException(status_code=503, detail=_billing_disabled_detail())
    try:
        return billing_usd_evolution_by_cost_center_month(date_from=date_from, date_to=date_to, tercero=tercero)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al agregar evolución por centro de costo: " + str(e),
        ) from e


@router.get("/evolution-paid-status")
def billing_evolution_paid_status(
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD inclusive"),
    tercero: Optional[str] = Query(None, description="Opcional: solo este tercero (bp.name)"),
) -> Dict[str, Any]:
    if not billing_pg_ready():
        raise HTTPException(status_code=503, detail=_billing_disabled_detail())
    try:
        return billing_usd_evolution_by_payment_status_month(
            date_from=date_from, date_to=date_to, tercero=tercero,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al agregar evolución pagado / no pagado: " + str(e),
        ) from e


@router.get("/invoices")
def billing_invoices(
    date_from: str = Query(
        ...,
        description="Primera fecha de factura (YYYY-MM-DD)",
    ),
    date_to: Optional[str] = Query(
        None,
        description="Si se indica, ci.dateinvoiced no supera esta fecha (inclusive)",
    ),
) -> Dict[str, Any]:
    if not billing_pg_ready():
        raise HTTPException(status_code=503, detail=_billing_disabled_detail())
    try:
        rows, dfrom, dto = list_billing_invoices(date_from=date_from, date_to=date_to)
        return {"date_from": dfrom, "date_to": dto, "count": len(rows), "rows": rows}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail="Error al leer facturas desde PostgreSQL: " + str(e),
        ) from e


@router.get("/health")
def billing_health():
    if not billing_pg_ready():
        return {"status": "disabled", "detail": _billing_disabled_detail()}
    try:
        fetch_billing_rows("SELECT 1 AS ok")
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=503, detail="PostgreSQL facturación: " + str(e)) from e
