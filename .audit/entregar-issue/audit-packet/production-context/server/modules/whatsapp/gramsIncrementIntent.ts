import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { handleMealItemMultiIncrement } from "./intent/gramsAdjustmentHandlers";

const MEALS = ["cafe da manha", "almoco", "jantar", "lanche da tarde", "lanche", "ceia"];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function labelRegex(label: string) {
  return label.replace(/\s+/g, "\\s+");
}

function mealFromText(text: string) {
  return MEALS.find(label => new RegExp(`\\b(?:do|da|de|no|na|ao|a|para)\\s+(?:refeicao\\s+)?${labelRegex(label)}\\b`).test(text)) ?? null;
}

function cleanFood(value: string | null, mealLabel: string | null) {
  if (!value) return null;
  let cleaned = value.replace(/^\s*(?:o|a|os|as|ao|aos|no|na|do|da|de|dos|das)\s+/i, "").trim();
  if (mealLabel) cleaned = cleaned.replace(new RegExp(`\\s+(?:do|da|de|no|na|ao|a|para)\\s+(?:refeicao\\s+)?${labelRegex(mealLabel)}\\s*$`, "i"), "").trim();
  return cleaned || null;
}

function parse(text: string) {
  const normalized = normalize(text);
  if (!/\b(?:somar|soma|some|adicionar|adiciona|adicione|acrescentar|acrescenta|acrescente|colocar\s+mais|coloca\s+mais|coloque\s+mais|aumentar|aumenta|aumente)\b/.test(normalized)) return null;
  const mealLabel = mealFromText(normalized);
  const increments: Array<{ gramsDelta: number; targetFood: string | null }> = [];
  const rx = /(\d+(?:[,.]\d+)?)\s*(?:g|gr|gramas?|ml|mililitros?)\b(?:\s+(?:(?:aos|dos|das|ao|as|os|no|na|do|da|de|a|o)\s+)?((?:(?!\d|\be\s+\d|[,;]\s*\d)\S+\s*)+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(normalized)) !== null) {
    const gramsDelta = Number(match[1].replace(",", "."));
    if (Number.isFinite(gramsDelta) && gramsDelta > 0) increments.push({ gramsDelta, targetFood: cleanFood(match[2]?.trim() ?? null, mealLabel) });
  }
  return increments.length ? { mealLabel, increments } : null;
}

export async function executeWhatsappGramsIncrementIntent(
  userId: number,
  input: { text?: string | null; receivedAt?: Date; userTimezone?: string },
) {
  const parsed = input.text ? parse(input.text) : null;
  if (!parsed) return null;
  const result = await handleMealItemMultiIncrement(userId, parsed.increments, { mealLabel: parsed.mealLabel, timeZone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE });
  if (result.action !== "meal_item_grams_adjusted") return result;
  const adjustments = Array.isArray(result.data?.adjustments) ? result.data.adjustments : [];
  return {
    ...result,
    reply: result.reply.includes("recalculei os macros") ? result.reply : `${result.reply}\n\nTambém recalculei os macros da refeição.`,
    data: { ...result.data, increments: adjustments },
  };
}

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: false,
  usesSummary: false,
  usesPendingOperation: true,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
