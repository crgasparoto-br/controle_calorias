import { getDashboardSnapshot, getWeeklySummary } from "../../db";

export async function getDashboardOverview(userId: number) {
  return getDashboardSnapshot(userId);
}

export async function getWeeklyReport(userId: number) {
  return getWeeklySummary(userId);
}
