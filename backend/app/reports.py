from datetime import datetime
from typing import Any, Dict, List, Tuple

from pymysql.err import OperationalError

from app.config import get_settings
from app.db import bulk_update_ticket_request_types, fetch_all, fetch_one


def _normalize_support_report_rows(rows: List[Dict[str, Any]]) -> None:
    """
    Garantiza clave `solicitante` en minúsculas y tipo str para JSON.
    PyMySQL / MySQL a veces devuelven alias en otro caso o bytes.
    """
    for r in rows:
        val: Any = r.get("solicitante")
        if val is None:
            for k, v in r.items():
                if str(k).lower() == "solicitante":
                    val = v
                    break
        for k in list(r.keys()):
            if str(k).lower() == "solicitante" and k != "solicitante":
                del r[k]
        if val is None:
            r["solicitante"] = None
            continue
        if isinstance(val, bytes):
            val = val.decode("utf-8", errors="replace")
        elif not isinstance(val, str):
            val = str(val)
        val = val.strip()
        r["solicitante"] = val if val else None


def _seconds_to_parts(total_seconds: int) -> Tuple[int, int, str]:
    if total_seconds < 0:
        total_seconds = 0
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    return hours, minutes, f"{hours:02d}:{minutes:02d}"


def list_projects() -> List[Dict[str, Any]]:
    return fetch_all(
        """
        SELECT id, name
        FROM glpi_projects
        WHERE is_deleted = 0
          AND COALESCE(name, '') <> ''
        ORDER BY name
        """
    )


def list_project_types() -> List[Dict[str, Any]]:
    """
    Tipos de proyecto (glpi_projecttypes), misma lista que el campo «Tipo» en el formulario
    de proyecto de GLPI (glpi_projects.projecttypes_id).
    """
    try:
        return fetch_all(
            """
            SELECT id, name
            FROM glpi_projecttypes
            ORDER BY name, id
            """
        )
    except Exception:
        return []


def _detect_requesttype_facturable_table() -> str:
    """
    Tabla plugin Fields con facturablefield vinculada a tipos de solicitud (items_id = id en glpi_requesttypes).
    Se prioriza el nombre de tabla sobre 'requesttype' para no unir contra otra entidad (p. ej. tickets).
    """
    row = fetch_one(
        """
        SELECT c.table_name
        FROM information_schema.columns c
        WHERE c.table_schema = DATABASE()
          AND c.column_name = 'facturablefield'
          AND EXISTS (
              SELECT 1
              FROM information_schema.columns c2
              WHERE c2.table_schema = c.table_schema
                AND c2.table_name = c.table_name
                AND c2.column_name = 'items_id'
          )
          AND (
              LOWER(c.table_name) LIKE '%%requesttype%%'
              OR LOWER(c.table_name) LIKE '%%requesttypes%%'
          )
        ORDER BY c.table_name
        LIMIT 1
        """
    )
    if row and row.get("table_name"):
        return str(row["table_name"])
    row = fetch_one(
        """
        SELECT c.table_name
        FROM information_schema.columns c
        WHERE c.table_schema = DATABASE()
          AND c.column_name = 'facturablefield'
          AND EXISTS (
              SELECT 1
              FROM information_schema.columns c2
              WHERE c2.table_schema = c.table_schema
                AND c2.table_name = c.table_name
                AND c2.column_name = 'items_id'
          )
        ORDER BY c.table_name
        LIMIT 1
        """
    )
    return str(row["table_name"]) if row and row.get("table_name") else ""


