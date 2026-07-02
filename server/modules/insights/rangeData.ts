import { calculateMealTotals } from "../../../shared/mealTotals";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
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

function buildWideOccurredAtRange(range: ReportDateRange) {
  const startAt = new Date(`${range.startDate}T00:00:00.000Z`);
  const endAt = new Date(`${range.endDate}T00:00:00.000Z`);
  startAt.setUTCDate(startAt.getUTCDate() - 1);
  endAt.setUTCDate(endAt.getUTCDate() + 2);
  return { startAt, endAt };
}

function isInsideLogicalRange(occurredAt: number, range: ReportDateRange) {
  const dateKey = getDateKeyInTimeZone(occurredAt);
  return dateKey >= range.startDate && dateKey <= range.endDate;
}

function withMealTotals(meal: ReportMeal): ReportMeal {
  return {
    ...meal,
    totals: meal.totals ?? calculateMealTotals(meal.items),
  };
}

export async function listReportMealsByDateRange(
  userId: number,
  range: ReportDateRange,
  options: { includeMedia?: boolean } = {},
): Promise<ReportMeal[]> {
  return withReportRangeMetric("meals", range, async markFallback => {
    const db = await getDb();
    if (db) {
      const occurredAtRange = buildWideOccurredAtRange(range);
      const dbMeals = await mealsRepository.findConfirmedByUserId(userId, {
        ...occurredAtRange,
        includeMedia: options.includeMedia ?? false,
      });

      if (dbMeals) {
        return dbMeals
          .filter(meal => isInsideLogicalRange(meal.occurredAt, range))
          .map(meal => withMealTotals(meal as ReportMeal))
          .sort((first, second) => second.occurredAt - first.occurredAt);
      }
    }

    markFallback();
    return (await listUserMeals(userId))
      .filter(meal => isInsideLogicalRange(meal.occurredAt, range))
      .map(withMealTotals)
      .sort((first, second) => second.occurredAt - first.occurredAt);
  });
}

export async function listReportExercisesByDateRange(userId: number, range: ReportDateRange): Promise<ReportExercise[]> {
  return withReportRangeMetric("exercises", range, async markFallback => {
    const db = await getDb();
    if (db) {
      const occurredAtRange = buildWideOccurredAtRange(range);
      const dbExercises = await exercisesRepository.findByUserIdAndRange(userId, occurredAtRange.startAt, occurredAtRange.endAt);

      if (dbExercises) {
        return dbExercises
          .filter(exercise => isInsideLogicalRange(Number(exercise.occurredAt), range))
          .sort((first, second) => Number(second.occurredAt) - Number(first.occurredAt));
      }
    }

    markFallback();
    return (await listUserExercises(userId))
      .filter(exercise => isInsideLogicalRange(Number(exercise.occurredAt), range))
      .sort((first, second) => Number(second.occurredAt) - Number(first.occurredAt));
  });
}

export async function listReportWaterLogsByDateRange(userId: number, range: ReportDateRange): Promise<ReportWaterLog[]> {
  return withReportRangeMetric("waterLogs", range, async markFallback => {
    const db = await getDb();
    if (db) {
      const occurredAtRange = buildWideOccurredAtRange(range);
      const dbLogs = await waterRepository.findLogsByUserIdAndRange(userId, occurredAtRange.startAt, occurredAtRange.endAt);

      if (dbLogs) {
        return dbLogs
          .filter(log => isInsideLogicalRange(Number(log.occurredAt), range))
          .sort((first, second) => Number(second.occurredAt) - Number(first.occurredAt));
      }
    }

    markFallback();
    return (await listUserWaterLogs(userId))
      .filter(log => isInsideLogicalRange(Number(log.occurredAt), range))
      .sort((first, second) => Number(second.occurredAt) - Number(first.occurredAt));
  });
}
