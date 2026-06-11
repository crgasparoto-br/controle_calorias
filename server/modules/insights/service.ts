import {
  getHabitSnapshots,
  getUserNutritionGoal,
  getUserGamification,
  getUserWaterGoal,
  getWeeklyProgress,
  listUserExercisesByDate,
  listUserMeals,
  listUserMealsByDate,
  listUserWaterLogsByDate,
  searchFoods,
} from "../../db";
import { FOOD_CATALOG_REFERENCE } from "../../foodCatalogReference";
import { calculateDayTotals, roundNutritionValue } from "../../../shared/mealTotals";
import { buildWeeklyNutritionStatus } from "../../../shared/safeMessages";
import { getDateKeyInTimeZone, getWeekdayIndexInTimeZone, toLogicalDateInTimeZone } from "../../../shared/timeZone";
import { calculateFoodQualitySummary, type FoodQualityDay } from "../../../shared/reportsGoalAnalytics";
import { weeklyInsightService } from "./weeklyInsightService";

function mealDateKey(meal: { occurredAt: number }) {
  return getDateKeyInTimeZone(meal.occurredAt);
}

function dateKeyToLogicalDate(date: string) {
  return new Date(`${date}T12:00:00Z`);
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
  const totals = weekly.reduce(
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
    foodQuality: calculateFoodQualitySummary(totals.foodQualityDays, weekly.length),
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

function buildWeightTrendForDates(entries: WeightEntryForTrend[] | undefined, dates: string[]) {
  const dateSet = new Set(dates);
  const points = (entries ?? [])
    .filter(entry => dateSet.has(entry.date) && Number.isFinite(entry.weightKg))
    .map(entry => ({
      id: entry.id,
      date: entry.date,
      label: formatPeriodDateLabel(entry.date),
      weightKg: roundNutritionValue(entry.weightKg),
      notes: entry.notes ?? null,
    }))
    .sort((first, second) => first.date.localeCompare(second.date));
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

type ReportRangeData = {
  dates: string[];
  mealsByDay: Array<Awaited<ReturnType<typeof listUserMealsByDate>>>;
  exercisesByDay: Array<Awaited<ReturnType<typeof listUserExercisesByDate>>>;
  waterLogsByDay: Array<Awaited<ReturnType<typeof listUserWaterLogsByDate>>>;
};

async function loadReportRangeData(userId: number, dates: string[]): Promise<ReportRangeData> {
  const [mealsByDay, exercisesByDay, waterLogsByDay] = await Promise.all([
    Promise.all(dates.map(date => listUserMealsByDate(userId, date, { includeMedia: false }))),
    Promise.all(dates.map(date => listUserExercisesByDate(userId, date))),
    Promise.all(dates.map(date => listUserWaterLogsByDate(userId, date))),
  ]);

  return { dates, mealsByDay, exercisesByDay, waterLogsByDay };
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
  foodLookup?: FoodLookup,
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
      foodQualityItems: [] as FoodQualityDay["items"],
    };
  }

  const quality = meals.reduce(
    (acc, meal) => {
      for (const item of meal.items) {
        const itemCalories = Number(item.calories || 0);
        acc.proteinGrams += Number(item.protein || 0);

        if (!foodLookup) {
          acc.foodQualityItems.push({ calories: itemCalories, isClassified: false });
          continue;
        }

        const food = resolveFoodLookupEntry(foodLookup, item.canonicalName, item.foodName, item.portionText);
        if (!food) {
          acc.foodQualityItems.push({ calories: itemCalories, isClassified: false });
          continue;
        }

        const servingFactor = food.servingSize > 0 && item.estimatedGrams > 0 ? item.estimatedGrams / food.servingSize : item.servings || 1;
        acc.fiberGrams += Number(food.fiber || 0) * servingFactor;
        if (food.isFruit) acc.fruitServings += servingFactor;
        if (food.isVegetable) acc.vegetableServings += servingFactor;
        if (food.isUltraProcessed) acc.ultraProcessedServings += servingFactor;
        acc.foodQualityItems.push({
          calories: itemCalories,
          isClassified: true,
          isFruit: food.isFruit,
          isVegetable: food.isVegetable,
          isUltraProcessed: food.isUltraProcessed,
        });
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
      foodQualityItems: [] as FoodQualityDay["items"],
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
    foodQualityItems: quality.foodQualityItems,
  };
}

async function buildWeeklyReportSummary(userId: number, weekOffset = 0) {
  const dateKeys = resolveWeekDates(weekOffset).map(day => getDateKeyInTimeZone(day));
  const [goal, waterGoal, foods, rangeData] = await Promise.all([
    getUserNutritionGoal(userId),
    getUserWaterGoal(userId),
    searchFoods(userId, "", 500),
    loadReportRangeData(userId, dateKeys),
  ]);
  const foodLookup = createFoodLookup(foods);

  return rangeData.dates.map((date, index) => {
    const weekday = getWeekdayIndexInTimeZone(dateKeyToLogicalDate(date));
    const planned = goal.days.find(goalDay => goalDay.weekday === weekday) ?? goal.today;
    const dailyMeals = rangeData.mealsByDay[index] ?? [];
    const dailyExercises = rangeData.exercisesByDay[index] ?? [];
    const dailyWaterLogs = rangeData.waterLogsByDay[index] ?? [];
    const totals = calculateDayTotals(dailyMeals);
    const burnedCalories = dailyExercises.reduce((acc, exercise) => acc + Number(exercise.caloriesBurned ?? 0), 0);
    const waterConsumedMl = dailyWaterLogs.reduce((acc, log) => acc + Number(log.amountMl ?? 0), 0);
    const quality = calculateQualityIndicators(dailyMeals, waterConsumedMl, foodLookup);
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
    buildWeeklyReportSummary(userId),
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
  const weeklyBurnedCalories = weekly.reduce((acc, day) => acc + day.exerciseCalories, 0);
  const weeklyQuality = buildWeeklyQuality(weekly);

  return {
    goal,
    today,
    week: {
      planned: {
        calories: roundNutritionValue(goal.weeklyTotals.calories),
        protein: roundNutritionValue(goal.weeklyTotals.proteinGrams),
        carbs: roundNutritionValue(goal.weeklyTotals.carbsGrams),
        fat: roundNutritionValue(goal.weeklyTotals.fatGrams),
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
        remainingToGoal: roundNutritionValue(goal.weeklyTotals.calories - (weeklyConsumed.calories - weeklyBurnedCalories)),
      },
      remaining: {
        calories: roundNutritionValue(goal.weeklyTotals.calories - weeklyConsumed.calories),
        protein: roundNutritionValue(goal.weeklyTotals.proteinGrams - weeklyConsumed.protein),
        carbs: roundNutritionValue(goal.weeklyTotals.carbsGrams - weeklyConsumed.carbs),
        fat: roundNutritionValue(goal.weeklyTotals.fatGrams - weeklyConsumed.fat),
      },
      adherence: roundNutritionValue(
        goal.weeklyTotals.calories
          ? Math.min((weeklyConsumed.calories / goal.weeklyTotals.calories) * 100, 100)
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
  const selectedWeekday = getWeekdayIndexInTimeZone(dateKeyToLogicalDate(selectedDate));
  const [goal, waterGoal, todaysMeals, todaysExercises, todaysWaterLogs, foods] = await Promise.all([
    getUserNutritionGoal(userId),
    getUserWaterGoal(userId),
    listUserMealsByDate(userId, selectedDate, { includeMedia: false }),
    listUserExercisesByDate(userId, selectedDate),
    listUserWaterLogsByDate(userId, selectedDate),
    options.includeQualityDetails ? searchFoods(userId, "", 500) : Promise.resolve(null),
  ]);
  const plannedGoal = goal.days.find(goalDay => goalDay.weekday === selectedWeekday) ?? goal.today;
  const todayTotals = calculateDayTotals(todaysMeals);
  const todayBurnedCalories = todaysExercises.reduce((acc, exercise) => acc + Number(exercise.caloriesBurned ?? 0), 0);
  const todayWaterMl = todaysWaterLogs.reduce((acc, log) => acc + Number(log.amountMl ?? 0), 0);
  const todayQuality = calculateQualityIndicators(todaysMeals, todayWaterMl, foods ? createFoodLookup(foods) : undefined);

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
  return buildWeeklyReportSummary(userId, weekOffset);
}

export async function getWeeklyProgressReport(userId: number, weekOffset = 0) {
  const [days, fallbackProgress] = await Promise.all([
    buildWeeklyReportSummary(userId, weekOffset),
    getWeeklyProgress(userId),
  ]);

  return buildWeeklyProgressFromSummary(days, fallbackProgress);
}

export async function getWeeklyInsightsReport(userId: number, weekOffset = 0) {
  const [progress, mealsByDay] = await Promise.all([
    getWeeklyProgressReport(userId, weekOffset),
    Promise.all(resolveWeekDates(weekOffset).map(day => listUserMealsByDate(userId, getDateKeyInTimeZone(day), { includeMedia: false }))),
  ]);
  const weeklyMeals = mealsByDay.flat();

  return buildWeeklyInsights(progress, weeklyMeals);
}

export async function getWeeklyReportBundle(userId: number, weekOffset = 0) {
  const dateKeys = resolveWeekDates(weekOffset).map(day => getDateKeyInTimeZone(day));
  const [weekly, fallbackProgress, mealsByDay] = await Promise.all([
    buildWeeklyReportSummary(userId, weekOffset),
    getWeeklyProgress(userId),
    Promise.all(dateKeys.map(date => listUserMealsByDate(userId, date, { includeMedia: false }))),
  ]);
  const progress = buildWeeklyProgressFromSummary(weekly, fallbackProgress);
  const weeklyMeals = mealsByDay.flat();

  return {
    weekly,
    progress,
    insights: buildWeeklyInsights(progress, weeklyMeals),
    mealsByDate: groupMealsByDate(weeklyMeals),
    quality: buildWeeklyQuality(weekly),
  };
}

export async function getPeriodReportBundle(
  userId: number,
  range: { startDate: string; endDate: string },
) {
  const dates = listDateKeysInRange(range.startDate, range.endDate);
  const [goal, waterGoal, foods, progress, rangeData] = await Promise.all([
    getUserNutritionGoal(userId),
    getUserWaterGoal(userId),
    searchFoods(userId, "", 500),
    getWeeklyProgress(userId),
    loadReportRangeData(userId, dates),
  ]);
  const habitAnalytics = buildHabitAnalyticsFromRange(waterGoal, rangeData, range);
  const meals = rangeData.mealsByDay.flat();
  const totals = calculateDayTotals(meals);
  const mealsByDate = groupMealsByDate(meals);
  const foodLookup = createFoodLookup(foods);
  const foodQualityDays: FoodQualityDay[] = [];
  const daily = dates.map((date, index) => {
    const planned = goal.days.find(goalDay => goalDay.weekday === getWeekdayIndexInTimeZone(dateKeyToLogicalDate(date))) ?? goal.today;
    const dailyMeals = rangeData.mealsByDay[index] ?? [];
    const dailyExercises = rangeData.exercisesByDay[index] ?? [];
    const dailyTotals = calculateDayTotals(dailyMeals);
    const dailyQuality = calculateQualityIndicators(dailyMeals, 0, foodLookup);
    const exerciseCalories = dailyExercises.reduce((total, exercise) => total + Number(exercise.caloriesBurned ?? 0), 0);
    const adjustedGoalCalories = calculateAdjustedGoalCalories(planned.calories, exerciseCalories);
    foodQualityDays.push({ date, items: dailyQuality.foodQualityItems });

    return {
      date,
      label: formatPeriodDateLabel(date),
      calories: roundNutritionValue(dailyTotals.calories),
      protein: roundNutritionValue(dailyTotals.protein),
      carbs: roundNutritionValue(dailyTotals.carbs),
      fat: roundNutritionValue(dailyTotals.fat),
      exerciseCalories: roundNutritionValue(exerciseCalories),
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
  const weightTrend = buildWeightTrendForDates(progress.weight.entries, dates);

  return {
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      dayCount: dates.length,
    },
    goal: {
      calories: goal.today.calories,
      protein: goal.today.proteinGrams,
      carbs: goal.today.carbsGrams,
      fat: goal.today.fatGrams,
      label: goal.today.label,
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
    quality: {
      foodQuality: calculateFoodQualitySummary(foodQualityDays, dates.length),
    },
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
