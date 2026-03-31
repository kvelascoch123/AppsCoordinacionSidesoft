from datetime import datetime
from typing import Any, Dict, List, Tuple

from app.db import fetch_all, fetch_one


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


def _detect_requesttype_facturable_table() -> str:
    """
    Detecta la tabla que contiene `facturablefield` para requesttypes (plugin Fields).
    Retorna nombre de tabla o cadena vacía si no existe.
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
        ORDER BY c.table_name
        LIMIT 1
        """
    )
    return str(row["table_name"]) if row and row.get("table_name") else ""


def support_report(project_id: int, date_from: str, date_to: str) -> Dict[str, Any]:
    # Valida formato yyyy-mm-dd
    start_dt = datetime.strptime(date_from, "%Y-%m-%d")
    end_dt = datetime.strptime(date_to, "%Y-%m-%d")
    if end_dt < start_dt:
        raise ValueError("La fecha hasta no puede ser menor que la fecha desde.")

    fact_table = _detect_requesttype_facturable_table()
    rtf_join = (
        f"LEFT JOIN {fact_table} rtf ON rtf.items_id = t.requesttypes_id"
        if fact_table
        else "LEFT JOIN (SELECT NULL AS items_id, NULL AS facturablefield) rtf ON 1=0"
    )

    main_sql = f"""
        SELECT
            tmp.id,
            tmp.titulo,
            tmp.proyecto,
            tmp.tipo_solicitud,
            tmp.facturable,
            tmp.solvedate,
            tmp.estado_ticket,
            tmp.tiempo_numerico,
            CONCAT(
                FLOOR(tmp.tiempo_numerico / 3600), ' horas ',
                FLOOR((tmp.tiempo_numerico %% 3600) / 60), ' minutos'
            ) AS tiempo_horas_minutos
        FROM (
            SELECT
                tt.tickets_id AS id,
                t.name AS titulo,
                COALESCE(pr.name, ppr.name) AS proyecto,
                COALESCE(NULLIF(rt.name, ''), 'Otro') AS tipo_solicitud,
                rtf.facturablefield AS facturable,
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
                SUM(tt.actiontime) AS tiempo_numerico
            FROM glpi_tickettasks tt
            LEFT JOIN glpi_tickets t ON t.id = tt.tickets_id
            LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
            {rtf_join}
            LEFT JOIN glpi_tickets_users tup ON tup.tickets_id = tt.tickets_id AND tup.type = 1
            LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff ON pltff.items_id = tt.tickets_id
            LEFT JOIN glpi_plugin_fields_userproyectorelacionadousers up ON up.items_id = tup.users_id
            LEFT JOIN glpi_projects pr
                ON pr.id = CAST(
                    REPLACE(
                        REPLACE(
                            REPLACE(up.projects_id_proyectorelacionadouserfield, '"', ''),
                        '[', ''),
                    ']', '') AS UNSIGNED
                )
            LEFT JOIN glpi_projects ppr ON ppr.id = pltff.projects_id_proyectorelacionadofieldtwo
            WHERE t.is_deleted <> 1
              AND tt.date >= %s
              AND tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              AND tt.actiontime > 0
              AND COALESCE(pr.id, ppr.id) = %s
            GROUP BY tt.tickets_id, t.name, proyecto, tipo_solicitud, facturable, solvedate, estado_ticket
            ORDER BY tt.tickets_id
        ) tmp
    """
    params = (date_from, date_to, project_id)

    rows: List[Dict[str, Any]]
    try:
        rows = fetch_all(main_sql, params)
    except Exception:
        # Fallback: proyecto por relación estándar de GLPI (itils_projects)
        rows = fetch_all(
            f"""
            SELECT
                t.id,
                t.name AS titulo,
                p.name AS proyecto,
                COALESCE(NULLIF(rt.name, ''), 'Otro') AS tipo_solicitud,
                rtf.facturablefield AS facturable,
                CASE
                    WHEN t.status = 1 THEN 'Nuevo'
                    WHEN t.status = 2 THEN 'En curso'
                    WHEN t.status = 3 THEN 'Planificado'
                    WHEN t.status = 4 THEN 'En espera'
                    WHEN t.status = 5 THEN 'Resuelto'
                    WHEN t.status = 6 THEN 'Cerrado'
                    ELSE 'Desconocido'
                END AS estado_ticket,
                SUM(tt.actiontime) AS tiempo_numerico,
                CONCAT(
                    FLOOR(SUM(tt.actiontime) / 3600), ' horas ',
                    FLOOR((SUM(tt.actiontime) %% 3600) / 60), ' minutos'
                ) AS tiempo_horas_minutos
            FROM glpi_tickettasks tt
            INNER JOIN glpi_tickets t ON t.id = tt.tickets_id
            LEFT JOIN glpi_requesttypes rt ON rt.id = t.requesttypes_id
            {rtf_join}
            INNER JOIN glpi_itils_projects ip ON ip.items_id = t.id AND ip.itemtype = 'Ticket'
            INNER JOIN glpi_projects p ON p.id = ip.projects_id
            WHERE t.is_deleted <> 1
              AND tt.date >= %s
              AND tt.date < DATE_ADD(%s, INTERVAL 1 DAY)
              AND tt.actiontime > 0
              AND p.id = %s
            GROUP BY t.id, t.name, p.name, tipo_solicitud, facturable, estado_ticket
            ORDER BY t.id
            """,
            params,
        )

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

