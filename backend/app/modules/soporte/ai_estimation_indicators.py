"""
Indicadores de eficiencia de estimación con IA (tiempo estimado vs ejecutado en GLPI).

Basado en un campo plugin Fields configurable (`tiempoestimadosolucinfield` o
`tiempoestimadosoluciniafield`) en formato H.MM (parte entera = horas, decimales = minutos;
ej. 0.50 = 50 min) y la suma de `actiontime` en tareas del ticket
**dentro del rango de fechas de filtros** (mismo criterio que otros modales de coordinación).
"""
from __future__ import annotations

from dataclasses import dataclass
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
from app.modules.soporte.indicators import _project_type_params, _project_type_sql
from app.modules.soporte.glpi_time import glpi_hm_cast_sql, glpi_hm_to_decimal_hours_sql, glpi_plugin_field_hm_hours_sql
from app.modules.soporte.metrics import _user_display_expr

DEFAULT_ESTIMATE_FIELD = "tiempoestimadosolucinfield"
ALLOWED_ESTIMATE_FIELDS = frozenset(
    {
        "tiempoestimadosolucinfield",
        "tiempoestimadosoluciniafield",
    }
)


def resolve_estimate_field(field: Optional[str]) -> str:
    f = (field or DEFAULT_ESTIMATE_FIELD).strip()
    if f not in ALLOWED_ESTIMATE_FIELDS:
        raise ValueError(
            f"estimate_field no válido: {f!r}. Valores permitidos: "
            + ", ".join(sorted(ALLOWED_ESTIMATE_FIELDS))
        )
    return f


@dataclass(frozen=True)
class _AiFieldExprs:
    field: str
    estimated_hours_expr: str
    has_estimate_pred: str
    has_time_pred: str
    comparable_pred: str
    executed_hours_expr: str
    deviation_pct_expr: str
    semaforo_key_expr: str


def _build_field_exprs(field: str) -> _AiFieldExprs:
    qualified = f"pf.{field}"
    hm_cast = glpi_hm_cast_sql(qualified)
    estimated_hours_expr = glpi_plugin_field_hm_hours_sql(qualified)
    has_estimate_pred = f"""
pf.{field} IS NOT NULL
AND TRIM(pf.{field}) != ''
AND {glpi_hm_to_decimal_hours_sql(hm_cast)} > 0
"""
    has_time_pred = "COALESCE(tareas.total_segundos, 0) > 0"
    comparable_pred = f"({has_estimate_pred}) AND ({has_time_pred})"
    executed_hours_expr = "ROUND(COALESCE(tareas.total_segundos, 0) / 3600.0, 2)"
    deviation_pct_expr = f"""
CASE
    WHEN NOT ({has_estimate_pred}) THEN NULL
    ELSE ROUND(
        ((COALESCE(tareas.total_segundos, 0) / 3600.0)
         / {estimated_hours_expr} - 1) * 100
    , 1)
END
"""
    semaforo_key_expr = f"""
CASE
    WHEN NOT ({has_estimate_pred}) THEN 'sin_estimar'
    WHEN NOT ({has_time_pred}) THEN 'sin_tiempo'
    WHEN (COALESCE(tareas.total_segundos, 0) / 3600.0) <= {estimated_hours_expr}
        THEN 'dentro'
    WHEN (COALESCE(tareas.total_segundos, 0) / 3600.0) <= {estimated_hours_expr} * 1.20
        THEN 'leve'
    ELSE 'significativo'
END
"""
    return _AiFieldExprs(
        field=field,
        estimated_hours_expr=estimated_hours_expr,
        has_estimate_pred=has_estimate_pred,
        has_time_pred=has_time_pred,
        comparable_pred=comparable_pred,
        executed_hours_expr=executed_hours_expr,
        deviation_pct_expr=deviation_pct_expr,
        semaforo_key_expr=semaforo_key_expr,
    )

_SEMAFORO_LABELS: Dict[str, str] = {
    "sin_estimar": "Sin estimación IA",
    "sin_tiempo": "Sin tiempo registrado",
    "dentro": "Dentro del estimado",
    "leve": "Desvío leve (< 20 %)",
    "significativo": "Desvío significativo",
}


