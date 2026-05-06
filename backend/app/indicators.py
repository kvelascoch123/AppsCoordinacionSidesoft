"""
Indicadores por tipo de proyecto (lectura GLPI).

Los KPI de la vista «Indicadores coordinación» están en `coordination_indicators`
(rutas: `coordination_routes`).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from pymysql.err import OperationalError

from app.config import Settings, get_settings
from app.db import fetch_all, fetch_one
from app.metrics import _user_display_expr

# GLPI Incidente estándar: Nuevo / En curso / Planificado / En espera / Resuelto / Cerrado (5–6 configurables).
_COORD_STATUS_NEW = 1
_COORD_STATUS_IN_PROGRESS = 2
_COORD_STATUS_PLANNED = 3
_COORD_STATUS_WAITING = 4


def _ticket_out_of_sla_breach_sql_fragment() -> str:
    """
    Incumplimiento del plazo de solución (TTR) según GLPI: columna `time_to_resolve`.
    - Resuelto/cerrado: fecha efectiva de cierre posterior al plazo.
    - Cualquier otro estado: el plazo ya pasó respecto a la hora actual (incumplimiento en curso).
    """
    return (
        "AND t.time_to_resolve IS NOT NULL "
        "AND ( "
        "(t.status IN (%s, %s) AND COALESCE(t.solvedate, t.date_mod) > t.time_to_resolve) "
        "OR (t.status NOT IN (%s, %s) AND NOW() > t.time_to_resolve) "
        ")"
    )


def _ticket_log_reopened_predicate_snippet(s: Settings) -> str:
    """Marcador EXISTS para tickets reabiertos (log de estado). id_search_option fijado por env."""
    lid = int(s.id_search_option_ticket_status_log)
    return f"""
        EXISTS (
            SELECT 1
            FROM glpi_logs lg
            WHERE lg.items_id = t.id
              AND lg.itemtype = 'Ticket'
              AND lg.id_search_option = {lid}
              AND lg.old_value REGEXP '^[0-9]+$'
              AND lg.new_value REGEXP '^[0-9]+$'
              AND CAST(lg.old_value AS UNSIGNED) IN (%s, %s)
              AND CAST(lg.new_value AS UNSIGNED) NOT IN (%s, %s)
        )
    """

def _project_type_sql(project_type_id: Optional[int]) -> str:
    if project_type_id is not None and int(project_type_id) >= 1:
        return " AND p.projecttypes_id = %s"
    return ""


def _project_type_params(project_type_id: Optional[int]) -> List[Any]:
    if project_type_id is not None and int(project_type_id) >= 1:
        return [int(project_type_id)]
    return []


def time_and_tickets_by_project(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Por proyecto. Si project_type_id es None, se incluyen todos los tipos de proyecto.

    Resolución de proyecto alineada con el informe de soporte / consultas habituales
    del plugin Fields: ticket (projects_id_proyectorelacionadofieldtwo) o solicitante
    (userproyectorelacionadousers → projects_id_proyectorelacionadouserfield).

    - horas: suma de actiontime de tareas en el rango (incluye tickets no creados en el rango).
    - total_tickets: tickets con `t.date` en el rango (apertura GLPI), con o sin tareas en el periodo.

    Filtro temporal de tareas: (begin o date) acotado al rango [date_from, date_to]
    (fin inclusive por día usando DATE_ADD en date_to).
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    pt_sql = _project_type_sql(project_type_id)

    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]

    params_time = list(params_base) + [date_from, date_from, date_to, date_to]
    params_created = list(params_base) + [date_from, date_to]

    sql_time_plugin = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY p.id, p.name
    """

    sql_created_plugin = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COUNT(DISTINCT t.id) AS tickets_created
        FROM glpi_tickets t
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY p.id, p.name
    """

    try:
        time_rows = fetch_all(sql_time_plugin, tuple(params_time))
        created_rows = fetch_all(sql_created_plugin, tuple(params_created))
    except OperationalError as e:
        # 1146 = tabla inexistente (instalación sin plugin Fields en ticket/solicitante)
        if e.args and e.args[0] == 1146:
            time_rows, created_rows = _time_and_created_counts_itils_split(
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                settings=s,
            )
        else:
            raise

    merged: Dict[int, Dict[str, Any]] = {}
    for r in time_rows:
        pid = int(r["project_id"])
        merged[pid] = {
            "project_id": pid,
            "project_name": (r.get("project_name") or f"Proyecto #{pid}") or f"Proyecto #{pid}",
            "actiontime_total": int(r.get("actiontime_total") or 0),
            "total_tickets": 0,
        }
    for r in created_rows:
        pid = int(r["project_id"])
        cnt = int(r.get("tickets_created") or 0)
        name = (r.get("project_name") or f"Proyecto #{pid}") or f"Proyecto #{pid}"
        if pid not in merged:
            merged[pid] = {
                "project_id": pid,
                "project_name": name,
                "actiontime_total": 0,
                "total_tickets": cnt,
            }
        else:
            merged[pid]["total_tickets"] = cnt
            if merged[pid]["project_name"] in ("", f"Proyecto #{pid}") and name:
                merged[pid]["project_name"] = name

    rows: List[Dict[str, Any]] = []
    for _pid, row in merged.items():
        pid = int(row["project_id"])
        sec = int(row["actiontime_total"])
        rows.append(
            {
                "project_id": pid,
                "project_name": row["project_name"],
                "total_tickets": int(row["total_tickets"]),
                "actiontime_seconds": sec,
                "horas": round(sec / 3600.0, 2),
            }
        )
    rows.sort(key=lambda x: (-x["horas"], -x["total_tickets"], x["project_name"]))

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": rows,
    }


def _time_and_created_counts_itils_split(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Si faltan tablas del plugin Fields: tiempo y altas por proyecto vía itils_projects."""
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    params_time = list(params_base) + [date_from, date_from, date_to, date_to]
    params_created = list(params_base) + [date_from, date_to]

    sql_time = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY p.id, p.name
    """
    sql_created = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COUNT(DISTINCT t.id) AS tickets_created
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY p.id, p.name
    """
    return fetch_all(sql_time, tuple(params_time)), fetch_all(sql_created, tuple(params_created))


