import json
import re
from typing import Any, Dict, List

from openai import OpenAI

from app.modules.soporte import reports
from app.modules.soporte.config import get_settings
from app.db import fetch_all, fetch_one


def _get_client() -> OpenAI:
    settings = get_settings()
    # Usa la variable de entorno estándar OPENAI_API_KEY
    return OpenAI()


def _load_ticket_context(ticket_id: int) -> Dict[str, Any]:
    ticket = fetch_one(
        """
        SELECT
            t.id,
            t.name,
            t.content
        FROM glpi_tickets t
        WHERE t.id = %s
        """,
        (ticket_id,),
    )
    if not ticket:
        raise ValueError(f"No existe el ticket {ticket_id} en glpi_tickets.")

    followups = fetch_all(
        """
        SELECT
            f.date,
            f.users_id,
            f.content,
            f.is_private
        FROM glpi_itilfollowups f
        WHERE f.itemtype = 'Ticket'
          AND f.items_id = %s
        ORDER BY f.date DESC
        LIMIT 20
        """,
        (ticket_id,),
    )

    tasks = fetch_all(
        """
        SELECT
            tt.date,
            tt.users_id,
            tt.content,
            tt.is_private,
            tt.state
        FROM glpi_tickettasks tt
        WHERE tt.tickets_id = %s
        ORDER BY tt.date DESC
        LIMIT 20
        """,
        (ticket_id,),
    )

    return {
        "ticket": ticket,
        "followups": followups,
        "tasks": tasks,
    }


