"""
Lógica de negocio y SQL del menú «Indicadores coordinación».

Reutiliza consultas KPI de `app.indicators` (filtro por proyecto, modal de ticket, SLA TTR).
El contrato HTTP vive en `app.modules.soporte.routes`.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from pymysql.err import OperationalError

from app.db import fetch_all, fetch_one
from app.modules.soporte.config import Settings, get_settings
from app.modules.soporte.metrics import STATUS_LABELS, _user_display_expr
from app.indicators import (
    _COORD_STATUS_IN_PROGRESS,
    _COORD_STATUS_NEW,
    _COORD_STATUS_PLANNED,
    _COORD_STATUS_WAITING,
    _fetch_global_kpi_ticket_rows_detail,
    _kpi_detail_actiontime_range_inner,
    _kpi_detail_solicitante_expr,
    _kpi_ticket_detail_normalize_rows,
    _kpi_ticket_estado_case_sql,
    _project_type_params,
    _project_type_sql,
    _sla_breach_resolution_params,
    _ticket_log_reopened_predicate_snippet,
    _ticket_out_of_sla_breach_sql_fragment,
    summary_kpis,
    support_hours_by_project_category_month,
    tickets_by_request_type_by_period,
    tickets_by_request_type_week_detail,
    tickets_created_in_range_detail,
    tickets_open_now_detail,
    tickets_resolved_in_range_detail,
)

def _coordination_status_counts_global(settings: Settings) -> Dict[str, int]:
    s = settings
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    ent_snip = ""
    ent_params: List[Any] = []
    if s.entities_id is not None:
        ent_snip = " AND t.entities_id = %s"
        ent_params = [s.entities_id]

    def _cnt(where_extra: str, tail_params: List[Any]) -> int:
        sql = (
            "SELECT COUNT(*) AS c FROM glpi_tickets t WHERE t.is_deleted = 0"
            f"{ent_snip} {where_extra}"
        )
        row = fetch_one(sql, tuple(ent_params + tail_params))
        return int(row.get("c") or 0) if row else 0

    started = _cnt("AND t.status = %s", [_COORD_STATUS_IN_PROGRESS])
    not_started = _cnt("AND t.status IN (%s, %s)", [_COORD_STATUS_NEW, _COORD_STATUS_PLANNED])
    waiting = _cnt("AND t.status = %s", [_COORD_STATUS_WAITING])

    reopened = 0
    try:
        ro_tail = (
            "AND t.status NOT IN (%s, %s) AND " + _ticket_log_reopened_predicate_snippet(s).strip()
        )
        reopened = _cnt(ro_tail, [st_sol, st_clo, st_sol, st_clo, st_sol, st_clo])
    except OperationalError:
        pass

    return {
        "tickets_started_now": started,
        "tickets_not_started_now": not_started,
        "tickets_waiting_now": waiting,
        "tickets_reopened_now": reopened,
    }


def _coordination_status_counts_scoped_itils(project_type_id: int, settings: Settings) -> Dict[str, int]:
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

    def _sql(where_body: str) -> str:
        return f"""
            SELECT COUNT(DISTINCT t.id) AS c
            {join_from}
            WHERE p.is_deleted = 0
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              {where_body}
        """

    r1 = fetch_one(_sql("AND t.status = %s"), tuple(params_base + [_COORD_STATUS_IN_PROGRESS]))
    r2 = fetch_one(
        _sql("AND t.status IN (%s, %s)"),
        tuple(params_base + [_COORD_STATUS_NEW, _COORD_STATUS_PLANNED]),
    )
    r3 = fetch_one(_sql("AND t.status = %s"), tuple(params_base + [_COORD_STATUS_WAITING]))

    reopened = 0
    try:
        r4 = fetch_one(
            _sql(f"AND t.status NOT IN (%s, %s) AND {_ticket_log_reopened_predicate_snippet(s).strip()}"),
            tuple(params_base + [st_sol, st_clo, st_sol, st_clo, st_sol, st_clo]),
        )
        resolved_opened = int(r4.get("c") or 0) if r4 else 0
        reopened = resolved_opened
    except OperationalError:
        pass

    return {
        "tickets_started_now": int(r1.get("c") or 0) if r1 else 0,
        "tickets_not_started_now": int(r2.get("c") or 0) if r2 else 0,
        "tickets_waiting_now": int(r3.get("c") or 0) if r3 else 0,
        "tickets_reopened_now": reopened,
    }


def _coordination_status_counts_scoped_plugin_try(project_type_id: int, settings: Settings) -> Dict[str, int]:
    """Mismo alcance de proyecto que summary_kpis; plugin o fallback itils."""
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

    def _sql(where_body: str) -> str:
        return f"""
            SELECT COUNT(DISTINCT t.id) AS c
            {join_from}
            WHERE p.is_deleted = 0
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              {where_body}
        """

    try:
        cr1 = fetch_one(_sql("AND t.status = %s"), tuple(params_base + [_COORD_STATUS_IN_PROGRESS]))
        cr2 = fetch_one(
            _sql("AND t.status IN (%s, %s)"),
            tuple(params_base + [_COORD_STATUS_NEW, _COORD_STATUS_PLANNED]),
        )
        cr3 = fetch_one(_sql("AND t.status = %s"), tuple(params_base + [_COORD_STATUS_WAITING]))
        reopened_val = 0
        try:
            cr4 = fetch_one(
                _sql(f"AND t.status NOT IN (%s, %s) AND {_ticket_log_reopened_predicate_snippet(s).strip()}"),
                tuple(params_base + [st_sol, st_clo, st_sol, st_clo, st_sol, st_clo]),
            )
            reopened_val = int(cr4.get("c") or 0) if cr4 else 0
        except OperationalError:
            pass

        return {
            "tickets_started_now": int(cr1.get("c") or 0) if cr1 else 0,
            "tickets_not_started_now": int(cr2.get("c") or 0) if cr2 else 0,
            "tickets_waiting_now": int(cr3.get("c") or 0) if cr3 else 0,
            "tickets_reopened_now": reopened_val,
        }
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            return _coordination_status_counts_scoped_itils(project_type_id, settings=s)
        raise


def _coordination_tickets_out_of_sla_count_global(
    date_from: str,
    date_to: str,
    settings: Settings,
) -> int:
    s = settings
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    ticket_entity = ""
    params_entity: List[Any] = []
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_entity = [s.entities_id]
    breach = _ticket_out_of_sla_breach_sql_fragment()
    sql = (
        "SELECT COUNT(*) AS c FROM glpi_tickets t WHERE t.is_deleted = 0"
        f"{ticket_entity}"
        " AND t.date >= %s AND t.date < DATE_ADD(%s, INTERVAL 1 DAY) "
        f"{breach}"
    )
    params = list(params_entity) + [date_from, date_to] + _sla_breach_resolution_params(
        st_sol, st_clo
    )
    row = fetch_one(sql, tuple(params))
    return int(row.get("c") or 0) if row else 0


def _coordination_tickets_out_of_sla_count_scoped_itils(
    project_type_id: int,
    date_from: str,
    date_to: str,
    settings: Settings,
) -> int:
    s = settings
    pt_sql = _project_type_sql(project_type_id)
    params_base = _project_type_params(project_type_id)
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_base = params_base + [s.entities_id]
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    breach = _ticket_out_of_sla_breach_sql_fragment()
    join_from = """
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
    """
    sql = f"""
        SELECT COUNT(DISTINCT t.id) AS c
        {join_from}
        WHERE 1=1
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
          {breach}
    """
    params = list(params_base) + [date_from, date_to] + _sla_breach_resolution_params(
        st_sol, st_clo
    )
    row = fetch_one(sql, tuple(params))
    return int(row.get("c") or 0) if row else 0


def _coordination_tickets_out_of_sla_count_scoped_plugin_try(
    project_type_id: int,
    date_from: str,
    date_to: str,
    settings: Settings,
) -> int:
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
    breach = _ticket_out_of_sla_breach_sql_fragment()
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
    sql = f"""
        SELECT COUNT(DISTINCT t.id) AS c
        {join_from}
        WHERE p.is_deleted = 0
          {pt_sql}
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
          {breach}
    """
    params = list(params_base) + [date_from, date_to] + _sla_breach_resolution_params(
        st_sol, st_clo
    )
    try:
        row = fetch_one(sql, tuple(params))
        return int(row.get("c") or 0) if row else 0
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            return _coordination_tickets_out_of_sla_count_scoped_itils(
                project_type_id=project_type_id,
                date_from=date_from,
                date_to=date_to,
                settings=s,
            )
        raise


def _coordination_tickets_out_of_sla_count(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Settings,
) -> int:
    try:
        if project_type_id is not None and int(project_type_id) >= 1:
            return _coordination_tickets_out_of_sla_count_scoped_plugin_try(
                int(project_type_id),
                date_from=date_from,
                date_to=date_to,
                settings=settings,
            )
        return _coordination_tickets_out_of_sla_count_global(
            date_from=date_from,
            date_to=date_to,
            settings=settings,
        )
    except OperationalError as e:
        if e.args and e.args[0] == 1054:
            return 0
        raise


def coordination_summary_kpis(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Extiende `summary_kpis` con métricas de coordinación por estado instantáneo
    (en curso, no iniciados nuevo+planificado, en espera, reabiertos vía histórico de log)
    y el total de tickets creados en el rango con incumplimiento del plazo TTR de GLPI (`time_to_resolve`).
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()

    core = summary_kpis(project_type_id=project_type_id, date_from=date_from, date_to=date_to, settings=s)

    if project_type_id is not None and int(project_type_id) >= 1:
        extra = _coordination_status_counts_scoped_plugin_try(int(project_type_id), settings=s)
    else:
        extra = _coordination_status_counts_global(s)

    core.update(extra)
    core["tickets_out_of_sla_in_range"] = _coordination_tickets_out_of_sla_count(
        project_type_id=project_type_id,
        date_from=date_from,
        date_to=date_to,
        settings=s,
    )
    return core
_COORD_DETAIL_BUCKETS = frozenset({"started", "not_started", "waiting", "reopened"})


def coordination_ticket_bucket_detail(
    bucket: str,
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Listado detalle para KPIs instantáneos: iniciados (en curso), no iniciados (nuevo+planificado),
    pausados (en espera), reabiertos (log GLPI estado).
    Tiempo invertido usa tareas con begin/date en el rango de filtros (igual que otros modales de coordinación).
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    b = bucket.strip().lower().replace("-", "_")
    if b not in _COORD_DETAIL_BUCKETS:
        raise ValueError(f"bucket inválido: {bucket}")

    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    solicitante_sq = f"{_kpi_detail_solicitante_expr(req_type)} AS solicitante"
    time_sq = f"{_kpi_detail_actiontime_range_inner()} AS actiontime_seconds"
    estad_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()

    if b == "started":
        status_tail = "AND t.status = %s"
        status_params: List[Any] = [_COORD_STATUS_IN_PROGRESS]
    elif b == "not_started":
        status_tail = "AND t.status IN (%s, %s)"
        status_params = [_COORD_STATUS_NEW, _COORD_STATUS_PLANNED]
    elif b == "waiting":
        status_tail = "AND t.status = %s"
        status_params = [_COORD_STATUS_WAITING]
    else:
        status_tail = "AND t.status NOT IN (%s, %s) AND " + _ticket_log_reopened_predicate_snippet(s).strip()
        status_params = [st_sol, st_clo, st_sol, st_clo, st_sol, st_clo]

    raw_rows: List[Dict[str, Any]] = []

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
              {status_tail}
            ORDER BY t.date ASC, t.id ASC
        """
        plist = list([date_from, date_from, date_to, date_to]) + params_base + status_params

        try:
            raw_rows = fetch_all(sql_plugin, tuple(plist))
        except OperationalError as e:
            if not (e.args and e.args[0] == 1146):
                if b == "reopened":
                    raw_rows = []
                else:
                    raise
            else:
                joins_it = """
                    FROM glpi_tickets t
                    INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
                    INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
                """
                sql_it = f"""
                    SELECT
                        t.id AS ticket_id,
                        t.name AS titulo,
                        DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_creacion,
                        {solicitante_sq},
                        {time_sq},
                        NULLIF(TRIM(p.name), '') AS proyecto,
                        {estad_sq}
                    {joins_it}
                    WHERE 1=1
                      {pt_sql}
                      {ticket_entity}
                      AND t.is_deleted = 0
                      {status_tail}
                    ORDER BY t.date ASC, t.id ASC
                """
                try:
                    raw_rows = fetch_all(sql_it, tuple(plist))
                except OperationalError:
                    if b == "reopened":
                        raw_rows = []
                    else:
                        raise
    else:
        ticket_entity = ""
        params_entity: List[Any] = []
        if s.entities_id is not None:
            ticket_entity = " AND t.entities_id = %s"
            params_entity = [s.entities_id]

        wg = (
            "WHERE t.is_deleted = 0"
            + ticket_entity
            + " "
            + status_tail
        )
        params_g = list([date_from, date_from, date_to, date_to]) + params_entity + status_params
        try:
            raw_rows = _fetch_global_kpi_ticket_rows_detail(wg, params_g, s)
        except OperationalError:
            if b == "reopened":
                raw_rows = []
            else:
                raise

    return {
        "bucket": b,
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": _kpi_ticket_detail_normalize_rows(raw_rows),
    }


