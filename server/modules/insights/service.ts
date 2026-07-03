import {
  getFoodsByIds,
  getHabitSnapshots,
  getUserGamification,
  getUserWaterGoal,
  getWeeklyProgress,
  listUserExercisesByDate,
  listUserMeals,
  listUserMealsByDate,
  listUserWaterLogsByDate,
  searchFoods,
} from "../../db";
import { calculateDayTotals, roundNutritionValue } from "../../../shared/mealTotals";
import { buildWeeklyNutritionStatus } from "../../../shared/safeMessages";
import { getDateKeyInTimeZone, getWeekdayIndexInTimeZone, toLogicalDateInTimeZone } from "../../../shared/timeZone";
import { calculateFoodQualitySummary, type FoodQualityDay } from "../../../shared/reportsGoalAnalytics";
import { getNutritionGoalForDate } from "../goals/service";
import { calculateQualityIndicators, createFoodLookup } from "./foodQuality";
<<<<<<< HEAD
import {
  listReportExercisesByDateRange,
  listReportMealsByDateRange,
  listReportWaterLogsByDateRange,
} from "./rangeData";
=======
>>>>>>> origin/main
import { weeklyInsightService } from "./weeklyInsightService";

function mealDateKey(meal: { occurredAt: number }) {
  return getDateKeyInTimeZone(meal.occurredAt);
}

function groupMealsByDate(meals: Awaited<ReturnType<typeof listUserMeals>>) {
  const groups = new Map<string, Awaited<ReturnType<typeof listUserMeals>>>();

  meals.forEach(meal => {
    const key = mealDateKey(meal);
    const currentGroup = groups.get(key) ?? [];
    currentGroup.push(meal);
    groups.set(key, currentGroup);
  });

  return Array.from(groups.entries())
    .sort(([firstDate], [secondDate]) => secondDate.localeCompare(firstDate))
    .map(([date, items]) => ({
      date,
      items: items.slice().sort((firstMeal, secondMeal) => secondMeal.occurredAt - firstMeal.occurredAt),
    }));
}

function buildAggregateQuality(days: Array<{ date: string; quality?: ReturnType<typeof calculateQualityIndicators> }>) {
  const totals = days.reduce(
    (acc, day) => {
      acc.proteinGrams += day.quality?.proteinGrams ?? 0;
      acc.fiberGrams += day.quality?.fiberGrams ?? 0;
      acc.waterMl += day.quality?.waterMl ?? 0;
      acc.fruitServings += day.quality?.fruitServings ?? 0;
      acc.vegetableServings += day.quality?.vegetableServings ?? 0;
      acc.ultraProcessedServings += day.quality?.ultraProcessedServings ?? 0;
      acc.mealCount += day.quality?.mealCount ?? 0;
      acc.regularityScore += (day.quality?.regularityScore ?? 0) / 7;
      acc.foodQualityDays.push({ date: day.date, items: day.quality?.foodQualityItems ?? [] });
      return acc;
    },
    {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: 0,
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
      foodQualityDays: [] as FoodQualityDay[],
    },
  );

  return {
    proteinGrams: totals.proteinGrams,
    fiberGrams: totals.fiberGrams,
    waterMl: totals.waterMl,
    fruitServings: totals.fruitServings,
    vegetableServings: totals.vegetableServings,
    ultraProcessedServings: totals.ultraProcessedServings,
    mealCount: totals.mealCount,
    regularityScore: totals.regularityScore,
    foodQuality: calculateFoodQualitySummary(totals.foodQualityDays, days.length),
  };
}

function buildWeeklyInsights(progress: Awaited<ReturnType<typeof getWeeklyProgressReport>>, meals: Awaited<ReturnType<typeof listUserMeals>>) {
  return {
    generatedAt: new Date().toISOString(),
    weekStart: progress.days[0]?.date ?? null,
    weekEnd: progress.days[progress.days.length - 1]?.date ?? null,
    insights: weeklyInsightService.generate({
      days: progress.days,
      meals,
    }),
  };
}

function resolveWeekDates(weekOffset = 0) {
  const referenceDate = toLogicalDateInTimeZone(new Date());
  referenceDate.setUTCDate(referenceDate.getUTCDate() + (weekOffset * 7));

  const monday = new Date(referenceDate);
  monday.setUTCDate(referenceDate.getUTCDate() - getWeekdayIndexInTimeZone(referenceDate));

  return Array.from({ length: 7 }).map((_, index) => {
    const current = new Date(monday);
    current.setUTCDate(monday.getUTCDate() + index);
    return current;
  });
}

function listDateKeysInRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  const limit = new Date(`${endDate}T12:00:00Z`);

  while (cursor <= limit) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function formatPeriodDateLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
}

type WeightEntryForTrend = {
  id?: number;
  date: string;
  weightKg: number;
  notes?: string | null;
};

