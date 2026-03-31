"""
Consultas de solo lectura contra el esquema GLPI 10.x (MySQL/MariaDB).
"""
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime

from app.config import Settings, get_settings
from app.db import fetch_all, fetch_one

# Etiquetas estándar GLPI (UI español habitual)
STATUS_LABELS = {
    1: "Nuevo",
    2: "En curso (asignado)",
    3: "Planificado",
    4: "En espera",
    5: "Resuelto",
    6: "Cerrado",
}

PRIORITY_LABELS = {
    1: "Muy baja",
    2: "Baja",
    3: "Media",
    4: "Alta",
    5: "Muy alta",
}


def _base_open_ticket_predicate(settings: Settings) -> Tuple[str, List[Any]]:
    """Condición SQL y parámetros para tickets abiertos operativos."""
    parts = [
        "t.is_deleted = 0",
        "t.status NOT IN (%s, %s)",
    ]
    params: List[Any] = [settings.status_solved, settings.status_closed]
    if settings.entities_id is not None:
        parts.append("t.entities_id = %s")
        params.append(settings.entities_id)
    return " AND ".join(parts), params


def _user_display_expr(alias: str = "u") -> str:
    return f"""COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE({alias}.firstname, ''), ' ', COALESCE({alias}.realname, ''))), ''),
        {alias}.name,
        CONCAT('Usuario #', {alias}.id)
    )"""


def get_summary(settings: Optional[Settings] = None) -> Dict[str, Any]:
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)

    row = fetch_one(
        f"""
        SELECT
            COUNT(*) AS open_total,
            SUM(
                CASE WHEN NOT EXISTS (
                    SELECT 1 FROM glpi_tickets_users tu
                    WHERE tu.tickets_id = t.id AND tu.type = %s
                ) THEN 1 ELSE 0 END
            ) AS unassigned_count,
            SUM(
                CASE WHEN t.status IN (1, 4) THEN 1 ELSE 0 END
            ) AS status_no_progress_or_waiting,
            AVG(TIMESTAMPDIFF(HOUR, COALESCE(t.date_creation, t.date), NOW())) AS avg_open_hours
        FROM glpi_tickets t
        WHERE {pred}
        """,
        tuple([s.assignee_link_type] + params),
    )
    if not row:
        return {
            "open_total": 0,
            "unassigned_count": 0,
            "status_new_or_pending": 0,
            "avg_open_hours": None,
        }
    return {
        "open_total": int(row["open_total"] or 0),
        "unassigned_count": int(row["unassigned_count"] or 0),
        "status_new_or_waiting": int(row["status_no_progress_or_waiting"] or 0),
        "avg_open_hours": float(row["avg_open_hours"]) if row["avg_open_hours"] is not None else None,
    }


def get_by_assignee(settings: Optional[Settings] = None) -> List[Dict[str, Any]]:
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)
    udisp = _user_display_expr("u")
    sql = f"""
        SELECT
            u.id AS user_id,
            {udisp} AS full_name,
            COUNT(DISTINCT t.id) AS ticket_count
        FROM glpi_tickets t
        INNER JOIN glpi_tickets_users tu
            ON tu.tickets_id = t.id AND tu.type = %s
        INNER JOIN glpi_users u ON u.id = tu.users_id AND u.is_deleted = 0
        WHERE {pred}
        GROUP BY u.id, u.firstname, u.realname, u.name
        ORDER BY ticket_count DESC
    """
    return fetch_all(sql, tuple([s.assignee_link_type] + params))


def get_management_by_assignee(settings: Optional[Settings] = None) -> List[Dict[str, Any]]:
    """
    Tickets en los que cada técnico registró gestión + tiempo invertido en tareas.
    """
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)
    udisp = _user_display_expr("u")
    rows = fetch_all(
        f"""
        SELECT
            COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id) AS user_id,
            {udisp} AS full_name,
            COUNT(DISTINCT tt.tickets_id) AS managed_tickets,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id
        LEFT JOIN glpi_users u ON u.id = COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id)
        WHERE {pred}
          AND tt.actiontime > 0
        GROUP BY user_id, u.id, u.firstname, u.realname, u.name
        ORDER BY actiontime_total DESC, managed_tickets DESC
        LIMIT 50
        """,
        tuple(params),
    )
    return rows


