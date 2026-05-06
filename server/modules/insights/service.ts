import { getDashboardSnapshot, getWeeklyProgress, getWeeklySummary, listUserMeals } from "../../db";
import { weeklyInsightService } from "./weeklyInsightService";

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
  const weeklyMeals = meals.filter(meal => weekDates.has(new Date(meal.occurredAt).toISOString().slice(0, 10)));

  return {
    generatedAt: new Date().toISOString(),
    weekStart: progress.days[0]?.date ?? null,
    weekEnd: progress.days[progress.days.length - 1]?.date ?? null,
    insights: weeklyInsightService.generate({
      days: progress.days,
      meals: weeklyMeals,
    }),
  };
}