def analyze_ticket(ticket_id: int, *, language: str = "es") -> Dict[str, Any]:
    """
    Devuelve un análisis en lenguaje natural del contexto del ticket,
    incluyendo módulo afectado, criticidad y posibles causas.
    """
    ctx = _load_ticket_context(ticket_id)
    ticket = ctx["ticket"]
    followups: List[Dict[str, Any]] = ctx["followups"]
    tasks: List[Dict[str, Any]] = ctx["tasks"]

    title = str(ticket.get("name") or "")
    description = str(ticket.get("content") or "")

    def _compact_entries(entries: List[Dict[str, Any]], kind: str) -> str:
        if not entries:
            return f"(Sin {kind})"
        lines: List[str] = []
        for e in entries:
            date = e.get("date")
            uid = e.get("users_id") or e.get("users_id_tech")
            is_private = e.get("is_private")
            content = (e.get("content") or "").strip().replace("\n", " ")
            prefix = f"{date} - usuario {uid}"
            if is_private:
                prefix += " [privado]"
            lines.append(f"- {prefix}: {content[:400]}")
        return "\n".join(lines[:15])

    followup_text = _compact_entries(followups, "seguimientos")
    task_text = _compact_entries(tasks, "tareas")

    raw_context = (
        f"TÍTULO: {title}\n\n"
        f"DESCRIPCIÓN (contenido del ticket):\n{description}\n\n"
        f"SEGUIMIENTOS (últimos):\n{followup_text}\n\n"
        f"TAREAS (últimas):\n{task_text}\n"
    )

    client = _get_client()

    system_prompt = (
        "Eres un analista de soporte y proyectos en una mesa de ayuda basada en GLPI. "
        "Lees el contenido del ticket (título, descripción, seguimientos y tareas) y devuelves un análisis breve, "
        "estructurado y útil para coordinación.\n\n"
        "Responde SIEMPRE en español claro, orientado a coordinadores y jefes de proyecto."
    )

    user_prompt = (
        "A partir del siguiente contexto real de un ticket de GLPI, genera un análisis con este formato JSON:\n\n"
        "{\n"
        '  \"summary\": \"resumen muy breve (1–3 frases) de qué trata el ticket\",\n'
        '  \"module\": \"módulo o área probablemente afectada (por ejemplo: inventario, portal de autoservicio, redes, base de datos, ERP X, portal web, correo, etc.)\",\n'
        '  \"criticality\": \"Alta | Media | Baja (elige UNA)\",\n'
        '  \"criticality_reason\": \"por qué asignas esa criticidad (máx. 3 frases)\",\n'
        '  \"probable_causes\": [\"lista de posibles causas técnicas o de proceso\"],\n'
        '  \"suggested_actions\": [\"lista de siguientes acciones recomendadas a coordinación / equipo técnico\"],\n'
        '  \"notes\": \"cualquier matiz relevante (dependencias, riesgos, impactos en SLA, etc.)\"\n'
        "}\n\n"
        "No inventes detalles muy específicos si el contexto no los soporta; sé prudente y habla en términos de probabilidad. "
        "Contexto del ticket:\n\n"
        f"{raw_context}"
    )

    completion = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )

    text = (completion.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("La respuesta del modelo vino vacía.")

    parsed = json.loads(text)
    parsed["ticket_id"] = ticket_id
    parsed["title"] = title
    return parsed


def analyze_project_tickets(project_id: int, date_from: str, date_to: str) -> Dict[str, Any]:
    """
    Análisis inteligente general de tickets gestionados de un proyecto en un rango.
    """
    report_data = reports.support_report(project_id=project_id, date_from=date_from, date_to=date_to)
    rows = report_data.get("rows", [])
    if not rows:
        return {
            "project_id": project_id,
            "date_from": date_from,
            "date_to": date_to,
            "total_tickets": 0,
            "summary": "No se encontraron tickets gestionados para el rango seleccionado.",
            "modules_affected": [],
            "main_support_drivers": [],
            "criticality_overview": "Sin datos",
            "recommendations": [],
        }

    ticket_ids = [int(r["id"]) for r in rows][:120]

    payload: List[Dict[str, Any]] = []
    for t in rows[:120]:
        tid = int(t["id"])
        ticket = fetch_one(
            """
            SELECT id, name, content
            FROM glpi_tickets
            WHERE id = %s
            """,
            (tid,),
        ) or {}
        followups = fetch_all(
            """
            SELECT date, content, is_private
            FROM glpi_itilfollowups
            WHERE itemtype = 'Ticket'
              AND items_id = %s
            ORDER BY date DESC
            LIMIT 8
            """,
            (tid,),
        )
        tasks = fetch_all(
            """
            SELECT date, content, actiontime, is_private
            FROM glpi_tickettasks
            WHERE tickets_id = %s
            ORDER BY date DESC
            LIMIT 8
            """,
            (tid,),
        )
        payload.append(
            {
                "id": tid,
                "titulo": ticket.get("name") or t.get("titulo") or "",
                "descripcion": (ticket.get("content") or "")[:1500],
                "tipo_solicitud": t.get("tipo_solicitud"),
                "facturable": t.get("facturable"),
                "estado_ticket": t.get("estado_ticket"),
                "tiempo_horas_minutos": t.get("tiempo_horas_minutos"),
                "seguimientos": [
                    {
                        "date": f.get("date"),
                        "is_private": f.get("is_private"),
                        "content": str(f.get("content") or "")[:350],
                    }
                    for f in followups
                ],
                "tareas": [
                    {
                        "date": x.get("date"),
                        "is_private": x.get("is_private"),
                        "actiontime": x.get("actiontime"),
                        "content": str(x.get("content") or "")[:350],
                    }
                    for x in tasks
                ],
            }
        )

    system_prompt = (
        "Eres un consultor senior de soporte y operaciones TI. "
        "Analizas un conjunto de tickets GLPI de un mismo proyecto y entregas un diagnóstico ejecutivo."
    )
    user_prompt = (
        "Analiza todos los tickets del proyecto/rango entregado y responde SOLO JSON con esta estructura:\n"
        "{\n"
        '  "summary": "resumen ejecutivo breve del comportamiento general del soporte",\n'
        '  "total_tickets": 0,\n'
        '  "modules_affected": ["módulos/áreas afectadas más relevantes"],\n'
        '  "main_support_drivers": ["motivos recurrentes que generaron soporte"],\n'
        '  "criticality_overview": "lectura global de criticidad y riesgo operativo",\n'
        '  "recommendations": ["acciones concretas de mejora"]\n'
        "}\n\n"
        "Debes inferir módulos y causas según título, descripción, seguimientos y tareas. "
        "Sé puntual y orientado a coordinación.\n\n"
        f"Contexto:\nproject_id={project_id}, date_from={date_from}, date_to={date_to}, total_tickets={len(rows)}\n"
        f"tickets={json.dumps(payload, ensure_ascii=False, default=str)}"
    )

    client = _get_client()
    completion = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    text = (completion.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("La respuesta del modelo vino vacía.")
    parsed = json.loads(text)
    parsed["project_id"] = project_id
    parsed["date_from"] = date_from
    parsed["date_to"] = date_to
    parsed["ticket_ids"] = ticket_ids
    parsed["report_total_tickets"] = len(rows)
    return parsed


_HTML = re.compile(r"<[^>]+>")


def _plain_text(s: str, limit: int = 4000) -> str:
    t = _HTML.sub(" ", s or "")
    t = " ".join(t.split())
    return t[:limit]


def _compact_ticket_for_batch(ticket_id: int) -> str:
    try:
        ctx = _load_ticket_context(ticket_id)
    except ValueError:
        return f"ticket_id={ticket_id}\n(sin datos en GLPI)"
    ticket = ctx["ticket"]
    followups: List[Dict[str, Any]] = ctx.get("followups") or []
    tasks: List[Dict[str, Any]] = ctx.get("tasks") or []
    title = str(ticket.get("name") or "")
    desc = _plain_text(str(ticket.get("content") or ""), 2500)
    fu_lines: List[str] = []
    for f in followups[:15]:
        c = _plain_text(str(f.get("content") or ""), 450)
        if c:
            fu_lines.append(c)
    task_lines: List[str] = []
    for tsk in tasks[:15]:
        c = _plain_text(str(tsk.get("content") or ""), 450)
        if c:
            task_lines.append(c)
    return (
        f"--- ticket_id={ticket_id} ---\nTÍTULO: {title}\n"
        f"DESCRIPCIÓN/REQUERIMIENTO: {desc}\n"
        f"SEGUIMIENTOS:\n- " + "\n- ".join(fu_lines if fu_lines else ["(ninguno)"])
        + f"\nACTIVIDADES/TAREAS:\n- " + "\n- ".join(task_lines if task_lines else ["(ninguna)"])
    )


def _short_contexts_for_batch(ticket_ids: List[int]) -> Dict[int, str]:
    if not ticket_ids:
        return {}
    blocks: List[str] = [_compact_ticket_for_batch(tid) for tid in ticket_ids]
    joined = "\n\n".join(blocks)
    client = _get_client()
    system_prompt = (
        "Actúa como un analista senior de mesa de ayuda y coordinador de soporte.\n\n"
        "Analiza cada ticket utilizando exclusivamente la información de los bloques: "
        "título, requerimiento (descripción), seguimientos, y actividades/tareas (contenido de tareas y seguimientos de GLPI).\n\n"
        "Objetivo: generar un contexto ejecutivo MUY conciso (máximo 2–3 frases) que permita a un coordinador entender con rapidez: "
        "qué se solicitó, qué problema o necesidad originó el ticket, qué acciones se ejecutaron, "
        "qué módulos o procesos fueron afectados (si aplica) y el estado o resultado actual según el texto.\n\n"
        "Reglas: integra toda la información en una sola narrativa coherente; no repitas literalmente el ticket, interpreta y sintetiza; "
        "diferencia implícitamente solicitud, ejecución y resultado; menciona módulos o áreas solo si son relevantes; "
        "si falta información clara, indícalo en una breve fórmula sin inventar; "
        "evita frases genéricas sin contexto; no agregues nada que no aparezca en el ticket.\n\n"
        "Cada resumen: un solo párrafo (2–3 frases máximo), claro, preciso, orientado a gestión, en español."
    )
    user_prompt = (
        "A partir de los bloques siguientes (cada uno tiene ticket_id, TÍTULO, DESCRIPCIÓN/REQUERIMIENTO, SEGUIMIENTOS, ACTIVIDADES/TAREAS), "
        "genera un contexto_corto por ticket según las reglas del sistema.\n\n"
        "Responde SOLO JSON con esta forma exacta:\n"
        '{ "contexts": [ { "ticket_id": <número>, "contexto_corto": "<un solo párrafo, 2–3 frases>" } ] }\n\n'
        f"Incluye exactamente un elemento por ticket, en el mismo orden si puedes. Tickets: {ticket_ids}.\n\n"
        f"{joined}"
    )
    try:
        completion = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.15,
        )
        text = (completion.choices[0].message.content or "").strip()
        if not text:
            raise RuntimeError("vacío")
        parsed = json.loads(text)
        out: Dict[int, str] = {}
        for item in parsed.get("contexts") or []:
            tid = int(item.get("ticket_id") or 0)
            if tid < 1:
                continue
            ctxs = str(item.get("contexto_corto") or "").strip()
            out[tid] = ctxs or "—"
        return out
    except Exception:
        return {tid: "No se pudo generar el resumen." for tid in ticket_ids}


TICKET_TABLE_ANALYSIS_MAX = 100
TICKET_TABLE_BATCH = 5


def analyze_tickets_per_ticket_table(
    project_id: int, date_from: str, date_to: str
) -> Dict[str, Any]:
    data = reports.tickets_created_for_project_table(project_id, date_from, date_to)
    base_rows: List[Dict[str, Any]] = list(data.get("rows") or [])
    n_total = len(base_rows)
    to_analyze = base_rows[:TICKET_TABLE_ANALYSIS_MAX]
    contexts: Dict[int, str] = {}
    for i in range(0, len(to_analyze), TICKET_TABLE_BATCH):
        batch = to_analyze[i : i + TICKET_TABLE_BATCH]
        ids = [int(r["id"]) for r in batch]
        part = _short_contexts_for_batch(ids)
        for tid in ids:
            contexts[tid] = part.get(tid) or "—"
    out_rows: List[Dict[str, Any]] = []
    for r in to_analyze:
        tid = int(r["id"])
        out_rows.append(
            {
                **r,
                "contexto_corto": contexts.get(tid) or "—",
            }
        )
    return {
        "project_id": data.get("project_id"),
        "project_name": data.get("project_name"),
        "date_from": data.get("date_from"),
        "date_to": data.get("date_to"),
        "rows": out_rows,
        "total_in_range": n_total,
        "truncated": n_total > TICKET_TABLE_ANALYSIS_MAX,
    }

