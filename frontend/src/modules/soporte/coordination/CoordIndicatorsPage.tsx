import { useCallback, useEffect, useState } from "react";

import type { ProjectType, IndicatorsProblemsSupportPayload, SupportProject } from "../../../api";
import { fetchIndicatorsProblemsSupport, fetchSupportProjects } from "../../../api";
import {
  fetchCoordinationSummaryKpis,
  fetchCoordinationWeeklyAssigneePerformance,
  fetchCoordinationWeeklyEvolution,
  fetchCoordinationWeeklyTechnicianEvolution,
  fetchCoordinationWeeklyTicketsByRequestType,
  fetchAiEstimationSummary,
  fetchAiEstimationWeekly,
  fetchAiEstimationTopDeviations,
  AI_ESTIMATION_FIELD_SLICES,
  fetchAiUsageSummary,
  fetchAiUsageWeekly,
  fetchAiUsageByStatus,
  fetchCoordinationResolvedEffortByResolution,
  fetchCoordinationTicketTimePareto,
  type CoordinationSummaryKpisPayload,
  type CoordinationWeeklyAssigneePerformancePayload,
  type CoordinationWeeklyEvolutionPayload,
  type CoordinationWeeklyTechnicianEvolutionPayload,
  type CoordinationWeeklyTicketsByRequestTypePayload,
  type CoordinationResolvedEffortPayload,
  type CoordinationTicketTimeParetoPayload,
  type AiEstimationFieldSliceData,
  type AiUsageSummaryPayload,
  type AiUsageWeeklyPayload,
  type AiUsageByStatusPayload,
} from "./api";
import { CoordIndicatorsSection } from "./CoordIndicatorsSection";

export type CoordIndicatorsPageProps = {
  indicatorsDateFrom: string;
  indicatorsDateTo: string;
  setIndicatorsDateFrom: (v: string) => void;
  setIndicatorsDateTo: (v: string) => void;
  indicatorsProjectTypeId: number | null;
  setIndicatorsProjectTypeId: (v: number | null) => void;
  projectTypes: ProjectType[];
  projectTypesLoading: boolean;
  projectTypesErr: string | null;
};

/**
 * Estado remoto y refresco para «Indicadores coordinación»: aísla merges respecto al resto de `App.tsx`.
 */