def _sql_exists_ticket_in_project_plugin_correlate_tt() -> str:
    """
    Filtro de proyecto (plugin de campos) sin multiplicar filas de tareas: correlaciona
    glpi_tickettasks tt; el placeholder %s es project_id en COALESCE(zpr, zppr).
    """
    return """
        EXISTS (
            SELECT 1
            FROM glpi_tickettasks zt
            INNER JOIN glpi_tickets z0 ON z0.id = zt.tickets_id AND z0.is_deleted <> 1
            LEFT JOIN glpi_tickets_users ztup ON ztup.tickets_id = zt.tickets_id AND ztup.type = 1
            LEFT JOIN glpi_plugin_fields_ticketticketsformfields zplt
                ON zplt.items_id = zt.tickets_id
            LEFT JOIN glpi_plugin_fields_userproyectorelacionadousers zup ON zup.items_id = ztup.users_id
            LEFT JOIN glpi_projects zpr
                ON zpr.id = CAST(
                    REPLACE(
                        REPLACE(
                            REPLACE(zup.projects_id_proyectorelacionadouserfield, '"', ''),
                        '[', ''),
                    ']', '') AS UNSIGNED
                )
            LEFT JOIN glpi_projects zppr ON zppr.id = zplt.projects_id_proyectorelacionadofieldtwo
            WHERE zt.tickets_id = tt.tickets_id
              AND COALESCE(zpr.id, zppr.id) = %s
        )
    """


