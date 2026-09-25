from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional, Tuple, Union

import pymysql
from pymysql.cursors import DictCursor

from app.modules.soporte.config import get_settings


def _connect(read_timeout: int = 60):
    s = get_settings()
    return pymysql.connect(
        host=s.db_host,
        port=s.db_port,
        user=s.db_user,
        password=s.db_password,
        database=s.db_name,
        charset=s.db_charset,
        cursorclass=DictCursor,
        connect_timeout=10,
        read_timeout=read_timeout,
        write_timeout=60,
    )


@contextmanager
def get_connection(read_timeout: int = 60) -> Iterator[pymysql.connections.Connection]:
    conn = _connect(read_timeout=read_timeout)
    try:
        yield conn
    finally:
        conn.close()


def fetch_all(
    sql: str,
    params: Optional[Union[Tuple[Any, ...], dict]] = None,
    *,
    read_timeout: int = 60,
) -> list[Dict[str, Any]]:
    with get_connection(read_timeout=read_timeout) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return list(cur.fetchall())


def fetch_one(
    sql: str, params: Optional[Union[Tuple[Any, ...], dict]] = None
) -> Optional[Dict[str, Any]]:
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def execute(
    sql: str, params: Optional[Union[Tuple[Any, ...], dict]] = None
) -> Tuple[int, int]:
    """Ejecuta una sentencia de escritura con commit. Devuelve (filas afectadas, lastrowid)."""
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                affected = cur.execute(sql, params or ())
                last_id = int(cur.lastrowid or 0)
            conn.commit()
            return int(affected), last_id
        except Exception:
            conn.rollback()
            raise


def bulk_update_ticket_request_types(updates: list[tuple[int, int]]) -> int:
    """
    Actualiza el tipo de solicitud de varios tickets.
    Cada tupla es (requesttypes_id, ticket_id). Tabla: glpi_tickets.
    """
    if not updates:
        return 0
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                total = 0
                for request_type_id, ticket_id in updates:
                    total += cur.execute(
                        """
                        UPDATE glpi_tickets
                        SET requesttypes_id = %s, date_mod = NOW()
                        WHERE id = %s AND is_deleted = 0
                        """,
                        (request_type_id, ticket_id),
                    )
            conn.commit()
            return total
        except Exception:
            conn.rollback()
            raise