function buildWeightTrendPoint(entry: WeightEntryForTrend, date = entry.date, notes = entry.notes ?? null) {
  return {
    id: entry.id,
    date,
    label: formatPeriodDateLabel(date),
    weightKg: roundNutritionValue(entry.weightKg),
    notes,
  };
}

function buildWeightTrendForDates(entries: WeightEntryForTrend[] | undefined, dates: string[]) {
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  if (!startDate || !endDate) {
    return {
      points: [],
      summary: {
        hasData: false,
        firstWeightKg: null,
        lastWeightKg: null,
        deltaKg: null,
      },
    };
  }

  const orderedEntries = (entries ?? [])
    .filter(entry => entry.date && Number.isFinite(entry.weightKg))
    .slice()
    .sort((first, second) => first.date.localeCompare(second.date));
  const latestBeforeStart = orderedEntries.filter(entry => entry.date < startDate).at(-1);
  const latestUpToEnd = orderedEntries.filter(entry => entry.date <= endDate).at(-1);
  const inRangeEntries = orderedEntries.filter(entry => entry.date >= startDate && entry.date <= endDate);
  const pointsByDate = new Map<string, ReturnType<typeof buildWeightTrendPoint>>();

  if (latestBeforeStart && !inRangeEntries.some(entry => entry.date === startDate)) {
    pointsByDate.set(
      startDate,
      buildWeightTrendPoint(latestBeforeStart, startDate, latestBeforeStart.notes ?? "Último peso registrado antes do período."),
    );
  }

  for (const entry of inRangeEntries) {
    pointsByDate.set(entry.date, buildWeightTrendPoint(entry));
  }

  if (pointsByDate.size === 1 && latestBeforeStart && latestUpToEnd?.date === latestBeforeStart.date && endDate !== startDate) {
    pointsByDate.set(
      endDate,
      buildWeightTrendPoint(latestBeforeStart, endDate, latestBeforeStart.notes ?? "Peso mantido a partir do último registro histórico."),
    );
  }

  const points = Array.from(pointsByDate.values()).sort((first, second) => first.date.localeCompare(second.date));
  const firstWeight = points[0];
  const lastWeight = points[points.length - 1];

  return {
    points,
    summary: {
      hasData: points.length > 0,
      firstWeightKg: firstWeight?.weightKg ?? null,
      lastWeightKg: lastWeight?.weightKg ?? null,
      deltaKg: firstWeight && lastWeight ? roundNutritionValue(lastWeight.weightKg - firstWeight.weightKg) : null,
    },
  };
}

function averageValue(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}

function calculateAdjustedGoalCalories(baseCalories: number, exerciseCalories: number) {
  return roundNutritionValue(baseCalories + Math.max(exerciseCalories, 0));
}

const FOOD_QUALITY_LOOKUP_QUERY_LIMIT = 8;
const FOOD_QUALITY_LOOKUP_CONCURRENCY = 6;
<<<<<<< HEAD
const REFERENCE_FOOD_LOOKUP = createFoodLookup([]);
=======
>>>>>>> origin/main

type ReportRangeData = {
  dates: string[];
  mealsByDay: Array<Awaited<ReturnType<typeof listReportMealsByDateRange>>>;
  exercisesByDay: Array<Awaited<ReturnType<typeof listReportExercisesByDateRange>>>;
  waterLogsByDay: Array<Awaited<ReturnType<typeof listReportWaterLogsByDateRange>>>;
};

type WeeklyReportSummaryOptions = {
  includeFoodQualityDetails?: boolean;
};

function groupRangeItemsByDate<T>(dates: string[], items: T[], getDate: (item: T) => string) {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const date = getDate(item);
    if (!dates.includes(date)) continue;
    const current = groups.get(date) ?? [];
    current.push(item);
    groups.set(date, current);
  }

  return dates.map(date => groups.get(date) ?? []);
}

async function loadReportRangeData(userId: number, dates: string[]): Promise<ReportRangeData> {
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  if (!startDate || !endDate) {
    return { dates, mealsByDay: [], exercisesByDay: [], waterLogsByDay: [] };
  }

  const range = { startDate, endDate };
  const [meals, exercises, waterLogs] = await Promise.all([
    listReportMealsByDateRange(userId, range, { includeMedia: false }),
    listReportExercisesByDateRange(userId, range),
    listReportWaterLogsByDateRange(userId, range),
  ]);

  return {
    dates,
    mealsByDay: groupRangeItemsByDate(dates, meals, mealDateKey),
    exercisesByDay: groupRangeItemsByDate(dates, exercises, exercise => getDateKeyInTimeZone(Number(exercise.occurredAt))),
    waterLogsByDay: groupRangeItemsByDate(dates, waterLogs, log => getDateKeyInTimeZone(Number(log.occurredAt))),
  };
}

function addFoodLookupName(names: Set<string>, value: string | null | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    names.add(normalized);
  }
}

