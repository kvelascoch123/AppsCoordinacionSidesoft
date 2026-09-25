"""KPI variables (hojas Datos / Resumen Cliente-Técnico / Resumen Técnico Global)."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from app.db import fetch_all

_OPEN_STATES = {"Nuevo", "En curso", "Planificado", "En espera"}
_WEEKEND_BONUS = 0.1  # Excel: % Soporte Fin de Semana 10 %

_SQL = """
SELECT
  t.date AS fecha_ticket,
  TRIM(COALESCE(pr.name, ppr.name)) AS proyecto,
  utech.name AS asignado,
  t.id AS ticket,
  CASE WHEN t.status = 6 THEN 'Sí' ELSE 'No' END AS ticket_cerrado,
  COALESCE(ts.satisfaction, 0) AS calificacion,
  CASE WHEN COALESCE(ts.satisfaction, 0) > 0 THEN 'Sí' ELSE 'No' END AS calificado,
  CASE
    WHEN t.itilcategories_id = 2 THEN 'SLA 1'
    WHEN t.itilcategories_id = 3 THEN 'SLA 2'
    WHEN t.itilcategories_id = 4 THEN 'SLA 3'
    ELSE 'Sin SLA'
  END AS sla,
  CASE
    WHEN pltff.excluirslafield = 1 THEN 'NO APLICA SLA'
    ELSE CASE
      WHEN t.itilcategories_id = 2 THEN
        CASE
          WHEN fn_labor_hours_between(
            t.`date`,
            COALESCE(
              t.solvedate,
              CASE
                WHEN t.status IN (1, 2, 3, 4) THEN NOW()
                WHEN t.status IN (5) THEN COALESCE(t.solvedate, t.date_mod)
                WHEN t.status IN (6) THEN COALESCE(t.closedate, t.date_mod)
              END
            )
          ) > COALESCE(fp.horasslaonefield, fpp.horasslaonefield)
          THEN 'SLA Incumplido'
          ELSE 'SLA Cumplido'
        END
      WHEN t.itilcategories_id = 3 THEN
        CASE
          WHEN fn_labor_hours_between(
            t.`date`,
            COALESCE(
              t.solvedate,
              CASE
                WHEN t.status IN (1, 2, 3, 4) THEN NOW()
                WHEN t.status IN (5) THEN COALESCE(t.solvedate, t.date_mod)
                WHEN t.status IN (6) THEN COALESCE(t.closedate, t.date_mod)
              END
            )
          ) - fn_labor_hours_between(
            NULLIF(pltff.fechainiciopausaslafield, ''),
            COALESCE(
              NULLIF(pltff.fechafinpausaslafield, ''),
              CASE
                WHEN t.status IN (1, 2, 3, 4) THEN NOW()
                WHEN t.status IN (5) THEN COALESCE(t.solvedate, t.date_mod)
                WHEN t.status IN (6) THEN COALESCE(t.closedate, t.date_mod)
              END
            )
          ) > COALESCE(fp.horasslatwofield, fpp.horasslatwofield)
          THEN 'SLA Incumplido'
          ELSE 'SLA Cumplido'
        END
      WHEN t.itilcategories_id = 4 THEN
        CASE
          WHEN fn_labor_hours_between(
            t.`date`,
            COALESCE(
              t.solvedate,
              CASE
                WHEN t.status IN (1, 2, 3, 4) THEN NOW()
                WHEN t.status IN (5) THEN COALESCE(t.solvedate, t.date_mod)
                WHEN t.status IN (6) THEN COALESCE(t.closedate, t.date_mod)
              END
            )
          ) - fn_labor_hours_between(
            NULLIF(pltff.fechainiciopausaslafield, ''),
            COALESCE(
              NULLIF(pltff.fechafinpausaslafield, ''),
              CASE
                WHEN t.status IN (1, 2, 3, 4) THEN NOW()
                WHEN t.status IN (5) THEN COALESCE(t.solvedate, t.date_mod)
                WHEN t.status IN (6) THEN COALESCE(t.closedate, t.date_mod)
              END
            )
          ) > COALESCE(fp.horasslathreefield, fpp.horasslathreefield)
          THEN 'SLA Incumplido'
          ELSE 'SLA Cumplido'
        END
      ELSE 'Sin SLA'
    END
  END AS cumplimiento_sla,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM glpi_logs l
      WHERE l.itemtype = 'Ticket'
        AND l.items_id = t.id
        AND l.old_value IN ('5', '6')
        AND l.new_value IN ('2')
    ) THEN 'Sí'
    ELSE 'No'
  END AS reapertura,
  CASE
    WHEN t.status = 1 THEN 'Nuevo'
    WHEN t.status = 2 THEN 'En curso'
    WHEN t.status = 3 THEN 'Planificado'
    WHEN t.status = 4 THEN 'En espera'
    WHEN t.status = 5 THEN 'Resuelto'
    WHEN t.status = 6 THEN 'Cerrado'
    ELSE 'Desconocido'
  END AS estado_ticket,
  utech.id AS tecnico_id,
  COALESCE(tsk.total_seconds, 0) AS total_seconds,
  COALESCE(
    CONCAT(
      FLOOR(tsk.total_seconds / 3600), ' horas ',
      FLOOR(tsk.total_seconds %% 3600) / 60, ' minutos'
    ),
    '0 horas 0 minutos'
  ) AS tiempo_horas_minutos