export function CoordIndicatorsPage(props: CoordIndicatorsPageProps) {
  const {
    indicatorsDateFrom,
    indicatorsDateTo,
    setIndicatorsDateFrom,
    setIndicatorsDateTo,
    indicatorsProjectTypeId,
    setIndicatorsProjectTypeId,
    projectTypes,
    projectTypesLoading,
    projectTypesErr,
  } = props;

  const [coordKpis, setCoordKpis] = useState<CoordinationSummaryKpisPayload | null>(null);
  const [coordWeeklyEvolution, setCoordWeeklyEvolution] = useState<CoordinationWeeklyEvolutionPayload | null>(null);
  const [coordWeeklyEvolutionErr, setCoordWeeklyEvolutionErr] = useState<string | null>(null);
  const [coordResolvedEffort, setCoordResolvedEffort] = useState<CoordinationResolvedEffortPayload | null>(null);
  const [coordResolvedEffortErr, setCoordResolvedEffortErr] = useState<string | null>(null);
  const [coordTicketPareto, setCoordTicketPareto] = useState<CoordinationTicketTimeParetoPayload | null>(null);
  const [coordTicketParetoErr, setCoordTicketParetoErr] = useState<string | null>(null);
  const [coordWeeklyAssignee, setCoordWeeklyAssignee] = useState<CoordinationWeeklyAssigneePerformancePayload | null>(
    null,
  );
  const [coordWeeklyAssigneeErr, setCoordWeeklyAssigneeErr] = useState<string | null>(null);
  const [coordWeeklyTechnician, setCoordWeeklyTechnician] =
    useState<CoordinationWeeklyTechnicianEvolutionPayload | null>(null);
  const [coordWeeklyTechnicianErr, setCoordWeeklyTechnicianErr] = useState<string | null>(null);
  const [coordWeeklyRt, setCoordWeeklyRt] = useState<CoordinationWeeklyTicketsByRequestTypePayload | null>(null);
  const [coordWeeklyRtErr, setCoordWeeklyRtErr] = useState<string | null>(null);
  const [coordIndicatorsLoading, setCoordIndicatorsLoading] = useState(false);
  const [coordinationPageErr, setCoordinationPageErr] = useState<string | null>(null);
  const [coordProblemsSupport, setCoordProblemsSupport] = useState<IndicatorsProblemsSupportPayload | null>(null);
  const [coordProblemsSupportErr, setCoordProblemsSupportErr] = useState<string | null>(null);
  const [aiEstimationSlices, setAiEstimationSlices] = useState<AiEstimationFieldSliceData[]>(
    AI_ESTIMATION_FIELD_SLICES.map((s) => ({
      ...s,
      summary: null,
      summaryErr: null,
      weekly: null,
      weeklyErr: null,
      topDeviations: null,
      topErr: null,
    })),
  );
  const [aiUsageSummary, setAiUsageSummary] = useState<AiUsageSummaryPayload | null>(null);
  const [aiUsageSummaryErr, setAiUsageSummaryErr] = useState<string | null>(null);
  const [aiUsageWeekly, setAiUsageWeekly] = useState<AiUsageWeeklyPayload | null>(null);
  const [aiUsageWeeklyErr, setAiUsageWeeklyErr] = useState<string | null>(null);
  const [aiUsageByStatus, setAiUsageByStatus] = useState<AiUsageByStatusPayload | null>(null);
  const [aiUsageByStatusErr, setAiUsageByStatusErr] = useState<string | null>(null);
  const [weeklyRtProjectFilterId, setWeeklyRtProjectFilterId] = useState<number | null>(null);
  const [weeklyRtProjectOptions, setWeeklyRtProjectOptions] = useState<SupportProject[]>([]);
  const [weeklyRtProjectsErr, setWeeklyRtProjectsErr] = useState<string | null>(null);

  useEffect(() => {
    fetchSupportProjects()
      .then((list) => {
        setWeeklyRtProjectOptions(list);
        setWeeklyRtProjectsErr(null);
      })
      .catch((e) => {
        setWeeklyRtProjectsErr(e instanceof Error ? e.message : String(e));
        setWeeklyRtProjectOptions([]);
      });
  }, []);

  const loadCoordinationIndicatorsPage = useCallback(async () => {
    if (!indicatorsDateFrom || !indicatorsDateTo) return;
    setCoordIndicatorsLoading(true);
    setCoordinationPageErr(null);
    setCoordWeeklyEvolutionErr(null);
    setCoordResolvedEffortErr(null);
    setCoordTicketParetoErr(null);
    setCoordWeeklyAssigneeErr(null);
    setCoordWeeklyTechnicianErr(null);
    setCoordWeeklyRtErr(null);
    setCoordProblemsSupportErr(null);
    setAiEstimationSlices(
      AI_ESTIMATION_FIELD_SLICES.map((s) => ({
        ...s,
        summary: null,
        summaryErr: null,
        weekly: null,
        weeklyErr: null,
        topDeviations: null,
        topErr: null,
      })),
    );
    setAiUsageSummaryErr(null);
    setAiUsageWeeklyErr(null);
    setAiUsageByStatusErr(null);
    try {
      const kpis = await fetchCoordinationSummaryKpis(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo);
      setCoordKpis(kpis);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordinationPageErr(msg);
      setCoordKpis(null);
    }
    try {
      setCoordWeeklyEvolution(
        await fetchCoordinationWeeklyEvolution(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordWeeklyEvolutionErr(msg);
      setCoordWeeklyEvolution(null);
    }
    try {
      setCoordResolvedEffort(
        await fetchCoordinationResolvedEffortByResolution(
          indicatorsProjectTypeId,
          indicatorsDateFrom,
          indicatorsDateTo,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordResolvedEffortErr(msg);
      setCoordResolvedEffort(null);
    }
    try {
      setCoordTicketPareto(
        await fetchCoordinationTicketTimePareto(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordTicketParetoErr(msg);
      setCoordTicketPareto(null);
    }
    try {
      setCoordWeeklyAssignee(
        await fetchCoordinationWeeklyAssigneePerformance(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordWeeklyAssigneeErr(msg);
      setCoordWeeklyAssignee(null);
    }
    try {
      setCoordWeeklyTechnician(
        await fetchCoordinationWeeklyTechnicianEvolution(
          indicatorsProjectTypeId,
          indicatorsDateFrom,
          indicatorsDateTo,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordWeeklyTechnicianErr(msg);
      setCoordWeeklyTechnician(null);
    }
    try {
      setCoordWeeklyRt(
        await fetchCoordinationWeeklyTicketsByRequestType(
          indicatorsProjectTypeId,
          indicatorsDateFrom,
          indicatorsDateTo,
          weeklyRtProjectFilterId,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordWeeklyRtErr(msg);
      setCoordWeeklyRt(null);
    }
    try {
      setCoordProblemsSupport(await fetchIndicatorsProblemsSupport(indicatorsDateFrom, indicatorsDateTo));
      setCoordProblemsSupportErr(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordProblemsSupportErr(msg);
      setCoordProblemsSupport(null);
    }
    const aiEstimationResults = await Promise.all(
      AI_ESTIMATION_FIELD_SLICES.map(async (slice) => {
        let summary: AiEstimationFieldSliceData["summary"] = null;
        let summaryErr: string | null = null;
        let weekly: AiEstimationFieldSliceData["weekly"] = null;
        let weeklyErr: string | null = null;
        let topDeviations: AiEstimationFieldSliceData["topDeviations"] = null;
        let topErr: string | null = null;

        try {
          summary = await fetchAiEstimationSummary(
            indicatorsProjectTypeId,
            indicatorsDateFrom,
            indicatorsDateTo,
            slice.field,
          );
        } catch (e) {
          summaryErr = e instanceof Error ? e.message : String(e);
        }
        try {
          weekly = await fetchAiEstimationWeekly(
            indicatorsProjectTypeId,
            indicatorsDateFrom,
            indicatorsDateTo,
            slice.field,
          );
        } catch (e) {
          weeklyErr = e instanceof Error ? e.message : String(e);
        }
        try {
          topDeviations = await fetchAiEstimationTopDeviations(
            indicatorsProjectTypeId,
            indicatorsDateFrom,
            indicatorsDateTo,
            10,
            slice.field,
          );
        } catch (e) {
          topErr = e instanceof Error ? e.message : String(e);
        }

        return {
          ...slice,
          summary,
          summaryErr,
          weekly,
          weeklyErr,
          topDeviations,
          topErr,
        };
      }),
    );
    setAiEstimationSlices(aiEstimationResults);
    try {
      setAiUsageSummary(await fetchAiUsageSummary(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiUsageSummaryErr(msg);
      setAiUsageSummary(null);
    }
    try {
      setAiUsageWeekly(await fetchAiUsageWeekly(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiUsageWeeklyErr(msg);
      setAiUsageWeekly(null);
    }
    try {
      setAiUsageByStatus(await fetchAiUsageByStatus(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiUsageByStatusErr(msg);
      setAiUsageByStatus(null);
    } finally {
      setCoordIndicatorsLoading(false);
    }
  }, [indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo, weeklyRtProjectFilterId]);

  useEffect(() => {
    void loadCoordinationIndicatorsPage();
  }, [loadCoordinationIndicatorsPage]);

  return (
    <CoordIndicatorsSection
      indicatorsDateFrom={indicatorsDateFrom}
      indicatorsDateTo={indicatorsDateTo}
      setIndicatorsDateFrom={setIndicatorsDateFrom}
      setIndicatorsDateTo={setIndicatorsDateTo}
      indicatorsProjectTypeId={indicatorsProjectTypeId}
      setIndicatorsProjectTypeId={setIndicatorsProjectTypeId}
      projectTypes={projectTypes}
      projectTypesLoading={projectTypesLoading}
      projectTypesErr={projectTypesErr}
      coordinationLoading={coordIndicatorsLoading}
      coordinationPageErr={coordinationPageErr}
      coordinationWeeklyErr={coordWeeklyEvolutionErr}
      coordinationResolvedEffortErr={coordResolvedEffortErr}
      coordinationTicketParetoErr={coordTicketParetoErr}
      coordinationAssigneeErr={coordWeeklyAssigneeErr}
      coordinationTechnicianErr={coordWeeklyTechnicianErr}
      coordinationWeeklyRequestTypeErr={coordWeeklyRtErr}
      weeklyRtProjectFilterId={weeklyRtProjectFilterId}
      setWeeklyRtProjectFilterId={setWeeklyRtProjectFilterId}
      weeklyRtProjectOptions={weeklyRtProjectOptions}
      weeklyRtProjectsErr={weeklyRtProjectsErr}
      coordProblemsSupport={coordProblemsSupport}
      coordProblemsSupportErr={coordProblemsSupportErr}
      onRefresh={() => void loadCoordinationIndicatorsPage()}
      coordKpis={coordKpis}
      coordWeeklyEvolution={coordWeeklyEvolution}
      coordResolvedEffort={coordResolvedEffort}
      coordTicketPareto={coordTicketPareto}
      coordWeeklyAssignee={coordWeeklyAssignee}
      coordWeeklyTechnician={coordWeeklyTechnician}
      coordWeeklyTicketsByRequestType={coordWeeklyRt}
      aiEstimationSlices={aiEstimationSlices}
      aiUsageSummary={aiUsageSummary}
      aiUsageSummaryErr={aiUsageSummaryErr}
      aiUsageWeekly={aiUsageWeekly}
      aiUsageWeeklyErr={aiUsageWeeklyErr}
      aiUsageByStatus={aiUsageByStatus}
      aiUsageByStatusErr={aiUsageByStatusErr}
    />
  );
}
