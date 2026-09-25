"""
Lógica de negocio y SQL del menú «Indicadores coordinación».

Reutiliza consultas KPI de `app.modules.soporte.indicators` (filtro por proyecto, modal de ticket, SLA TTR).
El contrato HTTP vive en `app.modules.soporte.routes`.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from pymysql.err import OperationalError

from app.db import fetch_all, fetch_one
from app.modules.soporte.config import Settings, get_settings
from app.modules.soporte.indicators import (
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
)
from app.modules.soporte.metrics import _user_display_expr

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
                    "tickets_managed_events": 0,
                    "actiontime_managed_seconds": 0,
                    "actiontime_resolved_seconds": 0,
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
    """
    Evolución semanal ISO dentro del rango de filtros (entidad y tipo de proyecto como el resumen).

    - **tickets_created**: aperturas con `t.date` en el rango, por semana ISO de creación.
    - **tickets_resolved**: en `glpi_logs`, transición **hacia** resuelto/cerrado desde un estado no resuelto/cerrado
      (`id_search_option` = `GLPI_TICKET_LOG_SO_STATUS`), por semana ISO de `lg.date_mod` (no usa `solvedate`).
    - **tickets_managed_events**: en `glpi_logs`, transición **desde** Nuevo **hacia** En curso, Planificado o En espera
      (misma opción de estado), por semana ISO de `lg.date_mod`; tickets distintos gestionados esa semana.
    - **actiontime_managed_seconds** / **actiontime_resolved_seconds**: suma de ``actiontime`` de tareas
      (``glpi_tickettasks``, ``begin``/``date``) en la **misma** semana ISO sobre tickets con evento gestionado o resuelto
      esa semana (sin duplicar si hay varios logs del mismo ticket).
    - **tickets_open_snapshot**: mismo universo y agrupación que **creados** (``t.date`` en el rango, semana ISO de creación),
      restringido a tickets cuyo **estado actual** no es resuelto ni cerrado; en cada semana, subconjunto de los creados allí.
    - **tickets_open_historic_logs**: por semana ISO, tickets en alcance con **estado reconstruido al instante de corte**
      (fin de semana efectivo) usando **solo** ``glpi_logs`` (opción ``GLPI_TICKET_LOG_SO_STATUS``): último ``new_value``
      con ``date_mod`` ≤ corte; si no hay, ``old_value`` del primer cambio posterior; si no hay logs de estado, ``t.status``.
      Permite ver cuántos quedaban «abiertos» (no resuelto/cerrado) **entonces**, aunque hoy estén cerrados.
    - **tickets_paused_events**: en `glpi_logs`, transición **a** estado En espera (4); `id_search_option` = `GLPI_TICKET_LOG_SO_STATUS`.
    - **tickets_reopened_events**: en `glpi_logs`, paso desde resuelto/cerrado a no resuelto/cerrado (misma lógica que KPI reabiertos).
    - **tickets_out_of_sla**: tickets creados en el rango que hoy incumplen TTR (`time_to_resolve`), agrupados por semana de creación.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    spine = _coord_iso_week_spine(date_from, date_to)
    if not spine:
        return {"date_from": date_from, "date_to": date_to, "project_type_id": project_type_id, "rows": []}

    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    lid = int(s.id_search_option_ticket_status_log)
    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()
    breach_frag = _ticket_out_of_sla_breach_sql_fragment()
    breach_params = [st_sol, st_clo, st_sol, st_clo]

    week_cut_union = " UNION ALL ".join(
        f"SELECT {int(w['period_sort'])} AS period_sort, %s AS week_end_cut" for w in spine
    )
    week_cut_params: List[Any] = [w["week_end"].strftime("%Y-%m-%d %H:%M:%S") for w in spine]

    ticket_entity = ""
    params_entity: List[Any] = []
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_entity = [s.entities_id]

    def _run_scoped(use_plugin: bool) -> None:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id) + list(params_entity)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"

        sql_created = f"""
            SELECT YEARWEEK(t.date, 3) AS period_sort, COUNT(DISTINCT t.id) AS c
            FROM glpi_tickets t
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
            GROUP BY period_sort
        """
        _coord_weekly_merge_counts(
            spine,
            "tickets_created",
            fetch_all(sql_created, tuple(params_base + [date_from, date_to])),
        )

        try:
            sql_res = f"""
                SELECT YEARWEEK(lg.date_mod, 3) AS period_sort, COUNT(DISTINCT lg.items_id) AS c
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                {tail}
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.new_value AS UNSIGNED) IN (%s, %s)
                  AND CAST(lg.old_value AS UNSIGNED) NOT IN (%s, %s)
                  AND {pw}
                  {pt_sql}
                  {ticket_entity}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_resolved",
                fetch_all(
                    sql_res,
                    tuple([st_sol, st_clo, st_sol, st_clo] + params_base + [date_from, date_to]),
                ),
            )
        except OperationalError:
            pass

        try:
            sql_managed = f"""
                SELECT YEARWEEK(lg.date_mod, 3) AS period_sort, COUNT(DISTINCT lg.items_id) AS c
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                {tail}
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.old_value AS UNSIGNED) = {_COORD_STATUS_NEW}
                  AND CAST(lg.new_value AS UNSIGNED) IN (
                    {_COORD_STATUS_IN_PROGRESS}, {_COORD_STATUS_PLANNED}, {_COORD_STATUS_WAITING}
                  )
                  AND {pw}
                  {pt_sql}
                  {ticket_entity}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_managed_events",
                fetch_all(sql_managed, tuple(params_base + [date_from, date_to])),
            )
        except OperationalError:
            pass

        try:
            sql_time_managed = f"""
                SELECT m.period_sort, COALESCE(SUM(tt.actiontime), 0) AS c
                FROM (
                    SELECT DISTINCT
                        YEARWEEK(lg.date_mod, 3) AS period_sort,
                        lg.items_id AS tickets_id
                    FROM glpi_logs lg
                    INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                    {tail}
                    WHERE lg.itemtype = 'Ticket'
                      AND lg.id_search_option = {lid}
                      AND lg.old_value REGEXP '^[0-9]+$'
                      AND lg.new_value REGEXP '^[0-9]+$'
                      AND CAST(lg.old_value AS UNSIGNED) = {_COORD_STATUS_NEW}
                      AND CAST(lg.new_value AS UNSIGNED) IN (
                        {_COORD_STATUS_IN_PROGRESS}, {_COORD_STATUS_PLANNED}, {_COORD_STATUS_WAITING}
                      )
                      AND {pw}
                      {pt_sql}
                      {ticket_entity}
                      AND lg.date_mod >= %s
                      AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                ) m
                INNER JOIN glpi_tickettasks tt ON tt.tickets_id = m.tickets_id
                  AND tt.actiontime > 0
                  AND YEARWEEK(COALESCE(tt.begin, tt.date), 3) = m.period_sort
                GROUP BY m.period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "actiontime_managed_seconds",
                fetch_all(sql_time_managed, tuple(params_base + [date_from, date_to])),
            )
        except OperationalError:
            pass

        try:
            sql_time_resolved = f"""
                SELECT m.period_sort, COALESCE(SUM(tt.actiontime), 0) AS c
                FROM (
                    SELECT DISTINCT
                        YEARWEEK(lg.date_mod, 3) AS period_sort,
                        lg.items_id AS tickets_id
                    FROM glpi_logs lg
                    INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                    {tail}
                    WHERE lg.itemtype = 'Ticket'
                      AND lg.id_search_option = {lid}
                      AND lg.old_value REGEXP '^[0-9]+$'
                      AND lg.new_value REGEXP '^[0-9]+$'
                      AND CAST(lg.new_value AS UNSIGNED) IN (%s, %s)
                      AND CAST(lg.old_value AS UNSIGNED) NOT IN (%s, %s)
                      AND {pw}
                      {pt_sql}
                      {ticket_entity}
                      AND lg.date_mod >= %s
                      AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                ) m
                INNER JOIN glpi_tickettasks tt ON tt.tickets_id = m.tickets_id
                  AND tt.actiontime > 0
                  AND YEARWEEK(COALESCE(tt.begin, tt.date), 3) = m.period_sort
                GROUP BY m.period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "actiontime_resolved_seconds",
                fetch_all(
                    sql_time_resolved,
                    tuple([st_sol, st_clo, st_sol, st_clo] + params_base + [date_from, date_to]),
                ),
            )
        except OperationalError:
            pass

        sql_open = f"""
            SELECT YEARWEEK(t.date, 3) AS period_sort, COUNT(DISTINCT t.id) AS c
            FROM glpi_tickets t
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
              AND t.status NOT IN (%s, %s)
            GROUP BY period_sort
        """
        _coord_weekly_merge_counts(
            spine,
            "tickets_open_snapshot",
            fetch_all(sql_open, tuple(params_base + [date_from, date_to, st_sol, st_clo])),
        )

        try:
            sql_open_hist = f"""
                SELECT w.period_sort, COUNT(DISTINCT t.id) AS c
                FROM ({week_cut_union}) w
                INNER JOIN glpi_tickets t ON t.is_deleted = 0
                  AND t.date <= w.week_end_cut
                {tail}
                WHERE {pw}
                  {pt_sql}
                  {ticket_entity}
                  AND IFNULL(
                    (
                      SELECT CAST(lg.new_value AS UNSIGNED)
                      FROM glpi_logs lg
                      WHERE lg.items_id = t.id
                        AND lg.itemtype = 'Ticket'
                        AND lg.id_search_option = {lid}
                        AND lg.old_value REGEXP '^[0-9]+$'
                        AND lg.new_value REGEXP '^[0-9]+$'
                        AND lg.date_mod <= w.week_end_cut
                      ORDER BY lg.date_mod DESC
                      LIMIT 1
                    ),
                    IFNULL(
                      (
                        SELECT CAST(lg.old_value AS UNSIGNED)
                        FROM glpi_logs lg
                        WHERE lg.items_id = t.id
                          AND lg.itemtype = 'Ticket'
                          AND lg.id_search_option = {lid}
                          AND lg.old_value REGEXP '^[0-9]+$'
                          AND lg.new_value REGEXP '^[0-9]+$'
                          AND lg.date_mod > w.week_end_cut
                        ORDER BY lg.date_mod ASC
                        LIMIT 1
                      ),
                      t.status
                    )
                  ) NOT IN (%s, %s)
                GROUP BY w.period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_open_historic_logs",
                fetch_all(sql_open_hist, tuple(week_cut_params + params_base + [st_sol, st_clo])),
            )
        except OperationalError:
            pass

        try:
            sql_oos = f"""
                SELECT YEARWEEK(t.date, 3) AS period_sort, COUNT(DISTINCT t.id) AS c
                FROM glpi_tickets t
                {tail}
                WHERE {pw}
                  {pt_sql}
                  {ticket_entity}
                  AND t.is_deleted = 0
                  AND t.date >= %s
                  AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
                  {breach_frag}
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_out_of_sla",
                fetch_all(sql_oos, tuple(params_base + [date_from, date_to] + breach_params)),
            )
        except OperationalError as ex:
            if not (ex.args and ex.args[0] == 1054):
                raise

        try:
            sql_pause = f"""
                SELECT YEARWEEK(lg.date_mod, 3) AS period_sort, COUNT(DISTINCT lg.items_id) AS c
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                {tail}
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.new_value AS UNSIGNED) = {_COORD_STATUS_WAITING}
                  AND CAST(lg.old_value AS UNSIGNED) <> {_COORD_STATUS_WAITING}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                  AND {pw}
                  {pt_sql}
                  {ticket_entity}
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_paused_events",
                fetch_all(sql_pause, tuple(params_base + [date_from, date_to])),
            )
        except OperationalError:
            pass

        try:
            sql_reo = f"""
                SELECT YEARWEEK(lg.date_mod, 3) AS period_sort, COUNT(DISTINCT lg.items_id) AS c
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                {tail}
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.old_value AS UNSIGNED) IN (%s, %s)
                  AND CAST(lg.new_value AS UNSIGNED) NOT IN (%s, %s)
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                  AND {pw}
                  {pt_sql}
                  {ticket_entity}
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_reopened_events",
                fetch_all(
                    sql_reo,
                    tuple(params_base + [st_sol, st_clo, st_sol, st_clo, date_from, date_to]),
                ),
            )
        except OperationalError:
            pass

    def _run_global() -> None:
        pb = list(params_entity)
        sql_created = f"""
            SELECT YEARWEEK(t.date, 3) AS period_sort, COUNT(*) AS c
            FROM glpi_tickets t
            WHERE t.is_deleted = 0
              {ticket_entity}
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
            GROUP BY period_sort
        """
        _coord_weekly_merge_counts(spine, "tickets_created", fetch_all(sql_created, tuple(pb + [date_from, date_to])))
        try:
            sql_res = f"""
                SELECT YEARWEEK(lg.date_mod, 3) AS period_sort, COUNT(DISTINCT lg.items_id) AS c
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.new_value AS UNSIGNED) IN (%s, %s)
                  AND CAST(lg.old_value AS UNSIGNED) NOT IN (%s, %s)
                  {ticket_entity}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_resolved",
                fetch_all(sql_res, tuple([st_sol, st_clo, st_sol, st_clo] + pb + [date_from, date_to])),
            )
        except OperationalError:
            pass
        try:
            sql_managed = f"""
                SELECT YEARWEEK(lg.date_mod, 3) AS period_sort, COUNT(DISTINCT lg.items_id) AS c
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.old_value AS UNSIGNED) = {_COORD_STATUS_NEW}
                  AND CAST(lg.new_value AS UNSIGNED) IN (
                    {_COORD_STATUS_IN_PROGRESS}, {_COORD_STATUS_PLANNED}, {_COORD_STATUS_WAITING}
                  )
                  {ticket_entity}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_managed_events",
                fetch_all(sql_managed, tuple(pb + [date_from, date_to])),
            )
        except OperationalError:
            pass
        try:
            sql_time_managed = f"""
                SELECT m.period_sort, COALESCE(SUM(tt.actiontime), 0) AS c
                FROM (
                    SELECT DISTINCT
                        YEARWEEK(lg.date_mod, 3) AS period_sort,
                        lg.items_id AS tickets_id
                    FROM glpi_logs lg
                    INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                    WHERE lg.itemtype = 'Ticket'
                      AND lg.id_search_option = {lid}
                      AND lg.old_value REGEXP '^[0-9]+$'
                      AND lg.new_value REGEXP '^[0-9]+$'
                      AND CAST(lg.old_value AS UNSIGNED) = {_COORD_STATUS_NEW}
                      AND CAST(lg.new_value AS UNSIGNED) IN (
                        {_COORD_STATUS_IN_PROGRESS}, {_COORD_STATUS_PLANNED}, {_COORD_STATUS_WAITING}
                      )
                      {ticket_entity}
                      AND lg.date_mod >= %s
                      AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                ) m
                INNER JOIN glpi_tickettasks tt ON tt.tickets_id = m.tickets_id
                  AND tt.actiontime > 0
                  AND YEARWEEK(COALESCE(tt.begin, tt.date), 3) = m.period_sort
                GROUP BY m.period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "actiontime_managed_seconds",
                fetch_all(sql_time_managed, tuple(pb + [date_from, date_to])),
            )
        except OperationalError:
            pass
        try:
            sql_time_resolved = f"""
                SELECT m.period_sort, COALESCE(SUM(tt.actiontime), 0) AS c
                FROM (
                    SELECT DISTINCT
                        YEARWEEK(lg.date_mod, 3) AS period_sort,
                        lg.items_id AS tickets_id
                    FROM glpi_logs lg
                    INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                    WHERE lg.itemtype = 'Ticket'
                      AND lg.id_search_option = {lid}
                      AND lg.old_value REGEXP '^[0-9]+$'
                      AND lg.new_value REGEXP '^[0-9]+$'
                      AND CAST(lg.new_value AS UNSIGNED) IN (%s, %s)
                      AND CAST(lg.old_value AS UNSIGNED) NOT IN (%s, %s)
                      {ticket_entity}
                      AND lg.date_mod >= %s
                      AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                ) m
                INNER JOIN glpi_tickettasks tt ON tt.tickets_id = m.tickets_id
                  AND tt.actiontime > 0
                  AND YEARWEEK(COALESCE(tt.begin, tt.date), 3) = m.period_sort
                GROUP BY m.period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "actiontime_resolved_seconds",
                fetch_all(
                    sql_time_resolved,
                    tuple([st_sol, st_clo, st_sol, st_clo] + pb + [date_from, date_to]),
                ),
            )
        except OperationalError:
            pass
        sql_open = f"""
            SELECT YEARWEEK(t.date, 3) AS period_sort, COUNT(*) AS c
            FROM glpi_tickets t
            WHERE t.is_deleted = 0
              {ticket_entity}
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
              AND t.status NOT IN (%s, %s)
            GROUP BY period_sort
        """
        _coord_weekly_merge_counts(
            spine,
            "tickets_open_snapshot",
            fetch_all(sql_open, tuple(pb + [date_from, date_to, st_sol, st_clo])),
        )

        try:
            sql_open_hist = f"""
                SELECT w.period_sort, COUNT(*) AS c
                FROM ({week_cut_union}) w
                INNER JOIN glpi_tickets t ON t.is_deleted = 0
                  AND t.date <= w.week_end_cut
                  {ticket_entity}
                WHERE IFNULL(
                    (
                      SELECT CAST(lg.new_value AS UNSIGNED)
                      FROM glpi_logs lg
                      WHERE lg.items_id = t.id
                        AND lg.itemtype = 'Ticket'
                        AND lg.id_search_option = {lid}
                        AND lg.old_value REGEXP '^[0-9]+$'
                        AND lg.new_value REGEXP '^[0-9]+$'
                        AND lg.date_mod <= w.week_end_cut
                      ORDER BY lg.date_mod DESC
                      LIMIT 1
                    ),
                    IFNULL(
                      (
                        SELECT CAST(lg.old_value AS UNSIGNED)
                        FROM glpi_logs lg
                        WHERE lg.items_id = t.id
                          AND lg.itemtype = 'Ticket'
                          AND lg.id_search_option = {lid}
                          AND lg.old_value REGEXP '^[0-9]+$'
                          AND lg.new_value REGEXP '^[0-9]+$'
                          AND lg.date_mod > w.week_end_cut
                        ORDER BY lg.date_mod ASC
                        LIMIT 1
                      ),
                      t.status
                    )
                  ) NOT IN (%s, %s)
                GROUP BY w.period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_open_historic_logs",
                fetch_all(sql_open_hist, tuple(week_cut_params + pb + [st_sol, st_clo])),
            )
        except OperationalError:
            pass

        try:
            sql_oos = f"""
                SELECT YEARWEEK(t.date, 3) AS period_sort, COUNT(*) AS c
                FROM glpi_tickets t
                WHERE t.is_deleted = 0
                  {ticket_entity}
                  AND t.date >= %s
                  AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
                  {breach_frag}
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_out_of_sla",
                fetch_all(sql_oos, tuple(pb + [date_from, date_to] + breach_params)),
            )
        except OperationalError as ex:
            if not (ex.args and ex.args[0] == 1054):
                raise

        try:
            sql_pause = f"""
                SELECT YEARWEEK(lg.date_mod, 3) AS period_sort, COUNT(DISTINCT lg.items_id) AS c
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.new_value AS UNSIGNED) = {_COORD_STATUS_WAITING}
                  AND CAST(lg.old_value AS UNSIGNED) <> {_COORD_STATUS_WAITING}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                  {ticket_entity}
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_paused_events",
                fetch_all(sql_pause, tuple(pb + [date_from, date_to])),
            )
        except OperationalError:
            pass

        try:
            sql_reo = f"""
                SELECT YEARWEEK(lg.date_mod, 3) AS period_sort, COUNT(DISTINCT lg.items_id) AS c
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.old_value AS UNSIGNED) IN (%s, %s)
                  AND CAST(lg.new_value AS UNSIGNED) NOT IN (%s, %s)
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
                  {ticket_entity}
                GROUP BY period_sort
            """
            _coord_weekly_merge_counts(
                spine,
                "tickets_reopened_events",
                fetch_all(sql_reo, tuple(pb + [st_sol, st_clo, st_sol, st_clo, date_from, date_to])),
            )
        except OperationalError:
            pass

    if project_type_id is not None and int(project_type_id) >= 1:
        try:
            _run_scoped(True)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                _run_scoped(False)
            else:
                raise
    else:
        _run_global()

    rows_out: List[Dict[str, Any]] = []
    for w in spine:
        rows_out.append(
            {
                "period_sort": int(w["period_sort"]),
                "period_label": str(w["period_label"]),
                "week_period_start": str(w.get("week_period_start") or ""),
                "week_period_end": str(w.get("week_period_end") or ""),
                "tickets_open_snapshot": int(w["tickets_open_snapshot"]),
                "tickets_open_historic_logs": int(w["tickets_open_historic_logs"]),
                "tickets_created": int(w["tickets_created"]),
                "tickets_paused_events": int(w["tickets_paused_events"]),
                "tickets_reopened_events": int(w["tickets_reopened_events"]),
                "tickets_resolved": int(w["tickets_resolved"]),
                "tickets_managed_events": int(w["tickets_managed_events"]),
                "actiontime_managed_seconds": int(w["actiontime_managed_seconds"]),
                "actiontime_resolved_seconds": int(w["actiontime_resolved_seconds"]),
                "tickets_out_of_sla": int(w["tickets_out_of_sla"]),
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": rows_out,
    }


def coordination_resolved_effort_by_resolution(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Indicador independiente: esfuerzo histórico atribuido a la fecha de resolución final.

    - Periodo de atribución: semana ISO de ``COALESCE(t.solvedate, t.closedate)`` (no usa ``glpi_logs``).
    - **tickets_resolved**: tickets distintos resuelto/cerrado con esa fecha de resolución en el rango.
    - **actiontime_total_seconds**: suma de ``actiontime`` de **todas** las tareas del ticket
      (``glpi_tickettasks``), sin filtrar por ``begin``/``date`` de la tarea.
    - **avg_hours_per_ticket**: ``actiontime_total_seconds / 3600 / tickets_resolved``.

    Reapertura: al usar la fecha actual de resolución del ticket, las horas se atribuyen solo a la
    resolución final vigente (no se duplican en resoluciones anteriores).
    Independiente de la serie «Horas en gestionados/resueltos» de la evolución semanal.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    spine = _coord_iso_week_spine(date_from, date_to)
    if not spine:
        return {"date_from": date_from, "date_to": date_to, "project_type_id": project_type_id, "rows": []}

    for w in spine:
        w["tickets_resolved"] = 0
        w["actiontime_total_seconds"] = 0

    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()
    res_date = "COALESCE(t.solvedate, t.closedate)"

    ticket_entity = ""
    params_entity: List[Any] = []
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_entity = [s.entities_id]

    def _run_scoped(use_plugin: bool) -> None:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id) + list(params_entity)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"

        sql = f"""
            SELECT
                YEARWEEK({res_date}, 3) AS period_sort,
                COUNT(DISTINCT t.id) AS tickets_resolved,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickets t
            LEFT JOIN glpi_tickettasks tt ON tt.tickets_id = t.id AND tt.actiontime > 0
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.status IN (%s, %s)
              AND {res_date} IS NOT NULL
              AND {res_date} >= %s
              AND {res_date} < DATE_ADD(%s, INTERVAL 1 DAY)
            GROUP BY period_sort
        """
        rows = fetch_all(sql, tuple(params_base + [st_sol, st_clo, date_from, date_to]))
        by_ps: Dict[int, Dict[str, int]] = {}
        for r in rows:
            ps = r.get("period_sort")
            if ps is None:
                continue
            by_ps[int(ps)] = {
                "tickets_resolved": int(r.get("tickets_resolved") or 0),
                "actiontime_total_seconds": int(r.get("actiontime_total") or 0),
            }
        for w in spine:
            hit = by_ps.get(int(w["period_sort"]))
            if hit:
                w["tickets_resolved"] = hit["tickets_resolved"]
                w["actiontime_total_seconds"] = hit["actiontime_total_seconds"]

    def _run_global() -> None:
        pb = list(params_entity)
        sql = f"""
            SELECT
                YEARWEEK({res_date}, 3) AS period_sort,
                COUNT(DISTINCT t.id) AS tickets_resolved,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickets t
            LEFT JOIN glpi_tickettasks tt ON tt.tickets_id = t.id AND tt.actiontime > 0
            WHERE t.is_deleted = 0
              {ticket_entity}
              AND t.status IN (%s, %s)
              AND {res_date} IS NOT NULL
              AND {res_date} >= %s
              AND {res_date} < DATE_ADD(%s, INTERVAL 1 DAY)
            GROUP BY period_sort
        """
        rows = fetch_all(sql, tuple(pb + [st_sol, st_clo, date_from, date_to]))
        by_ps: Dict[int, Dict[str, int]] = {}
        for r in rows:
            ps = r.get("period_sort")
            if ps is None:
                continue
            by_ps[int(ps)] = {
                "tickets_resolved": int(r.get("tickets_resolved") or 0),
                "actiontime_total_seconds": int(r.get("actiontime_total") or 0),
            }
        for w in spine:
            hit = by_ps.get(int(w["period_sort"]))
            if hit:
                w["tickets_resolved"] = hit["tickets_resolved"]
                w["actiontime_total_seconds"] = hit["actiontime_total_seconds"]

    if project_type_id is not None and int(project_type_id) >= 1:
        try:
            _run_scoped(True)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                _run_scoped(False)
            else:
                raise
    else:
        _run_global()

    rows_out: List[Dict[str, Any]] = []
    for w in spine:
        tr = int(w["tickets_resolved"])
        sec = int(w["actiontime_total_seconds"])
        avg_h = round((sec / 3600.0) / tr, 2) if tr > 0 else 0.0
        rows_out.append(
            {
                "period_sort": int(w["period_sort"]),
                "period_label": str(w["period_label"]),
                "week_period_start": str(w.get("week_period_start") or ""),
                "week_period_end": str(w.get("week_period_end") or ""),
                "tickets_resolved": tr,
                "actiontime_total_seconds": sec,
                "avg_hours_per_ticket": avg_h,
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": rows_out,
    }


def _pareto_stats_from_seconds(ticket_seconds: List[int], threshold: float = 0.80) -> Dict[str, Any]:
    """
    A partir de una lista de actiontime (segundos) por ticket, calcula métricas 80-20.
    No ordena la lista de entrada; trabaja sobre una copia ordenada descendente.
    """
    secs = sorted((int(x) for x in ticket_seconds if int(x) > 0), reverse=True)
    n = len(secs)
    total = int(sum(secs))
    if n == 0 or total <= 0:
        return {
            "tickets_with_time": 0,
            "actiontime_total_seconds": 0,
            "tickets_for_80pct": 0,
            "pct_tickets_for_80": 0.0,
            "actiontime_80pct_seconds": 0,
            "pct_hours_in_top_20pct_tickets": 0.0,
        }
    target = total * float(threshold)
    cum = 0
    k = 0
    for s in secs:
        cum += s
        k += 1
        if cum >= target:
            break
    top20_n = max(1, int(round(n * 0.20)))
    top20_sec = int(sum(secs[:top20_n]))
    return {
        "tickets_with_time": n,
        "actiontime_total_seconds": total,
        "tickets_for_80pct": k,
        "pct_tickets_for_80": round((k / n) * 100.0, 2),
        "actiontime_80pct_seconds": cum,
        "pct_hours_in_top_20pct_tickets": round((top20_sec / total) * 100.0, 2),
    }


def coordination_ticket_time_pareto(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
    top_n: int = 40,
) -> Dict[str, Any]:
    """
    Indicador 80-20 (Pareto) de tickets por tiempo de consumo (``glpi_tickettasks.actiontime``).

    - Universo: tareas con ``actiontime`` > 0 y ``COALESCE(begin, date)`` en el rango de filtros
      (misma entidad / tipo de proyecto que el resto de coordinación).
    - **range**: ranking de tickets en todo el rango + métricas 80-20 + ``top_tickets`` (hasta
      cubrir el 80 % o ``top_n`` filas).
    - **weeks** / **months**: para cada periodo, métricas 80-20 recalculadas con el tiempo de
      tareas de ese periodo (no es promedio de semanas).
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    spine = _coord_iso_week_spine(date_from, date_to)
    empty = {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "range": {
            **_pareto_stats_from_seconds([]),
            "top_tickets": [],
        },
        "weeks": [],
        "months": [],
    }
    if not spine:
        return empty

    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()
    ticket_entity = ""
    params_entity: List[Any] = []
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_entity = [s.entities_id]

    time_params = [date_from, date_from, date_to, date_to]
    limit_n = max(5, min(int(top_n), 100))

    def _fetch_ticket_totals(use_plugin: Optional[bool]) -> List[Dict[str, Any]]:
        if use_plugin is None:
            sql = f"""
                SELECT
                    t.id AS ticket_id,
                    t.name AS ticket_name,
                    COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
                FROM glpi_tickettasks tt
                INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
                WHERE tt.actiontime > 0
                  {ticket_entity}
                  AND (tt.begin >= %s OR tt.date >= %s)
                  AND (
                      tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                      OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
                  )
                GROUP BY t.id, t.name
                HAVING actiontime_total > 0
                ORDER BY actiontime_total DESC
            """
            return fetch_all(sql, tuple(params_entity + time_params))

        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id) + list(params_entity)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        sql = f"""
            SELECT
                t.id AS ticket_id,
                t.name AS ticket_name,
                COALESCE(MAX(p.name), '') AS project_name,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND tt.actiontime > 0
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
            GROUP BY t.id, t.name
            HAVING actiontime_total > 0
            ORDER BY actiontime_total DESC
        """
        return fetch_all(sql, tuple(params_base + time_params))

    def _fetch_period_rows(use_plugin: Optional[bool], period_expr: str) -> List[Dict[str, Any]]:
        if use_plugin is None:
            sql = f"""
                SELECT
                    {period_expr} AS period_sort,
                    t.id AS ticket_id,
                    COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
                FROM glpi_tickettasks tt
                INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
                WHERE tt.actiontime > 0
                  {ticket_entity}
                  AND (tt.begin >= %s OR tt.date >= %s)
                  AND (
                      tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                      OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
                  )
                GROUP BY period_sort, t.id
                HAVING actiontime_total > 0
            """
            return fetch_all(sql, tuple(params_entity + time_params))

        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id) + list(params_entity)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        sql = f"""
            SELECT
                {period_expr} AS period_sort,
                t.id AS ticket_id,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND tt.actiontime > 0
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
            GROUP BY period_sort, t.id
            HAVING actiontime_total > 0
        """
        return fetch_all(sql, tuple(params_base + time_params))

    use_plugin: Optional[bool]
    if project_type_id is not None and int(project_type_id) >= 1:
        try:
            ticket_rows = _fetch_ticket_totals(True)
            week_rows = _fetch_period_rows(True, "YEARWEEK(COALESCE(tt.begin, tt.date), 3)")
            month_rows = _fetch_period_rows(True, "DATE_FORMAT(COALESCE(tt.begin, tt.date), '%%Y%%m')")
            use_plugin = True
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                ticket_rows = _fetch_ticket_totals(False)
                week_rows = _fetch_period_rows(False, "YEARWEEK(COALESCE(tt.begin, tt.date), 3)")
                month_rows = _fetch_period_rows(False, "DATE_FORMAT(COALESCE(tt.begin, tt.date), '%%Y%%m')")
                use_plugin = False
            else:
                raise
    else:
        ticket_rows = _fetch_ticket_totals(None)
        week_rows = _fetch_period_rows(None, "YEARWEEK(COALESCE(tt.begin, tt.date), 3)")
        month_rows = _fetch_period_rows(None, "DATE_FORMAT(COALESCE(tt.begin, tt.date), '%%Y%%m')")
        use_plugin = None

    seconds_all = [int(r.get("actiontime_total") or 0) for r in ticket_rows]
    range_stats = _pareto_stats_from_seconds(seconds_all)
    total_sec = int(range_stats["actiontime_total_seconds"])
    top_tickets: List[Dict[str, Any]] = []
    cum = 0
    target_80 = total_sec * 0.80 if total_sec > 0 else 0
    for i, r in enumerate(ticket_rows):
        if i >= limit_n and (total_sec <= 0 or cum >= target_80):
            break
        sec = int(r.get("actiontime_total") or 0)
        if sec <= 0:
            continue
        cum += sec
        name = str(r.get("ticket_name") or "").strip() or f"Ticket #{int(r['ticket_id'])}"
        proj = str(r.get("project_name") or "").strip() if use_plugin is not None else ""
        top_tickets.append(
            {
                "rank": i + 1,
                "ticket_id": int(r["ticket_id"]),
                "ticket_name": name,
                "project_name": proj or None,
                "actiontime_seconds": sec,
                "pct_of_total": round((sec / total_sec) * 100.0, 2) if total_sec > 0 else 0.0,
                "cumulative_pct": round((cum / total_sec) * 100.0, 2) if total_sec > 0 else 0.0,
            }
        )

    period_set = {int(w["period_sort"]) for w in spine}
    by_week: Dict[int, List[int]] = {}
    for r in week_rows:
        ps = r.get("period_sort")
        if ps is None:
            continue
        ps_i = int(ps)
        if ps_i not in period_set:
            continue
        by_week.setdefault(ps_i, []).append(int(r.get("actiontime_total") or 0))

    weeks_out: List[Dict[str, Any]] = []
    for w in spine:
        ps = int(w["period_sort"])
        st = _pareto_stats_from_seconds(by_week.get(ps, []))
        weeks_out.append(
            {
                "period_sort": ps,
                "period_label": str(w["period_label"]),
                "week_period_start": str(w.get("week_period_start") or ""),
                "week_period_end": str(w.get("week_period_end") or ""),
                **st,
            }
        )

    by_month: Dict[int, List[int]] = {}
    for r in month_rows:
        ps = r.get("period_sort")
        if ps is None:
            continue
        # DATE_FORMAT %Y%m puede venir como str
        try:
            ps_i = int(str(ps).replace("-", "")[:6])
        except (TypeError, ValueError):
            continue
        by_month.setdefault(ps_i, []).append(int(r.get("actiontime_total") or 0))

    months_out: List[Dict[str, Any]] = []
    for ps_i in sorted(by_month.keys()):
        y, m = divmod(ps_i, 100)
        if m < 1 or m > 12 or y < 1970:
            continue
        if m == 12:
            last_day = 31
        else:
            last_day = (datetime(y, m + 1, 1) - timedelta(days=1)).day
        month_start = f"{y:04d}-{m:02d}-01"
        month_end = f"{y:04d}-{m:02d}-{last_day:02d}"
        label_dt = datetime(y, m, 15)
        period_label = label_dt.strftime("%Y-%m")
        st = _pareto_stats_from_seconds(by_month[ps_i])
        months_out.append(
            {
                "period_sort": ps_i,
                "period_label": period_label,
                "week_period_start": month_start,
                "week_period_end": month_end,
                **st,
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "range": {
            **range_stats,
            "top_tickets": top_tickets,
        },
        "weeks": weeks_out,
        "months": months_out,
    }


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


def _coord_log_ticket_assignee_user_id_expr(lg_alias: str = "lg") -> str:
    """
    users_id del técnico asignado desde `glpi_logs.new_value`: id numérico o sufijo típico «Nombre (id)» en GLPI.
    """
    a = lg_alias
    return (
        f"COALESCE("
        f"CASE WHEN {a}.new_value REGEXP '^[0-9]+$' THEN CAST({a}.new_value AS UNSIGNED) END, "
        f"NULLIF(CAST(NULLIF(TRIM(TRAILING ' ' FROM SUBSTRING_INDEX("
        f"SUBSTRING_INDEX({a}.new_value, '(', -1), ')', 1)), '') AS UNSIGNED), 0)"
        f")"
    )


def _coord_enrich_assignees_weekly_performance_extras(
    assignees: List[Dict[str, Any]],
    ps: int,
    lookup_assignee_work: Dict[int, Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]],
    lookup_resolved: Dict[int, Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]],
    lookup_assigned_log: Dict[int, Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]],
) -> None:
    """Completa filas: asignaciones vía log, métricas legacy asignado+tarea, y cierres por semana ISO."""
    aw_uid, aw_login = lookup_assignee_work.get(ps, ({}, {}))
    rs_uid, rs_login = lookup_resolved.get(ps, ({}, {}))
    as_uid, as_login = lookup_assigned_log.get(ps, ({}, {}))
    for row in assignees:
        uid = int(row.get("user_id") or 0)
        lg_raw = row.get("login")
        lg_key = str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else ""
        hit_aw = aw_uid.get(uid) if uid > 0 else None
        if hit_aw is None and lg_key:
            hit_aw = aw_login.get(lg_key)
        hit_rs = rs_uid.get(uid) if uid > 0 else None
        if hit_rs is None and lg_key:
            hit_rs = rs_login.get(lg_key)
        hit_as = as_uid.get(uid) if uid > 0 else None
        if hit_as is None and lg_key:
            hit_as = as_login.get(lg_key)
        row["tickets_assigned_in_week"] = int(hit_as["tickets_assigned_in_week"]) if hit_as else 0
        row["tickets_assignee_worked"] = int(hit_aw["tickets_assignee_worked"]) if hit_aw else 0
        row["actiontime_assignee_seconds"] = int(hit_aw["actiontime_assignee_seconds"]) if hit_aw else 0
        row["tickets_resolved_assignee"] = int(hit_rs["tickets_resolved_assignee"]) if hit_rs else 0
        row["actiontime_on_resolved_assignee_seconds"] = (
            int(hit_rs["actiontime_on_resolved_assignee_seconds"]) if hit_rs else 0
        )