FROM glpi_tickets t
LEFT JOIN glpi_tickettasks tt
  ON tt.tickets_id = t.id
LEFT JOIN glpi_plugin_fields_ticketticketsformfields pltff
  ON pltff.items_id = t.id
LEFT JOIN glpi_tickets_users tut
  ON tut.tickets_id = t.id AND tut.type = 2
LEFT JOIN glpi_users utech
  ON utech.id = tut.users_id
LEFT JOIN glpi_tickets_users tup
  ON tup.tickets_id = t.id AND tup.type = 1
LEFT JOIN glpi_users utp
  ON utp.id = tup.users_id
LEFT JOIN glpi_projects ppr
  ON ppr.id = pltff.projects_id_proyectorelacionadofieldtwo
LEFT JOIN glpi_plugin_fields_projectproyectos fpp
  ON fpp.items_id = ppr.id
LEFT JOIN glpi_plugin_fields_userproyectorelacionadousers up
  ON up.items_id = tup.users_id
LEFT JOIN glpi_projects pr
  ON pr.id = REPLACE(REPLACE(REPLACE(up.projects_id_proyectorelacionadouserfield, '"', ''), '[', ''), ']', '')
LEFT JOIN glpi_plugin_fields_projectproyectos fp
  ON fp.items_id = pr.id
LEFT JOIN glpi_ticketsatisfactions ts
  ON ts.tickets_id = t.id
LEFT JOIN (
  SELECT tickets_id, users_id, SUM(actiontime) AS total_seconds
  FROM glpi_tickettasks
  WHERE (DATE(`begin`) >= %s OR DATE(`date`) >= %s)
    AND (DATE(`begin`) <= %s OR DATE(`date`) <= %s)
  GROUP BY tickets_id, users_id
) tsk
  ON tsk.tickets_id = t.id
 AND tsk.users_id = utech.id
