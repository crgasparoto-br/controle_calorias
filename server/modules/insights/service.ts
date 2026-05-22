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

function createFoodLookup(foods: Awaited<ReturnType<typeof searchFoods>>) {
  const foodsByName = new Map<string, Awaited<ReturnType<typeof searchFoods>>[number]>();
  for (const food of foods) {
    foodsByName.set(normalizeCatalogText(food.name), food);
  }
  return foodsByName;
}

function calculateQualityIndicators(
  meals: Awaited<ReturnType<typeof listUserMeals>>,
  waterMl: number,
  foodsByName: Map<string, Awaited<ReturnType<typeof searchFoods>>[number]>,
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
        const food = foodsByName.get(normalizeCatalogText(item.canonicalName)) ?? foodsByName.get(normalizeCatalogText(item.foodName));
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
  const foodsByName = createFoodLookup(foods);

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
    const quality = calculateQualityIndicators(dailyMeals, waterConsumedMl, foodsByName);

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