function collectFoodQualityLookupNames(mealsByDay: ReportRangeData["mealsByDay"]) {
  const names = new Set<string>();

  for (const meals of mealsByDay) {
    for (const meal of meals) {
      for (const item of meal.items) {
        addFoodLookupName(names, item.canonicalName);
        addFoodLookupName(names, item.foodName);
        addFoodLookupName(names, item.portionText);
      }
    }
  }

  return Array.from(names);
}

async function mapFoodLookupNames(
  names: string[],
  mapper: (name: string) => Promise<Awaited<ReturnType<typeof searchFoods>>>,
) {
  const results: Array<Awaited<ReturnType<typeof searchFoods>>> = [];
  let nextIndex = 0;
  const workerCount = Math.min(FOOD_QUALITY_LOOKUP_CONCURRENCY, names.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < names.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(names[currentIndex]);
    }
  }));

  return results;
}

function collectFoodLookupCatalogIds(mealsByDay: ReportRangeData["mealsByDay"]) {
  const ids = new Set<number>();

  for (const meals of mealsByDay) {
    for (const meal of meals) {
      for (const item of meal.items) {
        if (item.foodCatalogId) {
          ids.add(item.foodCatalogId);
        }
      }
    }
  }

  return Array.from(ids);
}

async function buildFoodLookupForMeals(userId: number, mealsByDay: ReportRangeData["mealsByDay"]) {
  const lookupNames = collectFoodQualityLookupNames(mealsByDay);
  const catalogIds = collectFoodLookupCatalogIds(mealsByDay);
  if (!lookupNames.length && !catalogIds.length) {
    return createFoodLookup([]);
  }

  const [nameResults, idResults] = await Promise.all([
    mapFoodLookupNames(lookupNames, name => searchFoods(userId, name, FOOD_QUALITY_LOOKUP_QUERY_LIMIT)),
    getFoodsByIds(userId, catalogIds),
  ]);
  const foodsById = new Map<number, Awaited<ReturnType<typeof searchFoods>>[number]>();

  for (const foods of nameResults) {
    for (const food of foods) {
      foodsById.set(food.id, food);
    }
  }
  for (const food of idResults) {
    foodsById.set(food.id, food);
  }

  return createFoodLookup(Array.from(foodsById.values()));
}

function normalizeMealLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function calculateMealRegularityScore(meals: Array<{ mealLabel: string }>) {
  if (!meals.length) return 0;
  const labels = new Set(meals.map(meal => normalizeMealLabel(meal.mealLabel)));
  const hasMainMeal = ["cafe da manha", "almoco", "jantar"].filter(label => labels.has(label)).length;
  return Math.min(Math.round(((Math.min(meals.length, 4) / 4) * 60) + ((hasMainMeal / 3) * 40)), 100);
}

function resolveItemServingCount(item: { servings?: number | null }) {
  const servings = Number(item.servings ?? 0);
  return Number.isFinite(servings) && servings > 0 ? servings : 0;
}

function calculateLightQualityIndicators(
  meals: Parameters<typeof calculateQualityIndicators>[0],
  waterMl: number,
) {
  if (!meals.length) {
    return emptyQualityIndicators(waterMl);
  }

  const quality = calculateQualityIndicators(meals, waterMl, REFERENCE_FOOD_LOOKUP);
  let foodQualityItemIndex = 0;
  let fruitServings = 0;
  let vegetableServings = 0;
  let ultraProcessedServings = 0;
  let hasServingBasedClassification = false;

  for (const meal of meals) {
    for (const item of meal.items) {
      const qualityItem = quality.foodQualityItems[foodQualityItemIndex];
      foodQualityItemIndex += 1;
      if (!qualityItem?.isClassified) continue;

      const servings = resolveItemServingCount(item);
      if (servings <= 0) continue;

      hasServingBasedClassification = true;
      if (qualityItem.isFruit) fruitServings += servings;
      if (qualityItem.isVegetable) vegetableServings += servings;
      if (qualityItem.isUltraProcessed) ultraProcessedServings += servings;
    }
  }

  return {
    ...quality,
    fruitServings: hasServingBasedClassification ? roundNutritionValue(fruitServings) : quality.fruitServings,
    vegetableServings: hasServingBasedClassification ? roundNutritionValue(vegetableServings) : quality.vegetableServings,
    ultraProcessedServings: hasServingBasedClassification ? roundNutritionValue(ultraProcessedServings) : quality.ultraProcessedServings,
    mealCount: meals.length,
    regularityScore: calculateMealRegularityScore(meals),
    foodQualityItems: [] as FoodQualityDay["items"],
  };
}

function addFoodLookupName(names: Set<string>, value: string | null | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    names.add(normalized);
  }
}