WHERE (DATE(tt.`begin`) >= %s OR DATE(tt.`date`) >= %s)
  AND (DATE(tt.`begin`) <= %s OR DATE(tt.`date`) <= %s)
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
ORDER BY t.date ASC
"""


def _parse_dates(date_from: str, date_to: str) -> Tuple[str, str]:
    datetime.strptime(date_from, "%Y-%m-%d")
    datetime.strptime(date_to, "%Y-%m-%d")
    if date_to < date_from:
        raise ValueError("date_to debe ser >= date_from")
    return date_from, date_to


def _fmt_fecha(v: Any) -> Optional[str]:
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat(sep=" ", timespec="seconds")
    s = str(v).strip()
    return s or None


def _dash_or(value: Any, empty: bool) -> Any:
    return "--" if empty else value


def _build_datos(raw: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for r in raw:
        estado = (r.get("estado_ticket") or "").strip() or "Desconocido"
        evaluado = "No" if estado in _OPEN_STATES else "Sí"
        total_seconds = int(float(r.get("total_seconds") or 0))
        rows.append(
            {
                "fecha": _fmt_fecha(r.get("fecha_ticket")),
                "cliente": (r.get("proyecto") or "").strip() or "(sin proyecto)",
                "tecnico": (r.get("asignado") or "").strip() or "(sin técnico)",
                "id_ticket": int(r.get("ticket") or 0),
                "cerrado_por_cliente": r.get("ticket_cerrado") or "No",
                "calificacion": int(float(r.get("calificacion") or 0)),
                "ticket_calificado": r.get("calificado") or "No",
                "tipo_sla": r.get("sla") or "Sin SLA",
                "dentro_sla": r.get("cumplimiento_sla") or "Sin SLA",
                "reapertura": r.get("reapertura") or "No",
                "estado": estado,
                "tecnico_id": int(r["tecnico_id"]) if r.get("tecnico_id") is not None else None,
                "total_seconds": total_seconds,
                "tiempo_horas_minutos": r.get("tiempo_horas_minutos") or "0 horas 0 minutos",
                "evaluado_kpi_cierre": evaluado,
            }
        )
    return rows


def _build_resumen_cliente_tecnico(datos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for r in datos:
        buckets[(r["tecnico"], r["cliente"])].append(r)

    out: List[Dict[str, Any]] = []
    for (tecnico, cliente), items in sorted(buckets.items(), key=lambda x: (x[0][0].lower(), x[0][1].lower())):
        total_tickets = len(items)
        evaluables = [x for x in items if x["evaluado_kpi_cierre"] == "Sí"]
        d = len(evaluables)
        e = sum(1 for x in evaluables if x["cerrado_por_cliente"] == "Sí")
        i = sum(1 for x in evaluables if x["ticket_calificado"] == "Sí")
        m = sum(
            1
            for x in evaluables
            if x["dentro_sla"] in ("SLA Cumplido", "NO APLICA SLA")
        )
        q = sum(1 for x in items if x["reapertura"] == "Sí")
        u = sum(int(x["total_seconds"] or 0) for x in items)
        empty = d <= 0

        f = None if empty else (e / d)
        j = None if empty else (i / d)
        n = None if empty else (m / d)
        r_pct = 0.0 if total_tickets == 0 else (q / total_tickets) * 100.0

        out.append(
            {
                "tecnico": tecnico,
                "cliente": cliente,
                "total_tickets": total_tickets,
                "total_tickets_evaluar": d,
                "tickets_cerrados_cliente": e,
                "pct_cierre_cliente": _dash_or(f, empty),
                "cumple_kpi_cierre_25": _dash_or(
                    "CUMPLE" if f is not None and f > 0.25 else "NO CUMPLE",
                    empty,
                ),
                "variable_kpi_cierre_25": _dash_or(
                    (f if f is not None and f > 0.25 else 0.0) * 100.0,
                    empty,
                ),
                "tickets_calificados": i,
                "pct_tickets_calificados": _dash_or(j, empty),
                "cumple_kpi_calificacion_20": _dash_or(
                    "CUMPLE" if j is not None and j > 0.2 else "NO CUMPLE",
                    empty,
                ),
                "variable_kpi_calificacion_20": _dash_or(
                    (j if j is not None and j > 0.2 else 0.0) * 100.0,
                    empty,
                ),
                "tickets_dentro_sla": m,
                "pct_cumplimiento_sla": _dash_or(n, empty),
                # Excel hoja 2: CUMPLE si N>0.2 (cabecera dice >30%; se replica la fórmula).
                "cumple_kpi_sla": _dash_or(
                    "CUMPLE" if n is not None and n > 0.2 else "NO CUMPLE",
                    empty,
                ),
                "variable_kpi_sla_30": _dash_or(
                    (n if n is not None and n > 0.3 else 0.0) * 100.0,
                    empty,
                ),
                "tickets_reaperturas": q,
                "pct_reaperturas": r_pct,
                "cumple_kpi_reapertura": "CUMPLE" if r_pct < 25 else "NO CUMPLE",
                "variable_kpi_reapertura_25": 25.0 if r_pct < 50 else 0.0,
                "total_seg_glpi": u,
                "total_horas": u / 3600.0,
            }
        )
    return out


def _build_resumen_tecnico_global(
    datos: List[Dict[str, Any]],
    por_cliente: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    by_tech: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in datos:
        by_tech[r["tecnico"]].append(r)

    eval_by_tech: Dict[str, int] = defaultdict(int)
    secs_by_tech: Dict[str, int] = defaultdict(int)
    for row in por_cliente:
        eval_by_tech[row["tecnico"]] += int(row["total_tickets_evaluar"] or 0)
        secs_by_tech[row["tecnico"]] += int(row["total_seg_glpi"] or 0)

    out: List[Dict[str, Any]] = []
    for tecnico, items in sorted(by_tech.items(), key=lambda x: x[0].lower()):
        b = len(items)
        c = eval_by_tech.get(tecnico, 0)
        d = sum(
            1
            for x in items
            if x["cerrado_por_cliente"] == "Sí" and x["evaluado_kpi_cierre"] == "Sí"
        )
        e = 0.0 if c == 0 else d / c
        h = sum(1 for x in items if x["ticket_calificado"] == "Sí")
        i = 0.0 if c == 0 else h / c
        m = sum(
            1
            for x in items
            if x["evaluado_kpi_cierre"] == "Sí"
            and x["dentro_sla"] in ("SLA Cumplido", "NO APLICA SLA")
        )
        n = 0.0 if c == 0 else m / c
        q = sum(1 for x in items if x["reapertura"] == "Sí")
        # Excel: IF(B=0,0,Q/C) — chequea B pero divide por C.
        r_ratio = 0.0 if b == 0 else (0.0 if c == 0 else q / c)
        g = e * 0.25
        k = e  # alterno contra cierre
        l = k * 0.20
        p = n * 0.30
        t = max(0.0, 0.25 * (1.0 - r_ratio))
        u = t + p + l + g
        v = secs_by_tech.get(tecnico, 0)
        x = _WEEKEND_BONUS
        y = u + x

        out.append(
            {
                "tecnico": tecnico,
                "total_tickets": b,
                "total_tickets_evaluar_cierre": c,
                "tickets_cerrados_cliente": d,
                "pct_cierre_global": e,
                "cumple_kpi_cierre_25": "CUMPLE" if e >= 0.25 else "NO CUMPLE",
                "valor_25": g,
                "tickets_calificados": h,
                "pct_tickets_calificados": i,
                "cumple_kpi_calificacion_20": "CUMPLE" if i >= 0.2 else "NO CUMPLE",
                "alterno_contra_cierre": k,
                "valor_20": l,
                "tickets_dentro_sla": m,
                "pct_cumplimiento_sla": n,
                "cumple_kpi_sla": "CUMPLE" if n >= 0.3 else "NO CUMPLE",
                "valor_30": p,
                "tickets_reaperturas": q,
                "pct_reaperturas": r_ratio,
                "cumple_kpi_reapertura": "CUMPLE" if r_ratio < 0.25 else "NO CUMPLE",
                "valor_25_reapertura": t,
                "total_pct_variable": u,
                "tiempo_glpi_seg": v,
                "tiempo_horas": v / 3600.0,
                "pct_soporte_finde_10": x,
                "variable_final": y,
            }
        )
    return out


def list_kpi_variables(date_from: str, date_to: str) -> Dict[str, Any]:
    dfrom, dto = _parse_dates(date_from, date_to)
    params = (dfrom, dfrom, dto, dto, dfrom, dfrom, dto, dto)
    raw = fetch_all(_SQL, params, read_timeout=180)
    datos = _build_datos(raw)
    por_cliente = _build_resumen_cliente_tecnico(datos)
    por_tecnico = _build_resumen_tecnico_global(datos, por_cliente)
    return {
        "date_from": dfrom,
        "date_to": dto,
        "datos": datos,
        "resumen_cliente_tecnico": por_cliente,
        "resumen_tecnico_global": por_tecnico,
        "counts": {
            "datos": len(datos),
            "resumen_cliente_tecnico": len(por_cliente),
            "resumen_tecnico_global": len(por_tecnico),
        },
    }