def support_report(project_id: int, date_from: str, date_to: str) -> Dict[str, Any]:
    # Valida formato yyyy-mm-dd
    start_dt = datetime.strptime(date_from, "%Y-%m-%d")
    end_dt = datetime.strptime(date_to, "%Y-%m-%d")
    if end_dt < start_dt:
        raise ValueError("La fecha hasta no puede ser menor que la fecha desde.")

    fact_table = _detect_requesttype_facturable_table()
    rtf_outer = (
        f"LEFT JOIN {fact_table} rtf ON rtf.items_id = t.requesttypes_id"
        if fact_table
        else "LEFT JOIN (SELECT NULL AS items_id, NULL AS facturablefield) rtf ON 1=0"
    )

    req_type = int(get_settings().requester_link_type)
    # Solicitante: glpi_tickets_users (GLPI_REQUESTER_TYPE, por defecto 1) + glpi_users.
    # LEFT JOIN + alternative_email: evita NULL si users_id=0 o usuario “eliminado” en GLPI.
    solicitante_subq = f"""
        (
            SELECT COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                NULLIF(TRIM(u.name), ''),
                NULLIF(TRIM(tuc.alternative_email), '')
            )
            FROM glpi_tickets_users tuc
            LEFT JOIN glpi_users u ON u.id = tuc.users_id
            WHERE tuc.tickets_id = t.id AND tuc.type = {req_type}
            ORDER BY tuc.id ASC
            LIMIT 1
        )
    """

    _exists_proj = _sql_exists_ticket_in_project_plugin_correlate_tt()

    # Agrega tiempo por ticket; luego una sola lectura de glpi_tickets para requesttypes_id y tipo (evita datos mezclados por JOINs).
    main_sql = f"""
        SELECT
            base.id,
            t.requesttypes_id AS requesttypes_id,
            t.name AS titulo,
            base.proyecto,
            COALESCE(NULLIF(rt.name, ''), 'Otro') AS tipo_solicitud,
            rtf.facturablefield AS facturable,
            {solicitante_subq} AS solicitante,
            COALESCE(
                t.solvedate,
                CASE
                    WHEN t.status IN (1, 2, 3, 4) THEN NOW()
                    WHEN t.status = 5 THEN COALESCE(t.solvedate, t.date_mod)
                    WHEN t.status = 6 THEN COALESCE(t.closedate, t.date_mod)
                    ELSE t.date_mod
                END
            ) AS solvedate,
            CASE
                WHEN t.status = 1 THEN 'Nuevo'
                WHEN t.status = 2 THEN 'En curso'
                WHEN t.status = 3 THEN 'Planificado'
                WHEN t.status = 4 THEN 'En espera'
                WHEN t.status = 5 THEN 'Resuelto'
                WHEN t.status = 6 THEN 'Cerrado'
                ELSE 'Desconocido'
            END AS estado_ticket,
            base.tiempo_numerico,
            CONCAT(
                FLOOR(base.tiempo_numerico / 3600), ' horas ',
                FLOOR(MOD(base.tiempo_numerico, 3600) / 60), ' minutos'
            ) AS tiempo_horas_minutos
        FROM (
            SELECT
                tt.tickets_id AS id,
                (SELECT name FROM glpi_projects WHERE id = %s LIMIT 1) AS proyecto,
                SUM(tt.actiontime) AS tiempo_numerico
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t0 ON t0.id = tt.tickets_id AND t0.is_deleted <> 1
            WHERE tt.date >= %s
              AND tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              AND tt.actiontime > 0
              AND {_exists_proj}
            GROUP BY tt.tickets_id
        ) base
        INNER JOIN glpi_tickets t ON t.id = base.id AND t.is_deleted <> 1
        LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
        {rtf_outer}
        ORDER BY base.id
    """
    params = (project_id, date_from, date_to, project_id)

    rows: List[Dict[str, Any]]
    try:
        rows = fetch_all(main_sql, params)
    except Exception:
        # Fallback: proyecto por relación estándar de GLPI (itils_projects)
        rows = fetch_all(
            f"""
            SELECT
                t.id,
                t.requesttypes_id AS requesttypes_id,
                t.name AS titulo,
                (SELECT name FROM glpi_projects WHERE id = %s LIMIT 1) AS proyecto,
                COALESCE(NULLIF(rt.name, ''), 'Otro') AS tipo_solicitud,
                rtf.facturablefield AS facturable,
                {solicitante_subq} AS solicitante,
                CASE
                    WHEN t.status = 1 THEN 'Nuevo'
                    WHEN t.status = 2 THEN 'En curso'
                    WHEN t.status = 3 THEN 'Planificado'
                    WHEN t.status = 4 THEN 'En espera'
                    WHEN t.status = 5 THEN 'Resuelto'
                    WHEN t.status = 6 THEN 'Cerrado'
                    ELSE 'Desconocido'
                END AS estado_ticket,
                base.tiempo_numerico,
                CONCAT(
                    FLOOR(base.tiempo_numerico / 3600), ' horas ',
                    FLOOR(MOD(base.tiempo_numerico, 3600) / 60), ' minutos'
                ) AS tiempo_horas_minutos
            FROM (
                SELECT tt.tickets_id AS id, SUM(tt.actiontime) AS tiempo_numerico
                FROM glpi_tickettasks tt
                INNER JOIN glpi_tickets t0 ON t0.id = tt.tickets_id AND t0.is_deleted <> 1
                INNER JOIN glpi_itils_projects ip ON ip.items_id = t0.id AND ip.itemtype = 'Ticket'
                INNER JOIN glpi_projects p0 ON p0.id = ip.projects_id
                WHERE tt.date >= %s
                  AND tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
                  AND tt.actiontime > 0
                  AND p0.id = %s
                GROUP BY tt.tickets_id
            ) base
            INNER JOIN glpi_tickets t ON t.id = base.id AND t.is_deleted <> 1
            LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
            {rtf_outer}
            ORDER BY t.id
            """,
            (params[0], params[1], params[2], params[0]),
        )

    _normalize_support_report_rows(rows)

    total_seconds = int(sum(int(r.get("tiempo_numerico") or 0) for r in rows))

    def _is_facturable(v: Any) -> bool:
        s = str(v).strip().lower()
        return s in {"1", "si", "sí", "true", "t", "y", "yes"}

    facturable_seconds = int(sum(int(r.get("tiempo_numerico") or 0) for r in rows if _is_facturable(r.get("facturable"))))
    non_facturable_seconds = int(sum(int(r.get("tiempo_numerico") or 0) for r in rows if not _is_facturable(r.get("facturable"))))

    th, tm, thhmm = _seconds_to_parts(total_seconds)
    fh, fm, fhhmm = _seconds_to_parts(facturable_seconds)
    nfh, nfm, nfhhmm = _seconds_to_parts(non_facturable_seconds)

    return {
        "date_from": date_from,
        "date_to": date_to,
        "project_id": project_id,
        "rows": rows,
        "summary": {
            "total": {"hours": th, "minutes": tm, "hhmm": thhmm, "seconds": total_seconds},
            "facturable": {"hours": fh, "minutes": fm, "hhmm": fhhmm, "seconds": facturable_seconds},
            "no_facturable": {"hours": nfh, "minutes": nfm, "hhmm": nfhhmm, "seconds": non_facturable_seconds},
        },
    }


