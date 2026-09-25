"""
Indicadores de base de conocimiento GLPI (`glpi_knowbaseitems`).

Totales de artículos creados en un rango por `date_creation`, desglosados por autor (`users_id`).
Respeta `GLPI_ENTITIES_ID`; no aplica filtro por tipo de proyecto.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from pymysql.err import OperationalError

from app.db import fetch_all, fetch_one
from app.modules.soporte.config import Settings, get_settings
from app.modules.soporte.metrics import _user_display_expr


def _entity_clause(settings: Settings, alias: str = "gk") -> Tuple[str, List[Any]]:
    if settings.entities_id is not None:
        return f" AND {alias}.entities_id = %s", [int(settings.entities_id)]
    return "", []


def _date_range_clause() -> str:
    return """
        AND gk.date_creation >= %s
        AND gk.date_creation < DATE_ADD(%s, INTERVAL 1 DAY)
    """


def _author_display_expr() -> str:
    return f"""COALESCE(
        NULLIF({_user_display_expr("gu")}, ''),
        'Sin autor'
    )"""


def knowbase_registered_summary(
    date_from: str,
    date_to: str,
    settings: Optional[Settings] = None,
) -> Dict[str, Any]:
    """
    Total de artículos de base de conocimiento creados en el rango y conteo por autor.
    """
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    s = settings or get_settings()
    ent_tail, ent_params = _entity_clause(s)
    date_params = [date_from, date_to]
    author_expr = _author_display_expr()

    total_sql = f"""
        SELECT COUNT(*) AS c
        FROM glpi_knowbaseitems gk
        WHERE gk.is_deleted = 0{ent_tail}{_date_range_clause()}
    """
    by_author_sql = f"""
        SELECT
            gu.id AS user_id,
            gu.name AS login,
            {author_expr} AS author_name,
            COUNT(gk.id) AS item_count
        FROM glpi_knowbaseitems gk
        LEFT JOIN glpi_users gu ON gu.id = gk.users_id AND gu.is_deleted = 0
        WHERE gk.is_deleted = 0{ent_tail}{_date_range_clause()}
        GROUP BY gu.id, gu.firstname, gu.realname, gu.name
        ORDER BY item_count DESC, author_name ASC
    """
    params = tuple(ent_params + date_params)

    try:
        total_row = fetch_one(total_sql, params)
        author_rows = fetch_all(by_author_sql, params)
    except OperationalError as e:
        if not (e.args and e.args[0] == 1054):
            raise
        total_sql_no_del = f"""
            SELECT COUNT(*) AS c
            FROM glpi_knowbaseitems gk
            WHERE 1=1{ent_tail}{_date_range_clause()}
        """
        by_author_sql_no_del = f"""
            SELECT
                gu.id AS user_id,
                gu.name AS login,
                {author_expr} AS author_name,
                COUNT(gk.id) AS item_count
            FROM glpi_knowbaseitems gk
            LEFT JOIN glpi_users gu ON gu.id = gk.users_id AND gu.is_deleted = 0
            WHERE 1=1{ent_tail}{_date_range_clause()}
            GROUP BY gu.id, gu.firstname, gu.realname, gu.name
            ORDER BY item_count DESC, author_name ASC
        """
        total_row = fetch_one(total_sql_no_del, params)
        author_rows = fetch_all(by_author_sql_no_del, params)

    total_items = int(total_row.get("c") or 0) if total_row else 0
    by_author: List[Dict[str, Any]] = []
    for row in author_rows:
        uid = row.get("user_id")
        by_author.append(
            {
                "user_id": int(uid) if uid is not None else None,
                "login": row.get("login"),
                "author_name": str(row.get("author_name") or "Sin autor"),
                "item_count": int(row.get("item_count") or 0),
            }
        )

    return {
        "date_from": date_from,
        "date_to": date_to,
        "total_items": total_items,
        "by_author": by_author,
    }
