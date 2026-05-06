/** Tipos KPI compartidos entre `api.ts` y el módulo `coordination/` (evita imports circulares). */

export type IndicatorsSummaryKpisPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  tickets_created_in_range: number;
  tickets_resolved_in_range: number;
  tickets_open_now: number;
};

export type IndicatorsTicketKpiModalRow = {
  ticket_id: number;
  titulo: string | null;
  proyecto: string | null;
  solicitante: string | null;
  actiontime_seconds: number;
  fecha_creacion: string | null;
  estado: string | null;
};

export type IndicatorsTicketKpiModalPayload = {
  date_from: string;
  date_to: string;
  project_type_id: number | null;
  rows: IndicatorsTicketKpiModalRow[];
};

/** @deprecated use IndicatorsTicketKpiModalRow */
export type IndicatorsResolvedInRangeRow = IndicatorsTicketKpiModalRow;

/** @deprecated use IndicatorsTicketKpiModalPayload */
export type IndicatorsResolvedInRangeDetailPayload = IndicatorsTicketKpiModalPayload;