def get_management_by_assignee_in_range(
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Gestión por técnico en un rango de fechas (basado en glpi_tickettasks.date).
    """
    _ = datetime.strptime(date_from, "%Y-%m-%d")
    _ = datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    udisp = _user_display_expr("u")

    where_parts = ["tt.actiontime > 0", "tt.date >= %s", "tt.date < DATE_ADD(%s, INTERVAL 1 DAY)", "t.is_deleted = 0"]
    params: List[Any] = [date_from, date_to]
    if s.entities_id is not None:
        where_parts.append("t.entities_id = %s")
        params.append(s.entities_id)
    where_sql = " AND ".join(where_parts)

    rows = fetch_all(
        f"""
        SELECT
            COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id) AS user_id,
            {udisp} AS full_name,
            COUNT(DISTINCT tt.tickets_id) AS managed_tickets,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id
        LEFT JOIN glpi_users u ON u.id = COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id)
        WHERE {where_sql}
        GROUP BY user_id, u.id, u.firstname, u.realname, u.name
        ORDER BY actiontime_total DESC, managed_tickets DESC
        LIMIT 100
        """,
        tuple(params),
    )
    total_tickets = int(sum(int(r.get("managed_tickets") or 0) for r in rows))
    total_actiontime = int(sum(int(r.get("actiontime_total") or 0) for r in rows))
    return {
        "date_from": date_from,
        "date_to": date_to,
        "totals": {
            "tickets_attended": total_tickets,
            "actiontime_total": total_actiontime,
        },
        "rows": rows,
    }


def get_management_ticket_detail_in_range(
    date_from: str,
    date_to: str,
    user_id: Optional[int] = None,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    _ = datetime.strptime(date_from, "%Y-%m-%d")
    _ = datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()

    where_parts = ["tt.actiontime > 0", "tt.date >= %s", "tt.date < DATE_ADD(%s, INTERVAL 1 DAY)", "t.is_deleted = 0"]
    params: List[Any] = [date_from, date_to]
    if s.entities_id is not None:
        where_parts.append("t.entities_id = %s")
        params.append(s.entities_id)
    if user_id is not None:
        where_parts.append("COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id) = %s")
        params.append(user_id)
    where_sql = " AND ".join(where_parts)

    rows = fetch_all(
        f"""
        SELECT
            t.id AS ticket_id,
            t.name AS titulo,
            CASE
                WHEN t.status = 1 THEN 'Nuevo'
                WHEN t.status = 2 THEN 'En curso'
                WHEN t.status = 3 THEN 'Planificado'
                WHEN t.status = 4 THEN 'En espera'
                WHEN t.status = 5 THEN 'Resuelto'
                WHEN t.status = 6 THEN 'Cerrado'
                ELSE 'Desconocido'
            END AS estado_ticket,
            COALESCE(SUM(tt.actiontime), 0) AS actiontime_total
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t ON t.id = tt.tickets_id
        WHERE {where_sql}
        GROUP BY t.id, t.name, t.status
        ORDER BY actiontime_total DESC, t.id DESC
        """,
        tuple(params),
    )
    return {
        "date_from": date_from,
        "date_to": date_to,
        "user_id": user_id,
        "count": len(rows),
        "rows": rows,
    }


def get_by_status(settings: Optional[Settings] = None) -> List[Dict[str, Any]]:
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)
    rows = fetch_all(
        f"""
        SELECT t.status, COUNT(*) AS cnt
        FROM glpi_tickets t
        WHERE {pred}
        GROUP BY t.status
        ORDER BY cnt DESC
        """,
        tuple(params),
    )
    for r in rows:
        st = int(r["status"])
        r["status_label"] = STATUS_LABELS.get(st, f"Estado {st}")
    return rows


def get_by_priority(settings: Optional[Settings] = None) -> List[Dict[str, Any]]:
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)
    rows = fetch_all(
        f"""
        SELECT t.priority, COUNT(*) AS cnt
        FROM glpi_tickets t
        WHERE {pred}
        GROUP BY t.priority
        ORDER BY t.priority DESC
        """,
        tuple(params),
    )
    for r in rows:
        pr = int(r["priority"])
        r["priority_label"] = PRIORITY_LABELS.get(pr, f"Prioridad {pr}")
    return rows


def get_unassigned_samples(limit: int = 30, settings: Optional[Settings] = None) -> List[Dict[str, Any]]:
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)
    lim = max(1, min(int(limit), 200))
    return fetch_all(
        f"""
        SELECT
            t.id,
            t.name,
            t.status,
            t.priority,
            t.date_creation,
            t.date,
            TIMESTAMPDIFF(HOUR, COALESCE(t.date_creation, t.date), NOW()) AS hours_open,
            (
                SELECT COALESCE(SUM(tt.actiontime), 0)
                FROM glpi_tickettasks tt
                WHERE tt.tickets_id = t.id
            ) AS actiontime_total
        FROM glpi_tickets t
        WHERE {pred}
        AND NOT EXISTS (
            SELECT 1 FROM glpi_tickets_users tu
            WHERE tu.tickets_id = t.id AND tu.type = %s
        )
        ORDER BY hours_open DESC
        LIMIT {lim}
        """,
        tuple(params + [s.assignee_link_type]),
    )


def get_stale_without_followup(
    limit: int = 40,
    min_hours: Optional[int] = None,
    settings: Optional[Settings] = None,
) -> List[Dict[str, Any]]:
    """Tickets abiertos con más horas desde el último seguimiento público (o desde alta si no hay)."""
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)
    mh = min_hours if min_hours is not None else 0
    lim = max(1, min(int(limit), 200))
    udisp = _user_display_expr("u")

    rows = fetch_all(
        f"""
        SELECT
            t.id,
            t.name,
            t.status,
            t.priority,
            COALESCE(t.date_creation, t.date) AS opened_at,
            (
                SELECT COALESCE(SUM(tt.actiontime), 0)
                FROM glpi_tickettasks tt
                WHERE tt.tickets_id = t.id
            ) AS actiontime_total,
            (
                SELECT MAX(f.date)
                FROM glpi_itilfollowups f
                WHERE f.items_id = t.id
                  AND f.itemtype = 'Ticket'
                  AND f.is_private = 0
            ) AS last_public_followup,
            TIMESTAMPDIFF(HOUR,
                COALESCE(
                    (
                        SELECT MAX(f.date)
                        FROM glpi_itilfollowups f
                        WHERE f.items_id = t.id
                          AND f.itemtype = 'Ticket'
                          AND f.is_private = 0
                    ),
                    COALESCE(t.date_creation, t.date)
                ),
                NOW()
            ) AS hours_without_public_followup,
            (
                SELECT GROUP_CONCAT(DISTINCT {udisp} ORDER BY u.id SEPARATOR ', ')
                FROM glpi_tickets_users tu
                INNER JOIN glpi_users u ON u.id = tu.users_id
                WHERE tu.tickets_id = t.id AND tu.type = %s
            ) AS assignees
        FROM glpi_tickets t
        WHERE {pred}
        HAVING hours_without_public_followup >= %s
        ORDER BY hours_without_public_followup DESC
        LIMIT {lim}
        """,
        tuple([s.assignee_link_type] + params + [mh]),
    )
    for r in rows:
        r["status_label"] = STATUS_LABELS.get(int(r["status"]), str(r["status"]))
        r["priority_label"] = PRIORITY_LABELS.get(int(r["priority"]), str(r["priority"]))
    return rows


def get_project_context(settings: Optional[Settings] = None) -> List[Dict[str, Any]]:
    """Tickets abiertos con proyecto vinculado (para criticidad por cartera)."""
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)

    return fetch_all(
        f"""
        SELECT
            p.id AS project_id,
            p.name AS project_name,
            p.priority AS project_priority,
            COUNT(DISTINCT t.id) AS open_tickets
        FROM glpi_tickets t
        INNER JOIN glpi_itils_projects ip
            ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
        INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
        WHERE {pred}
        GROUP BY p.id, p.name, p.priority
        ORDER BY open_tickets DESC, p.priority DESC
        LIMIT 50
        """,
        tuple(params),
    )


def get_stale_count_vs_threshold(settings: Optional[Settings] = None) -> Dict[str, Any]:
    s = settings or get_settings()
    pred, params = _base_open_ticket_predicate(s)
    row = fetch_one(
        f"""
        SELECT
            SUM(
                CASE WHEN x.hrs >= %s THEN 1 ELSE 0 END
            ) AS stale_count,
            MAX(x.hrs) AS max_stale_hours
        FROM (
            SELECT
                t.id,
                TIMESTAMPDIFF(HOUR,
                    COALESCE(
                        (
                            SELECT MAX(f.date)
                            FROM glpi_itilfollowups f
                            WHERE f.items_id = t.id
                              AND f.itemtype = 'Ticket'
                              AND f.is_private = 0
                        ),
                        COALESCE(t.date_creation, t.date)
                    ),
                    NOW()
                ) AS hrs
            FROM glpi_tickets t
            WHERE {pred}
        ) x
        """,
        tuple([s.stale_hours] + params),
    )
    return {
        "stale_over_threshold": int(row["stale_count"] or 0) if row else 0,
        "max_stale_hours": float(row["max_stale_hours"]) if row and row["max_stale_hours"] is not None else None,
        "threshold_hours": s.stale_hours,
    }


def build_dashboard_payload() -> Dict[str, Any]:
    s = get_settings()
    summary = get_summary(s)
    stale_info = get_stale_count_vs_threshold(s)
    return {
        "generated_for": {
            "database": s.db_name,
            "entity_filter": s.entities_id,
            "stale_hours_threshold": s.stale_hours,
        },
        "meta": {
            "status_labels": STATUS_LABELS,
            "priority_labels": PRIORITY_LABELS,
        },
        "summary": {**summary, **stale_info},
        "by_assignee": get_by_assignee(s),
        "management_by_assignee": get_management_by_assignee(s),
        "by_status": get_by_status(s),
        "by_priority": get_by_priority(s),
        "unassigned_top": get_unassigned_samples(25, s),
        "stale_top": get_stale_without_followup(30, min_hours=0, settings=s),
        "by_project": get_project_context(s),
    }
