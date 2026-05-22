import { getDashboardSnapshot, getWeeklyProgress, getWeeklySummary, listUserMeals } from "../../db";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
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

function buildWeeklyQuality(weekly: Awaited<ReturnType<typeof getWeeklySummary>>) {
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

function buildWeeklyInsights(progress: Awaited<ReturnType<typeof getWeeklyProgress>>, meals: Awaited<ReturnType<typeof listUserMeals>>) {
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

export async function getDashboardOverview(userId: number) {
  return getDashboardSnapshot(userId);
}

export async function getWeeklyReport(userId: number) {
  return getWeeklySummary(userId);
}

export async function getWeeklyProgressReport(userId: number) {
  return getWeeklyProgress(userId);
}

export async function getWeeklyInsightsReport(userId: number) {
  const [progress, meals] = await Promise.all([
    getWeeklyProgress(userId),
    listUserMeals(userId),
  ]);
  const weekDates = new Set(progress.days.map(day => day.date));
  const weeklyMeals = meals.filter(meal => weekDates.has(mealDateKey(meal)));

  return buildWeeklyInsights(progress, weeklyMeals);
}

export async function getWeeklyReportBundle(userId: number) {
  const [weekly, progress, meals] = await Promise.all([
    getWeeklySummary(userId),
    getWeeklyProgress(userId),
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
