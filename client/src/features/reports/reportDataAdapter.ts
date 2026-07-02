export type ReportTotals = { calories: number; protein: number; carbs: number; fat: number };
export type ReportDay = ReportTotals & {
  date: string;
  label: string;
  goalCalories: number;
  adjustedGoalCalories: number;
  goalProtein: number;
  goalCarbs: number;
  goalFat: number;
  waterConsumedMl: number;
  waterGoalMl: number;
  exerciseCalories: number;
  quality?: unknown;
};

export type WeeklyReportValidation =
  | { renderable: true; days: ReportDay[]; reason: null }
  | { renderable: false; days: []; reason: string };

export const MAX_REPORT_RANGE_DAYS = 90;

const WEEKLY_DAY_COUNT = 7;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_WEEKLY_NUMERIC_FIELDS = [
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

type WeeklyNumericField = (typeof REQUIRED_WEEKLY_NUMERIC_FIELDS)[number];

export function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasFiniteNumericField(day: Record<string, unknown>, field: WeeklyNumericField) {
  if (!(field in day)) return false;
  return Number.isFinite(Number(day[field]));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeReportDay(day: unknown, fallbackGoal?: Record<string, unknown> | null): ReportDay {
  const source = isObjectRecord(day) ? day : {};
  const goalCalories = numberValue(source.goalCalories ?? fallbackGoal?.calories);
  const adjustedGoalCalories = numberValue(source.adjustedGoalCalories ?? source.goalCalories ?? fallbackGoal?.calories);

  return {
    date: String(source.date ?? ""),
    label: String(source.label ?? (source.date ? source.date : "-")),
    calories: numberValue(source.calories),
    protein: numberValue(source.protein),
    carbs: numberValue(source.carbs),
    fat: numberValue(source.fat),
    goalCalories,
    adjustedGoalCalories,
    goalProtein: numberValue(source.goalProtein ?? fallbackGoal?.protein ?? fallbackGoal?.proteinGrams),
    goalCarbs: numberValue(source.goalCarbs ?? fallbackGoal?.carbs ?? fallbackGoal?.carbsGrams),
    goalFat: numberValue(source.goalFat ?? fallbackGoal?.fat ?? fallbackGoal?.fatGrams),
    waterConsumedMl: numberValue(source.waterConsumedMl),
    waterGoalMl: numberValue(source.waterGoalMl),
    exerciseCalories: numberValue(source.exerciseCalories),
    quality: source.quality,
  };
}

export function extractWeeklyReportDays(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isObjectRecord(value)) return [];

  const candidates = [value.weekly, value.weeklyReport, value.days];
  return candidates.find(Array.isArray) ?? [];
}

export function validateWeeklyReportData(value: unknown): WeeklyReportValidation {
  const rawDays = extractWeeklyReportDays(value);

  if (rawDays.length !== WEEKLY_DAY_COUNT) {
    return { renderable: false, days: [], reason: `expected_${WEEKLY_DAY_COUNT}_days` };
  }

  const dates = new Set<string>();
  for (const rawDay of rawDays) {
    if (!isObjectRecord(rawDay)) {
      return { renderable: false, days: [], reason: "day_not_object" };
    }

    const date = String(rawDay.date ?? "");
    if (!DATE_PATTERN.test(date)) {
      return { renderable: false, days: [], reason: "invalid_day_date" };
    }
    if (dates.has(date)) {
      return { renderable: false, days: [], reason: "duplicated_day_date" };
    }
    dates.add(date);

    const missingField = REQUIRED_WEEKLY_NUMERIC_FIELDS.find(field => !hasFiniteNumericField(rawDay, field));
    if (missingField) {
      return { renderable: false, days: [], reason: `invalid_${missingField}` };
    }

    if (rawDay.quality !== undefined && !isObjectRecord(rawDay.quality)) {
      return { renderable: false, days: [], reason: "invalid_quality" };
    }
  }

  return { renderable: true, days: rawDays.map(day => normalizeReportDay(day)), reason: null };
}
