const DEFAULT_LABEL = "#212529";
const DEFAULT_RANGE = "#6c757d";

/** Rango legible (es-EC) entre dos fechas `YYYY-MM-DD` (semana ISO: lunes–domingo). */
export function formatIsoWeekRangeEs(isoStart: string, isoEnd: string): string {
  const s = isoStart?.trim();
  const e = isoEnd?.trim();
  if (!s || !e) return "";
  const opt: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
  const a = new Date(`${s}T12:00:00`);
  const b = new Date(`${e}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  return `${a.toLocaleDateString("es-EC", opt)} – ${b.toLocaleDateString("es-EC", opt)}`;
}

export type IsoWeekAxisRow = {
  chartLabel?: string;
  period_label?: string;
  week_period_start?: string;
  week_period_end?: string;
};

export type IsoWeekAxisTickProps = {
  x?: number;
  y?: number;
  payload?: { value?: string | number; index?: number };
  rows: ReadonlyArray<IsoWeekAxisRow>;
  labelFill?: string;
  rangeFill?: string;
};

/** Etiqueta de eje X en dos líneas: período ISO y debajo el rango calendario (rotación -28° como antes). */
export function IsoWeekAxisTick({
  x = 0,
  y = 0,
  payload,
  rows,
  labelFill = DEFAULT_LABEL,
  rangeFill = DEFAULT_RANGE,
}: IsoWeekAxisTickProps) {
  const labelVal = payload?.value != null ? String(payload.value) : "";
  let row: IsoWeekAxisRow | undefined;
  const ix = typeof payload?.index === "number" ? payload.index : -1;
  if (ix >= 0 && ix < rows.length) row = rows[ix];
  if (!row && labelVal) {
    const j = rows.findIndex((r) => String(r.chartLabel ?? r.period_label ?? "") === labelVal);
    if (j >= 0) row = rows[j];
  }
  const label = labelVal || String(row?.chartLabel ?? row?.period_label ?? "");
  const range = formatIsoWeekRangeEs(String(row?.week_period_start ?? ""), String(row?.week_period_end ?? ""));
  return (
    <g transform={`translate(${x},${y}) rotate(-28)`}>
      <text textAnchor="end" fill={labelFill} fontSize={10}>
        <tspan x={0} dy={0}>
          {label}
        </tspan>
        {range ? (
          <tspan x={0} dy={12} fill={rangeFill} fontSize={9}>
            {range}
          </tspan>
        ) : null}
      </text>
    </g>
  );
}
