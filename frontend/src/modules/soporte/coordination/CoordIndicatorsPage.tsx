import { useCallback, useEffect, useState } from "react";

import type { ProjectType, IndicatorsProblemsSupportPayload, SupportProject } from "../../../api";
import { fetchIndicatorsProblemsSupport, fetchSupportProjects } from "../../../api";
import {
  fetchCoordinationSummaryKpis,
  fetchCoordinationWeeklyAssigneePerformance,
  fetchCoordinationWeeklyEvolution,
  fetchCoordinationWeeklyTicketsByRequestType,
  type CoordinationSummaryKpisPayload,
  type CoordinationWeeklyAssigneePerformancePayload,
  type CoordinationWeeklyEvolutionPayload,
  type CoordinationWeeklyTicketsByRequestTypePayload,
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
  const [coordWeeklyAssignee, setCoordWeeklyAssignee] = useState<CoordinationWeeklyAssigneePerformancePayload | null>(
    null,
  );
  const [coordWeeklyAssigneeErr, setCoordWeeklyAssigneeErr] = useState<string | null>(null);
  const [coordWeeklyRt, setCoordWeeklyRt] = useState<CoordinationWeeklyTicketsByRequestTypePayload | null>(null);
  const [coordWeeklyRtErr, setCoordWeeklyRtErr] = useState<string | null>(null);
  const [coordIndicatorsLoading, setCoordIndicatorsLoading] = useState(false);
  const [coordinationPageErr, setCoordinationPageErr] = useState<string | null>(null);
  const [coordProblemsSupport, setCoordProblemsSupport] = useState<IndicatorsProblemsSupportPayload | null>(null);
  const [coordProblemsSupportErr, setCoordProblemsSupportErr] = useState<string | null>(null);
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
    setCoordWeeklyAssigneeErr(null);
    setCoordWeeklyRtErr(null);
    setCoordProblemsSupportErr(null);
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
      setCoordWeeklyAssignee(
        await fetchCoordinationWeeklyAssigneePerformance(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordWeeklyAssigneeErr(msg);
      setCoordWeeklyAssignee(null);
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
      coordinationAssigneeErr={coordWeeklyAssigneeErr}
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
      coordWeeklyAssignee={coordWeeklyAssignee}
      coordWeeklyTicketsByRequestType={coordWeeklyRt}
    />
  );
}
