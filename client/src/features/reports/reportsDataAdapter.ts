export type ReportDateRange = { start: string; end: string };
export type ReportDataMode = "week" | "period";

const WEEKLY_REPORT_DAY_COUNT = 7;

const REQUIRED_WEEKLY_NUMBER_FIELDS = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "goalCalories",
  "adjustedGoalCalories",
  "goalProtein",
  "goalCarbs",
  "goalFat",
  "waterConsumedMl",
  "waterGoalMl",
  "exerciseCalories",
] as const;

function firstArray(...candidates: unknown[]) {
  return candidates.find(Array.isArray) as unknown[] | undefined;
}

export function extractReportDays(data: unknown, mode: ReportDataMode) {
  const report = data as Record<string, unknown> | null | undefined;

  if (mode === "week") {
    return firstArray(data, report?.weekly, report?.weeklyReport, report?.days) ?? [];
  }

  return firstArray(report?.daily, report?.days) ?? [];
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function hasFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function hasRenderableWeeklyNumbers(day: Record<string, unknown>) {
  return REQUIRED_WEEKLY_NUMBER_FIELDS.every(field => hasFiniteNumber(day[field]));
}

export function isRenderableWeeklySummary(data: unknown, range: ReportDateRange) {
  const days = extractReportDays(data, "week");
  if (days.length !== WEEKLY_REPORT_DAY_COUNT) return false;

  const seenDates = new Set<string>();

  for (const rawDay of days) {
    if (!rawDay || typeof rawDay !== "object") return false;

    const day = rawDay as Record<string, unknown>;
    const date = day.date;
    if (!isDateKey(date)) return false;
    if (date < range.start || date > range.end) return false;
    if (seenDates.has(date)) return false;
    if (!hasRenderableWeeklyNumbers(day)) return false;

    seenDates.add(date);
  }

  return seenDates.size === WEEKLY_REPORT_DAY_COUNT;
}
