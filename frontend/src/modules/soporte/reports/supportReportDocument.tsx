import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table as DocxTable,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { saveAs } from "file-saver";
import type { CSSProperties } from "react";
import type { SupportReportPayload, SupportReportRow } from "../../../api";

const SIDESOFT_RUC = "1791998081001";

export function monthLabelForReport(dateIso: string): string {
  const dt = new Date(`${dateIso}T00:00:00`);
  return dt.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
}

export function formatQuitoReportDate(d: Date = new Date()): string {
  const day = d.getDate();
  const month = d.toLocaleDateString("es-EC", { month: "long" });
  const year = d.getFullYear();
  return `Quito, ${day} de ${month} del ${year}`;
}

export function formatMoneyUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

/** Etiqueta larga como en el informe de facturación (pendientes GLPI no restados aquí: el valor es el facturable del periodo). */
export const BILLING_FACTURABLE_ROW_LABEL =
  "Total horas facturables (Total horas facturables – Total Horas tickets pendientes de solución)";

/**
 * Formato del informe de facturación (histórico): parte entera = horas, decimales = minutos (ej. 7.56 = 7 h 56 min).
 * Preferir {@link formatTimeHHMMFromSeconds} en tablas alineado al resumen.
 */
export function formatHoursMinutesAsReportNumber(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}.${String(m).padStart(2, "0")}`;
}

/** Igual que la columna «Total (HH:MM)» del resumen general (p. ej. 15:30). */
export function formatTimeHHMMFromSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Horas en decimal (p. ej. horas de contrato 8,25) → «8:15». */
export function formatTimeHHMMFromDecimalHours(decimalHours: number): string {
  return formatTimeHHMMFromSeconds(Math.round((Math.max(0, Number(decimalHours)) || 0) * 3600));
}

/** Horas consumidas / facturables (decimales), horas contrato y horas a facturar = max(0, facturables − contrato). */
export function computeBillingTotals(totalSeconds: number, facturableSeconds: number, contractHours: number) {
  const totalS = Math.max(0, Math.floor(totalSeconds));
  const factS = Math.max(0, Math.floor(facturableSeconds));
  const contractH = Math.max(0, contractHours);
  const contractSec = Math.round(contractH * 3600);
  const toBillSec = Math.max(0, factS - contractSec);
  return {
    consumedDec: totalS / 3600,
    facturableDec: factS / 3600,
    contractDec: contractH,
    toBillDec: toBillSec / 3600,
    toBillSec,
  };
}

/** Costo: subtotal = horas a facturar (decimales) × tarifa; IVA sobre subtotal. */
export function computeSupportCosts(
  billableDecimalHours: number,
  hourlyRate: number,
  ivaPercent: number,
): {
  hours: number;
  minutes: number;
  decimalHours: number;
  subtotal: number;
  iva: number;
  total: number;
} {
  const rate = Math.max(0, hourlyRate);
  const ivaP = Math.max(0, ivaPercent);
  const dec = Math.max(0, billableDecimalHours);
  const sec = Math.max(0, Math.round(dec * 3600));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const subtotal = dec * rate;
  const iva = subtotal * (ivaP / 100);
  const total = subtotal + iva;
  return { hours, minutes, decimalHours: dec, subtotal, iva, total };
}

function hhmmNoPadHours(h: number, m: number): string {
  return `${h}:${String(m).padStart(2, "0")}`;
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

export async function exportSupportReportDocx(
  report: SupportReportPayload,
  projectName: string,
  draftRows: SupportReportRow[],
  summary: SupportReportPayload["summary"],
  cost: { hourlyRate: number; ivaPercent: number; contractHours: number },
): Promise<void> {
  const titleMonth = monthLabelForReport(report.date_from);
  const billing = computeBillingTotals(summary.total.seconds, summary.facturable.seconds, cost.contractHours);
  const costs = computeSupportCosts(billing.toBillDec, cost.hourlyRate, cost.ivaPercent);

  const makeHeaderCell = (text: string, widthPct: number) =>
    new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: "1F4E78" },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })],
        }),
      ],
    });

  type Align = (typeof AlignmentType)[keyof typeof AlignmentType];
  const makeDataCell = (text: string, widthPct: number, align: Align = AlignmentType.LEFT) =>
    new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        left: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
        right: { style: BorderStyle.SINGLE, size: 1, color: "D9E2EC" },
      },
      children: [
        new Paragraph({
          alignment: align,
          children: [new TextRun({ text, size: 20 })],
        }),
      ],
    });

  const billBorder = {
    top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  };
  const makeBillRow = (label: string, value: string, rowBold = false) =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 72, type: WidthType.PERCENTAGE },
          borders: billBorder,
          children: [
            new Paragraph({
              children: [new TextRun({ text: label, bold: rowBold, size: rowBold ? 22 : 20 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 28, type: WidthType.PERCENTAGE },
          borders: billBorder,
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: value, bold: rowBold, size: 22 })],
            }),
          ],
        }),
      ],
    });

  const billingDetailRows = [
    makeBillRow("Total horas consumidas", formatTimeHHMMFromSeconds(summary.total.seconds)),
    makeBillRow(BILLING_FACTURABLE_ROW_LABEL, formatTimeHHMMFromSeconds(summary.facturable.seconds)),
    makeBillRow("Total horas contrato", formatTimeHHMMFromDecimalHours(billing.contractDec)),
    makeBillRow("Total horas a facturar", formatTimeHHMMFromSeconds(billing.toBillSec), true),
  ];

  const costServiceRows = [
    makeBillRow(
      `Total Horas Soporte Facturable: ${costs.hours} Horas ${costs.minutes} Minutos`,
      formatMoneyUsd(costs.subtotal),
    ),
    makeBillRow("SUBTOTAL", formatMoneyUsd(costs.subtotal), true),
    makeBillRow(`IVA (${cost.ivaPercent}%)`, formatMoneyUsd(costs.iva), true),
    makeBillRow("TOTAL", formatMoneyUsd(costs.total), true),
  ];

  const summaryRows = [
    new TableRow({
      children: [
        makeHeaderCell("Concepto", 52),
        makeHeaderCell("Horas", 12),
        makeHeaderCell("Minutos", 12),
        makeHeaderCell("Total (HH:MM)", 24),
      ],
    }),
    new TableRow({
      children: [
        makeDataCell("Tiempo total invertido en soporte técnico", 52, AlignmentType.LEFT),
        makeDataCell(String(summary.total.hours), 12, AlignmentType.CENTER),
        makeDataCell(String(summary.total.minutes), 12, AlignmentType.CENTER),
        makeDataCell(hhmmNoPadHours(summary.total.hours, summary.total.minutes), 24, AlignmentType.CENTER),
      ],
    }),
    new TableRow({
      children: [
        makeDataCell("Tiempo facturable (Soporte, Error Usuario, Configuración, Facturable)", 52, AlignmentType.LEFT),
        makeDataCell(String(summary.facturable.hours), 12, AlignmentType.CENTER),
        makeDataCell(String(summary.facturable.minutes), 12, AlignmentType.CENTER),
        makeDataCell(hhmmNoPadHours(summary.facturable.hours, summary.facturable.minutes), 24, AlignmentType.CENTER),
      ],
    }),
    new TableRow({
      children: [
        makeDataCell("Tiempo no facturable (Desarrollo, Sistema - Bug, Garantía)", 52, AlignmentType.LEFT),
        makeDataCell(String(summary.no_facturable.hours), 12, AlignmentType.CENTER),
        makeDataCell(String(summary.no_facturable.minutes), 12, AlignmentType.CENTER),
        makeDataCell(hhmmNoPadHours(summary.no_facturable.hours, summary.no_facturable.minutes), 24, AlignmentType.CENTER),
      ],
    }),
  ];

  const ticketRows = [
    new TableRow({
      children: [
        makeHeaderCell("TICKET", 9),
        makeHeaderCell("TITULO", 34),
        makeHeaderCell("TIPO", 13),
        makeHeaderCell("ESTADO", 12),
        makeHeaderCell("SOLICITANTE", 17),
        makeHeaderCell("TIEMPO", 15),
      ],
    }),
    ...draftRows.map(
      (r) =>
        new TableRow({
          children: [
            makeDataCell(String(r.id), 9, AlignmentType.CENTER),
            makeDataCell(String(r.titulo || ""), 34, AlignmentType.LEFT),
            makeDataCell(String(r.tipo_solicitud || ""), 13, AlignmentType.CENTER),
            makeDataCell(String(r.estado_ticket || ""), 12, AlignmentType.CENTER),
            makeDataCell(String(r.solicitante || "—"), 17, AlignmentType.LEFT),
            makeDataCell(String(r.tiempo_horas_minutos || ""), 15, AlignmentType.CENTER),
          ],
        }),
    ),
  ];

  const assetBase = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  const headerImage = await loadPublicImage(`${assetBase}informe-header.jpg`);
  const headerChildren: Paragraph[] = [];
  /** Cabecera: imagen más pequeña, esquina superior izquierda (alineación del párrafo). */
  const headerImgW = 222;
  const headerImgH = 90;
  if (headerImage) {
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 120 },
        children: [
          new ImageRun({
            data: headerImage,
            type: "jpg",
            transformation: { width: headerImgW, height: headerImgH },
          }),
        ],
      }),
    );
  }

  const antecedenteBody =
    `En relación al SOPORTE TÉCNICO Y MANTENIMIENTO PARA EL SISTEMA ${projectName.toUpperCase()}, se emite el informe de las horas de atención de soporte técnico registrados en la herramienta GLPI, con respecto al periodo ${titleMonth}. Que han sido resueltos dentro del proceso y tiempo establecido, con las novedades registradas en la herramienta de GLPI, herramienta de soporte proporcionada por SIDESOFT.`;

  const doc = new Document({
    creator: "GLPI Coordination Dashboard",
    description: "Informe profesional de soporte",
    title: `Informe de Soporte ${projectName}`,
    sections: [
      {
        properties: {
          page: {
            margin: { top: 900, bottom: 900, left: 900, right: 900 },
          },
        },
        headers: {
          default: new Header({
            children: headerChildren.length ? headerChildren : [new Paragraph({})],
          }),
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: "Informe Servicio de Mantenimiento y Soporte",
                bold: true,
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: projectName, bold: true, size: 26 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 260 },
            children: [new TextRun({ text: formatQuitoReportDate(), size: 22, color: "4A5568" })],
          }),
          new Paragraph({
            spacing: { before: 120, after: 80 },
            children: [new TextRun({ text: "Antecedente:", bold: true, color: "1F4E78", size: 24 })],
          }),
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 180 },
            children: [new TextRun({ text: antecedenteBody, size: 22 })],
          }),
          new Paragraph({
            spacing: { before: 120, after: 100 },
            children: [
              new TextRun({
                text: `Resumen general del tiempo aplicado en soporte - ${titleMonth}`,
                bold: true,
                color: "1F4E78",
                size: 24,
              }),
            ],
          }),
          new DocxTable({
            rows: summaryRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
          }),
          new Paragraph({
            spacing: { before: 140, after: 120 },
            children: [
              new TextRun({
                text: `Detalle de los tickets atendidos - ${titleMonth}`,
                bold: true,
                color: "1F4E78",
                size: 24,
              }),
            ],
          }),
          new DocxTable({
            rows: ticketRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
          }),
          new Paragraph({
            spacing: { before: 180, after: 120 },
            children: [
              new TextRun({
                text: "Nota: Los tiempos presentados corresponden a registros en GLPI dentro del periodo seleccionado. Los valores están expresados en horas y minutos para facilitar la verificación y cálculo de costos.",
                size: 20,
                color: "4A5568",
                italics: true,
              }),
            ],
          }),
          new Paragraph({
            spacing: { before: 120, after: 80 },
            children: [new TextRun({ text: "Detalle Facturación de Horas:", bold: true, color: "1F4E78", size: 24 })],
          }),
          new DocxTable({
            rows: billingDetailRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
          }),
          new Paragraph({
            spacing: { before: 120, after: 80 },
            children: [new TextRun({ text: "Costo de Servicio", bold: true, color: "1F4E78", size: 24 })],
          }),
          new DocxTable({
            rows: costServiceRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
          }),
          new Paragraph({ spacing: { after: 120 }, children: [] }),
          new Paragraph({
            spacing: { before: 120, after: 80 },
            children: [new TextRun({ text: "Recomendaciones:", bold: true, color: "1F4E78", size: 24 })],
          }),
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({
                text: "• Se recomienda al usuario cumplir con los procesos correspondientes en cada ventana del sistema.",
                size: 22,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 180 },
            children: [
              new TextRun({
                text: "• Se recomienda dar seguimiento a cada ticket e informar en caso de demoras.",
                size: 22,
              }),
            ],
          }),
          new Paragraph({ spacing: { before: 260 }, children: [new TextRun({ text: "Atentamente:", bold: true, size: 22 })] }),
          new Paragraph({ children: [new TextRun({ text: "DEPARTAMENTO DE ATENCIÓN AL CLIENTE", size: 22 })] }),
          new Paragraph({ children: [new TextRun({ text: "SIDESOFT CIA.LTDA.", size: 22 })] }),
          new Paragraph({ children: [new TextRun({ text: `RUC: ${SIDESOFT_RUC}`, size: 22 })] }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `INFORME_SOPORTE_${projectName.replace(/\s+/g, "_").toUpperCase()}.docx`);
}

type SummaryPart = SupportReportPayload["summary"]["total"];

export function SupportReportPrintPreview({
  projectName,
  dateFromIso,
  summary,
  rows,
  contractHoursStr,
  onContractHoursChange,
  hourlyRateStr,
  ivaPercentStr,
  onHourlyRateChange,
  onIvaPercentChange,
}: {
  projectName: string;
  dateFromIso: string;
  summary: { total: SummaryPart; facturable: SummaryPart; no_facturable: SummaryPart };
  rows: SupportReportRow[];
  contractHoursStr: string;
  onContractHoursChange: (v: string) => void;
  hourlyRateStr: string;
  ivaPercentStr: string;
  onHourlyRateChange: (v: string) => void;
  onIvaPercentChange: (v: string) => void;
}) {
  const titleMonth = monthLabelForReport(dateFromIso);
  const contractH = parseFloat(contractHoursStr.replace(",", ".")) || 0;
  const billing = computeBillingTotals(summary.total.seconds, summary.facturable.seconds, contractH);
  const hourly = parseFloat(hourlyRateStr.replace(",", ".")) || 0;
  const ivaPct = parseFloat(ivaPercentStr.replace(",", ".")) || 0;
  const costs = computeSupportCosts(billing.toBillDec, hourly, ivaPct);

  const antecedenteBody =
    `En relación al SOPORTE TÉCNICO Y MANTENIMIENTO PARA EL SISTEMA ${projectName.toUpperCase()}, se emite el informe de las horas de atención de soporte técnico registrados en la herramienta GLPI, con respecto al periodo ${titleMonth}. Que han sido resueltos dentro del proceso y tiempo establecido, con las novedades registradas en la herramienta de GLPI, herramienta de soporte proporcionada por SIDESOFT.`;

  const paper: CSSProperties = {
    maxWidth: 880,
    margin: "0 auto",
    background: "#fff",
    color: "#1a1a1a",
    padding: "2rem 2.25rem 2.5rem",
    borderRadius: 2,
    boxShadow: "0 1px 6px rgba(0,0,0,0.12)",
    fontFamily: 'Calibri, "Segoe UI", system-ui, sans-serif',
    fontSize: "11pt",
    lineHeight: 1.45,
  };

  const h = (text: string) => (
    <p style={{ margin: "1.1rem 0 0.5rem", fontWeight: 700, color: "#1F4E78", fontSize: "1.05rem" }}>{text}</p>
  );

  const cellStyle: CSSProperties = { border: "1px solid #d9e2ec", padding: "6px 8px", verticalAlign: "top" };
  const thStyle: CSSProperties = {
    ...cellStyle,
    background: "#1F4E78",
    color: "#fff",
    fontWeight: 700,
    textAlign: "center",
  };
  const billCell: CSSProperties = { border: "1px solid #000", padding: "8px 10px", verticalAlign: "middle" };
  const billVal: CSSProperties = { ...billCell, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={paper}>
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.5rem" }}>
        <img
          src={`${(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/")}informe-header.jpg`}
          alt=""
          style={{ width: 222, maxWidth: "55%", height: "auto", display: "block" }}
        />
      </div>
      <p style={{ textAlign: "center", fontWeight: 700, fontSize: "1.15rem", margin: "0.75rem 0 0.35rem" }}>
        Informe Servicio de Mantenimiento y Soporte
      </p>
      <p style={{ textAlign: "center", fontWeight: 700, fontSize: "1.05rem", margin: "0 0 0.35rem" }}>{projectName}</p>
      <p style={{ textAlign: "center", color: "#4a5568", margin: "0 0 1.25rem" }}>{formatQuitoReportDate()}</p>

      {h("Antecedente:")}
      <p style={{ margin: "0 0 1rem", textAlign: "justify" }}>{antecedenteBody}</p>

      {h(`Resumen general del tiempo aplicado en soporte - ${titleMonth}`)}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1.25rem", fontSize: "0.92rem" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left" }}>Concepto</th>
            <th style={thStyle}>Horas</th>
            <th style={thStyle}>Minutos</th>
            <th style={thStyle}>Total (HH:MM)</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["Tiempo total invertido en soporte técnico", summary.total],
              ["Tiempo facturable (Soporte, Error Usuario, Configuración, Facturable)", summary.facturable],
              ["Tiempo no facturable (Desarrollo, Sistema - Bug, Garantía)", summary.no_facturable],
            ] as const
          ).map(([label, s]) => (
            <tr key={label}>
              <td style={cellStyle}>{label}</td>
              <td style={{ ...cellStyle, textAlign: "center" }}>{s.hours}</td>
              <td style={{ ...cellStyle, textAlign: "center" }}>{s.minutes}</td>
              <td style={{ ...cellStyle, textAlign: "center" }}>{hhmmNoPadHours(s.hours, s.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {h(`Detalle de los tickets atendidos - ${titleMonth}`)}
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          overflowX: "auto",
          maxHeight: 320,
          marginBottom: "1rem",
          border: "1px solid #d9e2ec",
        }}
      >
        <table
          style={{
            width: "100%",
            minWidth: "100%",
            borderCollapse: "collapse",
            fontSize: "0.88rem",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: "8%" }} />
            <col style={{ width: "32%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              {["TICKET", "TITULO", "TIPO", "ESTADO", "SOLICITANTE", "TIEMPO"].map((c) => (
                <th key={c} style={thStyle}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...cellStyle, textAlign: "center", fontWeight: 600 }}>{r.id}</td>
                <td style={{ ...cellStyle, wordBreak: "break-word" }}>{r.titulo ?? "—"}</td>
                <td style={{ ...cellStyle, textAlign: "center" }}>{r.tipo_solicitud ?? "—"}</td>
                <td style={{ ...cellStyle, textAlign: "center" }}>{r.estado_ticket ?? "—"}</td>
                <td style={cellStyle}>{r.solicitante?.trim() ? r.solicitante : "—"}</td>
                <td style={{ ...cellStyle, textAlign: "center" }}>{r.tiempo_horas_minutos ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "#4a5568", fontStyle: "italic" }}>
        Nota: Los tiempos presentados corresponden a registros en GLPI dentro del periodo seleccionado. Los valores están expresados en
        horas y minutos para facilitar la verificación y cálculo de costos.
      </p>

      {h("Detalle Facturación de Horas:")}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "0.5rem", fontSize: "0.92rem" }}>
        <tbody>
          <tr>
            <td style={billCell}>Total horas consumidas</td>
            <td style={billVal}>{formatTimeHHMMFromSeconds(summary.total.seconds)}</td>
          </tr>
          <tr>
            <td style={billCell}>{BILLING_FACTURABLE_ROW_LABEL}</td>
            <td style={billVal}>{formatTimeHHMMFromSeconds(summary.facturable.seconds)}</td>
          </tr>
          <tr>
            <td style={billCell}>Total horas contrato</td>
            <td style={{ ...billVal, padding: "4px 8px" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                }}
              >
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={contractHoursStr}
                  onChange={(e) => onContractHoursChange(e.target.value)}
                  style={{
                    minWidth: "5rem",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    textAlign: "right",
                    padding: "0.35rem 0.45rem",
                    borderRadius: 4,
                    border: "1px solid #cbd5e0",
                    fontSize: "0.95rem",
                  }}
                />
                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  = {formatTimeHHMMFromDecimalHours(contractH)}
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td style={{ ...billCell, fontWeight: 700 }}>Total horas a facturar</td>
            <td style={{ ...billVal, fontWeight: 700 }}>{formatTimeHHMMFromSeconds(billing.toBillSec)}</td>
          </tr>
        </tbody>
      </table>
      <p style={{ margin: "0 0 1.1rem", fontSize: "0.82rem", color: "#4a5568" }}>
        Los valores de esta tabla usan el mismo formato horas:minutos (HH:MM) que el resumen general. El costo de servicio multiplica
        la tarifa por las horas decimales reales de «horas a facturar».
      </p>

      {h("Costo de Servicio")}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.65rem",
          marginBottom: "0.85rem",
          padding: "0.75rem",
          background: "#f7fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.82rem", color: "#4a5568" }}>
          Valor por hora (USD)
          <input
            type="number"
            min={0}
            step="0.01"
            value={hourlyRateStr}
            onChange={(e) => onHourlyRateChange(e.target.value)}
            style={{
              padding: "0.4rem 0.5rem",
              borderRadius: 4,
              border: "1px solid #cbd5e0",
              fontSize: "0.95rem",
            }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.82rem", color: "#4a5568" }}>
          IVA (%)
          <input
            type="number"
            min={0}
            step="0.1"
            value={ivaPercentStr}
            onChange={(e) => onIvaPercentChange(e.target.value)}
            style={{
              padding: "0.4rem 0.5rem",
              borderRadius: 4,
              border: "1px solid #cbd5e0",
              fontSize: "0.95rem",
            }}
          />
        </label>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1.25rem", fontSize: "0.92rem" }}>
        <tbody>
          <tr>
            <td style={billCell}>
              Total Horas Soporte Facturable: {costs.hours} Horas {costs.minutes} Minutos
            </td>
            <td style={billVal}>{formatMoneyUsd(costs.subtotal)}</td>
          </tr>
          <tr>
            <td style={{ ...billCell, fontWeight: 700 }}>SUBTOTAL</td>
            <td style={{ ...billVal, fontWeight: 700 }}>{formatMoneyUsd(costs.subtotal)}</td>
          </tr>
          <tr>
            <td style={{ ...billCell, fontWeight: 700 }}>IVA ({ivaPct}%)</td>
            <td style={{ ...billVal, fontWeight: 700 }}>{formatMoneyUsd(costs.iva)}</td>
          </tr>
          <tr>
            <td style={{ ...billCell, fontWeight: 700 }}>TOTAL</td>
            <td style={{ ...billVal, fontWeight: 700 }}>{formatMoneyUsd(costs.total)}</td>
          </tr>
        </tbody>
      </table>

      {h("Recomendaciones:")}
      <ul style={{ margin: "0 0 1.25rem", paddingLeft: "1.25rem" }}>
        <li style={{ marginBottom: "0.35rem" }}>
          Se recomienda al usuario cumplir con los procesos correspondientes en cada ventana del sistema.
        </li>
        <li>Se recomienda dar seguimiento a cada ticket e informar en caso de demoras.</li>
      </ul>

      <p style={{ margin: "1.5rem 0 0.25rem", fontWeight: 700 }}>Atentamente:</p>
      <p style={{ margin: 0 }}>DEPARTAMENTO DE ATENCIÓN AL CLIENTE</p>
      <p style={{ margin: 0 }}>SIDESOFT CIA.LTDA.</p>
      <p style={{ margin: 0 }}>RUC: {SIDESOFT_RUC}</p>
    </div>
  );
}