def _ai_estimation_common_joins() -> str:
    """Tiempo ejecutado = tareas con begin/date dentro del rango de filtros (4 placeholders)."""
    return f"""
        LEFT JOIN glpi_plugin_fields_ticketticketsformfields pf
            ON pf.items_id = t.id AND pf.itemtype = 'Ticket'
        LEFT JOIN (
            SELECT tickets_id, SUM(actiontime) AS total_segundos, COUNT(id) AS num_tareas
            FROM glpi_tickettasks
            WHERE actiontime > 0
              AND (begin >= %s OR date >= %s)
              AND (
                  begin < DATE_ADD(%s, INTERVAL 1 DAY)
                  OR date < DATE_ADD(%s, INTERVAL 1 DAY)
              )
            GROUP BY tickets_id
        ) tareas ON tareas.tickets_id = t.id
    """


def _ai_task_range_params(date_from: str, date_to: str) -> List[str]:
    return [date_from, date_from, date_to, date_to]


def _ai_sql_params(
    project_type_id: Optional[int],
    entity_params: List[Any],
    date_from: str,
    date_to: str,
    extra: Optional[List[Any]] = None,
) -> List[Any]:
    """Orden SQL: subquery tareas → proyecto → entidad → fecha creación ticket."""
    out: List[Any] = list(_ai_task_range_params(date_from, date_to))
    if project_type_id is not None and int(project_type_id) >= 1:
        out.extend(_project_type_params(project_type_id))
    out.extend(entity_params)
    out.extend([date_from, date_to])
    if extra:
        out.extend(extra)
    return out


def _ai_ticket_date_filter() -> str:
    return """
        AND t.date >= %s
        AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        AND t.is_deleted = 0
    """


def _ai_entity_clause(settings: Settings) -> Tuple[str, List[Any]]:
    if settings.entities_id is not None:
        return " AND t.entities_id = %s", [settings.entities_id]
    return "", []


def _empty_summary() -> Dict[str, Any]:
    return {
        "total_tickets": 0,
        "tickets_with_estimate": 0,
        "tickets_with_time": 0,
        "tickets_comparable": 0,
        "tickets_within_estimate": 0,
        "tickets_minor_deviation": 0,
        "tickets_significant_deviation": 0,
        "compliance_rate_pct": None,
        "minor_deviation_rate_pct": None,
        "significant_deviation_rate_pct": None,
        "avg_deviation_pct": None,
        "total_hours_estimated": 0.0,
        "total_hours_executed": 0.0,
        "hours_difference": 0.0,
        "efficiency_ratio": None,
        "net_hours_vs_estimate": None,
        "semaforo_breakdown": _ai_normalize_semaforo_rows([], 0),
    }


def _ai_normalize_semaforo_rows(raw: List[Dict[str, Any]], total: int) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = {k: 0 for k in _SEMAFORO_LABELS}
    for r in raw:
        key = str(r.get("semaforo_key") or "")
        if key in counts:
            counts[key] = int(r.get("c") or 0)
    out: List[Dict[str, Any]] = []
    denom = total if total > 0 else 1
    for key, label in _SEMAFORO_LABELS.items():
        c = counts.get(key, 0)
        out.append(
            {
                "key": key,
                "label": label,
                "count": c,
                "pct": round(c * 100.0 / denom, 1),
            }
        )
    return out