def _tickets_by_request_type_itils(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    params_q = list(params_base) + [date_from, date_to]

    sql = f"""
        SELECT
            COALESCE(t.requesttypes_id, 0) AS requesttypes_id,
            COALESCE(MAX(rt.name), '(sin fuente)') AS request_type_name,
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY COALESCE(t.requesttypes_id, 0)
        ORDER BY ticket_count DESC, request_type_name
    """
    return fetch_all(sql, tuple(params_q))


def tickets_by_request_type(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Tickets dados de alta en el rango (`t.date`) agrupados por «Fuente de solicitud»
    (glpi_tickets.requesttypes_id / glpi_requesttypes). Misma resolución de proyecto
    y filtros (tipo de proyecto, entidad) que el gráfico principal de indicadores.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    params_q = list(params_base) + [date_from, date_to]

    sql_plugin = f"""
        SELECT
            COALESCE(t.requesttypes_id, 0) AS requesttypes_id,
            COALESCE(MAX(rt.name), '(sin fuente)') AS request_type_name,
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY COALESCE(t.requesttypes_id, 0)
        ORDER BY ticket_count DESC, request_type_name
    """

    try:
        raw = fetch_all(sql_plugin, tuple(params_q))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            raw = _tickets_by_request_type_itils(
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                settings=s,
            )
        else:
            raise

    rows: List[Dict[str, Any]] = []
    for r in raw:
        rid = int(r.get("requesttypes_id") or 0)
        rows.append(
            {
                "requesttypes_id": rid,
                "request_type_name": str(r.get("request_type_name") or "").strip() or "(sin fuente)",
                "ticket_count": int(r.get("ticket_count") or 0),
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": rows,
    }


def _ticket_creation_period_exprs(granularity: str) -> tuple[str, str]:
    """SELECT extra columns y expresión de GROUP BY (periodo sobre t.date — alta ticket)."""
    if granularity == "week":
        extra = """
            YEARWEEK(t.date, 3) AS period_sort,
            MAX(
                CONCAT(
                    SUBSTRING(YEARWEEK(t.date, 3), 1, 4),
                    ' sem. ',
                    SUBSTRING(YEARWEEK(t.date, 3), 5, 2)
                )
            ) AS period_label"""
        grp = "YEARWEEK(t.date, 3)"
    elif granularity == "month":
        extra = """
            DATE_FORMAT(t.date, '%%Y-%%m') AS period_sort,
            MAX(DATE_FORMAT(t.date, '%%Y-%%m')) AS period_label"""
        grp = "DATE_FORMAT(t.date, '%%Y-%%m')"
    else:
        raise ValueError("granularity debe ser 'week' o 'month'.")
    return extra, grp


def _tickets_by_request_type_by_period_itils(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    granularity: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    s = settings
    extra, grp_period = _ticket_creation_period_exprs(granularity)
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    params_q = list(params_base) + [date_from, date_to]

    sql = f"""
        SELECT
            {extra},
            COALESCE(t.requesttypes_id, 0) AS requesttypes_id,
            COALESCE(MAX(rt.name), '(sin fuente)') AS request_type_name,
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY {grp_period}, COALESCE(t.requesttypes_id, 0)
        ORDER BY period_sort, ticket_count DESC, request_type_name
    """
    return fetch_all(sql, tuple(params_q))


def tickets_by_request_type_by_period(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    granularity: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Tickets creados en el rango, por periodo (semana ISO o mes) y fuente de solicitud.
    Misma resolución de proyecto que tickets_by_request_type.
    """
    if granularity not in ("week", "month"):
        raise ValueError("granularity debe ser 'week' o 'month'.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    params_q = list(params_base) + [date_from, date_to]

    extra, grp_period = _ticket_creation_period_exprs(granularity)
    sql_plugin = f"""
        SELECT
            {extra},
            COALESCE(t.requesttypes_id, 0) AS requesttypes_id,
            COALESCE(MAX(rt.name), '(sin fuente)') AS request_type_name,
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY {grp_period}, COALESCE(t.requesttypes_id, 0)
        ORDER BY period_sort, ticket_count DESC, request_type_name
    """

    try:
        raw = fetch_all(sql_plugin, tuple(params_q))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            raw = _tickets_by_request_type_by_period_itils(
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                granularity=granularity,
                settings=s,
            )
        else:
            raise

    rows: List[Dict[str, Any]] = []
    for r in raw:
        rid = int(r.get("requesttypes_id") or 0)
        ps = r.get("period_sort")
        if granularity == "week":
            pk = str(int(ps)) if ps is not None else ""
        else:
            pk = str(ps or "").strip()
        rows.append(
            {
                "period_sort": pk,
                "period_label": str(r.get("period_label") or ""),
                "requesttypes_id": rid,
                "request_type_name": str(r.get("request_type_name") or "").strip() or "(sin fuente)",
                "ticket_count": int(r.get("ticket_count") or 0),
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "granularity": granularity,
        "rows": rows,
    }


def _request_type_display_name(requesttypes_id: int) -> str:
    if int(requesttypes_id) == 0:
        return "(sin fuente)"
    r = fetch_one("SELECT name FROM glpi_requesttypes WHERE id = %s LIMIT 1", (int(requesttypes_id),))
    if r and r.get("name"):
        return str(r["name"]).strip() or f"Fuente #{requesttypes_id}"
    return f"Fuente #{requesttypes_id}"


def _tickets_by_project_for_request_type_itils(
    requesttypes_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    rid = int(requesttypes_id)
    params_q = list(params_base) + [rid, date_from, date_to]

    sql = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND COALESCE(t.requesttypes_id, 0) = %s
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY p.id, p.name
        ORDER BY ticket_count DESC, p.name
    """
    return fetch_all(sql, tuple(params_q))


def _time_by_project_for_request_type_itils(
    requesttypes_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    rid = int(requesttypes_id)
    params_q = list(params_base) + [rid, date_from, date_from, date_to, date_to]

    sql = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND COALESCE(t.requesttypes_id, 0) = %s
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY p.id, p.name
        ORDER BY actiontime_total DESC, p.name
    """
    return fetch_all(sql, tuple(params_q))


def tickets_by_project_for_request_type(
    requesttypes_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Por proyecto para una fuente de solicitud concreta:

    - ticket_count: tickets con fecha de alta `t.date` en el rango.
    - actiontime_seconds / horas: suma de actiontime de tareas con begin/date en el rango
      (mismo criterio que el gráfico principal de horas), solo de tickets de esa fuente.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    rid = int(requesttypes_id)
    if rid < 0:
        raise ValueError("requesttypes_id no válido.")

    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    params_created = list(params_base) + [rid, date_from, date_to]
    params_time = list(params_base) + [rid, date_from, date_from, date_to, date_to]

    sql_created_plugin = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND COALESCE(t.requesttypes_id, 0) = %s
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY p.id, p.name
        ORDER BY ticket_count DESC, p.name
    """

    sql_time_plugin = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND COALESCE(t.requesttypes_id, 0) = %s
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY p.id, p.name
        ORDER BY actiontime_total DESC, p.name
    """

    try:
        created_raw = fetch_all(sql_created_plugin, tuple(params_created))
        time_raw = fetch_all(sql_time_plugin, tuple(params_time))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            created_raw = _tickets_by_project_for_request_type_itils(
                requesttypes_id=rid,
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                settings=s,
            )
            time_raw = _time_by_project_for_request_type_itils(
                requesttypes_id=rid,
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                settings=s,
            )
        else:
            raise

    merged: Dict[int, Dict[str, Any]] = {}
    for r in time_raw:
        pid = int(r["project_id"])
        merged[pid] = {
            "project_id": pid,
            "project_name": (r.get("project_name") or f"Proyecto #{pid}") or f"Proyecto #{pid}",
            "actiontime_total": int(r.get("actiontime_total") or 0),
            "ticket_count": 0,
        }
    for r in created_raw:
        pid = int(r["project_id"])
        cnt = int(r.get("ticket_count") or 0)
        name = (r.get("project_name") or f"Proyecto #{pid}") or f"Proyecto #{pid}"
        if pid not in merged:
            merged[pid] = {
                "project_id": pid,
                "project_name": name,
                "actiontime_total": 0,
                "ticket_count": cnt,
            }
        else:
            merged[pid]["ticket_count"] = cnt
            if merged[pid]["project_name"] in ("", f"Proyecto #{pid}") and name:
                merged[pid]["project_name"] = name

    rows: List[Dict[str, Any]] = []
    for _pid, row in merged.items():
        pid = int(row["project_id"])
        sec = int(row["actiontime_total"])
        rows.append(
            {
                "project_id": pid,
                "project_name": row["project_name"],
                "ticket_count": int(row["ticket_count"]),
                "actiontime_seconds": sec,
                "horas": round(sec / 3600.0, 2),
            }
        )
    rows.sort(key=lambda x: (-x["horas"], -x["ticket_count"], x["project_name"]))

    return {
        "requesttypes_id": rid,
        "request_type_name": _request_type_display_name(rid),
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": rows,
    }


def _tickets_created_detail_for_rt_project_itils(
    project_id: int,
    requesttypes_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    assign_type = int(s.assignee_link_type)
    assignees_sql = f"""
            (
                SELECT GROUP_CONCAT(
                    COALESCE(
                        NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                        u.name,
                        CONCAT('Usuario #', u.id)
                    )
                    ORDER BY tu.id
                    SEPARATOR ', '
                )
                FROM glpi_tickets_users tu
                INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
                WHERE tu.tickets_id = t.id AND tu.type = {assign_type}
            ) AS assignees
    """
    rid = int(requesttypes_id)
    params: List[Any] = [date_from, date_from, date_to, date_to, project_id] + _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params.append(s.entities_id)
    params.extend([rid, date_from, date_to])

    sql = f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            COALESCE((
                SELECT SUM(tt.actiontime)
                FROM glpi_tickettasks tt
                WHERE tt.tickets_id = t.id
                  AND tt.actiontime > 0
                  AND (tt.begin >= %s OR tt.date >= %s)
                  AND (
                      tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                      OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
                  )
            ), 0) AS actiontime_total,
            {assignees_sql}
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE p.id = %s
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND COALESCE(t.requesttypes_id, 0) = %s
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        ORDER BY t.id
    """
    return fetch_all(sql, tuple(params))


def tickets_created_detail_for_request_type_project(
    project_id: int,
    requesttypes_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Listado de tickets que cuentan en «Tickets creados en rango» del desglose por proyecto
    y fuente: alta `t.date` en el rango, proyecto y request type acordes.
    Incluye tiempo de tareas en el rango (misma ventana que el gráfico de horas).
    """
    if project_id < 1:
        raise ValueError("project_id no válido.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    rid = int(requesttypes_id)
    if rid < 0:
        raise ValueError("requesttypes_id no válido.")

    s = settings or get_settings()
    pt_sql = _project_type_sql(project_type_id)

    if project_type_id is not None and int(project_type_id) >= 1:
        proj = fetch_one(
            """
            SELECT id, name
            FROM glpi_projects
            WHERE id = %s AND is_deleted = 0 AND projecttypes_id = %s
            LIMIT 1
            """,
            (project_id, int(project_type_id)),
        )
    else:
        proj = fetch_one(
            """
            SELECT id, name
            FROM glpi_projects
            WHERE id = %s AND is_deleted = 0
            LIMIT 1
            """,
            (project_id,),
        )
    if not proj:
        raise ValueError("Proyecto no encontrado o no corresponde al tipo de proyecto seleccionado.")

    project_name = str(proj.get("name") or f"Proyecto #{project_id}")
    req_type = int(s.requester_link_type)
    assign_type = int(s.assignee_link_type)
    assignees_sql = f"""
            (
                SELECT GROUP_CONCAT(
                    COALESCE(
                        NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                        u.name,
                        CONCAT('Usuario #', u.id)
                    )
                    ORDER BY tu.id
                    SEPARATOR ', '
                )
                FROM glpi_tickets_users tu
                INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
                WHERE tu.tickets_id = t.id AND tu.type = {assign_type}
            ) AS assignees
    """

    params: List[Any] = [date_from, date_from, date_to, date_to, project_id] + _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params.append(s.entities_id)
    params.extend([rid, date_from, date_to])

    sql_plugin = f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            COALESCE((
                SELECT SUM(tt.actiontime)
                FROM glpi_tickettasks tt
                WHERE tt.tickets_id = t.id
                  AND tt.actiontime > 0
                  AND (tt.begin >= %s OR tt.date >= %s)
                  AND (
                      tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                      OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
                  )
            ), 0) AS actiontime_total,
            {assignees_sql}
        FROM glpi_tickets t
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.id = %s
          AND p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND COALESCE(t.requesttypes_id, 0) = %s
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        ORDER BY t.id
    """

    try:
        raw_rows = fetch_all(sql_plugin, tuple(params))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            raw_rows = _tickets_created_detail_for_rt_project_itils(
                project_id=project_id,
                requesttypes_id=rid,
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                settings=s,
            )
        else:
            raise

    rows: List[Dict[str, Any]] = []
    for r in raw_rows:
        tid = int(r["ticket_id"])
        sec = int(r.get("actiontime_total") or 0)
        asg = r.get("assignees")
        if asg is not None and not isinstance(asg, str):
            asg = str(asg)
        rows.append(
            {
                "ticket_id": tid,
                "titulo": r.get("titulo"),
                "actiontime_seconds": sec,
                "assignees": (asg.strip() if asg else None) or None,
            }
        )

    return {
        "project_id": project_id,
        "project_name": project_name,
        "requesttypes_id": rid,
        "request_type_name": _request_type_display_name(rid),
        "project_type_id": project_type_id,
        "date_from": date_from,
        "date_to": date_to,
        "rows": rows,
    }


def time_tickets_detail_for_project(
    project_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Desglose por ticket: tiempo (actiontime) en el rango para un proyecto concreto,
    misma resolución de proyecto y filtro de fechas que time_and_tickets_by_project.
    """
    if project_id < 1:
        raise ValueError("project_id no válido.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    pt_sql = _project_type_sql(project_type_id)

    if project_type_id is not None and int(project_type_id) >= 1:
        proj = fetch_one(
            """
            SELECT id, name
            FROM glpi_projects
            WHERE id = %s AND is_deleted = 0 AND projecttypes_id = %s
            LIMIT 1
            """,
            (project_id, int(project_type_id)),
        )
    else:
        proj = fetch_one(
            """
            SELECT id, name
            FROM glpi_projects
            WHERE id = %s AND is_deleted = 0
            LIMIT 1
            """,
            (project_id,),
        )
    if not proj:
        raise ValueError("Proyecto no encontrado o no corresponde al tipo de proyecto seleccionado.")

    project_name = str(proj.get("name") or f"Proyecto #{project_id}")
    req_type = int(s.requester_link_type)
    assign_type = int(s.assignee_link_type)
    assignees_sql = f"""
            (
                SELECT GROUP_CONCAT(
                    COALESCE(
                        NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                        u.name,
                        CONCAT('Usuario #', u.id)
                    )
                    ORDER BY tu.id
                    SEPARATOR ', '
                )
                FROM glpi_tickets_users tu
                INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
                WHERE tu.tickets_id = t.id AND tu.type = {assign_type}
            ) AS assignees
    """

    params = [project_id] + _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params.append(s.entities_id)
    params.extend([date_from, date_from, date_to, date_to])

    sql_plugin = f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total,
            {assignees_sql}
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.id = %s
          AND p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY t.id, t.name
        ORDER BY actiontime_total DESC, t.id
    """

    try:
        raw_rows = fetch_all(sql_plugin, tuple(params))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            raw_rows = _time_tickets_detail_itils_fallback(
                project_id=project_id,
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                settings=s,
            )
        else:
            raise

    rows: List[Dict[str, Any]] = []
    for r in raw_rows:
        tid = int(r["ticket_id"])
        sec = int(r.get("actiontime_total") or 0)
        asg = r.get("assignees")
        if asg is not None and not isinstance(asg, str):
            asg = str(asg)
        rows.append(
            {
                "ticket_id": tid,
                "titulo": r.get("titulo"),
                "actiontime_seconds": sec,
                "assignees": (asg.strip() if asg else None) or None,
            }
        )

    return {
        "project_id": project_id,
        "project_name": project_name,
        "project_type_id": project_type_id,
        "date_from": date_from,
        "date_to": date_to,
        "rows": rows,
    }


def _time_tickets_detail_itils_fallback(
    project_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    assign_type = int(s.assignee_link_type)
    assignees_sql = f"""
            (
                SELECT GROUP_CONCAT(
                    COALESCE(
                        NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                        u.name,
                        CONCAT('Usuario #', u.id)
                    )
                    ORDER BY tu.id
                    SEPARATOR ', '
                )
                FROM glpi_tickets_users tu
                INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
                WHERE tu.tickets_id = t.id AND tu.type = {assign_type}
            ) AS assignees
    """
    params = [project_id] + _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params.append(s.entities_id)
    params.extend([date_from, date_from, date_to, date_to])

    sql = f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total,
            {assignees_sql}
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE p.id = %s
          {pt_sql}
          {ticket_entity}
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY t.id, t.name
        ORDER BY actiontime_total DESC, t.id
    """
    return fetch_all(sql, tuple(params))


def created_tickets_by_period(
    project_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    granularity: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Tickets creados (fecha de alta) en el rango, agrupados por semana ISO o por mes,
    para un proyecto concreto. project_type_id None = cualquier tipo.
    """
    if project_id < 1:
        raise ValueError("project_id no válido.")
    if granularity not in ("week", "month"):
        raise ValueError("granularity debe ser 'week' o 'month'.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    pt_sql = _project_type_sql(project_type_id)

    if project_type_id is not None and int(project_type_id) >= 1:
        proj = fetch_one(
            """
            SELECT id, name
            FROM glpi_projects
            WHERE id = %s AND is_deleted = 0 AND projecttypes_id = %s
            LIMIT 1
            """,
            (project_id, int(project_type_id)),
        )
    else:
        proj = fetch_one(
            """
            SELECT id, name
            FROM glpi_projects
            WHERE id = %s AND is_deleted = 0
            LIMIT 1
            """,
            (project_id,),
        )
    if not proj:
        raise ValueError("Proyecto no encontrado o no corresponde al tipo de proyecto seleccionado.")

    project_name = str(proj.get("name") or f"Proyecto #{project_id}")
    req_type = int(s.requester_link_type)

    if granularity == "week":
        period_select = """
            YEARWEEK(t.date, 3) AS period_sort,
            CONCAT(
                SUBSTRING(YEARWEEK(t.date, 3), 1, 4),
                ' sem. ',
                SUBSTRING(YEARWEEK(t.date, 3), 5, 2)
            ) AS period_label
        """
    else:
        # %% escapado: PyMySQL usa % para parámetros; MySQL debe recibir %Y-%m
        period_select = """
            DATE_FORMAT(t.date, '%%Y-%%m') AS period_sort,
            DATE_FORMAT(t.date, '%%Y-%%m') AS period_label
        """

    params = [project_id] + _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params.append(s.entities_id)
    params.extend([date_from, date_to])

    sql_plugin = f"""
        SELECT
            {period_select},
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.id = %s
          AND p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY period_sort, period_label
        ORDER BY period_sort
    """

    try:
        raw_rows = fetch_all(sql_plugin, tuple(params))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            raw_rows = _created_tickets_by_period_itils(
                project_id=project_id,
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                granularity=granularity,
                settings=s,
            )
        else:
            raise

    rows: List[Dict[str, Any]] = []
    for r in raw_rows:
        ps = r.get("period_sort")
        rows.append(
            {
                "period_key": str(ps) if ps is not None else "",
                "period_label": str(r.get("period_label") or ""),
                "ticket_count": int(r.get("ticket_count") or 0),
            }
        )

    return {
        "project_id": project_id,
        "project_name": project_name,
        "project_type_id": project_type_id,
        "date_from": date_from,
        "date_to": date_to,
        "granularity": granularity,
        "rows": rows,
    }


def _created_tickets_by_period_itils(
    project_id: int,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    granularity: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    if granularity == "week":
        period_select = """
            YEARWEEK(t.date, 3) AS period_sort,
            CONCAT(
                SUBSTRING(YEARWEEK(t.date, 3), 1, 4),
                ' sem. ',
                SUBSTRING(YEARWEEK(t.date, 3), 5, 2)
            ) AS period_label
        """
    else:
        # %% escapado: PyMySQL usa % para parámetros; MySQL debe recibir %Y-%m
        period_select = """
            DATE_FORMAT(t.date, '%%Y-%%m') AS period_sort,
            DATE_FORMAT(t.date, '%%Y-%%m') AS period_label
        """
    params = [project_id] + _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params.append(s.entities_id)
    params.extend([date_from, date_to])

    sql = f"""
        SELECT
            {period_select},
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE p.id = %s
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY period_sort, period_label
        ORDER BY period_sort
    """
    return fetch_all(sql, tuple(params))


def _summary_kpis_scoped_to_project_type_itils(
    project_type_id: int,
    date_from: str,
    date_to: str,
    settings: Settings,
) -> tuple[int, int, int]:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)

    join_from = """
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
    """

    sql_created = f"""
        SELECT COUNT(DISTINCT t.id) AS c
        {join_from}
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
    """
    params_created = list(params_base) + [date_from, date_to]

    sql_resolved = f"""
        SELECT COUNT(DISTINCT t.id) AS c
        {join_from}
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.status IN (%s, %s)
          AND t.solvedate IS NOT NULL
          AND t.solvedate >= %s
          AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
    """
    params_resolved = list(params_base) + [st_sol, st_clo, date_from, date_to]

    sql_open = f"""
        SELECT COUNT(DISTINCT t.id) AS c
        {join_from}
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.status NOT IN (%s, %s)
    """
    params_open = list(params_base) + [st_sol, st_clo]

    c1 = fetch_one(sql_created, tuple(params_created))
    c2 = fetch_one(sql_resolved, tuple(params_resolved))
    c3 = fetch_one(sql_open, tuple(params_open))
    return (
        int(c1.get("c") or 0) if c1 else 0,
        int(c2.get("c") or 0) if c2 else 0,
        int(c3.get("c") or 0) if c3 else 0,
    )


def _summary_kpis_scoped_to_project_type_plugin(
    project_type_id: int,
    date_from: str,
    date_to: str,
    settings: Settings,
) -> tuple[int, int, int]:
    s = settings
    req_type = int(s.requester_link_type)
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)

    join_from = f"""
        FROM glpi_tickets t
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
    """

    sql_created = f"""
        SELECT COUNT(DISTINCT t.id) AS c
        {join_from}
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
    """
    params_created = list(params_base) + [date_from, date_to]

    sql_resolved = f"""
        SELECT COUNT(DISTINCT t.id) AS c
        {join_from}
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.status IN (%s, %s)
          AND t.solvedate IS NOT NULL
          AND t.solvedate >= %s
          AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
    """
    params_resolved = list(params_base) + [st_sol, st_clo, date_from, date_to]

    sql_open = f"""
        SELECT COUNT(DISTINCT t.id) AS c
        {join_from}
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.status NOT IN (%s, %s)
    """
    params_open = list(params_base) + [st_sol, st_clo]

    try:
        c1 = fetch_one(sql_created, tuple(params_created))
        c2 = fetch_one(sql_resolved, tuple(params_resolved))
        c3 = fetch_one(sql_open, tuple(params_open))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            return _summary_kpis_scoped_to_project_type_itils(
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                settings=s,
            )
        raise

    return (
        int(c1.get("c") or 0) if c1 else 0,
        int(c2.get("c") or 0) if c2 else 0,
        int(c3.get("c") or 0) if c3 else 0,
    )


def summary_kpis(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Totales sobre `glpi_tickets`:

    - **Sin tipo de proyecto** (`project_type_id` omitido o «todos»): toda la cola (sin exigir
      vínculo a proyecto), igual que consultas globales sobre tickets.
    - **Con tipo de proyecto**: solo tickets cuyo proyecto resuelto es de ese tipo
      (misma lógica que el gráfico: plugin Fields o `glpi_itils_projects` si faltan tablas del plugin).

    - creados: `t.date` en [date_from, date_to] (fin de día inclusive)
    - resueltos/cerrados: status configurado y `solvedate` en el mismo rango
    - abiertos: status distinto de resuelto/cerrado en el momento actual (sin filtrar por fecha
      de creación ni de resolución)

    Opcional: `GLPI_ENTITIES_ID` acota a una entidad GLPI.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)

    if project_type_id is not None and int(project_type_id) >= 1:
        cr, rr, oo = _summary_kpis_scoped_to_project_type_plugin(
            project_type_id=int(project_type_id),
            date_from=date_from,
            date_to=date_to,
            settings=s,
        )
        return {
            "date_from": date_from,
            "date_to": date_to,
            "project_type_id": project_type_id,
            "tickets_created_in_range": cr,
            "tickets_resolved_in_range": rr,
            "tickets_open_now": oo,
        }

    ticket_entity = ""
    params_entity: List[Any] = []
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_entity = [s.entities_id]

    base_where = f"FROM glpi_tickets t WHERE t.is_deleted = 0{ticket_entity}"

    sql_created = f"SELECT COUNT(*) AS c {base_where} AND t.date >= %s AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)"
    params_created = list(params_entity) + [date_from, date_to]

    sql_resolved = f"""
        SELECT COUNT(*) AS c {base_where}
          AND t.status IN (%s, %s)
          AND t.solvedate IS NOT NULL
          AND t.solvedate >= %s
          AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
    """
    params_resolved = list(params_entity) + [st_sol, st_clo, date_from, date_to]

    sql_open = f"SELECT COUNT(*) AS c {base_where} AND t.status NOT IN (%s, %s)"
    params_open = list(params_entity) + [st_sol, st_clo]

    c1 = fetch_one(sql_created, tuple(params_created))
    c2 = fetch_one(sql_resolved, tuple(params_resolved))
    c3 = fetch_one(sql_open, tuple(params_open))

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "tickets_created_in_range": int(c1.get("c") or 0) if c1 else 0,
        "tickets_resolved_in_range": int(c2.get("c") or 0) if c2 else 0,
        "tickets_open_now": int(c3.get("c") or 0) if c3 else 0,
    }




def _sla_breach_resolution_params(st_sol: int, st_clo: int) -> List[Any]:
    """Parámetros para el fragmento SQL de incumplimiento TTR (resuelto/cerrado vs abierto)."""
    return [st_sol, st_clo, st_sol, st_clo]


def _kpi_ticket_estado_case_sql(st_sol: int, st_clo: int) -> str:
    ss = int(st_sol)
    sc = int(st_clo)
    return f"""
        CASE
            WHEN t.status = {_COORD_STATUS_NEW} THEN 'Nuevo'
            WHEN t.status = {_COORD_STATUS_IN_PROGRESS} THEN 'En curso'
            WHEN t.status = {_COORD_STATUS_PLANNED} THEN 'Planificado'
            WHEN t.status = {_COORD_STATUS_WAITING} THEN 'En espera'
            WHEN t.status = {ss} THEN 'Resuelto'
            WHEN t.status = {sc} THEN 'Cerrado'
            ELSE CONCAT('Estado ', CAST(t.status AS CHAR))
        END AS estado
    """


def _kpi_ticket_detail_normalize_rows(raw_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for r in raw_rows:
        sid = int(r["ticket_id"])
        sol = r.get("solicitante")
        if sol is not None and not isinstance(sol, str):
            sol = str(sol)
        pj = r.get("proyecto")
        if pj is not None and not isinstance(pj, str):
            pj = str(pj)
        tit = r.get("titulo")
        es = r.get("estado")
        if es is not None and not isinstance(es, str):
            es = str(es)
        rows.append(
            {
                "ticket_id": sid,
                "titulo": (str(tit).strip() if tit else None) or None,
                "proyecto": (pj.strip() if pj else None) or None,
                "solicitante": (sol.strip() if sol else None) or None,
                "actiontime_seconds": int(r.get("actiontime_seconds") or 0),
                "fecha_creacion": str(r.get("fecha_creacion") or "").strip() or None,
                "estado": (es.strip() if es else None) or None,
            }
        )
    return rows


def _kpi_detail_solicitante_expr(req_type: int) -> str:
    return f"""
            (
                SELECT COALESCE(
                    NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                    u.name,
                    CONCAT('Usuario #', u.id)
                )
                FROM glpi_tickets_users tu
                INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
                WHERE tu.tickets_id = t.id AND tu.type = {req_type}
                ORDER BY tu.id
                LIMIT 1
            )
    """


def _kpi_detail_actiontime_range_inner() -> str:
    return """COALESCE((
                SELECT SUM(tt.actiontime)
                FROM glpi_tickettasks tt
                WHERE tt.tickets_id = t.id
                  AND tt.actiontime > 0
                  AND (tt.begin >= %s OR tt.date >= %s)
                  AND (
                      tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                      OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
                  )
            ), 0)"""


def _kpi_nested_itils_project_name() -> str:
    return """
        (
            SELECT NULLIF(TRIM(pr.name), '')
            FROM glpi_itils_projects ip
            INNER JOIN glpi_projects pr ON pr.id = ip.projects_id AND pr.is_deleted = 0
            WHERE ip.items_id = t.id AND ip.itemtype = 'Ticket'
            ORDER BY ip.id
            LIMIT 1
        )
    """


def _kpi_nested_plugin_project_name(req_type: int) -> str:
    return f"""
        (
            SELECT NULLIF(TRIM(pr.name), '')
            FROM glpi_plugin_fields_ticketticketsformfields pl
            LEFT JOIN (
                SELECT tickets_id, MIN(users_id) AS users_id
                FROM glpi_tickets_users
                WHERE type = {req_type}
                GROUP BY tickets_id
            ) tup ON tup.tickets_id = pl.items_id
            LEFT JOIN glpi_plugin_fields_userproyectorelacionadousers up ON up.items_id = tup.users_id
            INNER JOIN glpi_projects pr ON pr.id = COALESCE(
                NULLIF(pl.projects_id_proyectorelacionadofieldtwo, 0),
                CAST(NULLIF(TRIM(REPLACE(REPLACE(REPLACE(up.projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')), '') AS UNSIGNED)
            )
            WHERE pl.items_id = t.id AND pr.is_deleted = 0
            ORDER BY pl.items_id
            LIMIT 1
        )
    """


def _fetch_global_kpi_ticket_rows_detail(where_sql: str, params_in_order: List[Any], settings: Settings) -> List[Dict[str, Any]]:
    """where_sql debe empezar por WHERE … (globales KPI sin filtro tipo de proyecto)."""
    req_type = int(settings.requester_link_type)
    st_sol = int(settings.status_solved)
    st_clo = int(settings.status_closed)
    solicitante_e = _kpi_detail_solicitante_expr(req_type)
    time_e = _kpi_detail_actiontime_range_inner()
    estado_e = _kpi_ticket_estado_case_sql(st_sol, st_clo)

    def _sql(proyecto_expr_tail: str) -> str:
        return f"""
            SELECT
                t.id AS ticket_id,
                t.name AS titulo,
                DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
                {solicitante_e} AS solicitante,
                {time_e} AS actiontime_seconds,
                {proyecto_expr_tail},
                {estado_e.strip()}
            FROM glpi_tickets t
            {where_sql}
            ORDER BY t.date ASC, t.id ASC
        """

    plugins = _kpi_nested_plugin_project_name(req_type)
    itils = _kpi_nested_itils_project_name()
    full_proj = f"COALESCE({plugins}, {itils}) AS proyecto"
    itils_only = f"{itils} AS proyecto"
    tpl = tuple(params_in_order)
    try:
        return fetch_all(_sql(full_proj), tpl)
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            return fetch_all(_sql(itils_only), tpl)
        raise


def _tickets_resolved_detail_in_range_itils(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    """Listado para modal: mismo alcance que KPI resueltos con itils_projects."""
    s = settings
    req_type = int(s.requester_link_type)
    solicitante_sq = f"{_kpi_detail_solicitante_expr(req_type)} AS solicitante"
    time_sq = f"{_kpi_detail_actiontime_range_inner()} AS actiontime_seconds"
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    estad_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()

    join_from = """
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
    """
    sql = f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
            {solicitante_sq},
            {time_sq},
            NULLIF(TRIM(p.name), '') AS proyecto,
            {estad_sq}
        {join_from}
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.status IN (%s, %s)
          AND t.solvedate IS NOT NULL
          AND t.solvedate >= %s
          AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
        ORDER BY t.date ASC, t.id ASC
    """
    params = list([date_from, date_from, date_to, date_to]) + params_base + [st_sol, st_clo, date_from, date_to]
    return fetch_all(sql, tuple(params))


def _tickets_created_detail_in_range_itils(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    """Mismo alcance que KPI «creados en rango» con itils_projects."""
    s = settings
    req_type = int(s.requester_link_type)
    solicitante_sq = f"{_kpi_detail_solicitante_expr(req_type)} AS solicitante"
    time_sq = f"{_kpi_detail_actiontime_range_inner()} AS actiontime_seconds"
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    estad_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()

    join_from = """
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
    """
    sql = f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
            {solicitante_sq},
            {time_sq},
            NULLIF(TRIM(p.name), '') AS proyecto,
            {estad_sq}
        {join_from}
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        ORDER BY t.date ASC, t.id ASC
    """
    params = list([date_from, date_from, date_to, date_to]) + params_base + [date_from, date_to]
    return fetch_all(sql, tuple(params))


def _tickets_out_of_sla_detail_in_range_itils(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    """Detalle «fuera de SLA» con alcance itils_projects (fallback si no existen tablas del plugin)."""
    s = settings
    req_type = int(s.requester_link_type)
    solicitante_sq = f"{_kpi_detail_solicitante_expr(req_type)} AS solicitante"
    time_sq = f"{_kpi_detail_actiontime_range_inner()} AS actiontime_seconds"
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    estad_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()
    breach = _ticket_out_of_sla_breach_sql_fragment()

    join_from = """
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
    """
    sql = f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
            {solicitante_sq},
            {time_sq},
            NULLIF(TRIM(p.name), '') AS proyecto,
            {estad_sq}
        {join_from}
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
          {breach}
        ORDER BY t.date ASC, t.id ASC
    """
    params = list([date_from, date_from, date_to, date_to]) + params_base + [date_from, date_to] + list(
        _sla_breach_resolution_params(st_sol, st_clo)
    )
    return fetch_all(sql, tuple(params))


def _tickets_open_now_detail_itils(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    """Mismo alcance que KPI «abiertos ahora» con itils_projects; tiempo por tareas en rango de filtros."""
    s = settings
    req_type = int(s.requester_link_type)
    solicitante_sq = f"{_kpi_detail_solicitante_expr(req_type)} AS solicitante"
    time_sq = f"{_kpi_detail_actiontime_range_inner()} AS actiontime_seconds"
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    estad_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()

    join_from = """
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
    """
    sql = f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
            {solicitante_sq},
            {time_sq},
            NULLIF(TRIM(p.name), '') AS proyecto,
            {estad_sq}
        {join_from}
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.status NOT IN (%s, %s)
        ORDER BY t.date ASC, t.id ASC
    """
    params = list([date_from, date_from, date_to, date_to]) + params_base + [st_sol, st_clo]
    return fetch_all(sql, tuple(params))


def tickets_resolved_in_range_detail(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Tickets contados en «resueltos en rango» de summary_kpis: status sol/cerrados y solvedate en rango.

    Para cada uno: tiempo de tareas con begin/date en ese mismo rango (como otros listados del dashboard).
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)

    solicitante_sq = f"{_kpi_detail_solicitante_expr(req_type)} AS solicitante"
    time_sq = f"{_kpi_detail_actiontime_range_inner()} AS actiontime_seconds"
    estad_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()

    if project_type_id is not None and int(project_type_id) >= 1:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id)
        ticket_entity = ""
        if s.entities_id is not None:
            ticket_entity = " AND t.entities_id = %s"
            params_base = params_base + [s.entities_id]

        join_from = f"""
            FROM glpi_tickets t
            LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
            LEFT JOIN (
                SELECT tickets_id, MIN(users_id) AS users_id
                FROM glpi_tickets_users
                WHERE type = {req_type}
                GROUP BY tickets_id
            ) tup ON tup.tickets_id = t.id
            LEFT JOIN (
                SELECT items_id,
                    MIN(
                        REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                    ) AS project_id_str
                FROM glpi_plugin_fields_userproyectorelacionadousers
                GROUP BY items_id
            ) up ON up.items_id = tup.users_id
            INNER JOIN glpi_projects p ON p.id = COALESCE(
                NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
                CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
            )
        """
        sql_plugin = f"""
            SELECT
                t.id AS ticket_id,
                t.name AS titulo,
                DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
                {solicitante_sq},
                {time_sq},
                NULLIF(TRIM(p.name), '') AS proyecto,
                {estad_sq}
            {join_from}
            WHERE p.is_deleted = 0
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.status IN (%s, %s)
              AND t.solvedate IS NOT NULL
              AND t.solvedate >= %s
              AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
            ORDER BY t.date ASC, t.id ASC
        """
        params = list([date_from, date_from, date_to, date_to]) + params_base + [st_sol, st_clo, date_from, date_to]

        try:
            raw_rows = fetch_all(sql_plugin, tuple(params))
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw_rows = _tickets_resolved_detail_in_range_itils(
                    project_type_id=project_type_id,
                    date_from=date_from,
                    date_to=date_to,
                    settings=s,
                )
            else:
                raise
    else:
        ticket_entity = ""
        params_entity: List[Any] = []
        if s.entities_id is not None:
            ticket_entity = " AND t.entities_id = %s"
            params_entity = [s.entities_id]

        where_global = (
            "WHERE t.is_deleted = 0"
            f"{ticket_entity}"
            + " AND t.status IN (%s, %s)"
            + " AND t.solvedate IS NOT NULL"
            + " AND t.solvedate >= %s"
            + " AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)"
        )
        params_global = list([date_from, date_from, date_to, date_to]) + params_entity + [
            st_sol,
            st_clo,
            date_from,
            date_to,
        ]
        raw_rows = _fetch_global_kpi_ticket_rows_detail(where_global, params_global, s)

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": _kpi_ticket_detail_normalize_rows(raw_rows),
    }


def tickets_created_in_range_detail(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Listado del KPI tickets_created_in_range."""
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)

    solicitante_sq = f"{_kpi_detail_solicitante_expr(req_type)} AS solicitante"
    time_sq = f"{_kpi_detail_actiontime_range_inner()} AS actiontime_seconds"
    estad_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()

    if project_type_id is not None and int(project_type_id) >= 1:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id)
        ticket_entity = ""
        if s.entities_id is not None:
            ticket_entity = " AND t.entities_id = %s"
            params_base = params_base + [s.entities_id]

        join_from = f"""
            FROM glpi_tickets t
            LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
            LEFT JOIN (
                SELECT tickets_id, MIN(users_id) AS users_id
                FROM glpi_tickets_users
                WHERE type = {req_type}
                GROUP BY tickets_id
            ) tup ON tup.tickets_id = t.id
            LEFT JOIN (
                SELECT items_id,
                    MIN(
                        REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                    ) AS project_id_str
                FROM glpi_plugin_fields_userproyectorelacionadousers
                GROUP BY items_id
            ) up ON up.items_id = tup.users_id
            INNER JOIN glpi_projects p ON p.id = COALESCE(
                NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
                CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
            )
        """
        sql_plugin = f"""
            SELECT
                t.id AS ticket_id,
                t.name AS titulo,
                DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
                {solicitante_sq},
                {time_sq},
                NULLIF(TRIM(p.name), '') AS proyecto,
                {estad_sq}
            {join_from}
            WHERE p.is_deleted = 0
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
            ORDER BY t.date ASC, t.id ASC
        """
        params = list([date_from, date_from, date_to, date_to]) + params_base + [date_from, date_to]

        try:
            raw_rows = fetch_all(sql_plugin, tuple(params))
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw_rows = _tickets_created_detail_in_range_itils(
                    project_type_id=project_type_id,
                    date_from=date_from,
                    date_to=date_to,
                    settings=s,
                )
            else:
                raise
    else:
        ticket_entity = ""
        params_entity: List[Any] = []
        if s.entities_id is not None:
            ticket_entity = " AND t.entities_id = %s"
            params_entity = [s.entities_id]

        where_global = (
            "WHERE t.is_deleted = 0"
            f"{ticket_entity}"
            + " AND t.date >= %s AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)"
        )
        params_global = list([date_from, date_from, date_to, date_to]) + params_entity + [date_from, date_to]
        raw_rows = _fetch_global_kpi_ticket_rows_detail(where_global, params_global, s)

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": _kpi_ticket_detail_normalize_rows(raw_rows),
    }


def tickets_open_now_detail(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Listado del KPI tickets_open_now (estados no cerrados/resueltos).
    Tiempo invertido sobre tareas con begin/date dentro del mismo rango de filtros que el modal.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)

    solicitante_sq = f"{_kpi_detail_solicitante_expr(req_type)} AS solicitante"
    time_sq = f"{_kpi_detail_actiontime_range_inner()} AS actiontime_seconds"
    estad_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()

    if project_type_id is not None and int(project_type_id) >= 1:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id)
        ticket_entity = ""
        if s.entities_id is not None:
            ticket_entity = " AND t.entities_id = %s"
            params_base = params_base + [s.entities_id]

        join_from = f"""
            FROM glpi_tickets t
            LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
            LEFT JOIN (
                SELECT tickets_id, MIN(users_id) AS users_id
                FROM glpi_tickets_users
                WHERE type = {req_type}
                GROUP BY tickets_id
            ) tup ON tup.tickets_id = t.id
            LEFT JOIN (
                SELECT items_id,
                    MIN(
                        REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                    ) AS project_id_str
                FROM glpi_plugin_fields_userproyectorelacionadousers
                GROUP BY items_id
            ) up ON up.items_id = tup.users_id
            INNER JOIN glpi_projects p ON p.id = COALESCE(
                NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
                CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
            )
        """
        sql_plugin = f"""
            SELECT
                t.id AS ticket_id,
                t.name AS titulo,
                DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
                {solicitante_sq},
                {time_sq},
                NULLIF(TRIM(p.name), '') AS proyecto,
                {estad_sq}
            {join_from}
            WHERE p.is_deleted = 0
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.status NOT IN (%s, %s)
            ORDER BY t.date ASC, t.id ASC
        """
        params = list([date_from, date_from, date_to, date_to]) + params_base + [st_sol, st_clo]

        try:
            raw_rows = fetch_all(sql_plugin, tuple(params))
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw_rows = _tickets_open_now_detail_itils(
                    project_type_id=project_type_id,
                    date_from=date_from,
                    date_to=date_to,
                    settings=s,
                )
            else:
                raise
    else:
        ticket_entity = ""
        params_entity: List[Any] = []
        if s.entities_id is not None:
            ticket_entity = " AND t.entities_id = %s"
            params_entity = [s.entities_id]

        where_global = "WHERE t.is_deleted = 0" + ticket_entity + " AND t.status NOT IN (%s, %s)"
        params_global = list([date_from, date_from, date_to, date_to]) + params_entity + [
            st_sol,
            st_clo,
        ]
        raw_rows = _fetch_global_kpi_ticket_rows_detail(where_global, params_global, s)

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": _kpi_ticket_detail_normalize_rows(raw_rows),
    }



def _resolution_effort_period_select_tasks(granularity: str) -> str:
    if granularity == "week":
        return """
            YEARWEEK(COALESCE(tt.begin, tt.date), 3) AS period_sort,
            CONCAT(
                SUBSTRING(YEARWEEK(COALESCE(tt.begin, tt.date), 3), 1, 4),
                ' sem. ',
                SUBSTRING(YEARWEEK(COALESCE(tt.begin, tt.date), 3), 5, 2)
            ) AS period_label"""
    if granularity != "month":
        raise ValueError("granularity debe ser 'week' o 'month'.")
    return """
            DATE_FORMAT(COALESCE(tt.begin, tt.date), '%%Y-%%m') AS period_sort,
            DATE_FORMAT(COALESCE(tt.begin, tt.date), '%%Y-%%m') AS period_label"""


def _resolution_effort_period_select_solved(granularity: str) -> str:
    if granularity == "week":
        return """
            YEARWEEK(t.solvedate, 3) AS period_sort,
            CONCAT(
                SUBSTRING(YEARWEEK(t.solvedate, 3), 1, 4),
                ' sem. ',
                SUBSTRING(YEARWEEK(t.solvedate, 3), 5, 2)
            ) AS period_label"""
    if granularity != "month":
        raise ValueError("granularity debe ser 'week' o 'month'.")
    return """
            DATE_FORMAT(t.solvedate, '%%Y-%%m') AS period_sort,
            DATE_FORMAT(t.solvedate, '%%Y-%%m') AS period_label"""


def _resolution_effort_itils(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    granularity: str,
    settings: Settings,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    params_time = list(params_base) + [date_from, date_from, date_to, date_to]
    params_resolved = list(params_base) + [st_sol, st_clo, date_from, date_to]
    sel_t = _resolution_effort_period_select_tasks(granularity)
    sel_s = _resolution_effort_period_select_solved(granularity)

    sql_time = f"""
        SELECT
            {sel_t},
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY period_sort, period_label
        ORDER BY period_sort
    """

    sql_resolved = f"""
        SELECT
            {sel_s},
            COUNT(DISTINCT t.id) AS tickets_resolved
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.status IN (%s, %s)
          AND t.solvedate IS NOT NULL
          AND t.solvedate >= %s
          AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY period_sort, period_label
        ORDER BY period_sort
    """

    return fetch_all(sql_time, tuple(params_time)), fetch_all(sql_resolved, tuple(params_resolved))


def resolution_effort_by_period(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    granularity: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Evolución por semana ISO o por mes natural: tiempo en tareas con fecha en el periodo vs
    tickets resueltos/cerrados con solvedate en el periodo (misma lógica que
    weekly_resolution_effort_by_week cuando granularity='week').
    """
    if granularity not in ("week", "month"):
        raise ValueError("granularity debe ser 'week' o 'month'.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    params_time = list(params_base) + [date_from, date_from, date_to, date_to]
    params_resolved = list(params_base) + [st_sol, st_clo, date_from, date_to]
    sel_t = _resolution_effort_period_select_tasks(granularity)
    sel_s = _resolution_effort_period_select_solved(granularity)

    sql_time_plugin = f"""
        SELECT
            {sel_t},
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY period_sort, period_label
        ORDER BY period_sort
    """

    sql_resolved_plugin = f"""
        SELECT
            {sel_s},
            COUNT(DISTINCT t.id) AS tickets_resolved
        FROM glpi_tickets t
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.status IN (%s, %s)
          AND t.solvedate IS NOT NULL
          AND t.solvedate >= %s
          AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY period_sort, period_label
        ORDER BY period_sort
    """

    try:
        time_rows = fetch_all(sql_time_plugin, tuple(params_time))
        resolved_rows = fetch_all(sql_resolved_plugin, tuple(params_resolved))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            time_rows, resolved_rows = _resolution_effort_itils(
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                granularity=granularity,
                settings=s,
            )
        else:
            raise

    def _period_key(raw: Any) -> str:
        if raw is None:
            return ""
        if granularity == "week":
            return str(int(raw))
        return str(raw).strip()

    by_period: Dict[str, Dict[str, Any]] = {}
    for r in time_rows:
        pk = _period_key(r.get("period_sort"))
        if not pk:
            continue
        by_period[pk] = {
            "period_key": pk,
            "period_label": str(r.get("period_label") or ""),
            "actiontime_seconds": int(r.get("actiontime_total") or 0),
            "tickets_resolved": 0,
        }
    for r in resolved_rows:
        pk = _period_key(r.get("period_sort"))
        if not pk:
            continue
        cnt = int(r.get("tickets_resolved") or 0)
        lab = str(r.get("period_label") or "")
        if pk not in by_period:
            by_period[pk] = {
                "period_key": pk,
                "period_label": lab,
                "actiontime_seconds": 0,
                "tickets_resolved": cnt,
            }
        else:
            by_period[pk]["tickets_resolved"] = cnt
            if not by_period[pk]["period_label"] and lab:
                by_period[pk]["period_label"] = lab

    if granularity == "week":
        sorted_keys = sorted(by_period.keys(), key=lambda x: int(x))
    else:
        sorted_keys = sorted(by_period.keys())

    rows: List[Dict[str, Any]] = []
    for pk in sorted_keys:
        row = by_period[pk]
        tr = int(row["tickets_resolved"])
        sec = int(row["actiontime_seconds"])
        avg_sec: Optional[float] = None
        if tr > 0:
            avg_sec = float(sec) / float(tr)
        rows.append(
            {
                "period_key": row["period_key"],
                "period_label": row["period_label"],
                "actiontime_seconds": sec,
                "tickets_resolved": tr,
                "avg_seconds_per_resolved": round(avg_sec, 2) if avg_sec is not None else None,
                "avg_hours_per_resolved": round(avg_sec / 3600.0, 3) if avg_sec is not None else None,
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "granularity": granularity,
        "rows": rows,
    }


def weekly_resolution_effort_by_week(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Por semana ISO (lógica YEARWEEK(..., 3) como en otros indicadores):

    - **actiontime_seconds**: tiempo registrado en tareas cuya fecha de referencia
      (`COALESCE(begin, date)` de la tarea) cae en la semana, con el mismo vínculo
      ticket→proyecto que el gráfico principal.
    - **tickets_resolved**: tickets pasados a resuelto/cerrado con `solvedate` en esa semana.
    - **avg_hours_per_resolved**: tiempo total de la semana entre tickets resueltos esa semana
      (horas de esfuerzo por ticket cerrado; no es el lapso calendario hasta resolución).

    Si en una semana no hubo resueltos, el promedio viene nulo.
    """
    return resolution_effort_by_period(project_type_id, date_from, date_to, "week", settings)


def _tickettasks_period_period_key_exprs(granularity: str) -> tuple[str, str]:
    """period_key estable y GROUP BY sobre COALESCE(tt.begin, tt.date)."""
    b = "COALESCE(tt.begin, tt.date)"
    if granularity == "week":
        return (
            f"CAST(YEARWEEK({b}, 3) AS CHAR) AS period_key",
            f"CAST(YEARWEEK({b}, 3) AS CHAR)",
        )
    if granularity != "month":
        raise ValueError("granularity debe ser 'week' o 'month'.")
    return (
        f"DATE_FORMAT({b}, '%%Y-%%m') AS period_key",
        f"DATE_FORMAT({b}, '%%Y-%%m')",
    )


def _support_hours_by_project_category_month_itils(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    granularity: str,
    settings: Settings,
) -> List[Dict[str, Any]]:
    s = settings
    pk_sel, grp_pk = _tickettasks_period_period_key_exprs(granularity)
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    params_time = list(params_base) + [date_from, date_from, date_to, date_to]

    sql = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COALESCE(t.requesttypes_id, 0) AS requesttypes_id,
            COALESCE(MAX(rt.name), '(sin fuente)') AS request_type_name,
            {pk_sel},
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY
            p.id,
            p.name,
            COALESCE(t.requesttypes_id, 0),
            {grp_pk}
        ORDER BY
            p.name,
            {grp_pk},
            COALESCE(t.requesttypes_id, 0)
    """
    return fetch_all(sql, tuple(params_time))


def support_hours_by_project_category_month(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    granularity: str = "month",
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Horas de tareas (glpi_tickettasks.actiontime) en el rango, agrupadas por proyecto,
    fuente de solicitud (categoría) y periodo semanal ISO o mensual sobre la fecha de la tarea
    (COALESCE(tt.begin, tt.date)). Sin desglose por ticket.
    Misma resolución de proyecto y filtros que el gráfico de indicadores.
    """
    if granularity not in ("week", "month"):
        raise ValueError("granularity debe ser 'week' o 'month'.")
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    params_time = list(params_base) + [date_from, date_from, date_to, date_to]
    pk_sel, grp_pk = _tickettasks_period_period_key_exprs(granularity)

    sql_plugin = f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            COALESCE(t.requesttypes_id, 0) AS requesttypes_id,
            COALESCE(MAX(rt.name), '(sin fuente)') AS request_type_name,
            {pk_sel},
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
        LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = t.id
        LEFT JOIN (
            SELECT tickets_id, MIN(users_id) AS users_id
            FROM glpi_tickets_users
            WHERE type = {req_type}
            GROUP BY tickets_id
        ) tup ON tup.tickets_id = t.id
        LEFT JOIN (
            SELECT items_id,
                MIN(
                    REPLACE(REPLACE(REPLACE(projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
                ) AS project_id_str
            FROM glpi_plugin_fields_userproyectorelacionadousers
            GROUP BY items_id
        ) up ON up.items_id = tup.users_id
        INNER JOIN glpi_projects p ON p.id = COALESCE(
            NULLIF(pltff.projects_id_proyectorelacionadofieldtwo, 0),
            CAST(NULLIF(TRIM(up.project_id_str), '') AS UNSIGNED)
        )
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND tt.actiontime > 0
          AND (tt.begin >= %s OR tt.date >= %s)
          AND (
              tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
              OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          )
        GROUP BY
            p.id,
            p.name,
            COALESCE(t.requesttypes_id, 0),
            {grp_pk}
        ORDER BY
            p.name,
            {grp_pk},
            COALESCE(t.requesttypes_id, 0)
    """

    try:
        raw = fetch_all(sql_plugin, tuple(params_time))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            raw = _support_hours_by_project_category_month_itils(
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                granularity=granularity,
                settings=s,
            )
        else:
            raise

    rows: List[Dict[str, Any]] = []
    for r in raw:
        pid = int(r.get("project_id") or 0)
        rid = int(r.get("requesttypes_id") or 0)
        sec = int(r.get("actiontime_total") or 0)
        pk = str(r.get("period_key") or "").strip() or ""
        rows.append(
            {
                "project_id": pid,
                "project_name": (r.get("project_name") or f"Proyecto #{pid}") or f"Proyecto #{pid}",
                "requesttypes_id": rid,
                "request_type_name": str(r.get("request_type_name") or "").strip() or "(sin fuente)",
                "period_key": pk,
                "actiontime_seconds": sec,
                "horas": round(sec / 3600.0, 2),
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "granularity": granularity,
        "rows": rows,
    }
