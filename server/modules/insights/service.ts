import {
  getDashboardSnapshot,
  getUserNutritionGoal,
  getUserWaterGoal,
  getWeeklyProgress,
  listUserExercises,
  listUserMeals,
  listUserWaterLogs,
  searchFoods,
} from "../../db";
import { FOOD_CATALOG_REFERENCE } from "../../foodCatalogReference";
import { calculateDayTotals, roundNutritionValue } from "../../../shared/mealTotals";
import { buildWeeklyNutritionStatus } from "../../../shared/safeMessages";
import { getDateKeyInTimeZone, getWeekdayIndexInTimeZone, toLogicalDateInTimeZone } from "../../../shared/timeZone";
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

function buildWeeklyQuality(weekly: Awaited<ReturnType<typeof buildWeeklyReportSummary>>) {
  return weekly.reduce(
    (acc, day) => ({
      proteinGrams: acc.proteinGrams + (day.quality?.proteinGrams ?? 0),
      fiberGrams: acc.fiberGrams + (day.quality?.fiberGrams ?? 0),
      waterMl: acc.waterMl + (day.quality?.waterMl ?? 0),
      fruitServings: acc.fruitServings + (day.quality?.fruitServings ?? 0),
      vegetableServings: acc.vegetableServings + (day.quality?.vegetableServings ?? 0),
      ultraProcessedServings: acc.ultraProcessedServings + (day.quality?.ultraProcessedServings ?? 0),
      mealCount: acc.mealCount + (day.quality?.mealCount ?? 0),
      regularityScore: acc.regularityScore + ((day.quality?.regularityScore ?? 0) / 7),
    }),
    {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: 0,
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
    },
  );
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

function averageValue(total: number, count: number) {
  if (!count) return 0;
  return total / count;
}

function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function calculateRegularityScore(meals: Array<{ mealLabel: string }>) {
  if (!meals.length) return 0;
  const labels = new Set(meals.map(meal => normalizeCatalogText(meal.mealLabel)));
  const hasMainMeal = ["cafe da manha", "almoco", "jantar"].filter(label => labels.has(label)).length;
  return Math.min(Math.round(((Math.min(meals.length, 4) / 4) * 60) + ((hasMainMeal / 3) * 40)), 100);
}

type FoodLookupEntry = {
  fiber?: number | null;
  isFruit: boolean;
  isVegetable: boolean;
  isUltraProcessed: boolean;
  servingSize: number;
};

type FoodLookup = {
  foodsByName: Map<string, FoodLookupEntry>;
  fuzzyMatchers: Array<{ key: string; entry: FoodLookupEntry }>;
};

function createFoodLookup(foods: Awaited<ReturnType<typeof searchFoods>>): FoodLookup {
  const foodsByName = new Map<string, FoodLookupEntry>();

  for (const food of FOOD_CATALOG_REFERENCE) {
    const entry: FoodLookupEntry = {
      fiber: food.fiber ?? null,
      isFruit: Boolean(food.isFruit),
      isVegetable: Boolean(food.isVegetable),
      isUltraProcessed: Boolean(food.isUltraProcessed),
      servingSize: food.gramsPerServing,
    };

    foodsByName.set(normalizeCatalogText(food.name), entry);
    for (const alias of food.aliases) {
      foodsByName.set(normalizeCatalogText(alias), entry);
    }
  }

  for (const food of foods) {
    const existing = foodsByName.get(normalizeCatalogText(food.name));
    foodsByName.set(normalizeCatalogText(food.name), {
      fiber: food.fiber ?? existing?.fiber ?? null,
      isFruit: food.isFruit || existing?.isFruit || false,
      isVegetable: food.isVegetable || existing?.isVegetable || false,
      isUltraProcessed: food.isUltraProcessed || existing?.isUltraProcessed || false,
      servingSize: food.servingSize || existing?.servingSize || 0,
    });
  }

  const fuzzyMatchers = Array.from(foodsByName.entries())
    .filter(([key, entry]) => key.length >= 4 && (entry.isVegetable || entry.isFruit || entry.isUltraProcessed || entry.fiber))
    .sort((first, second) => second[0].length - first[0].length)
    .map(([key, entry]) => ({ key, entry }));

  return {
    foodsByName,
    fuzzyMatchers,
  };
}

function resolveFoodLookupEntry(foodLookup: FoodLookup, ...names: Array<string | undefined>) {
  for (const name of names) {
    if (!name) continue;
    const normalized = normalizeCatalogText(name);
    const exact = foodLookup.foodsByName.get(normalized);
    if (exact) return exact;

    const fuzzy = foodLookup.fuzzyMatchers.find(candidate => normalized.includes(candidate.key) || candidate.key.includes(normalized));
    if (fuzzy) return fuzzy.entry;
  }

  return null;
}

function calculateQualityIndicators(
  meals: Awaited<ReturnType<typeof listUserMeals>>,
  waterMl: number,
  foodLookup: FoodLookup,
) {
  if (!meals.length) {
    return {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: roundNutritionValue(waterMl),
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
    };
  }

  const quality = meals.reduce(
    (acc, meal) => {
      for (const item of meal.items) {
        acc.proteinGrams += Number(item.protein || 0);
        const food = resolveFoodLookupEntry(foodLookup, item.canonicalName, item.foodName, item.portionText);
        if (!food) continue;

        const servingFactor = food.servingSize > 0 && item.estimatedGrams > 0 ? item.estimatedGrams / food.servingSize : item.servings || 1;
        acc.fiberGrams += Number(food.fiber || 0) * servingFactor;
        if (food.isFruit) acc.fruitServings += servingFactor;
        if (food.isVegetable) acc.vegetableServings += servingFactor;
        if (food.isUltraProcessed) acc.ultraProcessedServings += servingFactor;
      }
      return acc;
    },
    {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: roundNutritionValue(waterMl),
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
    },
  );

  quality.mealCount = meals.length;
  quality.regularityScore = calculateRegularityScore(meals);

  return {
    proteinGrams: roundNutritionValue(quality.proteinGrams),
    fiberGrams: roundNutritionValue(quality.fiberGrams),
    waterMl: roundNutritionValue(waterMl),
    fruitServings: roundNutritionValue(quality.fruitServings),
    vegetableServings: roundNutritionValue(quality.vegetableServings),
    ultraProcessedServings: roundNutritionValue(quality.ultraProcessedServings),
    mealCount: quality.mealCount,
    regularityScore: quality.regularityScore,
  };
}

async function buildWeeklyReportSummary(userId: number, weekOffset = 0) {
  const [goal, waterGoal, meals, exercises, waterLogs, foods] = await Promise.all([
    getUserNutritionGoal(userId),
    getUserWaterGoal(userId),
    listUserMeals(userId),
    listUserExercises(userId),
    listUserWaterLogs(userId),
    searchFoods(userId, "", 500),
  ]);
  const foodLookup = createFoodLookup(foods);

  return resolveWeekDates(weekOffset).map(day => {
    const date = getDateKeyInTimeZone(day);
    const weekday = getWeekdayIndexInTimeZone(day);
    const planned = goal.days.find(goalDay => goalDay.weekday === weekday) ?? goal.today;
    const dailyMeals = meals.filter(meal => mealDateKey(meal) === date);
    const dailyExercises = exercises.filter(exercise => getDateKeyInTimeZone(Number(exercise.occurredAt)) === date);
    const dailyWaterLogs = waterLogs.filter(log => getDateKeyInTimeZone(Number(log.occurredAt)) === date);
    const totals = calculateDayTotals(dailyMeals);
    const burnedCalories = dailyExercises.reduce((acc, exercise) => acc + Number(exercise.caloriesBurned ?? 0), 0);
    const waterConsumedMl = dailyWaterLogs.reduce((acc, log) => acc + Number(log.amountMl ?? 0), 0);
    const quality = calculateQualityIndicators(dailyMeals, waterConsumedMl, foodLookup);

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
      goalProtein: planned.proteinGrams,
      goalCarbs: planned.carbsGrams,
      goalFat: planned.fatGrams,
    };
  });
}