def coordination_weekly_assignee_performance(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Por semana ISO (mismo criterio que evolución semanal). Tres lecturas independientes por técnico y semana:

    - **tickets_assigned_in_week**: tickets distintos con evento en `glpi_logs` que asignan al técnico
      (`id_search_option` = `GLPI_LOG_ASSIGNEE_TECH_SEARCH_OPTION`, fecha `date_mod` en la semana ISO).
      Mide **carga entrante**; no exige imputación ni cierre en esa semana. Si la opción es `0`, siempre devuelve 0.
    - **tickets_resolved_assignee**: cierres resuelto/cerrado con `solvedate` en esa semana ISO, siendo asignado
      del ticket. Mide **throughput de cierre**.
    - **tickets_worked** / **actiontime_seconds**: tickets distintos con tareas (`actiontime` > 0) en la semana,
      donde el usuario es técnico de la tarea. **Esfuerzo operativo** (puede ser distinto del asignado formal).

    Campos legacy (cruce asignado + tarea en la semana):

    - **tickets_assignee_worked** / **actiontime_assignee_seconds**
    - **actiontime_on_resolved_assignee_seconds**: tiempo en tareas del asignado solo en tickets que cierran esa semana.

    Alcance de ticket: entidad + tipo de proyecto como el resto de coordinación.
    Si `GLPI_COORD_PERFORMANCE_LOGINS` tiene valores, solo esos logins y todas las semanas incluyen una fila
    por cada uno en la serie (ceros si no hubo datos).
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    spine = _coord_iso_week_spine(date_from, date_to)
    if not spine:
        return {
            "date_from": date_from,
            "date_to": date_to,
            "project_type_id": project_type_id,
            "assignee_series": [],
            "weeks": [],
        }

    period_set = {int(w["period_sort"]) for w in spine}
    req_type = int(s.requester_link_type)
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
    assign_type = int(s.assignee_link_type)
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    assign_log_opt = int(s.id_search_option_ticket_assignee_tech_log)
    log_uid_sql = _coord_log_ticket_assignee_user_id_expr("lg")

    def _normalize_assignee_work_rows(raw: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
        by_week_aw: Dict[int, List[Dict[str, Any]]] = {}
        for r in raw:
            ps = r.get("period_sort")
            if ps is None:
                continue
            ps_i = int(ps)
            if ps_i not in period_set:
                continue
            uid = int(r.get("user_id") or 0)
            if uid < 1:
                continue
            fn = r.get("full_name")
            name_s = (str(fn).strip() if fn is not None else "") or f"Usuario #{uid}"
            lg_raw = r.get("login")
            login_v = (str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else None) or None
            by_week_aw.setdefault(ps_i, []).append(
                {
                    "user_id": uid,
                    "full_name": name_s,
                    "login": login_v,
                    "tickets_assignee_worked": int(r.get("tickets_assignee_worked") or 0),
                    "actiontime_assignee_seconds": int(r.get("actiontime_assignee_seconds") or 0),
                }
            )
        for ps_i, lst in by_week_aw.items():
            lst.sort(
                key=lambda x: (
                    -int(x["actiontime_assignee_seconds"]),
                    -int(x["tickets_assignee_worked"]),
                    x["full_name"],
                )
            )
        return by_week_aw

    def _normalize_resolved_assignee_week_rows(raw: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
        by_week_r: Dict[int, List[Dict[str, Any]]] = {}
        for r in raw:
            ps = r.get("period_sort")
            if ps is None:
                continue
            ps_i = int(ps)
            if ps_i not in period_set:
                continue
            uid = int(r.get("user_id") or 0)
            if uid < 1:
                continue
            fn = r.get("full_name")
            name_s = (str(fn).strip() if fn is not None else "") or f"Usuario #{uid}"
            lg_raw = r.get("login")
            login_v = (str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else None) or None
            by_week_r.setdefault(ps_i, []).append(
                {
                    "user_id": uid,
                    "full_name": name_s,
                    "login": login_v,
                    "tickets_resolved_assignee": int(r.get("tickets_resolved_assignee") or 0),
                    "actiontime_on_resolved_assignee_seconds": int(
                        r.get("actiontime_on_resolved_assignee_seconds") or 0
                    ),
                }
            )
        for ps_i, lst in by_week_r.items():
            lst.sort(
                key=lambda x: (
                    -int(x["actiontime_on_resolved_assignee_seconds"]),
                    -int(x["tickets_resolved_assignee"]),
                    x["full_name"],
                )
            )
        return by_week_r

    def _normalize_assigned_in_week_rows(raw: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
        by_week_as: Dict[int, List[Dict[str, Any]]] = {}
        for r in raw:
            ps = r.get("period_sort")
            if ps is None:
                continue
            ps_i = int(ps)
            if ps_i not in period_set:
                continue
            uid = int(r.get("user_id") or 0)
            if uid < 1:
                continue
            fn = r.get("full_name")
            name_s = (str(fn).strip() if fn is not None else "") or f"Usuario #{uid}"
            lg_raw = r.get("login")
            login_v = (str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else None) or None
            by_week_as.setdefault(ps_i, []).append(
                {
                    "user_id": uid,
                    "full_name": name_s,
                    "login": login_v,
                    "tickets_assigned_in_week": int(r.get("tickets_assigned_in_week") or 0),
                }
            )
        for ps_i, lst in by_week_as.items():
            lst.sort(
                key=lambda x: (
                    -int(x["tickets_assigned_in_week"]),
                    x["full_name"],
                )
            )
        return by_week_as

    def _sql_assignee_work_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                YEARWEEK(COALESCE(tt.begin, tt.date), 3) AS period_sort,
                tu.users_id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT tt.tickets_id) AS tickets_assignee_worked,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_assignee_seconds
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
            INNER JOIN glpi_tickets_users tu ON tu.tickets_id = t.id
              AND tu.type = {assign_type}
              AND tu.users_id = {tech_uid}
            {tail}
            INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND tt.actiontime > 0
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
              AND tu.users_id > 0
              {login_filter_sql}
            GROUP BY period_sort, tu.users_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, actiontime_assignee_seconds DESC
        """

    def _sql_assignee_work_global() -> str:
        return f"""
            SELECT
                YEARWEEK(COALESCE(tt.begin, tt.date), 3) AS period_sort,
                tu.users_id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT tt.tickets_id) AS tickets_assignee_worked,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_assignee_seconds
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
            INNER JOIN glpi_tickets_users tu ON tu.tickets_id = t.id
              AND tu.type = {assign_type}
              AND tu.users_id = {tech_uid}
            INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
            WHERE tt.actiontime > 0
              {ticket_entity}
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
              AND tu.users_id > 0
              {login_filter_sql}
            GROUP BY period_sort, tu.users_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, actiontime_assignee_seconds DESC
        """

    def _sql_assigned_week_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                YEARWEEK(lg.date_mod, 3) AS period_sort,
                u.id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT lg.items_id) AS tickets_assigned_in_week
            FROM glpi_logs lg
            INNER JOIN glpi_tickets t ON t.id = lg.items_id AND t.is_deleted = 0
            INNER JOIN glpi_users u ON u.id = ({log_uid_sql}) AND u.is_deleted = 0
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND lg.itemtype = 'Ticket'
              AND lg.id_search_option = {assign_log_opt}
              AND lg.date_mod >= %s
              AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
              AND ({log_uid_sql}) > 0
              {login_filter_sql}
            GROUP BY period_sort, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, tickets_assigned_in_week DESC
        """

    def _sql_assigned_week_global() -> str:
        return f"""
            SELECT
                YEARWEEK(lg.date_mod, 3) AS period_sort,
                u.id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT lg.items_id) AS tickets_assigned_in_week
            FROM glpi_logs lg
            INNER JOIN glpi_tickets t ON t.id = lg.items_id AND t.is_deleted = 0
            INNER JOIN glpi_users u ON u.id = ({log_uid_sql}) AND u.is_deleted = 0
            WHERE lg.itemtype = 'Ticket'
              AND lg.id_search_option = {assign_log_opt}
              AND lg.date_mod >= %s
              AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
              AND ({log_uid_sql}) > 0
              {ticket_entity}
              {login_filter_sql}
            GROUP BY period_sort, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, tickets_assigned_in_week DESC
        """

    def _sql_resolved_week_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                YEARWEEK(t.solvedate, 3) AS period_sort,
                tu.users_id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT t.id) AS tickets_resolved_assignee,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_on_resolved_assignee_seconds
            FROM glpi_tickets t
            INNER JOIN glpi_tickets_users tu ON tu.tickets_id = t.id AND tu.type = {assign_type}
            INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
            LEFT JOIN glpi_tickettasks tt ON tt.tickets_id = t.id
              AND tt.actiontime > 0
              AND {tech_uid} = tu.users_id
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.status IN (%s, %s)
              AND t.solvedate IS NOT NULL
              AND t.solvedate >= %s
              AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
              AND tu.users_id > 0
              {login_filter_sql}
            GROUP BY period_sort, tu.users_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, actiontime_on_resolved_assignee_seconds DESC
        """

    def _sql_resolved_week_global() -> str:
        return f"""
            SELECT
                YEARWEEK(t.solvedate, 3) AS period_sort,
                tu.users_id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT t.id) AS tickets_resolved_assignee,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_on_resolved_assignee_seconds
            FROM glpi_tickets t
            INNER JOIN glpi_tickets_users tu ON tu.tickets_id = t.id AND tu.type = {assign_type}
            INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
            LEFT JOIN glpi_tickettasks tt ON tt.tickets_id = t.id
              AND tt.actiontime > 0
              AND {tech_uid} = tu.users_id
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
            WHERE t.is_deleted = 0
              {ticket_entity}
              AND t.status IN (%s, %s)
              AND t.solvedate IS NOT NULL
              AND t.solvedate >= %s
              AND t.solvedate < DATE_ADD(%s, INTERVAL 1 DAY)
              AND tu.users_id > 0
              {login_filter_sql}
            GROUP BY period_sort, tu.users_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, actiontime_on_resolved_assignee_seconds DESC
        """

    def _normalize_rows(raw: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
        by_week: Dict[int, List[Dict[str, Any]]] = {}
        for r in raw:
            ps = r.get("period_sort")
            if ps is None:
                continue
            ps_i = int(ps)
            if ps_i not in period_set:
                continue
            uid = int(r.get("user_id") or 0)
            if uid < 1:
                continue
            fn = r.get("full_name")
            name_s = (str(fn).strip() if fn is not None else "") or f"Usuario #{uid}"
            lg_raw = r.get("login")
            login_v = (str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else None) or None
            by_week.setdefault(ps_i, []).append(
                {
                    "user_id": uid,
                    "full_name": name_s,
                    "login": login_v,
                    "tickets_worked": int(r.get("tickets_worked") or 0),
                    "actiontime_seconds": int(r.get("actiontime_total") or 0),
                }
            )
        for ps_i, lst in by_week.items():
            lst.sort(key=lambda x: (-int(x["actiontime_seconds"]), -int(x["tickets_worked"]), x["full_name"]))
        return by_week

    def _sql_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                YEARWEEK(COALESCE(tt.begin, tt.date), 3) AS period_sort,
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
            GROUP BY period_sort, user_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, actiontime_total DESC
        """

    def _sql_global() -> str:
        return f"""
            SELECT
                YEARWEEK(COALESCE(tt.begin, tt.date), 3) AS period_sort,
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
            GROUP BY period_sort, user_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, actiontime_total DESC
        """

    raw_rows: List[Dict[str, Any]] = []
    time_params = [date_from, date_from, date_to, date_to]
    tail_params = tuple(login_filter_params)
    if project_type_id is not None and int(project_type_id) >= 1:
        params_base = _project_type_params(project_type_id) + list(params_entity)
        qparams = tuple(params_base + time_params + list(tail_params))
        try:
            raw_rows = fetch_all(_sql_scoped(True), qparams)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw_rows = fetch_all(_sql_scoped(False), qparams)
            else:
                raise
    else:
        pb = list(params_entity)
        raw_rows = fetch_all(_sql_global(), tuple(pb + time_params + list(tail_params)))

    by_week = _normalize_rows(raw_rows)

    log_date_params = [date_from, date_to]
    raw_assignee_work: List[Dict[str, Any]] = []
    raw_resolved_week: List[Dict[str, Any]] = []
    raw_assigned_week: List[Dict[str, Any]] = []
    if project_type_id is not None and int(project_type_id) >= 1:
        params_base_aw = _project_type_params(project_type_id) + list(params_entity)
        q_aw = tuple(params_base_aw + time_params + list(tail_params))
        q_resolved = tuple(
            params_base_aw + time_params + [st_sol, st_clo, date_from, date_to] + list(tail_params)
        )
        try:
            raw_assignee_work = fetch_all(_sql_assignee_work_scoped(True), q_aw)
            raw_resolved_week = fetch_all(_sql_resolved_week_scoped(True), q_resolved)
            if assign_log_opt > 0:
                q_assign = tuple(params_base_aw + log_date_params + list(tail_params))
                raw_assigned_week = fetch_all(_sql_assigned_week_scoped(True), q_assign)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw_assignee_work = fetch_all(_sql_assignee_work_scoped(False), q_aw)
                raw_resolved_week = fetch_all(_sql_resolved_week_scoped(False), q_resolved)
                if assign_log_opt > 0:
                    q_assign = tuple(params_base_aw + log_date_params + list(tail_params))
                    raw_assigned_week = fetch_all(_sql_assigned_week_scoped(False), q_assign)
            else:
                raise
    else:
        pb_aw = list(params_entity)
        raw_assignee_work = fetch_all(
            _sql_assignee_work_global(), tuple(pb_aw + time_params + list(tail_params))
        )
        raw_resolved_week = fetch_all(
            _sql_resolved_week_global(),
            tuple(pb_aw + time_params + [st_sol, st_clo, date_from, date_to] + list(tail_params)),
        )
        if assign_log_opt > 0:
            q_assign = tuple(pb_aw + log_date_params + list(tail_params))
            raw_assigned_week = fetch_all(_sql_assigned_week_global(), q_assign)

    by_week_assignee_work = _normalize_assignee_work_rows(raw_assignee_work)
    by_week_resolved_assignee = _normalize_resolved_assignee_week_rows(raw_resolved_week)
    by_week_assigned_log = _normalize_assigned_in_week_rows(raw_assigned_week)
    lookup_assignee_work = _coord_week_uid_login_lookup_from_lists(by_week_assignee_work)
    lookup_resolved_assignee = _coord_week_uid_login_lookup_from_lists(by_week_resolved_assignee)
    lookup_assigned_log = _coord_week_uid_login_lookup_from_lists(by_week_assigned_log)

    weeks_out: List[Dict[str, Any]] = []
    for w in spine:
        ps = int(w["period_sort"])
        merged = _coord_week_assignees_merged_for_series(ps, series_meta, by_week)
        _coord_enrich_assignees_weekly_performance_extras(
            merged, ps, lookup_assignee_work, lookup_resolved_assignee, lookup_assigned_log
        )
        weeks_out.append(
            {
                "period_sort": ps,
                "period_label": str(w["period_label"]),
                "week_period_start": str(w.get("week_period_start") or ""),
                "week_period_end": str(w.get("week_period_end") or ""),
                "assignees": merged,
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "assignee_series": series_meta,
        "weeks": weeks_out,
    }


def _coord_enrich_technicians_weekly_created(
    technicians: List[Dict[str, Any]],
    ps: int,
    lookup_created: Dict[int, Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]],
) -> None:
    """Completa filas con tickets creados en la semana ISO donde el técnico figura como asignado."""
    cr_uid, cr_login = lookup_created.get(ps, ({}, {}))
    for row in technicians:
        uid = int(row.get("user_id") or 0)
        lg_raw = row.get("login")
        lg_key = str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else ""
        hit = cr_uid.get(uid) if uid > 0 else None
        if hit is None and lg_key:
            hit = cr_login.get(lg_key)
        row["tickets_created"] = int(hit["tickets_created"]) if hit else 0


