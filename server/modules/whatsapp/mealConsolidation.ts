import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { normalizeWhatsAppIntentText } from "./webhookUtils";

export type WhatsAppMealConsolidationCandidate = {
  id: number;
  userId?: number;
  source?: string | null;
  mealLabel: string;
  occurredAt: number | string | Date;
  items?: unknown[];
};

export type WhatsAppMealConsolidationResolution =
  | { action: "append"; meal: WhatsAppMealConsolidationCandidate }
  | { action: "create" }
  | { action: "ambiguous"; meals: WhatsAppMealConsolidationCandidate[] };

function normalizeMealLabel(label: string) {
  const normalized = normalizeWhatsAppIntentText(label);
  if (normalized.includes("cafe") || normalized.includes("manha")) return "cafe da manha";
  if (normalized.includes("almoco")) return "almoco";
  if (normalized.includes("janta")) return "jantar";
  if (normalized.includes("lanche")) return "lanche";
  if (normalized.includes("bebida")) return "bebida";
  return normalized;
}

export function formatWhatsAppConsolidationDateKey(
  date: number | string | Date,
  timeZone = DEFAULT_APP_TIME_ZONE,
) {
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? "" : getDateKeyInTimeZone(parsed, timeZone);
}

export function resolveWhatsAppMealConsolidationTarget(input: {
  savedMealId: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  meals: WhatsAppMealConsolidationCandidate[];
  timeZone?: string;
}): WhatsAppMealConsolidationResolution {
  const timeZone = input.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const targetDateKey = formatWhatsAppConsolidationDateKey(input.occurredAt, timeZone);
  const targetMealLabel = normalizeMealLabel(input.mealLabel);

  if (!targetDateKey || !targetMealLabel) {
    return { action: "create" };
  }

  const candidates = input.meals
    .filter(meal => meal.id !== input.savedMealId)
    .filter(meal => meal.source === "whatsapp")
    .filter(meal => formatWhatsAppConsolidationDateKey(meal.occurredAt, timeZone) === targetDateKey)
    .filter(meal => normalizeMealLabel(meal.mealLabel) === targetMealLabel)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  if (candidates.length === 0) {
    return { action: "create" };
  }

  if (candidates.length === 1) {
    return { action: "append", meal: candidates[0] };
  }

  return { action: "ambiguous", meals: candidates };
}