def _serialize_support_ticket_task_row(r: Dict[str, Any]) -> Dict[str, Any]:
    fd: Any = r.get("fecha_registro")
    if fd is not None and hasattr(fd, "isoformat"):
        fd = fd.isoformat(sep=" ", timespec="seconds")
    elif fd is not None:
        fd = str(fd)
    else:
        fd = None
    uc: Any = r.get("usuario_creador")
    if isinstance(uc, bytes):
        uc = uc.decode("utf-8", errors="replace").strip() or "—"
    elif uc is None or (isinstance(uc, str) and not str(uc).strip()):
        uc = "—"
    else:
        uc = str(uc).strip()
    at = int(r.get("actiontime") or 0)
    h, m, _ = _seconds_to_parts(at)
    tiempo_hm = f"{h} horas {m} minutos"
    return {
        "task_id": int(r.get("task_id") or 0),
        "fecha_registro": fd,
        "usuario_creador": uc,
        "actiontime": at,
        "tiempo_horas_minutos": tiempo_hm,
    }


def support_report_ticket_tasks(
    ticket_id: int, project_id: int, date_from: str, date_to: str
) -> List[Dict[str, Any]]:
    """
    Tareas (glpi_tickettasks) de un ticket en el periodo del informe, con el mismo criterio de proyecto
    que support_report (plugin Fields o itils_projects).
    """
    if ticket_id < 1 or project_id < 1:
        raise ValueError("Identificadores no válidos.")
    start_dt = datetime.strptime(date_from, "%Y-%m-%d")
    end_dt = datetime.strptime(date_to, "%Y-%m-%d")
    if end_dt < start_dt:
        raise ValueError("La fecha hasta no puede ser menor que la fecha desde.")

    user_name_expr = """
        COALESCE(
            NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
            NULLIF(TRIM(u.name), ''),
            '—'
        )
    """

    _exists_proj = _sql_exists_ticket_in_project_plugin_correlate_tt()
    sql_plugin = f"""
        SELECT
            tt.id AS task_id,
            tt.date AS fecha_registro,
            tt.actiontime,
            {user_name_expr} AS usuario_creador
        FROM glpi_tickettasks tt
        INNER JOIN glpi_tickets t0 ON t0.id = tt.tickets_id AND t0.is_deleted <> 1
        LEFT JOIN glpi_users u
            ON u.id = COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id)
        WHERE tt.tickets_id = %s
          AND tt.date >= %s
          AND tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
          AND tt.actiontime > 0
          AND {_exists_proj}
        ORDER BY tt.date ASC, tt.id ASC
    """
    params = (ticket_id, date_from, date_to, project_id)

    raw: List[Dict[str, Any]]
    try:
        raw = fetch_all(sql_plugin, params)
    except Exception:
        raw = fetch_all(
            f"""
            SELECT
                tt.id AS task_id,
                tt.date AS fecha_registro,
                tt.actiontime,
                {user_name_expr} AS usuario_creador
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t0 ON t0.id = tt.tickets_id AND t0.is_deleted <> 1
            INNER JOIN glpi_itils_projects ip ON ip.items_id = t0.id AND ip.itemtype = 'Ticket'
            INNER JOIN glpi_projects p0 ON p0.id = ip.projects_id
            LEFT JOIN glpi_users u
                ON u.id = COALESCE(NULLIF(tt.users_id_tech, 0), tt.users_id)
            WHERE tt.tickets_id = %s
              AND tt.date >= %s
              AND tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              AND tt.actiontime > 0
              AND p0.id = %s
            ORDER BY tt.date ASC, tt.id ASC
            """,
            params,
        )

    return [_serialize_support_ticket_task_row(r) for r in raw]


def _is_facturable_raw(v: Any) -> bool:
    s = str(v).strip().lower()
    return s in {"1", "si", "sí", "true", "t", "y", "yes"}


