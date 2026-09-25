"""
Indicadores de uso de IA en tickets GLPI (campo «¿Aplica IA?» del plugin Fields).

Campo: `plugin_fields_aplicaiafielddropdowns_id` — 1 = Sí, 0 = No, NULL/otro = sin registrar.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from pymysql.err import OperationalError

from app.db import fetch_all, fetch_one
from app.modules.soporte.config import Settings, get_settings
from app.modules.soporte.coordination_indicators import (
    _coord_iso_week_spine,
    _coord_itils_project_join_after_t,
    _coord_plugin_project_joins_after_t,
)
from app.modules.soporte.indicators import (
    _kpi_ticket_estado_case_sql,
    _project_type_params,
    _project_type_sql,
)
from app.modules.soporte.glpi_time import glpi_hm_cast_sql, glpi_hm_to_decimal_hours_sql, glpi_plugin_field_hm_hours_sql
from app.modules.soporte.metrics import _user_display_expr

_APLICA_IA_FIELD = "plugin_fields_aplicaiafielddropdowns_id"
_ESTIMATED_HOURS_FIELD = "tiempoestimadosolucinfield"

_APLICA_IA_KEY_EXPR = f"""
CASE
    WHEN pf.{_APLICA_IA_FIELD} = 1 THEN 'si'
    WHEN pf.{_APLICA_IA_FIELD} = 0 THEN 'no'
    ELSE 'sin_dato'
