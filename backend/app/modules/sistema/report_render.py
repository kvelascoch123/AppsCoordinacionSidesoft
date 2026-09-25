"""
Informe del envío automático por correo: HTML (cuerpo del correo), Word (python-docx) y PDF (reportlab).

Mismo diseño visual que el export manual del navegador (frontend/src/modules/soporte/reports/), pero con
enfoque informativo: resumen de la gestión y detalle de tickets, sin facturación ni costos. El export manual
de «Informes de soporte» no usa este módulo y conserva su contenido completo.
"""

import io
import re
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor, Twips
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

SIDESOFT_RUC = "1791998081001"
HEADER_IMAGE = Path(__file__).resolve().parents[2] / "assets" / "informe-header.jpg"
_MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]
ACCENT_HEX = "1F4E78"
MUTED_HEX = "4A5568"
GRID_HEX = "D9E2EC"


# --------------------------------------------------------------------------- cálculos comunes

def month_label(d: date) -> str:
    return f"{_MONTHS[d.month - 1]} de {d.year}"


def quito_date_label(d: date) -> str:
    return f"Quito, {d.day} de {_MONTHS[d.month - 1]} del {d.year}"


def hhmm_from_seconds(total_seconds: float) -> str:
    s = max(0, int(total_seconds))
    return f"{s // 3600}:{(s % 3600) // 60:02d}"


def report_filename(project_name: str, ext: str) -> str:
    safe = re.sub(r"[^\w\-]+", "_", project_name.strip().upper(), flags=re.UNICODE).strip("_") or "PROYECTO"
    return f"INFORME_SOPORTE_{safe}.{ext}"


def _long_date(d: date) -> str:
    return f"{d.day} de {_MONTHS[d.month - 1]} de {d.year}"


def _antecedente(project_name: str, report: Dict[str, Any]) -> str:
    period = month_label(date.fromisoformat(report["date_from"]))
    cutoff = _long_date(date.fromisoformat(report["date_to"]))
    return (
        f"En el marco del servicio de SOPORTE TÉCNICO Y MANTENIMIENTO DEL SISTEMA {project_name.upper()}, "
        f"compartimos el detalle de la atención brindada por SIDESOFT durante el periodo {period}, con corte al "
        f"{cutoff}, según los registros de nuestra herramienta de soporte GLPI. Este informe es de carácter "
        "informativo: presenta los tickets reportados y gestionados hasta la fecha, para que su equipo conozca el "
        "estado y el avance de cada requerimiento. No corresponde a un informe final ni de cierre del periodo."
    )


_NOTE = (
    "Nota: Los tiempos presentados corresponden a las tareas registradas en GLPI dentro del periodo indicado y "
    "están expresados en horas y minutos."
)
_RECOMMENDATIONS = [
    "• Se recomienda al usuario cumplir con los procesos correspondientes en cada ventana del sistema.",
    "• Se recomienda dar seguimiento a cada ticket e informar en caso de demoras.",
]
_SUMMARY_LABEL = "Tiempo total invertido en soporte técnico"
_TICKET_HEADERS = ["TICKET", "TITULO", "TIPO", "ESTADO", "SOLICITANTE", "TIEMPO"]


def _ticket_cells(r: Dict[str, Any]) -> List[str]:
    sol = str(r.get("solicitante") or "").strip()
    return [
        str(r.get("id", "")),
        str(r.get("titulo") or ""),
        str(r.get("tipo_solicitud") or ""),
        str(r.get("estado_ticket") or ""),
        sol or "—",
        str(r.get("tiempo_horas_minutos") or ""),
    ]


# --------------------------------------------------------------------------- Word

