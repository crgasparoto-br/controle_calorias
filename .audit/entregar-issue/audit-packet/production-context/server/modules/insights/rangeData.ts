import { calculateMealTotals } from "../../../shared/mealTotals";
import {
  getDateKeyInTimeZone,
  getUtcRangeForInclusiveLocalDateRange,
} from "../../../shared/timeZone";
import {
  getDb,
  listUserExercises,
  listUserMeals,
  listUserWaterLogs,
} from "../../db";
import { safeLogDetail } from "../../privacy";
import { createDrizzleExercisesRepository } from "../../repositories/exercisesRepository";
import { createDrizzleMealsRepository } from "../../repositories/mealsRepository";
import { createDrizzleWaterRepository } from "../../repositories/waterRepository";
import {
  estimateReportPayloadBytes,
  getReportRangeDays,
  logReportStageMetric,
} from "./reportMetrics";

type ReportDateRange = { startDate: string; endDate: string };

type ReportMeal = Awaited<ReturnType<typeof listUserMeals>>[number];
type ReportExercise = Awaited<ReturnType<typeof listUserExercises>>[number];
type ReportWaterLog = Awaited<ReturnType<typeof listUserWaterLogs>>[number];
type ReportRangeMetricStage = "meals" | "exercises" | "waterLogs";

const mealsRepository = createDrizzleMealsRepository({
  getDb,
  onWarning: logReportRangeReadWarning,
});
const exercisesRepository = createDrizzleExercisesRepository({
  getDb,
  onWarning: logReportRangeReadWarning,
});
const waterRepository = createDrizzleWaterRepository({
  getDb,
  onWarning: logReportRangeReadWarning,
});

function logReportRangeReadWarning(scope: string, error: unknown) {
  console.warn(`[Reports] ${scope}:`, safeLogDetail(error));
}

async function withReportRangeMetric<T>(
  stage: ReportRangeMetricStage,
  range: ReportDateRange,
  loader: (markFallback: () => void) => Promise<T[]>,
) {
  const startedAt = Date.now();
  let fallbackUsed = false;

  try {
    const items = await loader(() => {
      fallbackUsed = true;
    });
    logReportStageMetric({
      stage,
      rangeDays: getReportRangeDays(range),
      durationMs: Date.now() - startedAt,
      payloadApproxBytes: estimateReportPayloadBytes(items),
      itemCount: items.length,
      fallbackUsed,
      status: "success",
    });
    return items;
  } catch (error) {
    logReportStageMetric({
      stage,
      rangeDays: getReportRangeDays(range),
      durationMs: Date.now() - startedAt,
      payloadApproxBytes: 0,
      itemCount: 0,
      fallbackUsed,
      status: "error",
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

function buildOccurredAtRange(range: ReportDateRange, timeZone: string) {
  return getUtcRangeForInclusiveLocalDateRange(range.startDate, range.endDate, timeZone);
}

function isInsideLogicalRange(occurredAt: number, range: ReportDateRange, timeZone: string) {
  const dateKey = getDateKeyInTimeZone(occurredAt, timeZone);
  return dateKey >= range.startDate && dateKey <= range.endDate;
}

function withMealTotals(meal: ReportMeal): ReportMeal {
  return {
    ...meal,
    totals: meal.totals ?? calculateMealTotals(meal.items),
  };
}

function sortByOccurredAtDesc<T extends { occurredAt: number }>(items: T[]) {
  return items.slice().sort((first, second) => Number(second.occurredAt) - Number(first.occurredAt));
}

function filterByLogicalRange<T extends { occurredAt: number }>(
  items: T[],
  range: ReportDateRange,
  timeZone: string,
) {
  return items.filter(item => isInsideLogicalRange(Number(item.occurredAt), range, timeZone));
}

export async function listReportMealsByDateRange(
  userId: number,
  range: ReportDateRange,
  timeZone: string,
  options: { includeMedia?: boolean } = {},
): Promise<ReportMeal[]> {
  return withReportRangeMetric("meals", range, async markFallback => {
    const db = await getDb();
    if (db) {
      const occurredAtRange = buildOccurredAtRange(range, timeZone);
      const dbMeals = await mealsRepository.findConfirmedByUserId(userId, {
        ...occurredAtRange,
        includeMedia: options.includeMedia ?? false,
      });

      if (dbMeals) {
        return sortByOccurredAtDesc(
          filterByLogicalRange(dbMeals, range, timeZone).map(meal => withMealTotals(meal as ReportMeal)),
        );
      }
    }

    markFallback();
    return sortByOccurredAtDesc(
      filterByLogicalRange(await listUserMeals(userId), range, timeZone).map(withMealTotals),
    );
  });
}

export async function listReportExercisesByDateRange(
  userId: number,
  range: ReportDateRange,
  timeZone: string,
): Promise<ReportExercise[]> {
  return withReportRangeMetric("exercises", range, async markFallback => {
    const db = await getDb();
    if (db) {
      const occurredAtRange = buildOccurredAtRange(range, timeZone);
      const dbExercises = await exercisesRepository.findByUserIdAndRange(
        userId,
        occurredAtRange.startAt,
        occurredAtRange.endAt,
      );

      if (dbExercises) {
        return sortByOccurredAtDesc(filterByLogicalRange(dbExercises, range, timeZone));
      }
    }

    markFallback();
    return sortByOccurredAtDesc(filterByLogicalRange(await listUserExercises(userId), range, timeZone));
  });
}

export async function listReportWaterLogsByDateRange(
  userId: number,
  range: ReportDateRange,
  timeZone: string,
): Promise<ReportWaterLog[]> {
  return withReportRangeMetric("waterLogs", range, async markFallback => {
    const db = await getDb();
    if (db) {
      const occurredAtRange = buildOccurredAtRange(range, timeZone);
      const dbLogs = await waterRepository.findLogsByUserIdAndRange(
        userId,
        occurredAtRange.startAt,
        occurredAtRange.endAt,
      );

      if (dbLogs) {
        return sortByOccurredAtDesc(filterByLogicalRange(dbLogs, range, timeZone));
      }
    }

    markFallback();
    return sortByOccurredAtDesc(filterByLogicalRange(await listUserWaterLogs(userId), range, timeZone));
  });
}