def _coord_enrich_technicians_weekly_log_hours(
    technicians: List[Dict[str, Any]],
    ps: int,
    lookup_managed: Dict[int, Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]],
    lookup_resolved: Dict[int, Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]],
) -> None:
    """Completa filas con actiontime en tickets con evento gestionado/resuelto (glpi_logs) esa semana."""
    mg_uid, mg_login = lookup_managed.get(ps, ({}, {}))
    rs_uid, rs_login = lookup_resolved.get(ps, ({}, {}))
    for row in technicians:
        uid = int(row.get("user_id") or 0)
        lg_raw = row.get("login")
        lg_key = str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else ""
        hit_m = mg_uid.get(uid) if uid > 0 else None
        if hit_m is None and lg_key:
            hit_m = mg_login.get(lg_key)
        hit_r = rs_uid.get(uid) if uid > 0 else None
        if hit_r is None and lg_key:
            hit_r = rs_login.get(lg_key)
        row["actiontime_managed_seconds"] = int(hit_m["actiontime_seconds"]) if hit_m else 0
        row["actiontime_resolved_seconds"] = int(hit_r["actiontime_seconds"]) if hit_r else 0


def _coord_week_technicians_merged_for_series(
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
                    "tickets_created": 0,
                    "tickets_managed": 0,
                    "actiontime_seconds": 0,
                    "actiontime_managed_seconds": 0,
                    "actiontime_resolved_seconds": 0,
                }
            )
    return out