def coordination_tickets_out_of_sla_detail(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Listado de tickets **creados en el rango** con incumplimiento del plazo TTR de GLPI (`time_to_resolve`),
    cualquier estado: si está resuelto/cerrado se compara con la fecha efectiva de cierre; si no, con NOW().
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
    breach = _ticket_out_of_sla_breach_sql_fragment()

    raw_rows: List[Dict[str, Any]] = []

    try:
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
              {breach}
            ORDER BY t.date ASC, t.id ASC
        """
            params = (
                list([date_from, date_from, date_to, date_to])
                + params_base
                + [date_from, date_to]
                + list(_sla_breach_resolution_params(st_sol, st_clo))
            )

            try:
                raw_rows = fetch_all(sql_plugin, tuple(params))
            except OperationalError as e:
                if e.args and e.args[0] == 1146:
                    try:
                        raw_rows = _tickets_out_of_sla_detail_in_range_itils(
                            project_type_id=project_type_id,
                            date_from=date_from,
                            date_to=date_to,
                            settings=s,
                        )
                    except OperationalError as e2:
                        if e2.args and e2.args[0] == 1054:
                            raw_rows = []
                        else:
                            raise
                elif e.args and e.args[0] == 1054:
                    raw_rows = []
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
                + " AND t.date >= %s AND t.date < DATE_ADD(%s, INTERVAL 1 DAY) "
                + breach
            )
            params_global = (
                list([date_from, date_from, date_to, date_to])
                + params_entity
                + [date_from, date_to]
                + list(_sla_breach_resolution_params(st_sol, st_clo))
            )
            try:
                raw_rows = _fetch_global_kpi_ticket_rows_detail(where_global, params_global, s)
            except OperationalError as e:
                if e.args and e.args[0] == 1054:
                    raw_rows = []
                else:
                    raise
    except OperationalError as e:
        if e.args and e.args[0] == 1054:
            raw_rows = []
        else:
            raise

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": _kpi_ticket_detail_normalize_rows(raw_rows),
    }


def _coord_plugin_project_joins_after_t(req_type: int) -> str:
    """Joins desde `glpi_tickets t` al proyecto resuelto (plugin Fields), como en otros KPI de coordinación."""
    return f"""
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


def _coord_itils_project_join_after_t() -> str:
    return """
        INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
    """


def _coord_iso_week_spine(date_from: str, date_to: str) -> List[Dict[str, Any]]:
    """
    Semanas ISO que intersectan [date_from, date_to]. period_sort alineado con YEARWEEK(..., 3).
    """
    d0 = datetime.strptime(date_from, "%Y-%m-%d").date()
    d1 = datetime.strptime(date_to, "%Y-%m-%d").date()
    range_end = datetime.combine(d1, datetime.max.time()).replace(microsecond=0)
    now_dt = datetime.now().replace(microsecond=0)
    seen: set[int] = set()
    out: List[Dict[str, Any]] = []
    cur = d0
    while cur <= d1:
        iso_y, iso_w, _ = cur.isocalendar()
        ps = iso_y * 100 + iso_w
        if ps not in seen:
            seen.add(ps)
            monday = cur - timedelta(days=int(cur.weekday()))
            sunday = monday + timedelta(days=6)
            week_end_date = datetime.combine(sunday, datetime.max.time()).replace(microsecond=0)
            week_eff = min(week_end_date, now_dt, range_end)
            out.append(
                {
                    "period_sort": ps,
                    "period_label": f"{iso_y} sem. {iso_w:02d}",
                    "week_period_start": monday.isoformat(),
                    "week_period_end": sunday.isoformat(),
                    "week_end": week_eff,
                    "tickets_created": 0,
                    "tickets_resolved": 0,
                    "tickets_open_snapshot": 0,
                    "tickets_open_historic_logs": 0,
                    "tickets_paused_events": 0,
                    "tickets_reopened_events": 0,
                    "tickets_out_of_sla": 0,
                }
            )
        cur += timedelta(days=1)
    out.sort(key=lambda x: int(x["period_sort"]))
    return out


def _coord_weekly_merge_counts(spine: List[Dict[str, Any]], key: str, rows: List[Dict[str, Any]]) -> None:
    m: Dict[int, int] = {}
    for r in rows:
        ps = r.get("period_sort")
        if ps is None:
            continue
        m[int(ps)] = int(r.get("c") or 0)
    for w in spine:
        w[key] = m.get(int(w["period_sort"]), 0)


def coordination_weekly_evolution(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Delegado a ``coordination_indicators`` (implementación única)."""
    from app.modules.soporte import coordination_indicators as coordination

    return coordination.coordination_weekly_evolution(
        project_type_id=project_type_id,
        date_from=date_from,
        date_to=date_to,
        settings=settings,
    )


def _coord_fetch_performance_series_meta(logins: List[str], settings: Settings) -> List[Dict[str, Any]]:
    """Metadata fija por login (orden de `logins`) para series del gráfico; incluye huecos si no hay usuario."""
    if not logins:
        return []
    udisp = _user_display_expr("u")
    ph = ",".join(["%s"] * len(logins))
    sql = f"""
        SELECT u.id AS user_id, u.name AS login, {udisp} AS full_name
        FROM glpi_users u
        WHERE u.is_deleted = 0 AND u.name IN ({ph})
    """
    rows = fetch_all(sql, tuple(logins))
    by_name: Dict[str, Dict[str, Any]] = {str(r["login"]): r for r in rows}
    meta: List[Dict[str, Any]] = []
    for i, lg in enumerate(logins):
        r = by_name.get(lg)
        if r:
            uid = int(r["user_id"])
            fn = str(r.get("full_name") or "").strip() or lg
            meta.append(
                {
                    "user_id": uid,
                    "login": lg,
                    "full_name": fn,
                    "chart_key": f"u{uid}",
                }
            )
        else:
            meta.append(
                {
                    "user_id": -(i + 1),
                    "login": lg,
                    "full_name": f"{lg} (sin cuenta activa)",
                    "chart_key": f"g{i}",
                }
            )
    return meta


def _coord_week_assignees_merged_for_series(
    ps: int,
    series_meta: List[Dict[str, Any]],
    by_week: Dict[int, List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    if not series_meta:
        return list(by_week.get(ps, []))
    existing_list = by_week.get(ps, [])
    by_uid = {int(x["user_id"]): x for x in existing_list}
    by_login: Dict[str, Dict[str, Any]] = {}
    for x in existing_list:
        lg = x.get("login")
        if lg is not None and str(lg).strip():
            by_login[str(lg).strip()] = x
    out: List[Dict[str, Any]] = []
    for m in series_meta:
        uid = int(m["user_id"])
        lg = m.get("login")
        row = None
        if uid > 0:
            row = by_uid.get(uid)
        if row is None and lg is not None and str(lg).strip():
            row = by_login.get(str(lg).strip())
        if row is not None:
            out.append(dict(row))
        else:
            out.append(
                {
                    "user_id": uid,
                    "full_name": str(m.get("full_name") or ""),
                    "login": lg,
                    "tickets_worked": 0,
                    "actiontime_seconds": 0,
                }
            )
    return out


def _coord_week_uid_login_lookup_from_lists(
    by_week: Dict[int, List[Dict[str, Any]]],
) -> Dict[int, Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]]:
    """Para cada semana ISO: búsqueda por user_id y por login (`glpi_users.name`)."""
    out: Dict[int, Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]] = {}
    for ps_i, lst in by_week.items():
        by_uid: Dict[int, Dict[str, Any]] = {}
        by_login: Dict[str, Dict[str, Any]] = {}
        for x in lst:
            uid = int(x.get("user_id") or 0)
            if uid > 0:
                by_uid[uid] = x
            lg_raw = x.get("login")
            if lg_raw is not None and str(lg_raw).strip():
                by_login[str(lg_raw).strip()] = x
        out[ps_i] = (by_uid, by_login)
    return out


def coordination_weekly_assignee_performance(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Delegado a ``coordination_indicators`` (implementación única)."""
    from app.modules.soporte import coordination_indicators as coordination

    return coordination.coordination_weekly_assignee_performance(
        project_type_id=project_type_id,
        date_from=date_from,
        date_to=date_to,
        settings=settings,
    )


def coordination_weekly_technician_evolution(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Delegado a ``coordination_indicators`` (implementación única)."""
    from app.modules.soporte import coordination_indicators as coordination

    return coordination.coordination_weekly_technician_evolution(
        project_type_id=project_type_id,
        date_from=date_from,
        date_to=date_to,
        settings=settings,
    )


def coordination_assignee_tickets_per_hour_analysis(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Sobre el rango completo de filtros: por técnico, tickets distintos con tareas (`actiontime` > 0),
    horas totales registradas y **tickets/hora** = tickets / (suma de `actiontime` en horas).

    Además: tickets **resueltos/cerrados** con `solvedate` en el rango donde el usuario figura como
    técnico asignado (`glpi_tickets_users`, tipo configurado), **tiempo medio** desde `t.date` hasta
    `t.solvedate`, y **resueltos por hora registrada** (cierres en rango ÷ horas de tarea en rango).

    Misma entidad, tipo de proyecto y lista `GLPI_COORD_PERFORMANCE_LOGINS` que el gráfico semanal
    (si hay logins configurados, se devuelve una fila por cada uno; ceros si no hubo tiempo).
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    req_type = int(s.requester_link_type)
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    assign_type = int(s.assignee_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()
    ticket_entity = ""
    params_entity: List[Any] = []
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_entity = [s.entities_id]

    udisp = _user_display_expr("u")
    tech_uid = "COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id)"
    login_filter_sql = ""
    login_filter_params: List[str] = []
    allowed_logins = s.coordination_performance_user_logins_list
    if allowed_logins:
        login_filter_sql = " AND u.name IN (" + ",".join(["%s"] * len(allowed_logins)) + ")"
        login_filter_params = list(allowed_logins)

    series_meta = _coord_fetch_performance_series_meta(allowed_logins, s) if allowed_logins else []

    def _sql_scoped_totals(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                {tech_uid} AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT tt.tickets_id) AS tickets_worked,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
            {tail}
            LEFT JOIN glpi_users u ON u.id = {tech_uid}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND tt.actiontime > 0
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
              AND {tech_uid} > 0
              {login_filter_sql}
            GROUP BY user_id, u.id, u.firstname, u.realname, u.name
            ORDER BY actiontime_total DESC
        """

    def _sql_global_totals() -> str:
        return f"""
            SELECT
                {tech_uid} AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT tt.tickets_id) AS tickets_worked,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
            LEFT JOIN glpi_users u ON u.id = {tech_uid}
            WHERE tt.actiontime > 0
              {ticket_entity}
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
              AND {tech_uid} > 0
              {login_filter_sql}
            GROUP BY user_id, u.id, u.firstname, u.realname, u.name
            ORDER BY actiontime_total DESC
        """

    time_params = [date_from, date_from, date_to, date_to]
    tail_params = tuple(login_filter_params)
    raw_rows: List[Dict[str, Any]] = []
    if project_type_id is not None and int(project_type_id) >= 1:
        params_base = _project_type_params(project_type_id) + list(params_entity)
        qparams = tuple(params_base + time_params + list(tail_params))
        try:
            raw_rows = fetch_all(_sql_scoped_totals(True), qparams)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw_rows = fetch_all(_sql_scoped_totals(False), qparams)
            else:
                raise
    else:
        pb = list(params_entity)
        raw_rows = fetch_all(_sql_global_totals(), tuple(pb + time_params + list(tail_params)))

    def _sql_resolved_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                tu.users_id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT t.id) AS tickets_resolved,
                AVG(TIMESTAMPDIFF(SECOND, t.date, t.solvedate)) AS avg_resolution_seconds
            FROM glpi_tickets t
            INNER JOIN glpi_tickets_users tu ON tu.tickets_id = t.id AND tu.type = {assign_type}
            INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.status IN (%s, %s)
              AND t.solvedate IS NOT NULL
              AND t.solvedate >= %s
              AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
              {login_filter_sql}
            GROUP BY tu.users_id, u.id, u.firstname, u.realname, u.name
            ORDER BY tickets_resolved DESC
        """

    def _sql_resolved_global() -> str:
        return f"""
            SELECT
                tu.users_id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT t.id) AS tickets_resolved,
                AVG(TIMESTAMPDIFF(SECOND, t.date, t.solvedate)) AS avg_resolution_seconds
            FROM glpi_tickets t
            INNER JOIN glpi_tickets_users tu ON tu.tickets_id = t.id AND tu.type = {assign_type}
            INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
            WHERE t.is_deleted = 0
              {ticket_entity}
              AND t.status IN (%s, %s)
              AND t.solvedate IS NOT NULL
              AND t.solvedate >= %s
              AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
              {login_filter_sql}
            GROUP BY tu.users_id, u.id, u.firstname, u.realname, u.name
            ORDER BY tickets_resolved DESC
        """

    res_params_tail = [st_sol, st_clo, date_from, date_to] + list(login_filter_params)
    res_rows: List[Dict[str, Any]] = []
    if project_type_id is not None and int(project_type_id) >= 1:
        params_base_r = _project_type_params(project_type_id) + list(params_entity)
        qres = tuple(params_base_r + res_params_tail)
        try:
            res_rows = fetch_all(_sql_resolved_scoped(True), qres)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                res_rows = fetch_all(_sql_resolved_scoped(False), qres)
            else:
                raise
    else:
        pb_r = list(params_entity)
        res_rows = fetch_all(_sql_resolved_global(), tuple(pb_r + res_params_tail))

    res_by_uid: Dict[int, Dict[str, Any]] = {}
    res_by_login: Dict[str, Dict[str, Any]] = {}
    for r in res_rows:
        uid = int(r.get("user_id") or 0)
        if uid < 1:
            continue
        lg_raw = r.get("login")
        lg = str(lg_raw).strip() if lg_raw is not None else ""
        rec = {
            "tickets_resolved": int(r.get("tickets_resolved") or 0),
            "avg_resolution_seconds": r.get("avg_resolution_seconds"),
        }
        res_by_uid[uid] = rec
        if lg:
            res_by_login[lg] = rec

    by_uid: Dict[int, Dict[str, Any]] = {}
    by_login: Dict[str, Dict[str, Any]] = {}
    for r in raw_rows:
        uid = int(r.get("user_id") or 0)
        if uid < 1:
            continue
        lg_raw = r.get("login")
        lg = str(lg_raw).strip() if lg_raw is not None else ""
        rec = {
            "tickets_worked": int(r.get("tickets_worked") or 0),
            "actiontime_seconds": int(r.get("actiontime_total") or 0),
            "full_name": (str(r.get("full_name") or "").strip() or f"Usuario #{uid}"),
            "login": lg or None,
        }
        by_uid[uid] = rec
        if lg:
            by_login[lg] = rec

    rows_out: List[Dict[str, Any]] = []

    def _resolution_hit(uid: int, lg: Optional[str]) -> Optional[Dict[str, Any]]:
        if uid > 0 and uid in res_by_uid:
            return res_by_uid[uid]
        if lg:
            k = str(lg).strip()
            if k and k in res_by_login:
                return res_by_login[k]
        return None

    def _row_for(uid: int, lg: Optional[str], default_name: str) -> Dict[str, Any]:
        hit = None
        if uid > 0:
            hit = by_uid.get(uid)
        if hit is None and lg:
            hit = by_login.get(str(lg).strip())
        tickets = int(hit["tickets_worked"]) if hit else 0
        sec = int(hit["actiontime_seconds"]) if hit else 0
        fn = str(hit["full_name"]) if hit else default_name
        hours = sec / 3600.0
        tph: Optional[float] = None
        if hours > 0 and tickets >= 0:
            tph = round(tickets / hours, 4)
        rh = _resolution_hit(uid, lg)
        tr = int(rh["tickets_resolved"]) if rh else 0
        avg_sec = rh.get("avg_resolution_seconds") if rh else None
        avg_resolution_hours: Optional[float] = None
        if tr > 0 and avg_sec is not None:
            try:
                v = float(avg_sec)
                if v >= 0:
                    avg_resolution_hours = round(v / 3600.0, 2)
            except (TypeError, ValueError):
                pass
        rph: Optional[float] = None
        if hours > 0 and tr >= 0:
            rph = round(tr / hours, 4)
        return {
            "user_id": uid,
            "login": lg,
            "full_name": fn,
            "tickets_worked": tickets,
            "actiontime_seconds": sec,
            "hours": round(hours, 2),
            "tickets_per_hour": tph,
            "tickets_resolved_in_range": tr,
            "avg_resolution_hours": avg_resolution_hours,
            "resolved_per_registered_hour": rph,
        }

    if series_meta:
        for m in series_meta:
            uid = int(m["user_id"])
            lg = m.get("login")
            lg_s = str(lg) if lg is not None else None
            rows_out.append(_row_for(uid, lg_s, str(m.get("full_name") or "")))
    else:
        for r in raw_rows:
            uid = int(r.get("user_id") or 0)
            if uid < 1:
                continue
            lg_raw = r.get("login")
            lg_s = str(lg_raw).strip() if lg_raw is not None else ""
            fn = str(r.get("full_name") or "").strip() or f"Usuario #{uid}"
            rows_out.append(_row_for(uid, lg_s or None, fn))

        rows_out.sort(
            key=lambda r: (
                r["tickets_per_hour"] if r["tickets_per_hour"] is not None else -1.0,
                r["tickets_worked"],
            ),
            reverse=True,
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": rows_out,
    }

def _problems_iso_week_spine(date_from: str, date_to: str) -> List[Dict[str, Any]]:
    """Semanas ISO que intersectan [date_from, date_to]; mismas claves de periodo que coordinación."""
    d0 = datetime.strptime(date_from, "%Y-%m-%d").date()
    d1 = datetime.strptime(date_to, "%Y-%m-%d").date()
    seen: set[int] = set()
    out: List[Dict[str, Any]] = []
    cur = d0
    while cur <= d1:
        iso_y, iso_w, _ = cur.isocalendar()
        ps = iso_y * 100 + iso_w
        if ps not in seen:
            seen.add(ps)
            monday = cur - timedelta(days=int(cur.weekday()))
            sunday = monday + timedelta(days=6)
            out.append(
                {
                    "period_sort": ps,
                    "period_label": f"{iso_y} sem. {iso_w:02d}",
                    "week_period_start": monday.isoformat(),
                    "week_period_end": sunday.isoformat(),
                    "problems_created": 0,
                    "problems_resolved_or_closed": 0,
                }
            )
        cur += timedelta(days=1)
    out.sort(key=lambda x: int(x["period_sort"]))
    return out


def _problems_merge_week_counts(spine: List[Dict[str, Any]], rows: List[Dict[str, Any]], field: str) -> None:
    m: Dict[int, int] = {}
    for r in rows:
        ps = r.get("period_sort")
        if ps is None:
            continue
        m[int(ps)] = int(r.get("c") or 0)
    for w in spine:
        w[field] = m.get(int(w["period_sort"]), 0)


def problems_support_indicators(
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Totales en `glpi_problems`, desglose por estado y serie semanal en el rango.
    Respeta GLPI_ENTITIES_ID; sin filtro por tipo de proyecto.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    ent_tail = ""
    ent_params: List[Any] = []
    if s.entities_id is not None:
        ent_tail = " AND p.entities_id = %s"
        ent_params = [int(s.entities_id)]

    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)

    total_row = fetch_one(
        f"SELECT COUNT(*) AS c FROM glpi_problems p WHERE p.is_deleted = 0{ent_tail}",
        tuple(ent_params),
    )
    total_problems = int(total_row.get("c") or 0) if total_row else 0

    status_rows = fetch_all(
        f"""
        SELECT p.status AS status_id, COUNT(*) AS c
        FROM glpi_problems p
        WHERE p.is_deleted = 0{ent_tail}
        GROUP BY p.status
        ORDER BY p.status
        """,
        tuple(ent_params),
    )
    by_status: List[Dict[str, Any]] = []
    for r in status_rows:
        sid = int(r.get("status_id") or 0)
        by_status.append(
            {
                "status_id": sid,
                "status_label": STATUS_LABELS.get(sid, f"Estado #{sid}"),
                "count": int(r.get("c") or 0),
            }
        )

    spine = _problems_iso_week_spine(date_from, date_to)

    created_sql = f"""
        SELECT YEARWEEK(COALESCE(p.date_creation, p.date), 3) AS period_sort, COUNT(*) AS c
        FROM glpi_problems p
        WHERE p.is_deleted = 0{ent_tail}
          AND COALESCE(p.date_creation, p.date) >= %s
          AND COALESCE(p.date_creation, p.date) < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY YEARWEEK(COALESCE(p.date_creation, p.date), 3)
    """
    date_params = [date_from, date_to]
    try:
        created_rows = fetch_all(created_sql, tuple(ent_params + date_params))
    except OperationalError as e:
        if e.args and e.args[0] == 1054:
            created_sql_simple = f"""
                SELECT YEARWEEK(p.date, 3) AS period_sort, COUNT(*) AS c
                FROM glpi_problems p
                WHERE p.is_deleted = 0{ent_tail}
                  AND p.date >= %s
                  AND p.date < DATE_ADD(%s, INTERVAL 1 DAY)
                GROUP BY YEARWEEK(p.date, 3)
            """
            created_rows = fetch_all(created_sql_simple, tuple(ent_params + date_params))
        else:
            raise
    _problems_merge_week_counts(spine, created_rows, "problems_created")

    resolved_sql = f"""
        SELECT YEARWEEK(COALESCE(p.closedate, p.solvedate), 3) AS period_sort, COUNT(*) AS c
        FROM glpi_problems p
        WHERE p.is_deleted = 0{ent_tail}
          AND p.status IN (%s, %s)
          AND COALESCE(p.closedate, p.solvedate) IS NOT NULL
          AND COALESCE(p.closedate, p.solvedate) >= %s
          AND COALESCE(p.closedate, p.solvedate) < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY YEARWEEK(COALESCE(p.closedate, p.solvedate), 3)
    """
    resolved_rows = fetch_all(
        resolved_sql,
        tuple(ent_params + [st_sol, st_clo] + date_params),
    )
    _problems_merge_week_counts(spine, resolved_rows, "problems_resolved_or_closed")

    return {
        "date_from": date_from,
        "date_to": date_to,
        "total_problems": total_problems,
        "by_status": by_status,
        "weekly_rows": spine,
    }

