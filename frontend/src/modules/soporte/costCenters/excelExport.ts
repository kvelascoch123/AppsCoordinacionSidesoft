/** Exportación Excel (.xls SpreadsheetML) sin dependencias externas. */

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Marca una celda decimal (2 decimales). Excel la muestra con el separador del locale. */
export type ExcelDecimal = { readonly __excel: "dec"; value: number };

type CellValue = string | number | ExcelDecimal | null | undefined;

/** Redondea a 2 decimales. */
export function round2(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Celda numérica con 2 decimales. El XML usa punto internamente;
 * Excel (es-EC / es-ES) lo muestra con coma y permite SUMA.
 */
export function excelNum2(v: number | null | undefined): ExcelDecimal {
  return { __excel: "dec", value: round2(v) };
}

function isExcelDecimal(v: CellValue): v is ExcelDecimal {
  return typeof v === "object" && v != null && "__excel" in v && v.__excel === "dec";
}

function cellXml(value: CellValue): string {
  if (value == null || value === "") {
    return `<Cell><Data ss:Type="String"></Data></Cell>`;
  }
  if (isExcelDecimal(value)) {
    return `<Cell ss:StyleID="sDec"><Data ss:Type="Number">${value.value.toFixed(2)}</Data></Cell>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
    }
    const n = round2(value);
    return `<Cell ss:StyleID="sDec"><Data ss:Type="Number">${n.toFixed(2)}</Data></Cell>`;
  }
  const s = String(value);
  if (s === "--") {
    return `<Cell><Data ss:Type="String">--</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escXml(s)}</Data></Cell>`;
}

export type ExcelSheet = {
  name: string;
  headers: string[];
  rows: CellValue[][];
};

function sheetXml(sheet: ExcelSheet): string {
  const name = escXml(sheet.name.slice(0, 31));
  const headerRow = `<Row>${sheet.headers.map((h) => cellXml(h)).join("")}</Row>`;
  const dataRows = sheet.rows
    .map((row) => `<Row>${row.map((c) => cellXml(c)).join("")}</Row>`)
    .join("");
  return `
<Worksheet ss:Name="${name}">
  <Table>
    ${headerRow}
    ${dataRows}
  </Table>
</Worksheet>`;
}

/** Genera un .xls (SpreadsheetML) abierto por Excel / LibreOffice / Sheets. */
export function downloadExcelWorkbook(filename: string, sheets: ExcelSheet[]) {
  const safeName = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="sDec">
   <NumberFormat ss:Format="0.00"/>
  </Style>
 </Styles>
${sheets.map(sheetXml).join("\n")}
</Workbook>`;

  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = safeName;
  a.click();
  URL.revokeObjectURL(a.href);
}
