import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { saveAs } from "file-saver";
import type { SupportReportPayload, SupportReportRow } from "./api";
import {
  BILLING_FACTURABLE_ROW_LABEL,
  computeBillingTotals,
  computeSupportCosts,
  formatMoneyUsd,
  formatQuitoReportDate,
  formatTimeHHMMFromDecimalHours,
  formatTimeHHMMFromSeconds,
  monthLabelForReport,
} from "./supportReportDocument";

const SIDESOFT_RUC = "1791998081001";
const ACCENT_RGB: [number, number, number] = [31, 78, 120];

function uint8ToBase64(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + chunk)) as number[]);
  }
  return btoa(binary);
}

async function loadPublicImage(path: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function hhmmNoPadHours(h: number, m: number): string {
  return `${h}:${String(m).padStart(2, "0")}`;
}

function lastTableY(doc: jsPDF): number {
  const d = doc as jsPDF & { lastAutoTable?: { finalY: number } };
  return d.lastAutoTable?.finalY ?? 20;
}

/** Si no cabe `needMm` desde `y` hasta el pie útil, nueva página y `y = margin`. */
function reserveVerticalSpace(doc: jsPDF, y: number, margin: number, needMm: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  const bottom = pageH - margin;
  if (y + needMm > bottom) {
    doc.addPage();
    return margin;
  }
  return y;
}

const tableMargin = { top: 15, right: 15, bottom: 15, left: 15 };

export async function exportSupportReportPdf(
  report: SupportReportPayload,
  projectName: string,
  draftRows: SupportReportRow[],
  summary: SupportReportPayload["summary"],
  cost: { hourlyRate: number; ivaPercent: number; contractHours: number },
): Promise<void> {
  const titleMonth = monthLabelForReport(report.date_from);
  const billing = computeBillingTotals(summary.total.seconds, summary.facturable.seconds, cost.contractHours);
  const costs = computeSupportCosts(billing.toBillDec, cost.hourlyRate, cost.ivaPercent);

  const antecedenteBody =
    `En relación al SOPORTE TÉCNICO Y MANTENIMIENTO PARA EL SISTEMA ${projectName.toUpperCase()}, se emite el informe de las horas de atención de soporte técnico registrados en la herramienta GLPI, con respecto al periodo ${titleMonth}. Que han sido resueltos dentro del proceso y tiempo establecido, con las novedades registradas en la herramienta de GLPI, herramienta de soporte proporcionada por SIDESOFT.`;

  const margin = 15;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - 2 * margin;
  let y = margin;

  const assetBase = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  const headerBytes = await loadPublicImage(`${assetBase}informe-header.jpg`);
  if (headerBytes) {
    const imgW = 45;
    const imgH = (imgW * 82) / 203;
    const b64 = uint8ToBase64(headerBytes);
    doc.addImage(`data:image/jpeg;base64,${b64}`, "JPEG", margin, y, imgW, imgH);
    y += imgH + 6;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...ACCENT_RGB);
  doc.text("Informe Servicio de Mantenimiento y Soporte", pageW / 2, y, { align: "center" });
  y += 7;
  doc.setFontSize(12);
  doc.text(projectName, pageW / 2, y, { align: "center" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(74, 85, 104);
  doc.text(formatQuitoReportDate(), pageW / 2, y, { align: "center" });
  y += 10;
  doc.setTextColor(...ACCENT_RGB);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Antecedente:", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  const anteLines = doc.splitTextToSize(antecedenteBody, contentW);
  doc.text(anteLines, margin, y, { maxWidth: contentW, align: "justify" });
  y += anteLines.length * 5 + 6;

  y = reserveVerticalSpace(doc, y, margin, 48);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT_RGB);
  doc.text(`Resumen general del tiempo aplicado en soporte - ${titleMonth}`, margin, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Concepto", "Horas", "Minutos", "Total (HH:MM)"]],
    body: [
      [
        "Tiempo total invertido en soporte técnico",
        String(summary.total.hours),
        String(summary.total.minutes),
        hhmmNoPadHours(summary.total.hours, summary.total.minutes),
      ],
      [
        "Tiempo facturable (Soporte, Error Usuario, Configuración, Facturable)",
        String(summary.facturable.hours),
        String(summary.facturable.minutes),
        hhmmNoPadHours(summary.facturable.hours, summary.facturable.minutes),
      ],
      [
        "Tiempo no facturable (Desarrollo, Sistema - Bug, Garantía)",
        String(summary.no_facturable.hours),
        String(summary.no_facturable.minutes),
        hhmmNoPadHours(summary.no_facturable.hours, summary.no_facturable.minutes),
      ],
    ],
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: ACCENT_RGB, textColor: 255, fontStyle: "bold" },
    margin: tableMargin,
    tableWidth: contentW,
    rowPageBreak: "avoid",
  });
  y = lastTableY(doc) + 8;

  y = reserveVerticalSpace(doc, y, margin, 28);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT_RGB);
  doc.text(`Detalle de los tickets atendidos - ${titleMonth}`, margin, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["TICKET", "TITULO", "TIPO", "ESTADO", "SOLICITANTE", "TIEMPO"]],
    body: draftRows.map((r) => [
      String(r.id),
      String(r.titulo || ""),
      String(r.tipo_solicitud || ""),
      String(r.estado_ticket || ""),
      String(r.solicitante?.trim() ? r.solicitante : "—"),
      String(r.tiempo_horas_minutos || ""),
    ]),
    styles: { fontSize: 6.5, cellPadding: 1, overflow: "linebreak" },
    headStyles: { fillColor: ACCENT_RGB, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 72 },
      2: { cellWidth: 22 },
      3: { cellWidth: 18 },
      4: { cellWidth: 28 },
      5: { cellWidth: 26 },
    },
    margin: tableMargin,
    tableWidth: contentW,
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });
  y = lastTableY(doc) + 6;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(74, 85, 104);
  const note =
    "Nota: Los tiempos presentados corresponden a registros en GLPI dentro del periodo seleccionado. Los valores están expresados en horas y minutos para facilitar la verificación y cálculo de costos.";
  const noteLines = doc.splitTextToSize(note, contentW);
  doc.text(noteLines, margin, y);
  y += noteLines.length * 4 + 8;

  /* Título + tabla facturación (filas altas por texto largo): evitar título huérfano al pie de página */
  y = reserveVerticalSpace(doc, y, margin, 62);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT_RGB);
  doc.text("Detalle Facturación de Horas:", margin, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    body: [
      ["Total horas consumidas", formatTimeHHMMFromSeconds(summary.total.seconds)],
      [BILLING_FACTURABLE_ROW_LABEL, formatTimeHHMMFromSeconds(summary.facturable.seconds)],
      ["Total horas contrato", formatTimeHHMMFromDecimalHours(billing.contractDec)],
      ["Total horas a facturar", formatTimeHHMMFromSeconds(billing.toBillSec)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: contentW * 0.72 }, 1: { halign: "right", fontStyle: "bold" } },
    bodyStyles: { lineWidth: 0.1, lineColor: [0, 0, 0] },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === 3) {
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: tableMargin,
    tableWidth: contentW,
    rowPageBreak: "avoid",
  });
  y = lastTableY(doc) + 8;

  y = reserveVerticalSpace(doc, y, margin, 58);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT_RGB);
  doc.text("Costo de Servicio", margin, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    body: [
      [
        `Total Horas Soporte Facturable: ${costs.hours} Horas ${costs.minutes} Minutos`,
        formatMoneyUsd(costs.subtotal),
      ],
      ["SUBTOTAL", formatMoneyUsd(costs.subtotal)],
      [`IVA (${cost.ivaPercent}%)`, formatMoneyUsd(costs.iva)],
      ["TOTAL", formatMoneyUsd(costs.total)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: contentW * 0.72 }, 1: { halign: "right", fontStyle: "bold" } },
    bodyStyles: { lineWidth: 0.1, lineColor: [0, 0, 0] },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index > 0) {
        data.cell.styles.fontStyle = "bold";
      }
    },
    margin: tableMargin,
    tableWidth: contentW,
    rowPageBreak: "avoid",
  });
  y = lastTableY(doc) + 10;

  y = reserveVerticalSpace(doc, y, margin, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT_RGB);
  doc.text("Recomendaciones:", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  const rec1 = "• Se recomienda al usuario cumplir con los procesos correspondientes en cada ventana del sistema.";
  const rec2 = "• Se recomienda dar seguimiento a cada ticket e informar en caso de demoras.";
  doc.text(doc.splitTextToSize(rec1, contentW), margin, y);
  y += 12;
  doc.text(doc.splitTextToSize(rec2, contentW), margin, y);
  y += 14;

  y = reserveVerticalSpace(doc, y, margin, 32);
  doc.setFont("helvetica", "bold");
  doc.text("Atentamente:", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.text("DEPARTAMENTO DE ATENCIÓN AL CLIENTE", margin, y);
  y += 5;
  doc.text("SIDESOFT CIA.LTDA.", margin, y);
  y += 5;
  doc.text(`RUC: ${SIDESOFT_RUC}`, margin, y);

  const blob = doc.output("blob");
  saveAs(blob, `INFORME_SOPORTE_${projectName.replace(/\s+/g, "_").toUpperCase()}.pdf`);
}
