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

export function formatWhatsAppConsolidationDateKey(date: number | string | Date) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function resolveWhatsAppMealConsolidationTarget(input: {
  savedMealId: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  meals: WhatsAppMealConsolidationCandidate[];
}): WhatsAppMealConsolidationResolution {
  const targetDateKey = formatWhatsAppConsolidationDateKey(input.occurredAt);
  const targetMealLabel = normalizeMealLabel(input.mealLabel);

  if (!targetDateKey || !targetMealLabel) {
    return { action: "create" };
  }

  const candidates = input.meals
    .filter(meal => meal.id !== input.savedMealId)
    .filter(meal => meal.source === "whatsapp")
    .filter(meal => formatWhatsAppConsolidationDateKey(meal.occurredAt) === targetDateKey)
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
