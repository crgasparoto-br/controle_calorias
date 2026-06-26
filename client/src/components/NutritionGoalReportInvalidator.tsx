import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

type GoalSnapshot = {
  defaultGoal?: {
    calories?: number;
    proteinGrams?: number;
    carbsGrams?: number;
    fatGrams?: number;
  } | null;
  versions?: Array<{
    id?: number;
    startDate?: string;
    effectiveUntil?: Date | string | number | null;
    calories?: number;
    proteinGrams?: number;
    carbsGrams?: number;
    fatGrams?: number;
  }>;
  exceptionVersions?: Array<{
    id?: number;
    weekday?: number;
    startDate?: string;
    effectiveUntil?: Date | string | number | null;
    durationType?: string;
    calories?: number;
    proteinGrams?: number;
    carbsGrams?: number;
    fatGrams?: number;
  }>;
};

function dateSignature(value: Date | string | number | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function buildGoalSignature(goal: GoalSnapshot | null | undefined) {
  if (!goal) return null;

  return JSON.stringify({
    defaultGoal: goal.defaultGoal,
    versions: (goal.versions ?? []).map(version => ({
      id: version.id,
      startDate: version.startDate,
      effectiveUntil: dateSignature(version.effectiveUntil),
      calories: version.calories,
      proteinGrams: version.proteinGrams,
      carbsGrams: version.carbsGrams,
      fatGrams: version.fatGrams,
    })),
    exceptionVersions: (goal.exceptionVersions ?? []).map(version => ({
      id: version.id,
      weekday: version.weekday,
      startDate: version.startDate,
      effectiveUntil: dateSignature(version.effectiveUntil),
      durationType: version.durationType,
      calories: version.calories,
      proteinGrams: version.proteinGrams,
      carbsGrams: version.carbsGrams,
      fatGrams: version.fatGrams,
    })),
  });
}

export default function NutritionGoalReportInvalidator() {
  const [location] = useLocation();
  const isGoalsPage = location === "/goals";
  const utils = trpc.useUtils();
  const goalQuery = trpc.nutrition.goals.get.useQuery(undefined, {
    enabled: isGoalsPage,
  });
  const signature = useMemo(() => buildGoalSignature(goalQuery.data as GoalSnapshot | null | undefined), [goalQuery.data]);
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isGoalsPage || !signature) return;

    if (!lastSignatureRef.current) {
      lastSignatureRef.current = signature;
      return;
    }

    if (lastSignatureRef.current === signature) return;

    lastSignatureRef.current = signature;
    void Promise.all([
      utils.nutrition.dashboard.overview.invalidate(),
      utils.nutrition.dashboard.today.invalidate(),
      utils.nutrition.reports.weekly.invalidate(),
      utils.nutrition.reports.bundle.invalidate(),
      utils.nutrition.reports.periodBundle.invalidate(),
    ]);
  }, [isGoalsPage, signature, utils]);

  return null;
}
