import { useCallback, useEffect, useState } from "react";

import type { ProjectType } from "../api";
import {
  fetchCoordinationAssigneeTicketsPerHour,
  fetchCoordinationSummaryKpis,
  fetchCoordinationWeeklyAssigneePerformance,
  fetchCoordinationWeeklyEvolution,
  type CoordinationAssigneeTicketsPerHourPayload,
  type CoordinationSummaryKpisPayload,
  type CoordinationWeeklyAssigneePerformancePayload,
  type CoordinationWeeklyEvolutionPayload,
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
  const [coordAssigneeTph, setCoordAssigneeTph] = useState<CoordinationAssigneeTicketsPerHourPayload | null>(null);
  const [coordAssigneeTphErr, setCoordAssigneeTphErr] = useState<string | null>(null);
  const [coordIndicatorsLoading, setCoordIndicatorsLoading] = useState(false);
  const [coordinationPageErr, setCoordinationPageErr] = useState<string | null>(null);

  const loadCoordinationIndicatorsPage = useCallback(async () => {
    if (!indicatorsDateFrom || !indicatorsDateTo) return;
    setCoordIndicatorsLoading(true);
    setCoordinationPageErr(null);
    setCoordWeeklyEvolutionErr(null);
    setCoordWeeklyAssigneeErr(null);
    setCoordAssigneeTphErr(null);
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
      setCoordAssigneeTph(
        await fetchCoordinationAssigneeTicketsPerHour(indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCoordAssigneeTphErr(msg);
      setCoordAssigneeTph(null);
    } finally {
      setCoordIndicatorsLoading(false);
    }
  }, [indicatorsProjectTypeId, indicatorsDateFrom, indicatorsDateTo]);

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
      coordinationProductivityErr={coordAssigneeTphErr}
      onRefresh={() => void loadCoordinationIndicatorsPage()}
      coordKpis={coordKpis}
      coordWeeklyEvolution={coordWeeklyEvolution}
      coordWeeklyAssignee={coordWeeklyAssignee}
      coordAssigneeTicketsPerHour={coordAssigneeTph}
    />
  );
}
