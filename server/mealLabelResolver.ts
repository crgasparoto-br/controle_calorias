import { normalizeText } from "./mealTextParsing";
import type { MealProcessingInput } from "./nutritionEngineTypes";

const DEFAULT_MEAL_LABEL_BY_TIME = [
  { mealLabel: "Café da manhã", startTime: "05:00", endTime: "10:59" },
  { mealLabel: "Almoço", startTime: "11:00", endTime: "14:59" },
  { mealLabel: "Lanche da tarde", startTime: "15:00", endTime: "17:29" },
  { mealLabel: "Pré-treino", startTime: "17:30", endTime: "18:29" },
  { mealLabel: "Jantar", startTime: "18:30", endTime: "22:59" },
  { mealLabel: "Ceia", startTime: "23:00", endTime: "04:59" },
] as const;

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours * 60) + minutes;
}

function isTimeWithinRange(timeMinutes: number, startTime: string, endTime: string) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start <= end) {
    return timeMinutes >= start && timeMinutes <= end;
  }

  return timeMinutes >= start || timeMinutes <= end;
}

function parseDateInput(value: MealProcessingInput["occurredAt"]) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return new Date();
}

function getLocalTimeMinutes(date: Date, timeZone = "America/Sao_Paulo") {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");
  return (hour * 60) + minute;
}

export function inferMealLabelByTime(occurredAt: MealProcessingInput["occurredAt"], timeZone?: string) {
  const timeMinutes = getLocalTimeMinutes(parseDateInput(occurredAt), timeZone);
  return DEFAULT_MEAL_LABEL_BY_TIME.find(schedule =>
    isTimeWithinRange(timeMinutes, schedule.startTime, schedule.endTime),
  )?.mealLabel ?? "Refeição registrada";
}

function findExplicitMealLabel(sourceText: string) {
  const normalized = normalizeText(sourceText).replace(/-/g, " ").replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (/\b(pre treino|pretreino)\b/.test(normalized)) {
    return "Pré-treino";
  }
  if (/\b(pos treino|postreino)\b/.test(normalized)) {
    return "Pós-treino";
  }
  if (/\b(cafe da manha|cafe de manha|desjejum)\b/.test(normalized)) {
    return "Café da manhã";
  }
  if (/\balmoco\b/.test(normalized)) {
    return "Almoço";
  }
  if (/\b(jantar|janta)\b/.test(normalized)) {
    return "Jantar";
  }
  if (normalized === "lanche da tarde") {
    return "Lanche da tarde";
  }
  if (/\blanche\b/.test(normalized)) {
    return "Lanche";
  }
  if (/\bceia\b/.test(normalized)) {
    return "Ceia";
  }

  return null;
}

export function resolveMealLabel(input: MealProcessingInput, sourceText: string) {
  const explicitMealLabel = findExplicitMealLabel(sourceText);
  if (explicitMealLabel) {
    return explicitMealLabel;
  }

  return input.suggestedMealLabel?.trim() || inferMealLabelByTime(input.occurredAt, input.timeZone);
}
