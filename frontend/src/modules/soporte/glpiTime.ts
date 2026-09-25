/**
 * Formato GLPI H.MM: parte entera = horas, decimales = minutos (ej. 0.50 = 50 min).
 */

export function parseGlpiHmToSeconds(value: number | string | null | undefined): number {
  const val = typeof value === "string" ? Number.parseFloat(value.trim()) : Number(value);
  if (!Number.isFinite(val) || val < 0) return 0;
  const hours = Math.floor(val);
  const minutes = Math.round((val - hours) * 100);
  return hours * 3600 + minutes * 60;
}

export function formatSecondsAsHhMm(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function formatGlpiHmRaw(value: number | string | null | undefined): string {
  return formatSecondsAsHhMm(parseGlpiHmToSeconds(value));
}

export function formatDecimalHoursAsHhMm(decimalHours: number | null | undefined): string {
  if (decimalHours == null || !Number.isFinite(decimalHours)) return "—";
  return formatSecondsAsHhMm(Math.round(decimalHours * 3600));
}

export function formatSignedSecondsAsHhMm(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const sign = totalSeconds > 0 ? "+" : totalSeconds < 0 ? "−" : "";
  return `${sign}${formatSecondsAsHhMm(Math.abs(totalSeconds))}`;
}

export function formatSignedDecimalHoursAsHhMm(decimalHours: number | null | undefined): string {
  if (decimalHours == null || !Number.isFinite(decimalHours)) return "—";
  return formatSignedSecondsAsHhMm(Math.round(decimalHours * 3600));
}