END
"""

_IS_AI_SI = f"pf.{_APLICA_IA_FIELD} = 1"
_IS_AI_NO = f"pf.{_APLICA_IA_FIELD} = 0"
_IS_AI_SIN_DATO = f"(pf.{_APLICA_IA_FIELD} IS NULL OR pf.{_APLICA_IA_FIELD} NOT IN (0, 1))"

_ESTIMATED_HOURS_EXPR = glpi_plugin_field_hm_hours_sql(f"pf.{_ESTIMATED_HOURS_FIELD}")
_HM_CAST = glpi_hm_cast_sql(f"pf.{_ESTIMATED_HOURS_FIELD}")

_HAS_ESTIMATE_PRED = f"""
pf.{_ESTIMATED_HOURS_FIELD} IS NOT NULL
AND TRIM(pf.{_ESTIMATED_HOURS_FIELD}) != ''
AND {glpi_hm_to_decimal_hours_sql(_HM_CAST)} > 0
"""

_HAS_TIME_PRED = "COALESCE(tareas.total_segundos, 0) > 0"

_APLICA_IA_LABELS: Dict[str, str] = {
    "si": "Sí aplica IA",
    "no": "No aplica IA",
    "sin_dato": "Sin registrar",
}


def _usage_plugin_join() -> str:
    return """
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pf
            ON pf.items_id = t.id AND pf.itemtype = 'Ticket'
    """


def _usage_plugin_and_tasks_join() -> str:
    return f"""
        {_usage_plugin_join()}
        LEFT JOIN (
            SELECT tickets_id, SUM(actiontime) AS total_segundos
            FROM glpi_tickettasks
            WHERE actiontime > 0
            GROUP BY tickets_id
        ) tareas ON tareas.tickets_id = t.id
    """


def _usage_ticket_date_filter() -> str:
    return """
        AND t.date >= %s
        AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        AND t.is_deleted = 0
    """


def _usage_entity_clause(settings: Settings) -> Tuple[str, List[Any]]:
    if settings.entities_id is not None:
        return " AND t.entities_id = %s", [settings.entities_id]
    return "", []


def _usage_breakdown_rows(raw: List[Dict[str, Any]], total: int) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {k: 0 for k in _APLICA_IA_LABELS}
    for r in raw:
        key = str(r.get("aplica_ia_key") or "")
        if key in counts:
            counts[key] = int(r.get("c") or 0)
    out: List[Dict[str, Any]] = []
    denom = total if total > 0 else 1
    for key, label in _APLICA_IA_LABELS.items():
        c = counts.get(key, 0)
        out.append({"key": key, "label": label, "count": c, "pct": round(c * 100.0 / denom, 1)})
    return out


def _empty_usage_summary() -> Dict[str, Any]:
    return {
        "total_tickets": 0,
        "tickets_ai_yes": 0,
        "tickets_ai_no": 0,
        "tickets_ai_unset": 0,
        "adoption_rate_pct": None,
        "declared_rate_pct": None,
        "tickets_ai_with_estimate": 0,
        "tickets_ai_comparable": 0,
        "tickets_ai_within_estimate": 0,
        "ai_compliance_rate_pct": None,
        "tickets_no_ai_comparable": 0,
        "tickets_no_ai_within_estimate": 0,
        "no_ai_compliance_rate_pct": None,
        "aplica_ia_breakdown": _usage_breakdown_rows([], 0),
    }


def ai_usage_summary(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Resumen de adopción de IA y cumplimiento de estimación (Sí vs No)."""
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    entity_sql, entity_params = _usage_entity_clause(s)
    date_params = [date_from, date_to]
    joins = _usage_plugin_and_tasks_join()
    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)

    def _summary_from(where_scope: str, params: List[Any]) -> Dict[str, Any]:
        sql = f"""
            SELECT
                COUNT(DISTINCT t.id) AS total_tickets,
                COUNT(DISTINCT CASE WHEN {_IS_AI_SI} THEN t.id END) AS tickets_ai_yes,
                COUNT(DISTINCT CASE WHEN {_IS_AI_NO} THEN t.id END) AS tickets_ai_no,
                COUNT(DISTINCT CASE WHEN {_IS_AI_SIN_DATO} THEN t.id END) AS tickets_ai_unset,
                COUNT(DISTINCT CASE WHEN {_IS_AI_SI} AND {_HAS_ESTIMATE_PRED} THEN t.id END)
                    AS tickets_ai_with_estimate,
                COUNT(DISTINCT CASE
                    WHEN {_IS_AI_SI} AND {_HAS_ESTIMATE_PRED} AND {_HAS_TIME_PRED} THEN t.id END)
                    AS tickets_ai_comparable,
                COUNT(DISTINCT CASE
                    WHEN {_IS_AI_SI} AND {_HAS_ESTIMATE_PRED} AND {_HAS_TIME_PRED}
                     AND (COALESCE(tareas.total_segundos, 0) / 3600.0) <= {_ESTIMATED_HOURS_EXPR}
                    THEN t.id END) AS tickets_ai_within_estimate,
                COUNT(DISTINCT CASE
                    WHEN {_IS_AI_NO} AND {_HAS_ESTIMATE_PRED} AND {_HAS_TIME_PRED} THEN t.id END)
                    AS tickets_no_ai_comparable,
                COUNT(DISTINCT CASE
                    WHEN {_IS_AI_NO} AND {_HAS_ESTIMATE_PRED} AND {_HAS_TIME_PRED}
                     AND (COALESCE(tareas.total_segundos, 0) / 3600.0) <= {_ESTIMATED_HOURS_EXPR}
                    THEN t.id END) AS tickets_no_ai_within_estimate
            FROM glpi_tickets t
            {joins}
            {where_scope}
        """
        row = fetch_one(sql, tuple(params)) or {}

        sql_br = f"""
            SELECT {_APLICA_IA_KEY_EXPR} AS aplica_ia_key, COUNT(DISTINCT t.id) AS c
            FROM glpi_tickets t
            {_usage_plugin_join()}
            {where_scope}
            GROUP BY aplica_ia_key
        """
        br_rows = fetch_all(sql_br, tuple(params))

        total = int(row.get("total_tickets") or 0)
        ai_yes = int(row.get("tickets_ai_yes") or 0)
        ai_no = int(row.get("tickets_ai_no") or 0)
        declared = ai_yes + ai_no
        ai_comp = int(row.get("tickets_ai_comparable") or 0)
        ai_within = int(row.get("tickets_ai_within_estimate") or 0)
        no_comp = int(row.get("tickets_no_ai_comparable") or 0)
        no_within = int(row.get("tickets_no_ai_within_estimate") or 0)

        return {
            "total_tickets": total,
            "tickets_ai_yes": ai_yes,
            "tickets_ai_no": ai_no,
            "tickets_ai_unset": int(row.get("tickets_ai_unset") or 0),
            "adoption_rate_pct": round(ai_yes * 100.0 / total, 1) if total > 0 else None,
            "declared_rate_pct": round(ai_yes * 100.0 / declared, 1) if declared > 0 else None,
            "tickets_ai_with_estimate": int(row.get("tickets_ai_with_estimate") or 0),
            "tickets_ai_comparable": ai_comp,
            "tickets_ai_within_estimate": ai_within,
            "ai_compliance_rate_pct": round(ai_within * 100.0 / ai_comp, 1) if ai_comp > 0 else None,
            "tickets_no_ai_comparable": no_comp,
            "tickets_no_ai_within_estimate": no_within,
            "no_ai_compliance_rate_pct": round(no_within * 100.0 / no_comp, 1) if no_comp > 0 else None,
            "aplica_ia_breakdown": _usage_breakdown_rows(br_rows, total),
        }

    try:
        if project_type_id is not None and int(project_type_id) >= 1:
            params_base = _project_type_params(project_type_id) + list(entity_params) + date_params
            where_plugin = f"""
                {tail_plugin}
                WHERE p.is_deleted = 0
                  {_project_type_sql(project_type_id)}
                  {entity_sql}
                  {_usage_ticket_date_filter()}
            """
            where_itils = f"""
                {tail_itils}
                WHERE 1=1
                  {_project_type_sql(project_type_id)}
                  {entity_sql}
                  {_usage_ticket_date_filter()}
            """
            try:
                summary = _summary_from(where_plugin, params_base)
            except OperationalError as e:
                if e.args and e.args[0] == 1146:
                    summary = _summary_from(where_itils, params_base)
                elif e.args and e.args[0] == 1054:
                    summary = _empty_usage_summary()
                else:
                    raise
        else:
            where_global = f"""
                WHERE t.is_deleted = 0
                  {entity_sql}
                  {_usage_ticket_date_filter()}
            """
            params_global = list(entity_params) + date_params
            summary = _summary_from(where_global, params_global)
    except OperationalError as e:
        if e.args and e.args[0] == 1054:
            summary = _empty_usage_summary()
        else:
            raise

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        **summary,
    }


