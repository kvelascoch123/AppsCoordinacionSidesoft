"""
Consultas contra la base de facturación (PostgreSQL).

Mismos criterios funcionales que el SQL de referencia (tipos de documento,
centros de coste y estado CO).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from app.modules.soporte.billing_pg import fetch_billing_rows

_BILLING_DOCTYPES = (
    "1. FACTURA DE VENTA RECURRENTE",
    "2. FACTURA DE VENTA",
)

_BILLING_COST_CENTERS = (
    "HOSTING ERP",
    "SOPORTE",
    "SOPORTE - CONTRATO",
    "SERVICIO EN LA NUBE - OPENBRAVO ERP",
    "MINEGO-FACTURACION ELECTRONICA",
    "INFRAESTRUCTURA",
    "SERVICIO EN LA NUBE - APLICACIONES",
    "",
    "SERVICIO EN LA NUBE - FACTURA ELECTRONICA",
    "SERVICIO EN LA NUBE - ODOO",
    "SOPORTE - ADICIONAL",
)


def _billing_invoices_sql(with_date_to: bool) -> str:
    date_tail = ""
    if with_date_to:
        date_tail = "  AND ci.dateinvoiced <= %s::date\n"
    return f"""
SELECT
    bp.name AS tercero,
    ci.documentno,
    ci.poreference,
    ci.dateinvoiced::text AS dateinvoiced,
    ci.grandtotal,
    ci.ispaid,
    ci.totalpaid,
    cc.name AS centro_costo,
    u.name AS usuario1,
    ci.description
FROM c_invoice ci
LEFT JOIN c_doctype dt ON dt.c_doctype_id = ci.c_doctypetarget_id
LEFT JOIN c_bpartner bp ON bp.c_bpartner_id = ci.c_bpartner_id
LEFT JOIN user1 u ON u.user1_id = ci.user1_id
LEFT JOIN c_costcenter cc ON cc.c_costcenter_id = ci.c_costcenter_id
WHERE ci.dateinvoiced >= %s::date
{date_tail}  AND dt.name = ANY(%s)
  AND ci.docstatus = 'CO'
  AND COALESCE(BTRIM(cc.name::text), '')::text = ANY(%s)
ORDER BY bp.name NULLS LAST, ci.dateinvoiced DESC
"""


def _billing_scope_from_joins() -> str:
    return """
FROM c_invoice ci
LEFT JOIN c_doctype dt ON dt.c_doctype_id = ci.c_doctypetarget_id
LEFT JOIN c_bpartner bp ON bp.c_bpartner_id = ci.c_bpartner_id
LEFT JOIN user1 u ON u.user1_id = ci.user1_id
LEFT JOIN c_costcenter cc ON cc.c_costcenter_id = ci.c_costcenter_id
"""


def _billing_scope_params_base(
    date_from: str,
    date_to: str,
    tercero: Optional[str],
) -> Tuple[List[Any], str]:
    """Parámetros en orden: fechas, listas de filtro, [tercero si aplica]. Retorna (params_list, tercero_sql_fragment)."""
    dt_list = list(_BILLING_DOCTYPES)
    cc_list = list(_BILLING_COST_CENTERS)
    tercero_sql = ""
    tail: List[Any] = [date_from, date_to, dt_list, cc_list]
    if tercero is not None and str(tercero).strip() != "":
        tercero_sql = " AND bp.name = %s "
        tail.append(str(tercero).strip())
    return tail, tercero_sql


def list_billing_terceros(date_from: str, date_to: str) -> List[str]:
    """Nombres de tercero distintos con facturas en el rango (mismos filtros que el listado)."""
    if not date_to:
        raise ValueError("date_to es obligatorio para listar terceros.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    params_base, tercero_sql = _billing_scope_params_base(date_from, date_to, None)
    sql = f"""
SELECT DISTINCT bp.name AS tercero
{_billing_scope_from_joins()}
WHERE ci.dateinvoiced >= %s::date
  AND ci.dateinvoiced <= %s::date
  AND dt.name = ANY(%s)
  AND ci.docstatus = 'CO'
  AND COALESCE(BTRIM(cc.name::text), '')::text = ANY(%s)
  {tercero_sql}
  AND bp.name IS NOT NULL
  AND BTRIM(bp.name::text) <> ''