def _set_cell_borders(cell, color: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tc_pr.append(borders)


def _set_cell_fill(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def _fixed_layout(table) -> None:
    tbl_pr = table._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tbl_pr.append(layout)


def _write_cell(cell, text: str, *, size: float = 10, bold: bool = False, color: Optional[str] = None,
                align=WD_ALIGN_PARAGRAPH.LEFT) -> None:
    p = cell.paragraphs[0]
    p.alignment = align
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def _docx_table(doc, content_width_twips: int, widths_pct: List[int], header: List[str],
                rows: List[List[str]], aligns: List[Any]):
    table = doc.add_table(rows=len(rows) + 1, cols=len(widths_pct))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    _fixed_layout(table)
    widths = [Twips(content_width_twips * w // 100) for w in widths_pct]
    for col_idx, col in enumerate(table.columns):
        col.width = widths[col_idx]
    for i, text in enumerate(header):
        c = table.cell(0, i)
        c.width = widths[i]
        _set_cell_fill(c, ACCENT_HEX)
        _set_cell_borders(c, GRID_HEX)
        _write_cell(c, text, bold=True, color="FFFFFF", align=WD_ALIGN_PARAGRAPH.CENTER)
    for ri, row in enumerate(rows, start=1):
        for ci, text in enumerate(row):
            c = table.cell(ri, ci)
            c.width = widths[ci]
            _set_cell_borders(c, GRID_HEX)
            _write_cell(c, text, align=aligns[ci])
    return table


def _docx_heading(doc, text: str, before: int = 6, after: int = 4) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(before)
    p.paragraph_format.space_after = Pt(after)
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(12)
    r.font.color.rgb = RGBColor.from_string(ACCENT_HEX)


def _docx_text(doc, text: str, *, size: float = 11, bold=False, italic=False, color=None,
               align=WD_ALIGN_PARAGRAPH.LEFT, before: float = 0, after: float = 0) -> None:
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(before)
    p.paragraph_format.space_after = Pt(after)
    r = p.add_run(text)
    r.bold = bold
    r.italic = italic
    r.font.size = Pt(size)
    if color:
        r.font.color.rgb = RGBColor.from_string(color)


def _summary_cells(summary: Dict[str, Any]) -> List[str]:
    t = summary["total"]
    return [_SUMMARY_LABEL, str(t["hours"]), str(t["minutes"]), f"{t['hours']}:{int(t['minutes']):02d}"]


def render_docx(project_name: str, report: Dict[str, Any], issued: date) -> bytes:
    summary = report["summary"]
    rows = report["rows"]
    title_month = month_label(date.fromisoformat(report["date_from"]))

    doc = Document()
    doc.core_properties.author = "GLPI Coordination Dashboard"
    doc.core_properties.title = f"Informe de Soporte {project_name}"
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(0)

    section = doc.sections[0]
    section.page_width = Twips(11906)  # A4
    section.page_height = Twips(16838)
    margin = Twips(900)
    section.top_margin = section.bottom_margin = section.left_margin = section.right_margin = margin
    content_w = 11906 - 2 * 900

    if HEADER_IMAGE.exists():
        hp = section.header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
        hp.paragraph_format.space_after = Pt(6)
        hp.add_run().add_picture(str(HEADER_IMAGE), width=Inches(222 / 96), height=Inches(90 / 96))

    _docx_text(doc, "Informe Servicio de Mantenimiento y Soporte", size=14, bold=True,
               align=WD_ALIGN_PARAGRAPH.CENTER, after=6)
    _docx_text(doc, project_name, size=13, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, after=5)
    _docx_text(doc, quito_date_label(issued), size=11, color=MUTED_HEX, align=WD_ALIGN_PARAGRAPH.CENTER, after=13)

    _docx_heading(doc, "Antecedente:")
    _docx_text(doc, _antecedente(project_name, report), align=WD_ALIGN_PARAGRAPH.JUSTIFY, after=9)

    _docx_heading(doc, f"Resumen general del tiempo aplicado en soporte - {title_month}", after=5)
    C, L = WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT
    _docx_table(doc, content_w, [52, 12, 12, 24], ["Concepto", "Horas", "Minutos", "Total (HH:MM)"],
                [_summary_cells(summary)], [L, C, C, C])

    _docx_heading(doc, f"Detalle de los tickets atendidos - {title_month}", before=7, after=6)
    _docx_table(doc, content_w, [9, 34, 13, 12, 17, 15], _TICKET_HEADERS,
                [_ticket_cells(r) for r in rows], [C, L, C, C, L, C])

    _docx_text(doc, _NOTE, size=10, italic=True, color=MUTED_HEX, before=9, after=6)

    _docx_heading(doc, "Recomendaciones:")
    _docx_text(doc, _RECOMMENDATIONS[0], after=3)
    _docx_text(doc, _RECOMMENDATIONS[1], after=9)
    _docx_text(doc, "Atentamente:", bold=True, before=13)
    _docx_text(doc, "DEPARTAMENTO DE ATENCIÓN AL CLIENTE")
    _docx_text(doc, "SIDESOFT CIA.LTDA.")
    _docx_text(doc, f"RUC: {SIDESOFT_RUC}")

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------- PDF

def render_pdf(project_name: str, report: Dict[str, Any], issued: date) -> bytes:
    summary = report["summary"]
    rows = report["rows"]
    title_month = month_label(date.fromisoformat(report["date_from"]))

    accent = colors.HexColor("#" + ACCENT_HEX)
    muted = colors.HexColor("#" + MUTED_HEX)
    margin = 15 * mm
    content_w = A4[0] - 2 * margin

    st_title = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=13, leading=16, alignment=TA_CENTER,
                              textColor=accent)
    st_sub = ParagraphStyle("s", parent=st_title, fontSize=12, leading=15)
    st_date = ParagraphStyle("d", fontName="Helvetica", fontSize=10, leading=13, alignment=TA_CENTER, textColor=muted)
    st_h = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=accent,
                          spaceBefore=6, spaceAfter=4)
    st_body = ParagraphStyle("b", fontName="Helvetica", fontSize=10, leading=13, alignment=TA_JUSTIFY)
    st_note = ParagraphStyle("n", fontName="Helvetica-Oblique", fontSize=8.5, leading=11, textColor=muted)
    st_cell = ParagraphStyle("c", fontName="Helvetica", fontSize=8, leading=10)
    st_cell_c = ParagraphStyle("cc", parent=st_cell, alignment=TA_CENTER)
    st_tcell = ParagraphStyle("tc", fontName="Helvetica", fontSize=6.5, leading=8)
    st_tcell_c = ParagraphStyle("tcc", parent=st_tcell, alignment=TA_CENTER)
    st_head = ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.white,
                             alignment=TA_CENTER)
    st_thead = ParagraphStyle("tth", parent=st_head, fontSize=7, leading=9)

    def P(text: str, style) -> Paragraph:
        return Paragraph(escape(text), style)

    head_style = [
        ("BACKGROUND", (0, 0), (-1, 0), accent),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#" + GRID_HEX)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]

    story: List[Any] = []
    if HEADER_IMAGE.exists():
        img_w = 45 * mm
        img = Image(str(HEADER_IMAGE), width=img_w, height=img_w * 82 / 203)
        img.hAlign = "LEFT"
        story += [img, Spacer(1, 6 * mm)]
    story += [
        P("Informe Servicio de Mantenimiento y Soporte", st_title),
        Spacer(1, 2 * mm),
        P(project_name, st_sub),
        Spacer(1, 1.5 * mm),
        P(quito_date_label(issued), st_date),
        Spacer(1, 5 * mm),
        P("Antecedente:", st_h),
        P(_antecedente(project_name, report), st_body),
    ]

    summary_data = [[P(h, st_head) for h in ("Concepto", "Horas", "Minutos", "Total (HH:MM)")]]
    c = _summary_cells(summary)
    summary_data.append([P(c[0], st_cell), P(c[1], st_cell_c), P(c[2], st_cell_c), P(c[3], st_cell_c)])
    t_sum = Table(summary_data, colWidths=[content_w * w for w in (0.52, 0.12, 0.12, 0.24)])
    t_sum.setStyle(TableStyle(head_style))
    story.append(KeepTogether([P(f"Resumen general del tiempo aplicado en soporte - {title_month}", st_h), t_sum]))

    ticket_data = [[P(h, st_thead) for h in _TICKET_HEADERS]]
    for r in rows:
        c = _ticket_cells(r)
        ticket_data.append([
            P(c[0], st_tcell_c), P(c[1], st_tcell), P(c[2], st_tcell_c), P(c[3], st_tcell_c),
            P(c[4], st_tcell), P(c[5], st_tcell_c),
        ])
    widths_mm = (14, 72, 22, 18, 28, 26)
    scale = content_w / (sum(widths_mm) * mm)
    t_tk = Table(ticket_data, colWidths=[w * mm * scale for w in widths_mm], repeatRows=1)
    t_tk.setStyle(TableStyle(head_style))
    story += [P(f"Detalle de los tickets atendidos - {title_month}", st_h), t_tk, Spacer(1, 3 * mm),
              P(_NOTE, st_note)]

    story.append(KeepTogether([
        P("Recomendaciones:", st_h),
        P(_RECOMMENDATIONS[0], st_body), Spacer(1, 2 * mm), P(_RECOMMENDATIONS[1], st_body), Spacer(1, 8 * mm),
        P("Atentamente:", ParagraphStyle("a", parent=st_body, fontName="Helvetica-Bold", alignment=TA_LEFT)),
        P("DEPARTAMENTO DE ATENCIÓN AL CLIENTE", st_body),
        P("SIDESOFT CIA.LTDA.", st_body),
        P(f"RUC: {SIDESOFT_RUC}", st_body),
    ]))

    buf = io.BytesIO()
    SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin,
        title=f"Informe de Soporte {project_name}", author="GLPI Coordination Dashboard",
    ).build(story)
    return buf.getvalue()


# --------------------------------------------------------------------------- HTML (cuerpo del correo)

def _h(text: Any) -> str:
    return escape(str(text))


def render_html(project_name: str, report: Dict[str, Any], issued: date, logo_src: str) -> str:
    """
    Informe completo en HTML para el cuerpo del correo (mismo contenido que la vista previa de «Informes de soporte»).
    Solo tablas y estilos en línea: es lo que Outlook y Gmail muestran de forma fiable.
    `logo_src`: «cid:…» para el correo o data URI para la vista previa.
    """
    summary = report["summary"]
    title_month = month_label(date.fromisoformat(report["date_from"]))
    accent, muted, grid = f"#{ACCENT_HEX}", f"#{MUTED_HEX}", f"#{GRID_HEX}"
    cell = f"border:1px solid {grid};padding:6px 8px;vertical-align:top;font-size:13px"
    th = f"border:1px solid {grid};padding:6px 8px;background:{accent};color:#ffffff;font-weight:bold;text-align:center;font-size:13px"

    def heading(text: str) -> str:
        return f'<p style="margin:18px 0 8px;font-weight:bold;color:{accent};font-size:16px">{_h(text)}</p>'

    def table(inner: str) -> str:
        return ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
                f'style="border-collapse:collapse;width:100%;margin-bottom:6px">{inner}</table>')

    sc = _summary_cells(summary)
    sum_rows = (
        f'<tr><td style="{cell}">{_h(sc[0])}</td>'
        + "".join(f'<td style="{cell};text-align:center">{_h(v)}</td>' for v in sc[1:])
        + "</tr>"
    )
    ticket_rows = "".join(
        "<tr>"
        f'<td style="{cell};text-align:center;font-weight:bold">{_h(c[0])}</td>'
        f'<td style="{cell}">{_h(c[1])}</td>'
        f'<td style="{cell};text-align:center">{_h(c[2])}</td>'
        f'<td style="{cell};text-align:center">{_h(c[3])}</td>'
        f'<td style="{cell}">{_h(c[4])}</td>'
        f'<td style="{cell};text-align:center">{_h(c[5])}</td>'
        "</tr>"
        for c in (_ticket_cells(r) for r in report["rows"])
    )

    ticket_head = "".join(
        f'<th style="{th};width:{w}%">{_h(h)}</th>' for h, w in zip(_TICKET_HEADERS, (8, 32, 14, 12, 18, 16))
    )
    return f"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><td align="center" style="padding:8px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="max-width:880px;border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0">