def list_request_types() -> List[Dict[str, Any]]:
    """
    Todos los registros de glpi_requesttypes (sin filtrar is_deleted: en algunas BD solo uno
    queda “activo” y el resto quedaría oculto). El facturable se cruza aparte.
    """
    rows = fetch_all(
        """
        SELECT id, name
        FROM glpi_requesttypes
        ORDER BY name, id
        """
    )

    fact_table = _detect_requesttype_facturable_table()
    fact_map: Dict[int, Any] = {}
    if fact_table:
        try:
            fr = fetch_all(f"SELECT items_id, facturablefield FROM {fact_table}")
            for x in fr:
                iid = int(x["items_id"])
                if iid not in fact_map:
                    fact_map[iid] = x.get("facturablefield")
        except Exception:
            pass

    out: List[Dict[str, Any]] = [{"id": 0, "name": "Sin tipo", "facturable": False}]
    seen = {0}
    for r in rows:
        rid = int(r["id"])
        if rid in seen:
            continue
        seen.add(rid)
        nm = str(r.get("name") or "").strip() or "Otro"
        raw = fact_map.get(rid)
        out.append(
            {
                "id": rid,
                "name": nm,
                "facturable": _is_facturable_raw(raw),
            }
        )
    return out


def apply_ticket_request_type_changes(updates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Persiste cambios de tipo de solicitud: solo tabla glpi_tickets (columna requesttypes_id).
    La facturación del informe se deriva del tipo y del plugin Fields sobre requesttypes.
    """
    if not updates:
        return {"updated": 0, "errors": []}

    by_ticket: Dict[int, int] = {}
    for u in updates:
        by_ticket[int(u["ticket_id"])] = int(u["requesttypes_id"])

    type_ids = set(by_ticket.values())
    valid_type_ids: set[int] = {0}
    type_ids_nonzero = type_ids - {0}
    if type_ids_nonzero:
        valid_ids_rows = fetch_all(
            f"SELECT id FROM glpi_requesttypes WHERE id IN ({','.join(['%s'] * len(type_ids_nonzero))})",
            tuple(type_ids_nonzero),
        )
        valid_type_ids |= {int(r["id"]) for r in valid_ids_rows}
    errors: List[str] = []
    pairs: List[tuple[int, int]] = []

    for tid, rtid in by_ticket.items():
        if rtid not in valid_type_ids:
            errors.append(f"Tipo de solicitud {rtid} no válido (ticket {tid})")
            continue
        row = fetch_one(
            "SELECT id FROM glpi_tickets WHERE id = %s AND is_deleted = 0",
            (tid,),
        )
        if not row:
            errors.append(f"Ticket {tid} no encontrado o eliminado")
            continue
        pairs.append((rtid, tid))

    if not pairs:
        return {"updated": 0, "errors": errors}

    try:
        n = bulk_update_ticket_request_types(pairs)
    except Exception as e:
        return {"updated": 0, "errors": errors + [str(e)]}

    return {"updated": n, "errors": errors}


def tickets_created_for_project_table(project_id: int, date_from: str, date_to: str) -> Dict[str, Any]:
    """
    Tickets dados de alta en el rango (glpi_tickets.date) y vinculados al proyecto,
    con la misma resolución de proyecto que el informe (plugin Fields o glpi_itils_projects).
    Tiempo: suma de actiontime de tareas cuya fecha/ inicio cae en [date_from, date_to] (día final inclusive).
    """
    if project_id < 1:
        raise ValueError("project_id no válido.")
    start_cmp = datetime.strptime(date_from, "%Y-%m-%d")
    end_dt = datetime.strptime(date_to, "%Y-%m-%d")
    if end_dt < start_cmp:
        raise ValueError("La fecha hasta no puede ser menor que la fecha desde.")
    s = get_settings()
    req_type = int(s.requester_link_type)
    solicitante_subq = f"""
        (
            SELECT COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(u.firstname, ''), ' ', COALESCE(u.realname, ''))), ''),
                NULLIF(TRIM(u.name), ''),
                NULLIF(TRIM(tuc.alternative_email), '')
            )
            FROM glpi_tickets_users tuc
            LEFT JOIN glpi_users u ON u.id = tuc.users_id
            WHERE tuc.tickets_id = t.id AND tuc.type = {req_type}
            ORDER BY tuc.id ASC
            LIMIT 1
        )
    """
    proj = fetch_one("SELECT id, name FROM glpi_projects WHERE id = %s AND is_deleted = 0", (project_id,))
    if not proj:
        raise ValueError("Proyecto no encontrado.")
    project_name = str(proj.get("name") or f"Proyecto #{project_id}")

    time_subq = """
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
            ), 0) AS actiontime_total
    """

    params_plugin: List[Any] = [date_from, date_from, date_to, date_to, project_id]
    ticket_entity = ""
    if s.entities_id is not None:
        ticket_entity = " AND t.entities_id = %s"
        params_plugin.append(s.entities_id)
    params_plugin.extend([date_from, date_to])

    sql_plugin = f"""
        SELECT
            t.id,
            t.name AS titulo,
            t.date AS fecha_ticket,
            COALESCE(NULLIF(rt.name, ''), 'Otro') AS tipo_solicitud,
            {solicitante_subq} AS solicitante,
            {time_subq}
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
        WHERE p.id = %s
          AND p.is_deleted = 0
          {ticket_entity}
          AND t.is_deleted = 0
          AND t.date >= %s
          AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
        ORDER BY t.date ASC, t.id ASC
    """
    try:
        raw_rows: List[Dict[str, Any]] = fetch_all(sql_plugin, tuple(params_plugin))
    except OperationalError as e:
        if e.args and e.args[0] == 1146:
            params_itils: List[Any] = [date_from, date_from, date_to, date_to, project_id]
            if s.entities_id is not None:
                params_itils.append(s.entities_id)
            params_itils.extend([date_from, date_to])
            sql_itils = f"""
                SELECT
                    t.id,
                    t.name AS titulo,
                    t.date AS fecha_ticket,
                    COALESCE(NULLIF(rt.name, ''), 'Otro') AS tipo_solicitud,
                    {solicitante_subq} AS solicitante,
                    {time_subq}
                FROM glpi_tickets t
                LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
                INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
                INNER JOIN glpi_projects p ON p.id = ip.projects_id AND p.is_deleted = 0
                WHERE p.id = %s
                  {ticket_entity}
                  AND t.is_deleted = 0
                  AND t.date >= %s
                  AND t.date < DATE_ADD(%s, INTERVAL 1 DAY)
                ORDER BY t.date ASC, t.id ASC
            """
            raw_rows = fetch_all(sql_itils, tuple(params_itils))
        else:
            raise
    _normalize_support_report_rows(raw_rows)
    rows: List[Dict[str, Any]] = []
    for r in raw_rows:
        tid = int(r["id"])
        sec = int(r.get("actiontime_total") or 0)
        th, tm, _ = _seconds_to_parts(sec)
        ft = r.get("fecha_ticket")
        if ft is not None and hasattr(ft, "isoformat"):
            fecha_s = ft.isoformat(sep=" ", timespec="seconds")
        else:
            fecha_s = str(ft) if ft else None
        raw_ts = r.get("tipo_solicitud")
        if raw_ts is not None and not isinstance(raw_ts, str):
            raw_ts = str(raw_ts)
        tipo = (raw_ts or "Otro").strip() or "Otro"
        rows.append(
            {
                "id": tid,
                "titulo": (r.get("titulo") or "") if isinstance(r.get("titulo"), str) else (str(r.get("titulo") or "")),
                "tipo_solicitud": tipo,
                "fecha_ticket": fecha_s,
                "solicitante": r.get("solicitante"),
                "actiontime_seconds": sec,
                "tiempo_horas_minutos": f"{th} horas {tm} minutos",
            }
        )
    return {
        "project_id": project_id,
        "project_name": project_name,
        "date_from": date_from,
        "date_to": date_to,
        "rows": rows,
    }

