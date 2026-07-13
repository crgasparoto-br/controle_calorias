import { handleMealItemMultiAdjustment } from "./intent/gramsAdjustmentHandlers";

export type WhatsappGramsAdjustmentResult = Awaited<ReturnType<typeof handleMealItemMultiAdjustment>>;

const MEALS = ["cafe da manha", "almoco", "jantar", "lanche da tarde", "lanche", "ceia"];
const MEAL_PREPOSITIONS = ["do", "da", "de", "no", "na", "ao", "a", "para"];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function mealReferenceSuffixes(mealLabel: string) {
  return MEAL_PREPOSITIONS.flatMap(preposition => [`${preposition} ${mealLabel}`, `${preposition} refeicao ${mealLabel}`]);
}

function mealFromText(text: string) {
  return MEALS.find(label => mealReferenceSuffixes(label).some(reference => text === reference || text.includes(` ${reference}`) || text.includes(`${reference} `))) ?? null;
}

function cleanFood(value: string | null, mealLabel: string | null) {
  if (!value) return null;
  let cleaned = value.replace(/^\s*(?:o|a|os|as|ao|aos|no|na|do|da|de|dos|das)\s+/i, "").trim();
  if (mealLabel) {
    for (const suffix of mealReferenceSuffixes(mealLabel)) {
      if (cleaned === suffix) return null;
      if (cleaned.endsWith(` ${suffix}`)) {
        cleaned = cleaned.slice(0, -suffix.length).trim();
        break;
      }
    }
  }
  return cleaned || null;
}

function parse(text: string) {
  const normalized = normalize(text);
  if (!/\b(?:diminuir|diminui|diminuia|reduzir|reduz|reduza|tirar|tira|tire|remover|remove|remova|descontar|desconta|desconte)\b/.test(normalized)) return null;
  const mealLabel = mealFromText(normalized);
  const adjustments: Array<{ gramsDelta: number; targetFood: string | null }> = [];
  const rx = /(\d+(?:[,.]\d+)?)\s*(?:g|gr|gramas?|ml|mililitros?)\b(?:\s+(?:(?:aos|dos|das|ao|as|os|no|na|do|da|de|a|o)\s+)?((?:(?!\d|\be\s+\d|[,;]\s*\d)\S+\s*)+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(normalized)) !== null) {
    const gramsDelta = Number(match[1].replace(",", "."));
    if (Number.isFinite(gramsDelta) && gramsDelta > 0) adjustments.push({ gramsDelta, targetFood: cleanFood(match[2]?.trim() ?? null, mealLabel) });
  }
  return adjustments.length ? adjustments : null;
}

export async function executeWhatsappGramsAdjustmentIntent(
  userId: number,
  input: { text?: string | null; receivedAt?: Date },
): Promise<WhatsappGramsAdjustmentResult | null> {
  const adjustments = input.text ? parse(input.text) : null;
  if (!adjustments) return null;
  return handleMealItemMultiAdjustment(userId, adjustments);
}

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: false,
  usesSummary: false,
  usesPendingOperation: true,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