function classifyWeeklyDay(day: Awaited<ReturnType<typeof buildWeeklyReportSummary>>[number]) {
  if (day.calories <= 0) return "no_data" as const;
  const ratio = day.goalCalories ? day.calories / day.goalCalories : 0;
  if (ratio > 1.05) return "above" as const;
  if (ratio < 0.9) return "below" as const;
  return "within" as const;
}

export async function getDashboardOverview(userId: number) {
  return getDashboardSnapshot(userId);
}

export async function getWeeklyReport(userId: number, weekOffset = 0) {
  return buildWeeklyReportSummary(userId, weekOffset);
}

export async function getWeeklyProgressReport(userId: number, weekOffset = 0) {
  const [days, fallbackProgress] = await Promise.all([
    buildWeeklyReportSummary(userId, weekOffset),
    getWeeklyProgress(userId),
  ]);

  const totalCalories = roundNutritionValue(days.reduce((acc, day) => acc + day.calories, 0));
  const totalGoalCalories = roundNutritionValue(days.reduce((acc, day) => acc + day.goalCalories, 0));
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

  const balanceCalories = roundNutritionValue(totalGoalCalories - totalNetCalories);
  const message = buildWeeklyNutritionStatus({
    totalCalories,
    daysAboveGoal: daysByStatus.above,
    daysWithinGoal: daysByStatus.within,
  });

  return {
    days: days.map(day => ({
      ...day,
      status: classifyWeeklyDay(day),
      calorieDelta: roundNutritionValue(day.calories - day.goalCalories),
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
    weight: fallbackProgress.weight,
  };
}

export async function getWeeklyInsightsReport(userId: number, weekOffset = 0) {
  const [progress, meals] = await Promise.all([
    getWeeklyProgressReport(userId, weekOffset),
    listUserMeals(userId),
  ]);
  const weekDates = new Set(progress.days.map(day => day.date));
  const weeklyMeals = meals.filter(meal => weekDates.has(mealDateKey(meal)));

  return buildWeeklyInsights(progress, weeklyMeals);
}

export async function getWeeklyReportBundle(userId: number, weekOffset = 0) {
  const [weekly, progress, meals] = await Promise.all([
    buildWeeklyReportSummary(userId, weekOffset),
    getWeeklyProgressReport(userId, weekOffset),
    listUserMeals(userId),
  ]);
  const weekDates = new Set(progress.days.map(day => day.date));
  const weeklyMeals = meals.filter(meal => weekDates.has(mealDateKey(meal)));

  return {
    weekly,
    progress,
    insights: buildWeeklyInsights(progress, weeklyMeals),
    mealsByDate: groupMealsByDate(weeklyMeals),
    quality: buildWeeklyQuality(weekly),
  };
}

export async function getHabitAnalyticsReport(
  userId: number,
  range: { startDate: string; endDate: string },
) {
  const [waterGoal, waterLogs, exercises] = await Promise.all([
    getUserWaterGoal(userId),
    listUserWaterLogs(userId),
    listUserExercises(userId),
  ]);

  const dates = listDateKeysInRange(range.startDate, range.endDate);
  const waterByDate = new Map<string, number>(dates.map(date => [date, 0]));
  const exerciseByDate = new Map<string, { caloriesBurned: number; durationMinutes: number }>(
    dates.map(date => [date, { caloriesBurned: 0, durationMinutes: 0 }]),
  );

  waterLogs.forEach(log => {
    const date = getDateKeyInTimeZone(Number(log.occurredAt));
    if (!waterByDate.has(date)) return;
    waterByDate.set(date, roundNutritionValue((waterByDate.get(date) ?? 0) + Number(log.amountMl ?? 0)));
  });

  exercises.forEach(exercise => {
    const date = getDateKeyInTimeZone(Number(exercise.occurredAt));
    if (!exerciseByDate.has(date)) return;
    const current = exerciseByDate.get(date) ?? { caloriesBurned: 0, durationMinutes: 0 };
    exerciseByDate.set(date, {
      caloriesBurned: roundNutritionValue(current.caloriesBurned + Number(exercise.caloriesBurned ?? 0)),
      durationMinutes: roundNutritionValue(current.durationMinutes + Number(exercise.durationMinutes ?? 0)),
    });
  });

  const waterDays = dates.map(date => ({
    date,
    label: formatPeriodDateLabel(date),
    totalMl: roundNutritionValue(waterByDate.get(date) ?? 0),
  }));
  const totalConsumedMl = roundNutritionValue(waterDays.reduce((total, day) => total + day.totalMl, 0));
  const totalGoalMl = roundNutritionValue(waterGoal.dailyTargetMl * dates.length);
  const goalHitDays = waterGoal.dailyTargetMl > 0
    ? waterDays.filter(day => day.totalMl >= waterGoal.dailyTargetMl).length
    : 0;
  const lowestWaterDay = waterDays.reduce<(typeof waterDays)[number] | null>((current, day) => {
    if (day.totalMl <= 0) return current;
    if (!current || day.totalMl < current.totalMl) return day;
    return current;
  }, null);

  const exerciseDays = dates.map(date => {
    const current = exerciseByDate.get(date) ?? { caloriesBurned: 0, durationMinutes: 0 };
    return {
      date,
      label: formatPeriodDateLabel(date),
      caloriesBurned: roundNutritionValue(current.caloriesBurned),
      durationMinutes: roundNutritionValue(current.durationMinutes),
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
      dayCount: dates.length,
    },
    water: {
      dailyGoalMl: waterGoal.dailyTargetMl,
      totalGoalMl,
      totalConsumedMl,
      goalHitDays,
      averageDailyMl: roundNutritionValue(averageValue(totalConsumedMl, dates.length)),
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