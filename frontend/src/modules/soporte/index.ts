/**
 * Módulo **Soporte**: indicadores de coordinación GLPI, problemas de soporte en indicadores,
 * informes DOCX/PDF de soporte y utilidades de gráficos ISO usadas por esas vistas.
 *
 * El menú principal (`App.tsx`) sigue orquestando páginas; este barrel facilita imports desde `modules/soporte`.
 */
export {
  CoordIndicatorsPage,
  CoordIndicatorsSection,
  type CoordIndicatorsPageProps,
} from "./coordination";
export type {
  CoordinationBucketDetailPayload,
  CoordinationSummaryKpisPayload,
  CoordinationTicketBucketKind,
  CoordinationWeeklyAssigneePerformancePayload,
  CoordinationWeeklyAssigneeRow,
  CoordinationWeeklyAssigneeSeriesItem,
  CoordinationWeeklyAssigneeWeekBlock,
  CoordinationWeeklyEvolutionPayload,
  CoordinationWeeklyEvolutionRow,
  CoordinationWeeklyRequestTypeRow,
  CoordinationWeeklyTicketsByRequestTypePayload,
  CoordinationWeeklyRtDetailPayload,
} from "./coordination/api";
export {
  fetchCoordinationSummaryKpis,
  fetchCoordinationTicketBucketDetail,
  fetchCoordinationTicketsOutOfSlaDetail,
  fetchCoordinationWeeklyAssigneePerformance,
  fetchCoordinationWeeklyEvolution,
  fetchCoordinationWeeklyTicketsByRequestType,
  fetchCoordinationWeeklyTicketsByRequestTypeDetail,
} from "./coordination/api";
export {
  ProblemsSupportIndicatorsSection,
  type ProblemsSupportIndicatorsSectionProps,
} from "./components/ProblemsSupportIndicatorsSection";
export {
  exportSupportReportDocx,
  SupportReportPrintPreview,
  monthLabelForReport,
  formatQuitoReportDate,
  formatMoneyUsd,
} from "./reports/supportReportDocument";
export { exportSupportReportPdf } from "./reports/supportReportPdf";
export { formatIsoWeekRangeEs, IsoWeekAxisTick } from "./chartIsoWeekAxis";