function collectFoodQualityLookupNames(mealsByDay: ReportRangeData["mealsByDay"]) {
  const names = new Set<string>();

  for (const meals of mealsByDay) {
    for (const meal of meals) {
      for (const item of meal.items) {
        addFoodLookupName(names, item.canonicalName);
        addFoodLookupName(names, item.foodName);
        addFoodLookupName(names, item.portionText);
      }
    }
  }

  return Array.from(names);
}

async function mapFoodLookupNames(
  names: string[],
  mapper: (name: string) => Promise<Awaited<ReturnType<typeof searchFoods>>>,
) {
  const results: Array<Awaited<ReturnType<typeof searchFoods>>> = [];
  let nextIndex = 0;
  const workerCount = Math.min(FOOD_QUALITY_LOOKUP_CONCURRENCY, names.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < names.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(names[currentIndex]);
    }
  }));

  return results;
}

async function buildFoodLookupForMeals(userId: number, mealsByDay: ReportRangeData["mealsByDay"]) {
  const lookupNames = collectFoodQualityLookupNames(mealsByDay);
  if (!lookupNames.length) {
    return createFoodLookup([]);
  }

  const results = await mapFoodLookupNames(
    lookupNames,
    name => searchFoods(userId, name, FOOD_QUALITY_LOOKUP_QUERY_LIMIT),
  );
  const foodsById = new Map<number, Awaited<ReturnType<typeof searchFoods>>[number]>();

  for (const foods of results) {
    for (const food of foods) {
      foodsById.set(food.id, food);
    }
  }

  return createFoodLookup(Array.from(foodsById.values()));
}

function buildHabitAnalyticsFromRange(
  waterGoal: Awaited<ReturnType<typeof getUserWaterGoal>>,
  data: ReportRangeData,
  range: { startDate: string; endDate: string },
) {
  const waterDays = data.dates.map((date, index) => ({
    date,
    label: formatPeriodDateLabel(date),
    totalMl: roundNutritionValue(
      (data.waterLogsByDay[index] ?? []).reduce((total, log) => total + Number(log.amountMl ?? 0), 0),
    ),
  }));
  const totalConsumedMl = roundNutritionValue(waterDays.reduce((total, day) => total + day.totalMl, 0));
  const totalGoalMl = roundNutritionValue(waterGoal.dailyTargetMl * data.dates.length);
  const goalHitDays = waterGoal.dailyTargetMl > 0
    ? waterDays.filter(day => day.totalMl >= waterGoal.dailyTargetMl).length
    : 0;
  const lowestWaterDay = waterDays.reduce<(typeof waterDays)[number] | null>((current, day) => {
    if (day.totalMl <= 0) return current;
    if (!current || day.totalMl < current.totalMl) return day;
    return current;
  }, null);

  const exerciseDays = data.dates.map((date, index) => {
    const dailyExercises = data.exercisesByDay[index] ?? [];
    return {
      date,
      label: formatPeriodDateLabel(date),
      caloriesBurned: roundNutritionValue(dailyExercises.reduce((total, exercise) => total + Number(exercise.caloriesBurned ?? 0), 0)),
      durationMinutes: roundNutritionValue(dailyExercises.reduce((total, exercise) => total + Number(exercise.durationMinutes ?? 0), 0)),
    };
  });
  const totalExerciseCalories = roundNutritionValue(exerciseDays.reduce((total, day) => total + day.caloriesBurned, 0));
  const totalExerciseDurationMinutes = roundNutritionValue(exerciseDays.reduce((total, day) => total + day.durationMinutes, 0));
  const activeDays = exerciseDays.filter(day => day.caloriesBurned > 0 || day.durationMinutes > 0).length;
  const highestExerciseDay = exerciseDays.reduce<(typeof exerciseDays)[number] | null>((current, day) => {
    if (day.caloriesBurned <= 0) return current;
    if (!current || day.caloriesBurned > current.caloriesBurned) return day;
    return current;
  }, null);

  return {
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      dayCount: data.dates.length,
    },
    water: {
      dailyGoalMl: waterGoal.dailyTargetMl,
      totalGoalMl,
      totalConsumedMl,
      goalHitDays,
      averageDailyMl: roundNutritionValue(averageValue(totalConsumedMl, data.dates.length)),
      lowestDay: lowestWaterDay
        ? {
            date: lowestWaterDay.date,
            label: lowestWaterDay.label,
            totalMl: lowestWaterDay.totalMl,
          }
        : null,
    },
    exercise: {
      totalCalories: totalExerciseCalories,
      totalDurationMinutes: totalExerciseDurationMinutes,
      activeDays,
      averageCaloriesPerActiveDay: roundNutritionValue(averageValue(totalExerciseCalories, activeDays)),
      highestDay: highestExerciseDay
        ? {
            date: highestExerciseDay.date,
            label: highestExerciseDay.label,
            caloriesBurned: highestExerciseDay.caloriesBurned,
            durationMinutes: highestExerciseDay.durationMinutes,
          }
        : null,
    },
  };
}