ORDER BY 1
"""
    rows = fetch_billing_rows(sql, tuple(params_base))
    out: List[str] = []
    for r in rows:
        v = r.get("tercero")
        if v is None:
            continue
        s = str(v).strip()
        if s:
            out.append(s)
    return out


def billing_usd_evolution_by_cost_center_month(
    date_from: str,
    date_to: str,
    tercero: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Suma `grandtotal` por mes natural y por centro de coste (`cc.name`).
    Respuesta para gráfico de barras agrupadas por periodo: `cost_centers` + `rows` con `amounts[i]` alineado.
    """
    if not date_to:
        raise ValueError("date_to es obligatorio para la evolución mensual.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")

    params, tercero_sql = _billing_scope_params_base(date_from, date_to, tercero)
    sql = f"""
SELECT
    TO_CHAR(DATE_TRUNC('month', ci.dateinvoiced::timestamp), 'YYYY-MM') AS period_key,
    COALESCE(NULLIF(BTRIM(cc.name::text), ''), '(Sin centro de costo)') AS centro_costo,
    SUM(ci.grandtotal)::float8 AS total_usd,
    COUNT(*)::int AS invoice_count
{_billing_scope_from_joins()}
WHERE ci.dateinvoiced >= %s::date
  AND ci.dateinvoiced <= %s::date
  AND dt.name = ANY(%s)
  AND ci.docstatus = 'CO'
  AND COALESCE(BTRIM(cc.name::text), '')::text = ANY(%s)
  {tercero_sql}
GROUP BY 1, 2
ORDER BY 1, 2
"""
    raw = fetch_billing_rows(sql, tuple(params))
    rows_norm: List[Dict[str, Any]] = []
    for r in raw:
        d = {str(k).lower(): _serialize_value(v) for k, v in dict(r).items()}
        rows_norm.append(d)

    cc_totals: Dict[str, float] = defaultdict(float)
    by_period_cc: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    period_order: List[str] = []

    for r in rows_norm:
        pk = str(r.get("period_key") or "")
        cc = str(r.get("centro_costo") or "(Sin centro de costo)")
        val = float(r.get("total_usd") or 0)
        if pk and pk not in period_order:
            period_order.append(pk)
        by_period_cc[pk][cc] += val
        cc_totals[cc] += val

    cost_centers_sorted = sorted(cc_totals.keys(), key=lambda x: (-cc_totals[x], x))
    period_order.sort()

    chart_rows: List[Dict[str, Any]] = []
    grand_total = 0.0
    for pk in period_order:
        amounts = [round(by_period_cc[pk].get(cc, 0.0), 2) for cc in cost_centers_sorted]
        row_total = float(sum(amounts))
        grand_total += row_total
        chart_rows.append(
            {
                "period_key": pk,
                "amounts": amounts,
                "total_usd": round(row_total, 2),
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "tercero_filter": (tercero.strip() if tercero and str(tercero).strip() else None),
        "cost_centers": cost_centers_sorted,
        "rows": chart_rows,
        "grand_total_usd": round(grand_total, 2),
    }


_PAID_BUCKET_KEYS = ("Pagado", "No pagado", "Sin indicar")
_PAYMENT_CHART_SERIES = ("Pagado", "No pagado", "Diferencia (pag. − impag.)")


def billing_usd_evolution_by_payment_status_month(
    date_from: str,
    date_to: str,
    tercero: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Por mes natural: volumen marcado Pagado (`ispaid`), no pagado (incluye «Sin indicar» en la segunda barra),
    y diferencia Pagado menos ese total no pagado. Soporta `ci.ispaid` boolean o texto (Y/N, etc.).
    """
    if not date_to:
        raise ValueError("date_to es obligatorio para la evolución mensual.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")

    params, tercero_sql = _billing_scope_params_base(date_from, date_to, tercero)
    sql = f"""
SELECT
    TO_CHAR(DATE_TRUNC('month', ci.dateinvoiced::timestamp), 'YYYY-MM') AS period_key,
    CASE
        WHEN ci.ispaid IS NULL OR COALESCE(NULLIF(BTRIM(ci.ispaid::text), ''), '') = '' THEN 'Sin indicar'
        WHEN upper(BTRIM(ci.ispaid::text)) IN (
            'Y', 'YES', 'T', 'TRUE', '1'
        ) THEN 'Pagado'
        WHEN upper(BTRIM(ci.ispaid::text)) IN (
            'N', 'NO', 'F', 'FALSE', '0'
        ) THEN 'No pagado'
        ELSE 'Sin indicar'
    END AS payment_label,
    SUM(ci.grandtotal)::float8 AS total_usd,
    COUNT(*)::int AS invoice_count
{_billing_scope_from_joins()}
WHERE ci.dateinvoiced >= %s::date
  AND ci.dateinvoiced <= %s::date
  AND dt.name = ANY(%s)
  AND ci.docstatus = 'CO'
  AND COALESCE(BTRIM(cc.name::text), '')::text = ANY(%s)
  {tercero_sql}
GROUP BY 1, 2
ORDER BY 1, 2
"""
    raw = fetch_billing_rows(sql, tuple(params))
    rows_norm: List[Dict[str, Any]] = []
    for r in raw:
        d = {str(k).lower(): _serialize_value(v) for k, v in dict(r).items()}
        rows_norm.append(d)

    by_period_status: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    period_order: List[str] = []

    for r in rows_norm:
        pk = str(r.get("period_key") or "")
        label = str(r.get("payment_label") or "Sin indicar")
        if label not in _PAID_BUCKET_KEYS:
            label = "Sin indicar"
        val = float(r.get("total_usd") or 0)
        if pk and pk not in period_order:
            period_order.append(pk)
        by_period_status[pk][label] += val

    period_order.sort()
    chart_rows: List[Dict[str, Any]] = []
    grand_total_invoiced = 0.0
    for pk in period_order:
        bd = by_period_status[pk]
        p = float(bd.get("Pagado", 0))
        nop = float(bd.get("No pagado", 0))
        sin = float(bd.get("Sin indicar", 0))
        no_agg = round(nop + sin, 2)
        diff = round(p - no_agg, 2)
        row_invoiced = p + no_agg
        grand_total_invoiced += row_invoiced
        chart_rows.append(
            {
                "period_key": pk,
                "amounts": [round(p, 2), no_agg, diff],
                "total_usd": round(row_invoiced, 2),
            }
        )

    tf = tercero.strip() if tercero and str(tercero).strip() else None
    return {
        "date_from": date_from,
        "date_to": date_to,
        "tercero_filter": tf,
        "cost_centers": list(_PAYMENT_CHART_SERIES),
        "rows": chart_rows,
        "grand_total_usd": round(grand_total_invoiced, 2),
    }


def list_billing_invoices(
    date_from: str,
    date_to: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], str, Optional[str]]:
    """
    Lista facturas. date_from/date_to formato YYYY-MM-DD.
    Sin date_to: solo límites inferior (comportamiento original del SELECT de referencia).
    """
    if date_to == "":
        date_to = None

    datetime.strptime(date_from, "%Y-%m-%d")
    if date_to:
        datetime.strptime(date_to, "%Y-%m-%d")

    dt_list = list(_BILLING_DOCTYPES)
    cc_list = list(_BILLING_COST_CENTERS)

    with_to = date_to is not None
    sql = _billing_invoices_sql(with_to).strip()
    if with_to:
        params = (date_from, date_to, dt_list, cc_list)
    else:
        params = (date_from, dt_list, cc_list)

    rows = fetch_billing_rows(sql, params)
    serialized = [_serialize_row(dict(r)) for r in rows]
    for row in serialized:
        row["valor_pendiente"] = _valor_pendiente_factura(row.get("grandtotal"), row.get("totalpaid"))
    return serialized, date_from, date_to


def _valor_pendiente_factura(grandtotal: Any, totalpaid: Any) -> float:
    try:
        gt_f = float(grandtotal or 0)
    except (TypeError, ValueError):
        gt_f = 0.0
    tp_f: Optional[float]
    try:
        if totalpaid is None:
            tp_f = None
        else:
            tp_f = float(totalpaid)
    except (TypeError, ValueError):
        tp_f = None
    pend = gt_f if tp_f is None else gt_f - tp_f
    return round(float(pend), 2)


def _serialize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in row.items():
        key = str(k).lower()
        out[key] = _serialize_value(v)
    return out


def _serialize_value(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, memoryview):
        return bytes(v).decode("utf-8", errors="replace")
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return v
