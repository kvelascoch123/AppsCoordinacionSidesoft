"""Distribución de horas por proyecto / centro de costo / consultor (GLPI)."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from app.db import fetch_all

_EMPTY_PROYECTO = "(sin proyecto)"
_EMPTY_ASIGNADO = "(sin asignado)"

_INNER_SQL = """
  SELECT
    t.date AS fecha_ticket,
    TRIM(COALESCE(pr.name, ppr.name)) AS proyecto,
    TRIM(COALESCE(pr.code, ppr.code)) AS centro_costo,
    utech.name AS asignado,
    t.id AS ticket,
    t.name AS titulo,
    CASE
      WHEN t.status = 1 THEN 'Nuevo'
      WHEN t.status = 2 THEN 'En curso'
      WHEN t.status = 3 THEN 'Planificado'
      WHEN t.status = 4 THEN 'En espera'
      WHEN t.status = 5 THEN 'Resuelto'
      WHEN t.status = 6 THEN 'Cerrado'
      ELSE 'Desconocido'
    END AS estado,
    tsk.total_seconds AS tiempo_segundos
  FROM glpi_tickets t
  LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff
    ON pltff.items_id = t.id
  LEFT JOIN glpi_tickets_users tut
    ON tut.tickets_id = t.id AND tut.type = 2
  LEFT JOIN glpi_users utech
    ON utech.id = tut.users_id
  LEFT JOIN glpi_tickets_users tup
    ON tup.tickets_id = t.id AND tup.type = 1
  LEFT JOIN glpi_users utp
    ON utp.id = tup.users_id
  LEFT JOIN glpi_projects ppr
    ON ppr.id = pltff.projects_id_proyectorelacionadofieldtwo
  LEFT JOIN glpi_plugin_fields_projectproyectos fpp
    ON fpp.items_id = ppr.id
  LEFT JOIN glpi_plugin_fields_userproyectorelacionadousers up
    ON up.items_id = tup.users_id
  LEFT JOIN glpi_projects pr
    ON pr.id = REPLACE(REPLACE(REPLACE(up.projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
  LEFT JOIN glpi_plugin_fields_projectproyectos fp
    ON fp.items_id = pr.id
  LEFT JOIN glpi_ticketsatisfactions ts
    ON ts.tickets_id = t.id
  LEFT JOIN (
    SELECT tickets_id, users_id, `begin`, `date`, SUM(actiontime) AS total_seconds
    FROM glpi_tickettasks
    WHERE (DATE(`begin`) >= %s OR DATE(`date`) >= %s)
      AND (DATE(`begin`) <= %s OR DATE(`date`) <= %s)
    GROUP BY tickets_id, users_id
  ) tsk
    ON tsk.tickets_id = t.id
   AND tsk.users_id = utech.id
  WHERE (DATE(tsk.`begin`) >= %s OR DATE(tsk.`date`) >= %s)
    AND (DATE(tsk.`begin`) <= %s OR DATE(tsk.`date`) <= %s)
  GROUP BY 1, 2, 3, 4, 5, 6, 7
"""

_SQL = f"""
SELECT
  proyecto,
  MAX(centro_costo) AS centro_costo,
  asignado,
  SUM(tiempo_segundos) AS total_seconds
FROM (
{_INNER_SQL}
) tmp
GROUP BY proyecto, asignado
ORDER BY proyecto ASC, asignado ASC
"""


def _parse_dates(date_from: str, date_to: str) -> Tuple[str, str]:
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    if date_to < date_from:
        raise ValueError("date_to debe ser >= date_from")
    return date_from, date_to


def _fmt_fecha(v: Any) -> Optional[str]:
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat(sep=" ", timespec="seconds")
    s = str(v).strip()
    return s or None


def _match_label(column: str, value: str, empty_label: str) -> Tuple[str, Tuple[Any, ...]]:
    """Filtro SQL para etiquetas normalizadas en Python (placeholders de vacío)."""
    v = (value or "").strip()
    if not v or v == empty_label:
        return f"({column} IS NULL OR TRIM({column}) = '')", ()
    return f"TRIM({column}) = %s", (v,)


def _format_tiempo(total_seconds: float) -> str:
    secs = max(0, int(round(float(total_seconds or 0))))
    hours = secs // 3600
    minutes = (secs % 3600) / 60.0
    return f"{hours} horas {minutes:.4f} minutos"


def _horas_laboradas(total_seconds: float) -> float:
    """Equivalente Excel: REDONDEAR(horas + minutos/60; 2) desde el texto de tiempo."""
    return round(float(total_seconds or 0) / 3600.0, 2)


def list_cost_center_hours(date_from: str, date_to: str) -> Dict[str, Any]:
    dfrom, dto = _parse_dates(date_from, date_to)
    params = (dfrom, dfrom, dto, dto, dfrom, dfrom, dto, dto)
    raw = fetch_all(_SQL, params)

    # Totales por proyecto para % participación (SUMAR.SI por columna A / proyecto).
    project_hours: Dict[str, float] = defaultdict(float)
    prepared: List[Dict[str, Any]] = []
    for row in raw:
        proyecto = (row.get("proyecto") or "").strip() or _EMPTY_PROYECTO
        centro = (row.get("centro_costo") or "").strip() or None
        asignado = (row.get("asignado") or "").strip() or _EMPTY_ASIGNADO
        total_seconds = float(row.get("total_seconds") or 0)
        horas = _horas_laboradas(total_seconds)
        project_hours[proyecto] += horas
        prepared.append(
            {
                "proyecto": proyecto,
                "centro_costo": centro,
                "asignado": asignado,
                "tiempo_horas_minutos": _format_tiempo(total_seconds),
                "horas_laboradas": horas,
                "total_seconds": int(round(total_seconds)),
            }
        )

    rows: List[Dict[str, Any]] = []
    for item in prepared:
        denom = project_hours.get(item["proyecto"]) or 0.0
        pct = (item["horas_laboradas"] / denom * 100.0) if denom else 0.0
        rows.append(
            {
                **item,
                "pct_participacion": round(pct, 8),
            }
        )

    return {
        "date_from": dfrom,
        "date_to": dto,
        "count": len(rows),
        "rows": rows,
    }


def list_cost_center_tickets(
    date_from: str,
    date_to: str,
    proyecto: str,
    asignado: str,
) -> Dict[str, Any]:
    """Tickets (y horas de tareas) que alimentan una fila proyecto + consultor."""
    dfrom, dto = _parse_dates(date_from, date_to)
    proj_sql, proj_params = _match_label("proyecto", proyecto, _EMPTY_PROYECTO)
    asg_sql, asg_params = _match_label("asignado", asignado, _EMPTY_ASIGNADO)
    sql = f"""
SELECT
  ticket,
  MAX(titulo) AS titulo,
  MAX(fecha_ticket) AS fecha_ticket,
  MAX(estado) AS estado,
  MAX(proyecto) AS proyecto,
  MAX(centro_costo) AS centro_costo,
  MAX(asignado) AS asignado,
  SUM(COALESCE(tiempo_segundos, 0)) AS total_seconds
FROM (
{_INNER_SQL}
) tmp
WHERE {proj_sql}
  AND {asg_sql}
GROUP BY ticket
ORDER BY fecha_ticket ASC, ticket ASC
"""
    params: Tuple[Any, ...] = (dfrom, dfrom, dto, dto, dfrom, dfrom, dto, dto) + proj_params + asg_params
    raw = fetch_all(sql, params, read_timeout=180)

    tickets: List[Dict[str, Any]] = []
    total_seconds = 0
    for row in raw:
        secs = float(row.get("total_seconds") or 0)
        if secs <= 0:
            continue
        total_seconds += secs
        tickets.append(
            {
                "ticket": int(row.get("ticket") or 0),
                "titulo": (row.get("titulo") or "").strip() or None,
                "fecha": _fmt_fecha(row.get("fecha_ticket")),
                "estado": (row.get("estado") or "").strip() or "Desconocido",
                "proyecto": (row.get("proyecto") or "").strip() or _EMPTY_PROYECTO,
                "centro_costo": (row.get("centro_costo") or "").strip() or None,
                "asignado": (row.get("asignado") or "").strip() or _EMPTY_ASIGNADO,
                "tiempo_horas_minutos": _format_tiempo(secs),
                "horas_laboradas": _horas_laboradas(secs),
                "total_seconds": int(round(secs)),
            }
        )

    return {
        "date_from": dfrom,
        "date_to": dto,
        "proyecto": (proyecto or "").strip() or _EMPTY_PROYECTO,
        "asignado": (asignado or "").strip() or _EMPTY_ASIGNADO,
        "count": len(tickets),
        "total_seconds": int(round(total_seconds)),
        "horas_laboradas": _horas_laboradas(total_seconds),
        "tickets": tickets,
    }