<<<<<<< HEAD
async function buildWeeklyReportSummary(userId: number, weekOffset = 0, options: WeeklyReportSummaryOptions = {}) {
=======
async function buildWeeklyReportSummary(userId: number, weekOffset = 0) {
>>>>>>> origin/main
  const dateKeys = resolveWeekDates(weekOffset).map(day => getDateKeyInTimeZone(day));
  const [goalsByDate, waterGoal, rangeData] = await Promise.all([
    Promise.all(dateKeys.map(date => getNutritionGoalForDate(userId, date))),
    getUserWaterGoal(userId),
    loadReportRangeData(userId, dateKeys),
  ]);
<<<<<<< HEAD
  const foodLookup = options.includeFoodQualityDetails
    ? await buildFoodLookupForMeals(userId, rangeData.mealsByDay)
    : undefined;
=======
  const foodLookup = await buildFoodLookupForMeals(userId, rangeData.mealsByDay);
>>>>>>> origin/main

  return rangeData.dates.map((date, index) => {
    const planned = goalsByDate[index]?.today ?? goalsByDate[0].today;
    const dailyMeals = rangeData.mealsByDay[index] ?? [];
    const dailyExercises = rangeData.exercisesByDay[index] ?? [];
    const dailyWaterLogs = rangeData.waterLogsByDay[index] ?? [];
    const totals = calculateDayTotals(dailyMeals);
    const burnedCalories = dailyExercises.reduce((acc, exercise) => acc + Number(exercise.caloriesBurned ?? 0), 0);
    const waterConsumedMl = dailyWaterLogs.reduce((acc, log) => acc + Number(log.amountMl ?? 0), 0);
    const quality = options.includeFoodQualityDetails
      ? calculateQualityIndicators(dailyMeals, waterConsumedMl, foodLookup)
      : calculateLightQualityIndicators(dailyMeals, waterConsumedMl);
    const adjustedGoalCalories = calculateAdjustedGoalCalories(planned.calories, burnedCalories);

    return {
      date,
      label: planned.shortLabel,
      calories: roundNutritionValue(totals.calories),
      protein: roundNutritionValue(totals.protein),
      carbs: roundNutritionValue(totals.carbs),
      fat: roundNutritionValue(totals.fat),
      exerciseCalories: roundNutritionValue(burnedCalories),
      netCalories: roundNutritionValue(totals.calories - burnedCalories),
      waterConsumedMl: roundNutritionValue(waterConsumedMl),
      waterGoalMl: waterGoal.dailyTargetMl,
      quality,
      goalCalories: planned.calories,
      adjustedGoalCalories,
      goalProtein: planned.proteinGrams,
      goalCarbs: planned.carbsGrams,
      goalFat: planned.fatGrams,
    };
  });
}

type WeeklyReportSummary = Awaited<ReturnType<typeof buildWeeklyReportSummary>>;

function classifyWeeklyDay(day: WeeklyReportSummary[number]) {
  if (day.calories <= 0) return "no_data" as const;
  const ratio = day.adjustedGoalCalories ? day.calories / day.adjustedGoalCalories : 0;
  if (ratio > 1.05) return "above" as const;
  if (ratio < 0.9) return "below" as const;
  return "within" as const;
}

function emptyQualityIndicators(waterMl = 0) {
  return {
    proteinGrams: 0,
    fiberGrams: 0,
    waterMl: roundNutritionValue(waterMl),
    fruitServings: 0,
    vegetableServings: 0,
    ultraProcessedServings: 0,
    mealCount: 0,
    regularityScore: 0,
    foodQualityItems: [] as FoodQualityDay["items"],
  };
}

function buildWeeklyProgressFromSummary(
  days: WeeklyReportSummary,
  fallbackProgress: Awaited<ReturnType<typeof getWeeklyProgress>>,
) {
  const totalCalories = roundNutritionValue(days.reduce((acc, day) => acc + day.calories, 0));
  const totalGoalCalories = roundNutritionValue(days.reduce((acc, day) => acc + day.adjustedGoalCalories, 0));
  const totalExerciseCalories = roundNutritionValue(days.reduce((acc, day) => acc + day.exerciseCalories, 0));
  const totalNetCalories = roundNutritionValue(days.reduce((acc, day) => acc + day.netCalories, 0));
  const averageCalories = roundNutritionValue(totalCalories / Math.max(days.length, 1));
  const averageProtein = roundNutritionValue(days.reduce((acc, day) => acc + day.protein, 0) / Math.max(days.length, 1));
  const daysByStatus = days.reduce(
    (acc, day) => {
      const status = classifyWeeklyDay(day);
      acc[status] += 1;
      return acc;
    },
    { within: 0, above: 0, below: 0, no_data: 0 },
  );

  const balanceCalories = roundNutritionValue(totalGoalCalories - totalCalories);
  const message = buildWeeklyNutritionStatus({
    totalCalories,
    daysAboveGoal: daysByStatus.above,
    daysWithinGoal: daysByStatus.within,
  });
  const weightTrend = buildWeightTrendForDates(fallbackProgress.weight.entries, days.map(day => day.date));

  return {
    days: days.map(day => ({
      ...day,
      status: classifyWeeklyDay(day),
      calorieDelta: roundNutritionValue(day.calories - day.adjustedGoalCalories),
      netDelta: roundNutritionValue(day.netCalories - day.goalCalories),
    })),
    summary: {
      averageCalories,
      totalCalories,
      totalGoalCalories,
      calorieDelta: roundNutritionValue(totalCalories - totalGoalCalories),
      daysWithinGoal: daysByStatus.within,
      daysAboveGoal: daysByStatus.above,
      daysBelowGoal: daysByStatus.below,
      daysWithoutRecords: daysByStatus.no_data,
      averageProtein,
      totalExerciseCalories,
      totalNetCalories,
      balanceCalories,
      message,
    },
    weight: {
      ...fallbackProgress.weight,
      entries: weightTrend.points,
      ...weightTrend.summary,
    },
  };
}

export async function getDashboardOverview(userId: number) {
  const todayOverview = await getDashboardTodayOverview(userId, { includeQualityDetails: true });
  const { goal, today, meals, exercises, water } = todayOverview;

  const [weekly, habits] = await Promise.all([
    buildWeeklyReportSummary(userId, 0, { includeFoodQualityDetails: true }),
    getHabitSnapshots(userId),
  ]);
  const gamification = await getUserGamification(userId, weekly);

  const weeklyConsumed = weekly.reduce(
    (acc, day) => ({
      calories: acc.calories + day.calories,
      protein: acc.protein + day.protein,
      carbs: acc.carbs + day.carbs,
      fat: acc.fat + day.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const weeklyPlanned = weekly.reduce(
    (acc, day) => ({
      calories: acc.calories + day.goalCalories,
      proteinGrams: acc.proteinGrams + day.goalProtein,
      carbsGrams: acc.carbsGrams + day.goalCarbs,
      fatGrams: acc.fatGrams + day.goalFat,
    }),
    { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
  );
  const weeklyBurnedCalories = weekly.reduce((acc, day) => acc + day.exerciseCalories, 0);
  const weeklyQuality = buildAggregateQuality(weekly);

  return {
    goal,
    today,
    week: {
      planned: {
        calories: roundNutritionValue(weeklyPlanned.calories),
        protein: roundNutritionValue(weeklyPlanned.proteinGrams),
        carbs: roundNutritionValue(weeklyPlanned.carbsGrams),
        fat: roundNutritionValue(weeklyPlanned.fatGrams),
      },
      consumed: {
        calories: roundNutritionValue(weeklyConsumed.calories),
        protein: roundNutritionValue(weeklyConsumed.protein),
        carbs: roundNutritionValue(weeklyConsumed.carbs),
        fat: roundNutritionValue(weeklyConsumed.fat),
      },
      burned: {
        calories: roundNutritionValue(weeklyBurnedCalories),
      },
      water: {
        consumedMl: roundNutritionValue(weeklyQuality.waterMl),
        goalMl: water.goal.dailyTargetMl * 7,
        remainingMl: Math.max((water.goal.dailyTargetMl * 7) - roundNutritionValue(weeklyQuality.waterMl), 0),
      },
      quality: {
        proteinGrams: roundNutritionValue(weeklyQuality.proteinGrams),
        fiberGrams: roundNutritionValue(weeklyQuality.fiberGrams),
        waterMl: roundNutritionValue(weeklyQuality.waterMl),
        fruitServings: roundNutritionValue(weeklyQuality.fruitServings),
        vegetableServings: roundNutritionValue(weeklyQuality.vegetableServings),
        ultraProcessedServings: roundNutritionValue(weeklyQuality.ultraProcessedServings),
        mealCount: weeklyQuality.mealCount,
        regularityScore: roundNutritionValue(weeklyQuality.regularityScore),
        foodQuality: weeklyQuality.foodQuality,
      },
      net: {
        calories: roundNutritionValue(weeklyConsumed.calories - weeklyBurnedCalories),
        remainingToGoal: roundNutritionValue(weeklyPlanned.calories - (weeklyConsumed.calories - weeklyBurnedCalories)),
      },
      remaining: {
        calories: roundNutritionValue(weeklyPlanned.calories - weeklyConsumed.calories),
        protein: roundNutritionValue(weeklyPlanned.proteinGrams - weeklyConsumed.protein),
        carbs: roundNutritionValue(weeklyPlanned.carbsGrams - weeklyConsumed.carbs),
        fat: roundNutritionValue(weeklyPlanned.fatGrams - weeklyConsumed.fat),
      },
      adherence: roundNutritionValue(
        weeklyPlanned.calories
          ? Math.min((weeklyConsumed.calories / weeklyPlanned.calories) * 100, 100)
          : 0,
      ),
    },
    weekly,
    meals,
    exercises,
    water,
    gamification,
    habits,
  };
}

export async function getDashboardTodayOverview(userId: number, options: { date?: string; includeQualityDetails?: boolean } = {}) {
  const selectedDate = options.date ?? getDateKeyInTimeZone(new Date());
  const [goal, waterGoal, todaysMeals, todaysExercises, todaysWaterLogs] = await Promise.all([
    getNutritionGoalForDate(userId, selectedDate),
    getUserWaterGoal(userId),
    listUserMealsByDate(userId, selectedDate, { includeMedia: false }),
    listUserExercisesByDate(userId, selectedDate),
    listUserWaterLogsByDate(userId, selectedDate),
  ]);
  const plannedGoal = goal.today;
  const todayTotals = calculateDayTotals(todaysMeals);
  const todayBurnedCalories = todaysExercises.reduce((acc, exercise) => acc + Number(exercise.caloriesBurned ?? 0), 0);
  const todayWaterMl = todaysWaterLogs.reduce((acc, log) => acc + Number(log.amountMl ?? 0), 0);
  const foodLookup = options.includeQualityDetails ? await buildFoodLookupForMeals(userId, [todaysMeals]) : undefined;
  const todayQuality = calculateQualityIndicators(todaysMeals, todayWaterMl, foodLookup);

  return {
    goal,
    today: {
      date: selectedDate,
      goal: {
        calories: plannedGoal.calories,
        adjustedCalories: calculateAdjustedGoalCalories(plannedGoal.calories, todayBurnedCalories),
        protein: plannedGoal.proteinGrams,
        carbs: plannedGoal.carbsGrams,
        fat: plannedGoal.fatGrams,
        label: plannedGoal.label,
      },
      consumed: {
        calories: roundNutritionValue(todayTotals.calories),
        protein: roundNutritionValue(todayTotals.protein),
        carbs: roundNutritionValue(todayTotals.carbs),
        fat: roundNutritionValue(todayTotals.fat),
      },
      burned: {
        calories: roundNutritionValue(todayBurnedCalories),
      },
      water: {
        consumedMl: roundNutritionValue(todayWaterMl),
        goalMl: waterGoal.dailyTargetMl,
        remainingMl: Math.max(waterGoal.dailyTargetMl - roundNutritionValue(todayWaterMl), 0),
      },
      quality: todayQuality,
      net: {
        calories: roundNutritionValue(todayTotals.calories - todayBurnedCalories),
        remainingToGoal: roundNutritionValue(plannedGoal.calories - (todayTotals.calories - todayBurnedCalories)),
      },
      remaining: {
        calories: roundNutritionValue(plannedGoal.calories - todayTotals.calories),
        protein: roundNutritionValue(plannedGoal.proteinGrams - todayTotals.protein),
        carbs: roundNutritionValue(plannedGoal.carbsGrams - todayTotals.carbs),
        fat: roundNutritionValue(plannedGoal.fatGrams - todayTotals.fat),
      },
      adherence: roundNutritionValue(plannedGoal.calories ? Math.min((todayTotals.calories / plannedGoal.calories) * 100, 100) : 0),
    },
    meals: todaysMeals.slice(0, 8),
    exercises: todaysExercises.slice(0, 8),
    water: {
      goal: waterGoal,
      logs: todaysWaterLogs.slice(0, 8),
    },
  };
}

export async function getWeeklyReport(userId: number, weekOffset = 0) {
  const dateKeys = resolveWeekDates(weekOffset).map(day => getDateKeyInTimeZone(day));
  const [weekly, fallbackProgress] = await Promise.all([
    buildWeeklyReportSummary(userId, weekOffset, { includeFoodQualityDetails: true }),
    getWeeklyProgress(userId),
  ]);

  return {
    weekly,
    weightTrend: buildWeightTrendForDates(fallbackProgress.weight.entries, dateKeys),
    quality: buildAggregateQuality(weekly),
  };
}

export async function getWeeklyProgressReport(userId: number, weekOffset = 0) {
  const [days, fallbackProgress] = await Promise.all([
    buildWeeklyReportSummary(userId, weekOffset),
    getWeeklyProgress(userId),
  ]);

  return buildWeeklyProgressFromSummary(days, fallbackProgress);
}

export async function getWeeklyInsightsReport(userId: number, weekOffset = 0) {
  const dateKeys = resolveWeekDates(weekOffset).map(day => getDateKeyInTimeZone(day));
  const range = { startDate: dateKeys[0], endDate: dateKeys[dateKeys.length - 1] };
  const [progress, weeklyMeals] = await Promise.all([
    getWeeklyProgressReport(userId, weekOffset),
    listReportMealsByDateRange(userId, range, { includeMedia: false }),
  ]);

  return buildWeeklyInsights(progress, weeklyMeals);
}

export async function getWeeklyReportBundle(userId: number, weekOffset = 0) {
  const dateKeys = resolveWeekDates(weekOffset).map(day => getDateKeyInTimeZone(day));
  const range = { startDate: dateKeys[0], endDate: dateKeys[dateKeys.length - 1] };
  const [weekly, fallbackProgress, weeklyMeals] = await Promise.all([
    buildWeeklyReportSummary(userId, weekOffset, { includeFoodQualityDetails: true }),
    getWeeklyProgress(userId),
    listReportMealsByDateRange(userId, range, { includeMedia: false }),
  ]);
  const progress = buildWeeklyProgressFromSummary(weekly, fallbackProgress);

  return {
    weekly,
    progress,
    insights: buildWeeklyInsights(progress, weeklyMeals),
    mealsByDate: groupMealsByDate(weeklyMeals),
    quality: buildAggregateQuality(weekly),
  };
}

export async function getPeriodReportBundle(
  userId: number,
  range: { startDate: string; endDate: string },
) {
  const dates = listDateKeysInRange(range.startDate, range.endDate);
  const [goalsByDate, waterGoal, progress, rangeData] = await Promise.all([
    Promise.all(dates.map(date => getNutritionGoalForDate(userId, date))),
    getUserWaterGoal(userId),
    getWeeklyProgress(userId),
    loadReportRangeData(userId, dates),
  ]);
  const habitAnalytics = buildHabitAnalyticsFromRange(waterGoal, rangeData, range);
  const meals = rangeData.mealsByDay.flat();
  const totals = calculateDayTotals(meals);
  const mealsByDate = groupMealsByDate(meals);
  const foodLookup = await buildFoodLookupForMeals(userId, rangeData.mealsByDay);
<<<<<<< HEAD
=======
  const foodQualityDays: FoodQualityDay[] = [];
>>>>>>> origin/main
  const daily = dates.map((date, index) => {
    const planned = goalsByDate[index]?.today ?? goalsByDate[0].today;
    const dailyMeals = rangeData.mealsByDay[index] ?? [];
    const dailyExercises = rangeData.exercisesByDay[index] ?? [];
    const dailyWaterLogs = rangeData.waterLogsByDay[index] ?? [];
    const dailyTotals = calculateDayTotals(dailyMeals);
    const waterConsumedMl = dailyWaterLogs.reduce((total, log) => total + Number(log.amountMl ?? 0), 0);
    const dailyQuality = calculateQualityIndicators(dailyMeals, waterConsumedMl, foodLookup);
    const exerciseCalories = dailyExercises.reduce((total, exercise) => total + Number(exercise.caloriesBurned ?? 0), 0);
    const adjustedGoalCalories = calculateAdjustedGoalCalories(planned.calories, exerciseCalories);

    return {
      date,
      label: formatPeriodDateLabel(date),
      calories: roundNutritionValue(dailyTotals.calories),
      protein: roundNutritionValue(dailyTotals.protein),
      carbs: roundNutritionValue(dailyTotals.carbs),
      fat: roundNutritionValue(dailyTotals.fat),
      exerciseCalories: roundNutritionValue(exerciseCalories),
      quality: dailyQuality,
      goalCalories: planned.calories,
      adjustedGoalCalories,
      goalProtein: planned.proteinGrams,
      goalCarbs: planned.carbsGrams,
      goalFat: planned.fatGrams,
      calorieDelta: roundNutritionValue(dailyTotals.calories - adjustedGoalCalories),
      adherencePercent: adjustedGoalCalories > 0
        ? roundNutritionValue((dailyTotals.calories / adjustedGoalCalories) * 100)
        : 0,
    };
  });
  const periodGoal = goalsByDate[goalsByDate.length - 1]?.today ?? goalsByDate[0].today;
  const weightTrend = buildWeightTrendForDates(progress.weight.entries, dates);

  return {
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      dayCount: dates.length,
    },
    goal: {
      calories: periodGoal.calories,
      protein: periodGoal.proteinGrams,
      carbs: periodGoal.carbsGrams,
      fat: periodGoal.fatGrams,
      label: periodGoal.label,
    },
    totals: {
      calories: roundNutritionValue(totals.calories),
      protein: roundNutritionValue(totals.protein),
      carbs: roundNutritionValue(totals.carbs),
      fat: roundNutritionValue(totals.fat),
    },
    daily,
    mealsByDate,
    habitAnalytics,
    quality: buildAggregateQuality(daily),
    weightTrend,
  };
}

export async function getHabitAnalyticsReport(
  userId: number,
  range: { startDate: string; endDate: string },
) {
  const dates = listDateKeysInRange(range.startDate, range.endDate);
  const [waterGoal, rangeData] = await Promise.all([
    getUserWaterGoal(userId),
    loadReportRangeData(userId, dates),
  ]);

  return buildHabitAnalyticsFromRange(waterGoal, rangeData, range);
}