<tr><td style="padding:24px 28px 28px;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.45;color:#1a1a1a">
  <img src="{_h(logo_src)}" alt="SIDESOFT" width="222" style="display:block;width:222px;max-width:55%;height:auto;border:0">
  <p style="text-align:center;font-weight:bold;font-size:18px;margin:12px 0 4px">Informe Servicio de Mantenimiento y Soporte</p>
  <p style="text-align:center;font-weight:bold;font-size:16px;margin:0 0 4px">{_h(project_name)}</p>
  <p style="text-align:center;color:{muted};margin:0 0 16px">{_h(quito_date_label(issued))}</p>
  {heading("Antecedente:")}
  <p style="margin:0 0 12px;text-align:justify">{_h(_antecedente(project_name, report))}</p>
  {heading(f"Resumen general del tiempo aplicado en soporte - {title_month}")}
  {table(f'<tr><th style="{th};text-align:left">Concepto</th><th style="{th}">Horas</th><th style="{th}">Minutos</th>'
         f'<th style="{th}">Total (HH:MM)</th></tr>{sum_rows}')}
  {heading(f"Detalle de los tickets atendidos - {title_month}")}
  {table(f"<tr>{ticket_head}</tr>{ticket_rows}")}
  <p style="margin:10px 0 14px;font-size:13px;color:{muted};font-style:italic">{_h(_NOTE)}</p>
  {heading("Recomendaciones:")}
  <p style="margin:0 0 6px">{_h(_RECOMMENDATIONS[0])}</p>
  <p style="margin:0 0 18px">{_h(_RECOMMENDATIONS[1])}</p>
  <p style="margin:18px 0 2px;font-weight:bold">Atentamente:</p>
  <p style="margin:0">DEPARTAMENTO DE ATENCIÓN AL CLIENTE</p>
  <p style="margin:0">SIDESOFT CIA.LTDA.</p>
  <p style="margin:0">RUC: {SIDESOFT_RUC}</p>
</td></tr></table>
</td></tr></table>"""


def header_image_bytes() -> Optional[bytes]:
    return HEADER_IMAGE.read_bytes() if HEADER_IMAGE.exists() else None