def coordination_weekly_technician_evolution(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Evolución semanal ISO por técnico en el rango de filtros (misma entidad y tipo de proyecto que coordinación).

    Por semana y técnico:

    - **tickets_created**: tickets con ``t.date`` en la semana donde el usuario figura como asignado del ticket.
    - **tickets_managed**: tickets distintos con tareas ``actiontime`` > 0 en la semana (técnico de la tarea).
    - **actiontime_seconds**: suma de ``actiontime`` en esas tareas.
    - **actiontime_managed_seconds**: ``actiontime`` del técnico en la misma semana ISO sobre tickets con
      transición en ``glpi_logs`` de Nuevo → En curso/Planificado/En espera esa semana (misma lógica que
      «Horas en gestionados» de la evolución semanal global).
    - **actiontime_resolved_seconds**: igual, sobre tickets con transición a resuelto/cerrado esa semana
      (misma lógica que «Horas en resueltos» de la evolución semanal global).

    ``summary``: totales del equipo en el rango (creados = aperturas; gestionados = tickets distintos con imputación).
    ``technician_totals``: agregados por técnico en todo el rango.
    Si ``GLPI_COORD_PERFORMANCE_LOGINS`` tiene valores, la serie fija es esa lista (ceros si no hubo actividad).
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    spine = _coord_iso_week_spine(date_from, date_to)
    empty_payload: Dict[str, Any] = {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "summary": {
            "tickets_created_team": 0,
            "tickets_managed_team": 0,
            "actiontime_seconds_team": 0,
        },
        "technician_series": [],
        "technician_totals": [],
        "weeks": [],
    }
    if not spine:
        return empty_payload

    period_set = {int(w["period_sort"]) for w in spine}
    req_type = int(s.requester_link_type)
    assign_type = int(s.assignee_link_type)
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    lid = int(s.id_search_option_ticket_status_log)
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
    time_params = [date_from, date_from, date_to, date_to]
    tail_params = tuple(login_filter_params)
    log_date_params = [date_from, date_to]

    def _normalize_managed_rows(raw: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
        by_week: Dict[int, List[Dict[str, Any]]] = {}
        for r in raw:
            ps = r.get("period_sort")
            if ps is None:
                continue
            ps_i = int(ps)
            if ps_i not in period_set:
                continue
            uid = int(r.get("user_id") or 0)
            if uid < 1:
                continue
            fn = r.get("full_name")
            name_s = (str(fn).strip() if fn is not None else "") or f"Usuario #{uid}"
            lg_raw = r.get("login")
            login_v = (str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else None) or None
            by_week.setdefault(ps_i, []).append(
                {
                    "user_id": uid,
                    "full_name": name_s,
                    "login": login_v,
                    "tickets_managed": int(r.get("tickets_managed") or 0),
                    "actiontime_seconds": int(r.get("actiontime_total") or 0),
                }
            )
        for ps_i, lst in by_week.items():
            lst.sort(
                key=lambda x: (
                    -int(x["actiontime_seconds"]),
                    -int(x["tickets_managed"]),
                    x["full_name"],
                )
            )
        return by_week

    def _normalize_created_rows(raw: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
        by_week: Dict[int, List[Dict[str, Any]]] = {}
        for r in raw:
            ps = r.get("period_sort")
            if ps is None:
                continue
            ps_i = int(ps)
            if ps_i not in period_set:
                continue
            uid = int(r.get("user_id") or 0)
            if uid < 1:
                continue
            fn = r.get("full_name")
            name_s = (str(fn).strip() if fn is not None else "") or f"Usuario #{uid}"
            lg_raw = r.get("login")
            login_v = (str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else None) or None
            by_week.setdefault(ps_i, []).append(
                {
                    "user_id": uid,
                    "full_name": name_s,
                    "login": login_v,
                    "tickets_created": int(r.get("tickets_created") or 0),
                }
            )
        for ps_i, lst in by_week.items():
            lst.sort(key=lambda x: (-int(x["tickets_created"]), x["full_name"]))
        return by_week

    def _normalize_log_hours_rows(raw: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
        by_week: Dict[int, List[Dict[str, Any]]] = {}
        for r in raw:
            ps = r.get("period_sort")
            if ps is None:
                continue
            ps_i = int(ps)
            if ps_i not in period_set:
                continue
            uid = int(r.get("user_id") or 0)
            if uid < 1:
                continue
            fn = r.get("full_name")
            name_s = (str(fn).strip() if fn is not None else "") or f"Usuario #{uid}"
            lg_raw = r.get("login")
            login_v = (str(lg_raw).strip() if lg_raw is not None and str(lg_raw).strip() else None) or None
            by_week.setdefault(ps_i, []).append(
                {
                    "user_id": uid,
                    "full_name": name_s,
                    "login": login_v,
                    "actiontime_seconds": int(r.get("actiontime_total") or 0),
                }
            )
        return by_week

    def _sql_managed_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                YEARWEEK(COALESCE(tt.begin, tt.date), 3) AS period_sort,
                {tech_uid} AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT tt.tickets_id) AS tickets_managed,
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
            GROUP BY period_sort, user_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, actiontime_total DESC
        """

    def _sql_managed_global() -> str:
        return f"""
            SELECT
                YEARWEEK(COALESCE(tt.begin, tt.date), 3) AS period_sort,
                {tech_uid} AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT tt.tickets_id) AS tickets_managed,
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
            GROUP BY period_sort, user_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, actiontime_total DESC
        """

    def _sql_created_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                YEARWEEK(t.date, 3) AS period_sort,
                tu.users_id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT t.id) AS tickets_created
            FROM glpi_tickets t
            INNER JOIN glpi_tickets_users tu ON tu.tickets_id = t.id AND tu.type = {assign_type}
            INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
              AND tu.users_id > 0
              {login_filter_sql}
            GROUP BY period_sort, tu.users_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, tickets_created DESC
        """

    def _sql_created_global() -> str:
        return f"""
            SELECT
                YEARWEEK(t.date, 3) AS period_sort,
                tu.users_id AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COUNT(DISTINCT t.id) AS tickets_created
            FROM glpi_tickets t
            INNER JOIN glpi_tickets_users tu ON tu.tickets_id = t.id AND tu.type = {assign_type}
            INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
            WHERE t.is_deleted = 0
              {ticket_entity}
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
              AND tu.users_id > 0
              {login_filter_sql}
            GROUP BY period_sort, tu.users_id, u.id, u.firstname, u.realname, u.name
            ORDER BY period_sort ASC, tickets_created DESC
        """

    def _sql_team_created_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT COUNT(DISTINCT t.id) AS c
            FROM glpi_tickets t
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND t.is_deleted = 0
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        """

    def _sql_team_created_global() -> str:
        return f"""
            SELECT COUNT(DISTINCT t.id) AS c
            FROM glpi_tickets t
            WHERE t.is_deleted = 0
              {ticket_entity}
              AND t.date >= %s
              AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        """

    def _sql_team_managed_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                COUNT(DISTINCT tt.tickets_id) AS tickets_managed,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
            {tail}
            WHERE {pw}
              {pt_sql}
              {ticket_entity}
              AND tt.actiontime > 0
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
        """

    def _sql_team_managed_global() -> str:
        return f"""
            SELECT
                COUNT(DISTINCT tt.tickets_id) AS tickets_managed,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id AND t.is_deleted = 0
            WHERE tt.actiontime > 0
              {ticket_entity}
              AND (tt.begin >= %s OR tt.date >= %s)
              AND (
                  tt.begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
        """

    def _sql_hours_on_managed_log_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                m.period_sort,
                {tech_uid} AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM (
                SELECT DISTINCT
                    YEARWEEK(lg.date_mod, 3) AS period_sort,
                    lg.items_id AS tickets_id
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                {tail}
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.old_value AS UNSIGNED) = {_COORD_STATUS_NEW}
                  AND CAST(lg.new_value AS UNSIGNED) IN (
                    {_COORD_STATUS_IN_PROGRESS}, {_COORD_STATUS_PLANNED}, {_COORD_STATUS_WAITING}
                  )
                  AND {pw}
                  {pt_sql}
                  {ticket_entity}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
            ) m
            INNER JOIN glpi_tickettasks tt ON tt.tickets_id = m.tickets_id
              AND tt.actiontime > 0
              AND YEARWEEK(COALESCE(tt.begin, tt.date), 3) = m.period_sort
            LEFT JOIN glpi_users u ON u.id = {tech_uid}
            WHERE {tech_uid} > 0
              {login_filter_sql}
            GROUP BY m.period_sort, user_id, u.id, u.firstname, u.realname, u.name
        """

    def _sql_hours_on_managed_log_global() -> str:
        return f"""
            SELECT
                m.period_sort,
                {tech_uid} AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM (
                SELECT DISTINCT
                    YEARWEEK(lg.date_mod, 3) AS period_sort,
                    lg.items_id AS tickets_id
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.old_value AS UNSIGNED) = {_COORD_STATUS_NEW}
                  AND CAST(lg.new_value AS UNSIGNED) IN (
                    {_COORD_STATUS_IN_PROGRESS}, {_COORD_STATUS_PLANNED}, {_COORD_STATUS_WAITING}
                  )
                  {ticket_entity}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
            ) m
            INNER JOIN glpi_tickettasks tt ON tt.tickets_id = m.tickets_id
              AND tt.actiontime > 0
              AND YEARWEEK(COALESCE(tt.begin, tt.date), 3) = m.period_sort
            LEFT JOIN glpi_users u ON u.id = {tech_uid}
            WHERE {tech_uid} > 0
              {login_filter_sql}
            GROUP BY m.period_sort, user_id, u.id, u.firstname, u.realname, u.name
        """

    def _sql_hours_on_resolved_log_scoped(use_plugin: bool) -> str:
        pt_sql = _project_type_sql(project_type_id)
        tail = tail_plugin if use_plugin else tail_itils
        pw = "p.is_deleted = 0" if use_plugin else "1=1"
        return f"""
            SELECT
                m.period_sort,
                {tech_uid} AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM (
                SELECT DISTINCT
                    YEARWEEK(lg.date_mod, 3) AS period_sort,
                    lg.items_id AS tickets_id
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                {tail}
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.new_value AS UNSIGNED) IN (%s, %s)
                  AND CAST(lg.old_value AS UNSIGNED) NOT IN (%s, %s)
                  AND {pw}
                  {pt_sql}
                  {ticket_entity}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
            ) m
            INNER JOIN glpi_tickettasks tt ON tt.tickets_id = m.tickets_id
              AND tt.actiontime > 0
              AND YEARWEEK(COALESCE(tt.begin, tt.date), 3) = m.period_sort
            LEFT JOIN glpi_users u ON u.id = {tech_uid}
            WHERE {tech_uid} > 0
              {login_filter_sql}
            GROUP BY m.period_sort, user_id, u.id, u.firstname, u.realname, u.name
        """

    def _sql_hours_on_resolved_log_global() -> str:
        return f"""
            SELECT
                m.period_sort,
                {tech_uid} AS user_id,
                u.name AS login,
                {udisp} AS full_name,
                COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
            FROM (
                SELECT DISTINCT
                    YEARWEEK(lg.date_mod, 3) AS period_sort,
                    lg.items_id AS tickets_id
                FROM glpi_logs lg
                INNER JOIN glpi_tickets t ON t.id = lg.items_id AND lg.itemtype = 'Ticket' AND t.is_deleted = 0
                WHERE lg.itemtype = 'Ticket'
                  AND lg.id_search_option = {lid}
                  AND lg.old_value REGEXP '^[0-9]+$'
                  AND lg.new_value REGEXP '^[0-9]+$'
                  AND CAST(lg.new_value AS UNSIGNED) IN (%s, %s)
                  AND CAST(lg.old_value AS UNSIGNED) NOT IN (%s, %s)
                  {ticket_entity}
                  AND lg.date_mod >= %s
                  AND lg.date_mod < DATE_ADD(%s, INTERVAL 1 DAY)
            ) m
            INNER JOIN glpi_tickettasks tt ON tt.tickets_id = m.tickets_id
              AND tt.actiontime > 0
              AND YEARWEEK(COALESCE(tt.begin, tt.date), 3) = m.period_sort
            LEFT JOIN glpi_users u ON u.id = {tech_uid}
            WHERE {tech_uid} > 0
              {login_filter_sql}
            GROUP BY m.period_sort, user_id, u.id, u.firstname, u.realname, u.name
        """

    raw_managed: List[Dict[str, Any]] = []
    raw_created: List[Dict[str, Any]] = []
    raw_hours_managed: List[Dict[str, Any]] = []
    raw_hours_resolved: List[Dict[str, Any]] = []
    team_created_row: Optional[Dict[str, Any]] = None
    team_managed_row: Optional[Dict[str, Any]] = None

    if project_type_id is not None and int(project_type_id) >= 1:
        params_base = _project_type_params(project_type_id) + list(params_entity)
        q_managed = tuple(params_base + time_params + list(tail_params))
        q_created = tuple(params_base + [date_from, date_to] + list(tail_params))
        q_team_created = tuple(params_base + [date_from, date_to])
        q_team_managed = tuple(params_base + time_params)
        q_hours_managed = tuple(params_base + log_date_params + list(tail_params))
        q_hours_resolved = tuple(
            [st_sol, st_clo, st_sol, st_clo] + params_base + log_date_params + list(tail_params)
        )
        try:
            raw_managed = fetch_all(_sql_managed_scoped(True), q_managed)
            raw_created = fetch_all(_sql_created_scoped(True), q_created)
            team_created_row = fetch_one(_sql_team_created_scoped(True), q_team_created)
            team_managed_row = fetch_one(_sql_team_managed_scoped(True), q_team_managed)
            try:
                raw_hours_managed = fetch_all(_sql_hours_on_managed_log_scoped(True), q_hours_managed)
                raw_hours_resolved = fetch_all(_sql_hours_on_resolved_log_scoped(True), q_hours_resolved)
            except OperationalError:
                raw_hours_managed = []
                raw_hours_resolved = []
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw_managed = fetch_all(_sql_managed_scoped(False), q_managed)
                raw_created = fetch_all(_sql_created_scoped(False), q_created)
                team_created_row = fetch_one(_sql_team_created_scoped(False), q_team_created)
                team_managed_row = fetch_one(_sql_team_managed_scoped(False), q_team_managed)
                try:
                    raw_hours_managed = fetch_all(_sql_hours_on_managed_log_scoped(False), q_hours_managed)
                    raw_hours_resolved = fetch_all(_sql_hours_on_resolved_log_scoped(False), q_hours_resolved)
                except OperationalError:
                    raw_hours_managed = []
                    raw_hours_resolved = []
            else:
                raise
    else:
        pb = list(params_entity)
        raw_managed = fetch_all(_sql_managed_global(), tuple(pb + time_params + list(tail_params)))
        raw_created = fetch_all(_sql_created_global(), tuple(pb + [date_from, date_to] + list(tail_params)))
        team_created_row = fetch_one(_sql_team_created_global(), tuple(pb + [date_from, date_to]))
        team_managed_row = fetch_one(_sql_team_managed_global(), tuple(pb + time_params))
        try:
            raw_hours_managed = fetch_all(
                _sql_hours_on_managed_log_global(),
                tuple(pb + log_date_params + list(tail_params)),
            )
            raw_hours_resolved = fetch_all(
                _sql_hours_on_resolved_log_global(),
                tuple([st_sol, st_clo, st_sol, st_clo] + pb + log_date_params + list(tail_params)),
            )
        except OperationalError:
            raw_hours_managed = []
            raw_hours_resolved = []

    by_week_managed = _normalize_managed_rows(raw_managed)
    by_week_created = _normalize_created_rows(raw_created)
    by_week_hours_managed = _normalize_log_hours_rows(raw_hours_managed)
    by_week_hours_resolved = _normalize_log_hours_rows(raw_hours_resolved)
    lookup_created = _coord_week_uid_login_lookup_from_lists(by_week_created)
    lookup_hours_managed = _coord_week_uid_login_lookup_from_lists(by_week_hours_managed)
    lookup_hours_resolved = _coord_week_uid_login_lookup_from_lists(by_week_hours_resolved)

    if not series_meta:
        acc: Dict[int, Dict[str, Any]] = {}
        for lst in (
            list(by_week_managed.values())
            + list(by_week_created.values())
            + list(by_week_hours_managed.values())
            + list(by_week_hours_resolved.values())
        ):
            for row in lst:
                uid = int(row["user_id"])
                cur = acc.get(uid)
                if not cur:
                    acc[uid] = {
                        "user_id": uid,
                        "login": row.get("login") or "",
                        "full_name": row["full_name"],
                        "chart_key": f"u{uid}",
                    }
        series_meta = sorted(
            acc.values(),
            key=lambda x: (str(x.get("full_name") or ""), int(x["user_id"])),
        )

    weeks_out: List[Dict[str, Any]] = []
    totals_acc: Dict[int, Dict[str, Any]] = {}

    for w in spine:
        ps = int(w["period_sort"])
        merged = _coord_week_technicians_merged_for_series(ps, series_meta, by_week_managed)
        _coord_enrich_technicians_weekly_created(merged, ps, lookup_created)
        _coord_enrich_technicians_weekly_log_hours(
            merged, ps, lookup_hours_managed, lookup_hours_resolved
        )
        for row in merged:
            uid = int(row.get("user_id") or 0)
            if uid < 1:
                continue
            cur = totals_acc.setdefault(
                uid,
                {
                    "user_id": uid,
                    "full_name": str(row.get("full_name") or ""),
                    "login": row.get("login"),
                    "tickets_created": 0,
                    "tickets_managed": 0,
                    "actiontime_seconds": 0,
                    "actiontime_managed_seconds": 0,
                    "actiontime_resolved_seconds": 0,
                },
            )
            cur["tickets_created"] += int(row.get("tickets_created") or 0)
            cur["tickets_managed"] += int(row.get("tickets_managed") or 0)
            cur["actiontime_seconds"] += int(row.get("actiontime_seconds") or 0)
            cur["actiontime_managed_seconds"] += int(row.get("actiontime_managed_seconds") or 0)
            cur["actiontime_resolved_seconds"] += int(row.get("actiontime_resolved_seconds") or 0)
        weeks_out.append(
            {
                "period_sort": ps,
                "period_label": str(w["period_label"]),
                "week_period_start": str(w.get("week_period_start") or ""),
                "week_period_end": str(w.get("week_period_end") or ""),
                "technicians": merged,
            }
        )

    technician_totals = sorted(
        totals_acc.values(),
        key=lambda x: (
            -int(x["actiontime_seconds"]),
            -int(x["tickets_managed"]),
            str(x.get("full_name") or ""),
        ),
    )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "summary": {
            "tickets_created_team": int(team_created_row.get("c") or 0) if team_created_row else 0,
            "tickets_managed_team": int(team_managed_row.get("tickets_managed") or 0) if team_managed_row else 0,
            "actiontime_seconds_team": int(team_managed_row.get("actiontime_total") or 0) if team_managed_row else 0,
        },
        "technician_series": series_meta,
        "technician_totals": technician_totals,
        "weeks": weeks_out,
    }


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