def ai_estimation_efficiency_summary(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
    estimate_field: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resumen del rango: cobertura de estimación IA, cumplimiento (semáforo) y balance de horas.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    field = resolve_estimate_field(estimate_field)
    fx = _build_field_exprs(field)
    s = settings or get_settings()
    entity_sql, entity_params = _ai_entity_clause(s)
    joins = _ai_estimation_common_joins()
    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()

    def _summary_from(where_scope: str, params: List[Any]) -> Dict[str, Any]:
        sql = f"""
            SELECT
                COUNT(DISTINCT t.id) AS total_tickets,
                COUNT(DISTINCT CASE WHEN {fx.has_estimate_pred} THEN t.id END) AS tickets_with_estimate,
                COUNT(DISTINCT CASE WHEN {fx.has_time_pred} THEN t.id END) AS tickets_with_time,
                COUNT(DISTINCT CASE WHEN {fx.comparable_pred} THEN t.id END) AS tickets_comparable,
                COUNT(DISTINCT CASE
                    WHEN {fx.comparable_pred}
                     AND (COALESCE(tareas.total_segundos, 0) / 3600.0) <= {fx.estimated_hours_expr}
                    THEN t.id END) AS tickets_within_estimate,
                COUNT(DISTINCT CASE
                    WHEN {fx.comparable_pred}
                     AND (COALESCE(tareas.total_segundos, 0) / 3600.0) > {fx.estimated_hours_expr}
                     AND (COALESCE(tareas.total_segundos, 0) / 3600.0) <= {fx.estimated_hours_expr} * 1.20
                    THEN t.id END) AS tickets_minor_deviation,
                COUNT(DISTINCT CASE
                    WHEN {fx.comparable_pred}
                     AND (COALESCE(tareas.total_segundos, 0) / 3600.0) > {fx.estimated_hours_expr} * 1.20
                    THEN t.id END) AS tickets_significant_deviation,
                ROUND(SUM(CASE WHEN {fx.has_estimate_pred} THEN {fx.estimated_hours_expr} ELSE 0 END), 2)
                    AS total_hours_estimated,
                ROUND(SUM(COALESCE(tareas.total_segundos, 0)) / 3600.0, 2) AS total_hours_executed,
                ROUND(AVG(
                    CASE WHEN {fx.comparable_pred} THEN
                        ((COALESCE(tareas.total_segundos, 0) / 3600.0)
                         / {fx.estimated_hours_expr} - 1) * 100
                    END
                ), 1) AS avg_deviation_pct,
                ROUND(SUM(CASE WHEN {fx.comparable_pred} THEN {fx.estimated_hours_expr} ELSE 0 END), 2)
                    AS comparable_hours_estimated,
                ROUND(SUM(CASE WHEN {fx.comparable_pred} THEN COALESCE(tareas.total_segundos, 0) ELSE 0 END) / 3600.0, 2)
                    AS comparable_hours_executed
            FROM glpi_tickets t
            {joins}
            {where_scope}
        """
        row = fetch_one(sql, tuple(params))
        if not row:
            row = {}

        sql_sem = f"""
            SELECT {fx.semaforo_key_expr} AS semaforo_key, COUNT(DISTINCT t.id) AS c
            FROM glpi_tickets t
            {joins}
            {where_scope}
            GROUP BY semaforo_key
        """
        sem_rows = fetch_all(sql_sem, tuple(params))

        total = int(row.get("total_tickets") or 0)
        comparable = int(row.get("tickets_comparable") or 0)
        within = int(row.get("tickets_within_estimate") or 0)
        minor = int(row.get("tickets_minor_deviation") or 0)
        significant = int(row.get("tickets_significant_deviation") or 0)

        total_est = float(row.get("total_hours_estimated") or 0)
        total_exec = float(row.get("total_hours_executed") or 0)
        hours_diff = round(total_exec - total_est, 2)

        compliance_pct: Optional[float] = None
        if comparable > 0:
            compliance_pct = round(within * 100.0 / comparable, 1)

        efficiency_ratio: Optional[float] = None
        if total_exec > 0 and total_est > 0:
            efficiency_ratio = round(total_est / total_exec, 3)

        time_savings_hours: Optional[float] = None
        if comparable > 0:
            comp_est = float(row.get("comparable_hours_estimated") or 0)
            comp_exec = float(row.get("comparable_hours_executed") or 0)
            time_savings_hours = round(comp_est - comp_exec, 2)

        return {
            "total_tickets": total,
            "tickets_with_estimate": int(row.get("tickets_with_estimate") or 0),
            "tickets_with_time": int(row.get("tickets_with_time") or 0),
            "tickets_comparable": comparable,
            "tickets_within_estimate": within,
            "tickets_minor_deviation": minor,
            "tickets_significant_deviation": significant,
            "compliance_rate_pct": compliance_pct,
            "minor_deviation_rate_pct": round(minor * 100.0 / comparable, 1) if comparable > 0 else None,
            "significant_deviation_rate_pct": round(significant * 100.0 / comparable, 1) if comparable > 0 else None,
            "avg_deviation_pct": float(row["avg_deviation_pct"]) if row.get("avg_deviation_pct") is not None else None,
            "total_hours_estimated": total_est,
            "total_hours_executed": total_exec,
            "hours_difference": hours_diff,
            "efficiency_ratio": efficiency_ratio,
            "net_hours_vs_estimate": time_savings_hours,
            "semaforo_breakdown": _ai_normalize_semaforo_rows(sem_rows, total),
        }

    if project_type_id is not None and int(project_type_id) >= 1:
        params_base = _ai_sql_params(project_type_id, entity_params, date_from, date_to)
        where_plugin = f"""
            {tail_plugin}
            WHERE p.is_deleted = 0
              {_project_type_sql(project_type_id)}
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        where_itils = f"""
            {tail_itils}
            WHERE 1=1
              {_project_type_sql(project_type_id)}
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        try:
            summary = _summary_from(where_plugin, params_base)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                summary = _summary_from(where_itils, params_base)
            elif e.args and e.args[0] == 1054:
                summary = _empty_summary()
            else:
                raise
    else:
        where_global = f"""
            WHERE t.is_deleted = 0
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        params_global = _ai_sql_params(None, entity_params, date_from, date_to)
        try:
            summary = _summary_from(where_global, params_global)
        except OperationalError as e:
            if e.args and e.args[0] == 1054:
                summary = _empty_summary()
            else:
                raise

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "estimate_field": field,
        **summary,
    }


def ai_estimation_weekly_evolution(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
    estimate_field: Optional[str] = None,
) -> Dict[str, Any]:
    """Serie semanal ISO: horas estimadas vs ejecutadas y desviación promedio."""
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    field = resolve_estimate_field(estimate_field)
    fx = _build_field_exprs(field)
    s = settings or get_settings()
    spine = _coord_iso_week_spine(date_from, date_to)
    if not spine:
        return {"date_from": date_from, "date_to": date_to, "project_type_id": project_type_id, "rows": []}

    entity_sql, entity_params = _ai_entity_clause(s)
    joins = _ai_estimation_common_joins()
    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()
    period_set = {int(w["period_sort"]) for w in spine}

    def _fetch_weekly_rows(where_scope: str, params: List[Any]) -> List[Dict[str, Any]]:
        sql = f"""
            SELECT
                YEARWEEK(t.date, 3) AS period_sort,
                COUNT(DISTINCT t.id) AS total_tickets,
                COUNT(DISTINCT CASE WHEN {fx.has_estimate_pred} THEN t.id END) AS tickets_estimated,
                COUNT(DISTINCT CASE WHEN {fx.has_time_pred} THEN t.id END) AS tickets_with_time,
                COUNT(DISTINCT CASE WHEN {fx.comparable_pred} THEN t.id END) AS tickets_comparable,
                COUNT(DISTINCT CASE
                    WHEN {fx.comparable_pred}
                     AND (COALESCE(tareas.total_segundos, 0) / 3600.0) <= {fx.estimated_hours_expr}
                    THEN t.id END) AS tickets_within_estimate,
                ROUND(SUM(CASE WHEN {fx.has_estimate_pred} THEN {fx.estimated_hours_expr} ELSE 0 END), 2)
                    AS total_hours_estimated,
                ROUND(SUM(COALESCE(tareas.total_segundos, 0)) / 3600.0, 2) AS total_hours_executed,
                ROUND(AVG(
                    CASE WHEN {fx.comparable_pred} THEN
                        ((COALESCE(tareas.total_segundos, 0) / 3600.0)
                         / {fx.estimated_hours_expr} - 1) * 100
                    END
                ), 1) AS avg_deviation_pct
            FROM glpi_tickets t
            {joins}
            {where_scope}
            GROUP BY period_sort
        """
        return fetch_all(sql, tuple(params))

    raw: List[Dict[str, Any]] = []
    if project_type_id is not None and int(project_type_id) >= 1:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _ai_sql_params(project_type_id, entity_params, date_from, date_to)
        where_plugin = f"""
            {tail_plugin}
            WHERE p.is_deleted = 0
              {pt_sql}
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        where_itils = f"""
            {tail_itils}
            WHERE 1=1
              {pt_sql}
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        try:
            raw = _fetch_weekly_rows(where_plugin, params_base)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                raw = _fetch_weekly_rows(where_itils, params_base)
            else:
                raise
    else:
        where_global = f"""
            WHERE t.is_deleted = 0
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        params_global = _ai_sql_params(None, entity_params, date_from, date_to)
        raw = _fetch_weekly_rows(where_global, params_global)

    by_week: Dict[int, Dict[str, Any]] = {}
    for r in raw:
        ps = r.get("period_sort")
        if ps is None:
            continue
        ps_i = int(ps)
        if ps_i not in period_set:
            continue
        by_week[ps_i] = r

    rows_out: List[Dict[str, Any]] = []
    for w in spine:
        ps = int(w["period_sort"])
        hit = by_week.get(ps, {})
        comparable = int(hit.get("tickets_comparable") or 0)
        within = int(hit.get("tickets_within_estimate") or 0)
        total_est = float(hit.get("total_hours_estimated") or 0)
        total_exec = float(hit.get("total_hours_executed") or 0)
        rows_out.append(
            {
                "period_sort": ps,
                "period_label": str(w["period_label"]),
                "week_period_start": str(w.get("week_period_start") or ""),
                "week_period_end": str(w.get("week_period_end") or ""),
                "total_tickets": int(hit.get("total_tickets") or 0),
                "tickets_estimated": int(hit.get("tickets_estimated") or 0),
                "tickets_with_time": int(hit.get("tickets_with_time") or 0),
                "tickets_comparable": comparable,
                "tickets_within_estimate": within,
                "compliance_rate_pct": round(within * 100.0 / comparable, 1) if comparable > 0 else None,
                "total_hours_estimated": total_est,
                "total_hours_executed": total_exec,
                "hours_difference": round(total_exec - total_est, 2),
                "avg_deviation_pct": float(hit["avg_deviation_pct"]) if hit.get("avg_deviation_pct") is not None else None,
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "estimate_field": field,
        "rows": rows_out,
    }


def ai_estimation_top_deviations(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    limit: int = 10,
    settings: Optional[Settings] = None,
    estimate_field: Optional[str] = None,
) -> Dict[str, Any]:
    """Ranking de tickets con mayor desvío positivo (ejecutado − estimado)."""
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    field = resolve_estimate_field(estimate_field)
    fx = _build_field_exprs(field)
    lim = max(1, min(int(limit), 50))
    s = settings or get_settings()
    assign_type = int(s.assignee_link_type)
    udisp = _user_display_expr("u_tec")
    entity_sql, entity_params = _ai_entity_clause(s)
    joins = _ai_estimation_common_joins()
    req_type = int(s.requester_link_type)
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()

    comparable_filter = f"""
        {fx.comparable_pred}
        AND (COALESCE(tareas.total_segundos, 0) / 3600.0) > {fx.estimated_hours_expr}
    """

    def _rows_from(where_prefix: str, params: List[Any]) -> List[Dict[str, Any]]:
        sql = f"""
            SELECT
                t.id AS ticket_id,
                t.name AS titulo,
                DATE(t.date) AS fecha_creacion,
                {udisp} AS tecnico,
                pf.{fx.field} AS horas_estimadas_raw,
                {fx.estimated_hours_expr} AS horas_estimadas,
                {fx.executed_hours_expr} AS horas_ejecutadas,
                ROUND(
                    (COALESCE(tareas.total_segundos, 0) / 3600.0) - {fx.estimated_hours_expr}
                , 2) AS desvio_horas,
                {fx.deviation_pct_expr} AS desvio_pct,
                {fx.semaforo_key_expr} AS semaforo_key
            FROM glpi_tickets t
            {joins}
            LEFT JOIN glpi_tickets_users tu_tec ON tu_tec.tickets_id = t.id AND tu_tec.type = {assign_type}
            LEFT JOIN glpi_users u_tec ON u_tec.id = tu_tec.users_id
            {where_prefix}
              AND {comparable_filter}
            ORDER BY desvio_horas DESC
            LIMIT {lim}
        """
        raw = fetch_all(sql, tuple(params))
        out: List[Dict[str, Any]] = []
        for r in raw:
            key = str(r.get("semaforo_key") or "")
            out.append(
                {
                    "ticket_id": int(r.get("ticket_id") or 0),
                    "titulo": str(r.get("titulo") or ""),
                    "fecha_creacion": str(r.get("fecha_creacion") or ""),
                    "tecnico": str(r.get("tecnico") or "").strip() or None,
                    "horas_estimadas_raw": str(r.get("horas_estimadas_raw") or "").strip() or None,
                    "horas_estimadas": float(r.get("horas_estimadas") or 0),
                    "horas_ejecutadas": float(r.get("horas_ejecutadas") or 0),
                    "desvio_horas": float(r.get("desvio_horas") or 0),
                    "desvio_pct": float(r["desvio_pct"]) if r.get("desvio_pct") is not None else None,
                    "semaforo_key": key,
                    "semaforo_label": _SEMAFORO_LABELS.get(key, key),
                }
            )
        return out

    if project_type_id is not None and int(project_type_id) >= 1:
        pt_sql = _project_type_sql(project_type_id)
        params_base = _ai_sql_params(project_type_id, entity_params, date_from, date_to)
        where_plugin = f"""
            {tail_plugin}
            WHERE p.is_deleted = 0
              {pt_sql}
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        where_itils = f"""
            {tail_itils}
            WHERE 1=1
              {pt_sql}
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        try:
            rows = _rows_from(where_plugin, params_base)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                rows = _rows_from(where_itils, params_base)
            elif e.args and e.args[0] == 1054:
                rows = []
            else:
                raise
    else:
        where_global = f"""
            WHERE t.is_deleted = 0
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        params_global = _ai_sql_params(None, entity_params, date_from, date_to)
        try:
            rows = _rows_from(where_global, params_global)
        except OperationalError as e:
            if e.args and e.args[0] == 1054:
                rows = []
            else:
                raise

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "estimate_field": field,
        "limit": lim,
        "rows": rows,
    }


def ai_estimation_tickets_detail(
    project_type_id: Optional[int],
    date_from: str,
    date_to: str,
    semaforo_key: Optional[str] = None,
    settings: Optional[Settings] = None,
    estimate_field: Optional[str] = None,
    comparable_only: bool = False,
) -> Dict[str, Any]:
    """Detalle por ticket; filtro opcional por semáforo o solo tickets comparables."""
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    field = resolve_estimate_field(estimate_field)
    fx = _build_field_exprs(field)
    s = settings or get_settings()
    assign_type = int(s.assignee_link_type)
    req_type = int(s.requester_link_type)
    udisp_tec = _user_display_expr("u_tec")
    udisp_req = _user_display_expr("u_req")
    entity_sql, entity_params = _ai_entity_clause(s)
    joins = _ai_estimation_common_joins()
    tail_plugin = _coord_plugin_project_joins_after_t(req_type)
    tail_itils = _coord_itils_project_join_after_t()

    sem_filter = ""
    extra_params: List[Any] = []
    order_sql = "ORDER BY t.date DESC, t.id DESC"
    if comparable_only:
        sem_filter = f" AND ({fx.comparable_pred})"
        order_sql = f"""
            ORDER BY CASE ({fx.semaforo_key_expr})
                WHEN 'dentro' THEN 0
                WHEN 'leve' THEN 1
                WHEN 'significativo' THEN 2
                ELSE 3
            END,
            t.date DESC,
            t.id DESC
        """
    elif semaforo_key:
        sk = semaforo_key.strip().lower().replace("-", "_")
        if sk in _SEMAFORO_LABELS:
            sem_filter = f" AND ({fx.semaforo_key_expr}) = %s"
            extra_params = [sk]

    def _rows_from(where_prefix: str, params: List[Any]) -> List[Dict[str, Any]]:
        sql = f"""
            SELECT
                t.id AS ticket_id,
                t.name AS titulo,
                DATE(t.date) AS fecha_creacion,
                YEARWEEK(t.date, 3) AS semana_iso,
                CASE t.status
                    WHEN 1 THEN 'Nuevo'
                    WHEN 2 THEN 'En curso (asignado)'
                    WHEN 3 THEN 'En curso (planificado)'
                    WHEN 4 THEN 'Pendiente'
                    WHEN 5 THEN 'Resuelto'
                    WHEN 6 THEN 'Cerrado'
                    ELSE CONCAT('Estado ', t.status)
                END AS estado,
                CASE t.type
                    WHEN 1 THEN 'Incidente'
                    WHEN 2 THEN 'Requerimiento'
                    ELSE 'Otro'
                END AS tipo,
                {udisp_req} AS solicitante,
                {udisp_tec} AS tecnico,
                pf.{fx.field} AS horas_estimadas_raw,
                {fx.estimated_hours_expr} AS horas_estimadas,
                COALESCE(tareas.total_segundos, 0) AS segundos_ejecutados,
                {fx.executed_hours_expr} AS horas_ejecutadas,
                COALESCE(tareas.num_tareas, 0) AS cantidad_tareas,
                ROUND(
                    CASE WHEN {fx.has_estimate_pred} THEN
                        (COALESCE(tareas.total_segundos, 0) / 3600.0) - {fx.estimated_hours_expr}
                    END
                , 2) AS diferencia_horas,
                {fx.deviation_pct_expr} AS desviacion_pct,
                {fx.semaforo_key_expr} AS semaforo_key
            FROM glpi_tickets t
            {joins}
            LEFT JOIN glpi_tickets_users tu_req ON tu_req.tickets_id = t.id AND tu_req.type = {req_type}
            LEFT JOIN glpi_users u_req ON u_req.id = tu_req.users_id
            LEFT JOIN glpi_tickets_users tu_tec ON tu_tec.tickets_id = t.id AND tu_tec.type = {assign_type}
            LEFT JOIN glpi_users u_tec ON u_tec.id = tu_tec.users_id
            {where_prefix}
              {sem_filter}
            {order_sql}
        """
        raw = fetch_all(sql, tuple(params))
        out: List[Dict[str, Any]] = []
        for r in raw:
            key = str(r.get("semaforo_key") or "")
            out.append(
                {
                    "ticket_id": int(r.get("ticket_id") or 0),
                    "titulo": str(r.get("titulo") or ""),
                    "fecha_creacion": str(r.get("fecha_creacion") or ""),
                    "semana_iso": int(r["semana_iso"]) if r.get("semana_iso") is not None else None,
                    "estado": str(r.get("estado") or ""),
                    "tipo": str(r.get("tipo") or ""),
                    "solicitante": str(r.get("solicitante") or "").strip() or None,
                    "tecnico": str(r.get("tecnico") or "").strip() or None,
                    "horas_estimadas_raw": str(r.get("horas_estimadas_raw") or "").strip() or None,
                    "horas_estimadas": float(r.get("horas_estimadas") or 0) if r.get("horas_estimadas_raw") else None,
                    "horas_ejecutadas": float(r.get("horas_ejecutadas") or 0),
                    "cantidad_tareas": int(r.get("cantidad_tareas") or 0),
                    "diferencia_horas": float(r["diferencia_horas"]) if r.get("diferencia_horas") is not None else None,
                    "desviacion_pct": float(r["desviacion_pct"]) if r.get("desviacion_pct") is not None else None,
                    "semaforo_key": key,
                    "semaforo_label": _SEMAFORO_LABELS.get(key, key),
                }
            )
        return out

    if project_type_id is not None and int(project_type_id) >= 1:
        params_base = _ai_sql_params(project_type_id, entity_params, date_from, date_to, extra_params)
        where_plugin = f"""
            {tail_plugin}
            WHERE p.is_deleted = 0
              {_project_type_sql(project_type_id)}
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        where_itils = f"""
            {tail_itils}
            WHERE 1=1
              {_project_type_sql(project_type_id)}
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        try:
            rows = _rows_from(where_plugin, params_base)
        except OperationalError as e:
            if e.args and e.args[0] == 1146:
                rows = _rows_from(where_itils, params_base)
            elif e.args and e.args[0] == 1054:
                rows = []
            else:
                raise
    else:
        where_global = f"""
            WHERE t.is_deleted = 0
              {entity_sql}
              {_ai_ticket_date_filter()}
        """
        params_global = _ai_sql_params(None, entity_params, date_from, date_to, extra_params)
        try:
            rows = _rows_from(where_global, params_global)
        except OperationalError as e:
            if e.args and e.args[0] == 1054:
                rows = []
            else:
                raise

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_type_id": project_type_id,
        "estimate_field": field,
        "semaforo_key": semaforo_key,
        "comparable_only": comparable_only,
        "rows": rows,
    }