def ai_usage_weekly_evolution(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Serie semanal ISO: tickets creados con Sí / No / sin registrar IA."""
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    spine = _coord_iso_week_spine(date_from, date_to)
    if not spine:
        return {"date_from": date_from, "date_to": date_to, "project_type_id": project_type_id, "rows": []}

    entity_sql, entity_params = _usage_entity_clause(s)
    date_params = [date_from, date_to]
    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()
    period_set = {int(w["period_sort"]) for w in spine}

    def _fetch(where_scope: str, params: List[Any]) -> List[Dict[str, Any]]:
        sql = f"""
            SELECT
                YEARWEEK(t.date, 3) AS period_sort,
                COUNT(DISTINCT t.id) AS total_tickets,
                COUNT(DISTINCT CASE WHEN {_IS_AI_SI} THEN t.id END) AS tickets_ai_yes,
                COUNT(DISTINCT CASE WHEN {_IS_AI_NO} THEN t.id END) AS tickets_ai_no,
                COUNT(DISTINCT CASE WHEN {_IS_AI_SIN_DATO} THEN t.id END) AS tickets_ai_unset
            FROM glpi_tickets t
            {_usage_plugin_join()}
            {where_scope}
            GROUP BY period_sort
        """
        return fetch_all(sql, tuple(params))

    raw: List[Dict[str, Any]] = []
    if project_type_id is not None and int(project_type_id) >= 1:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id) + list(entity_params) + date_params
        where_plugin = f"""
            {tail_plugin}
            WHERE p.is_deleted = 0
              {pt_sql}
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        where_itils = f"""
            {tail_itils}
            WHERE 1=1
              {pt_sql}
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        try:
            raw = _fetch(where_plugin, params_base)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw = _fetch(where_itils, params_base)
            else:
                raise
    else:
        where_global = f"""
            WHERE t.is_deleted = 0
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        raw = _fetch(where_global, list(entity_params) + date_params)

    by_week: Dict[int, Dict[str, Any]] = {}
    for r in raw:
        ps = r.get("period_sort")
        if ps is None:
            continue
        ps_i = int(ps)
        if ps_i in period_set:
            by_week[ps_i] = r

    rows_out: List[Dict[str, Any]] = []
    for w in spine:
        ps = int(w["period_sort"])
        hit = by_week.get(ps, {})
        total = int(hit.get("total_tickets") or 0)
        yes = int(hit.get("tickets_ai_yes") or 0)
        declared = yes + int(hit.get("tickets_ai_no") or 0)
        rows_out.append(
            {
                "period_sort": ps,
                "period_label": str(w["period_label"]),
                "week_period_start": str(w.get("week_period_start") or ""),
                "week_period_end": str(w.get("week_period_end") or ""),
                "total_tickets": total,
                "tickets_ai_yes": yes,
                "tickets_ai_no": int(hit.get("tickets_ai_no") or 0),
                "tickets_ai_unset": int(hit.get("tickets_ai_unset") or 0),
                "adoption_rate_pct": round(yes * 100.0 / total, 1) if total > 0 else None,
                "declared_rate_pct": round(yes * 100.0 / declared, 1) if declared > 0 else None,
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": rows_out,
    }


def ai_usage_by_status(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Desglose por estado GLPI y valor de «¿Aplica IA?»."""
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    entity_sql, entity_params = _usage_entity_clause(s)
    date_params = [date_from, date_to]
    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    estado_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()
    estado_expr = estado_sq.replace(" AS estado", "")

    def _fetch(where_scope: str, params: List[Any]) -> List[Dict[str, Any]]:
        sql = f"""
            SELECT
                t.status AS status_id,
                {estado_expr} AS estado_label,
                {_APLICA_IA_KEY_EXPR} AS aplica_ia_key,
                COUNT(DISTINCT t.id) AS ticket_count
            FROM glpi_tickets t
            {_usage_plugin_join()}
            {where_scope}
            GROUP BY t.status, aplica_ia_key
            ORDER BY t.status ASC, aplica_ia_key ASC
        """
        return fetch_all(sql, tuple(params))

    raw: List[Dict[str, Any]] = []
    if project_type_id is not None and int(project_type_id) >= 1:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id) + list(entity_params) + date_params
        where_plugin = f"""
            {tail_plugin}
            WHERE p.is_deleted = 0
              {pt_sql}
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        where_itils = f"""
            {tail_itils}
            WHERE 1=1
              {pt_sql}
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        try:
            raw = _fetch(where_plugin, params_base)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw = _fetch(where_itils, params_base)
            elif e.args and e.args[0] == 1054:
                raw = []
            else:
                raise
    else:
        where_global = f"""
            WHERE t.is_deleted = 0
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        try:
            raw = _fetch(where_global, list(entity_params) + date_params)
        except OperationalError as e:
            if e.args and e.args[0] == 1054:
                raw = []
            else:
                raise

    rows_out: List[Dict[str, Any]] = []
    for r in raw:
        key = str(r.get("aplica_ia_key") or "sin_dato")
        rows_out.append(
            {
                "status_id": int(r.get("status_id") or 0),
                "estado_label": str(r.get("estado_label") or ""),
                "aplica_ia_key": key,
                "aplica_ia_label": _APLICA_IA_LABELS.get(key, key),
                "ticket_count": int(r.get("ticket_count") or 0),
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "rows": rows_out,
    }


def ai_usage_tickets_detail(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    aplica_ia_key: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """Listado detallado por ticket (script base del usuario); filtro opcional si/no/sin_dato."""
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    assign_type = int(s.assignee_link_type)
    req_type = int(s.requester_link_type)
    st_sol = int(s.status_solved)
    st_clo = int(s.status_closed)
    udisp_tec = _user_display_expr("u_tec")
    udisp_req = _user_display_expr("u_req")
    entity_sql, entity_params = _usage_entity_clause(s)
    date_params = [date_from, date_to]
    req_type_int = req_type
    tail_plugin = _coord_plugin_project_joins_after_t(req_type_int)
    tail_itils = _coord_itils_project_join_after_t()
    estado_sq = _kpi_ticket_estado_case_sql(st_sol, st_clo).strip()

    ai_filter = ""
    extra_params: List[Any] = []
    if aplica_ia_key:
        ak = aplica_ia_key.strip().lower().replace("-", "_")
        if ak in _APLICA_IA_LABELS:
            ai_filter = f" AND ({_APLICA_IA_KEY_EXPR}) = %s"
            extra_params = [ak]

    def _fetch(where_scope: str, params: List[Any]) -> List[Dict[str, Any]]:
        sql = f"""
            SELECT
                t.id AS ticket_id,
                DATE_FORMAT(t.date, '%%Y-%%m-%%d %%H:%%i') AS fecha_ticket,
                {estado_sq},
                CASE t.type
                    WHEN 1 THEN 'Incidente'
                    WHEN 2 THEN 'Requerimiento'
                    ELSE 'Otro'
                END AS tipo,
                {udisp_req} AS solicitante,
                {udisp_tec} AS tecnico,
                pf.{_APLICA_IA_FIELD} AS aplica_ia_id,
                {_APLICA_IA_KEY_EXPR} AS aplica_ia_key,
                t.name AS titulo,
                CASE WHEN {_HAS_ESTIMATE_PRED} THEN {_ESTIMATED_HOURS_EXPR} END AS horas_estimadas,
                ROUND(COALESCE(tareas.total_segundos, 0) / 3600.0, 2) AS horas_ejecutadas
            FROM glpi_tickets t
            {_usage_plugin_and_tasks_join()}
            LEFT JOIN glpi_tickets_users tu_req ON tu_req.tickets_id = t.id AND tu_req.type = {req_type}
            LEFT JOIN glpi_users u_req ON u_req.id = tu_req.users_id
            LEFT JOIN glpi_tickets_users tu_tec ON tu_tec.tickets_id = t.id AND tu_tec.type = {assign_type}
            LEFT JOIN glpi_users u_tec ON u_tec.id = tu_tec.users_id
            {where_scope}
              {ai_filter}
            ORDER BY t.date DESC, t.id DESC
        """
        raw = fetch_all(sql, tuple(params))
        out: List[Dict[str, Any]] = []
        for r in raw:
            key = str(r.get("aplica_ia_key") or "sin_dato")
            out.append(
                {
                    "ticket_id": int(r.get("ticket_id") or 0),
                    "fecha_ticket": str(r.get("fecha_ticket") or ""),
                    "estado": str(r.get("estado") or ""),
                    "tipo": str(r.get("tipo") or ""),
                    "solicitante": str(r.get("solicitante") or "").strip() or None,
                    "tecnico": str(r.get("tecnico") or "").strip() or None,
                    "titulo": str(r.get("titulo") or ""),
                    "aplica_ia_id": r.get("aplica_ia_id"),
                    "aplica_ia_key": key,
                    "aplica_ia_label": _APLICA_IA_LABELS.get(key, key),
                    "horas_estimadas": float(r["horas_estimadas"]) if r.get("horas_estimadas") is not None else None,
                    "horas_ejecutadas": float(r.get("horas_ejecutadas") or 0),
                }
            )
        return out

    if project_type_id is not None and int(project_type_id) >= 1:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _project_type_params(project_type_id) + list(entity_params) + date_params + extra_params
        where_plugin = f"""
            {tail_plugin}
            WHERE p.is_deleted = 0
              {pt_sql}
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        where_itils = f"""
            {tail_itils}
            WHERE 1=1
              {pt_sql}
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        try:
            rows = _fetch(where_plugin, params_base)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                rows = _fetch(where_itils, params_base)
            elif e.args and e.args[0] == 1054:
                rows = []
            else:
                raise
    else:
        where_global = f"""
            WHERE t.is_deleted = 0
              {entity_sql}
              {_usage_ticket_date_filter()}
        """
        params_global = list(entity_params) + date_params + extra_params
        try:
            rows = _fetch(where_global, params_global)
        except OperationalError as e:
            if e.args and e.args[0] == 1054:
                rows = []
            else:
                raise

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "aplica_ia_key": aplica_ia_key,
        "rows": rows,
    }
