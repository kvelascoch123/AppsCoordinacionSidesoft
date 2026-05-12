"""Conexión de solo lectura a PostgreSQL para indicadores de facturación."""

from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor

from app.modules.soporte.config import get_settings


def billing_pg_ready() -> bool:
    s = get_settings()
    if not getattr(s, "billing_pg_enabled", False):
        return False
    if not (s.billing_pg_host or "").strip():
        return False
    if not (s.billing_pg_database or "").strip():
        return False
    return True


@contextmanager
def get_billing_connection() -> Iterator[psycopg2.extensions.connection]:
    s = get_settings()
    conn = psycopg2.connect(
        host=s.billing_pg_host,
        port=s.billing_pg_port,
        user=s.billing_pg_user or None,
        password=s.billing_pg_password or None,
        dbname=s.billing_pg_database,
        connect_timeout=15,
        options=f"-c search_path={s.billing_pg_schema},public",
    )
    try:
        yield conn
    finally:
        conn.close()


def fetch_billing_rows(sql: str, params: Optional[tuple[Any, ...]] = None) -> List[Dict[str, Any]]:
    with get_billing_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params or ())
            return list(cur.fetchall())
