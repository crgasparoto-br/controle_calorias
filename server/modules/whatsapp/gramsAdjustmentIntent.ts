import { listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { formatMealItemTargetOptions, resolveMealItemTarget } from "./mealItemTargetMatcher";
import { buildWhatsAppMealActionReplyMessage } from "./replyMessages";

type Meal = Awaited<ReturnType<typeof listMeals>>[number];
type Item = NonNullable<Meal["items"]>[number];
const MEALS = ["cafe da manha", "almoco", "jantar", "lanche da tarde", "lanche", "ceia"];
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_GRAMS = 1;

function norm(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function fmt(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value); }
function itemName(item: Item) { return item.foodName || item.canonicalName || "item"; }
function labelRx(label: string) { return label.replace(/\s+/g, "\\s+"); }
function mealFromText(text: string) { return MEALS.find(label => new RegExp(`\b(?:do|da|de|no|na|ao|a|para)\s+(?:refeicao\s+)?${labelRx(label)}\b`).test(text)) ?? null; }
function cleanFood(value: string | null, mealLabel: string | null) {
  if (!value) return null;
  let cleaned = value.replace(/^\s*(?:o|a|os|as|ao|aos|no|na|do|da|de|dos|das)\s+/i, "").trim();
  if (mealLabel) cleaned = cleaned.replace(new RegExp(`\s+(?:do|da|de|no|na|ao|a|para)\s+(?:refeicao\s+)?${labelRx(mealLabel)}\s*$`, "i"), "").trim();
  return cleaned || null;
}
function parse(text: string) {
  const normalized = norm(text);
  if (!/\b(?:diminuir|diminui|diminuia|reduzir|reduz|reduza|tirar|tira|tire|remover|remove|remova|descontar|desconta|desconte)\b/.test(normalized)) return null;
  const mealLabel = mealFromText(normalized);
  const adjustments: Array<{ gramsDelta: number; targetFood: string | null }> = [];
  const rx = /(\d+(?:[,.]\d+)?)\s*(?:g|gr|gramas?|ml|mililitros?)\b(?:\s+(?:(?:aos|dos|das|ao|as|os|no|na|do|da|de|a|o)\s+)?((?:(?!\d|\be\s+\d|[,;]\s*\d)\S+\s*)+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(normalized)) !== null) {
    const gramsDelta = Number(match[1].replace(",", "."));
    if (Number.isFinite(gramsDelta) && gramsDelta > 0) adjustments.push({ gramsDelta, targetFood: cleanFood(match[2]?.trim() ?? null, mealLabel) });
  }
  return adjustments.length ? { mealLabel, adjustments } : null;
}
function findItem(items: Item[], food: string | null) {
  const target = resolveMealItemTarget(items, food);
  return target.kind === "matched" ? target.index : -1;
}
function findMeal(meals: Meal[], intent: NonNullable<ReturnType<typeof parse>>) {
  if (intent.mealLabel) return meals.find(meal => norm(meal.mealLabel ?? "").includes(intent.mealLabel!)) ?? null;
  const targets = intent.adjustments.filter(x => x.targetFood);
  if (!targets.length) return meals[0] ?? null;

  const latestMeal = meals[0];
  const latestHasAmbiguousTarget = targets.some(target => resolveMealItemTarget(latestMeal?.items ?? [], target.targetFood).kind === "ambiguous");
  if (latestHasAmbiguousTarget) return latestMeal ?? null;

  return meals.find(meal => targets.every(target => findItem(meal.items ?? [], target.targetFood) >= 0)) ?? latestMeal ?? null;
}
function scale(item: Item, grams: number): MealItemInput {
  const old = Number(item.estimatedGrams || 0), ratio = old > 0 ? grams / old : 1;
  return { ...item, estimatedGrams: grams, portionText: `${fmt(grams)} g`, quantity: grams, unit: "g", servings: Math.max(Number(item.servings || 1) * ratio, 0.1), calories: Number((Number(item.calories || 0) * ratio).toFixed(1)), protein: Number((Number(item.protein || 0) * ratio).toFixed(1)), carbs: Number((Number(item.carbs || 0) * ratio).toFixed(1)), fat: Number((Number(item.fat || 0) * ratio).toFixed(1)) } as MealItemInput;
}
export async function executeWhatsappGramsAdjustmentIntent(userId: number, input: { text?: string | null; receivedAt?: Date }) {
  const intent = input.text ? parse(input.text) : null;
  if (!intent) return null;
  const now = (input.receivedAt ?? new Date()).getTime();
  const meals = (await listMeals(userId)).filter(meal => { const at = new Date(meal.occurredAt).getTime(); return Number.isFinite(at) && at <= now && now - at <= WINDOW_MS; }).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const latestMeal = meals[0], meal = findMeal(meals, intent);
  const context = meal ? (intent.mealLabel || meal.id !== latestMeal?.id ? `refeicao ${meal.mealLabel}` : "ultima refeicao") : intent.mealLabel ? `refeicao ${intent.mealLabel}` : "refeicao recente";
  if (!meal?.items?.length) return { handled: true, action: "clarification_needed" as const, reply: `Nao encontrei esses alimentos na ${context}. Me diga quais itens devo ajustar.`, eventType: "whatsapp.intent.clarification_needed", detail: "Pedido de reducao de gramas sem refeicao compativel." };
  let items: Item[] = [...meal.items];
  const applied: Array<{ foodName: string; previousGrams: number; nextGrams: number }> = [];
  for (const adjustment of intent.adjustments) {
    const target = resolveMealItemTarget(items, adjustment.targetFood);
    if (target.kind === "ambiguous") {
      return {
        handled: true,
        action: "clarification_needed" as const,
        reply: `Encontrei mais de um item para ${adjustment.targetFood ?? "esse alimento"} na ${context}:\n${formatMealItemTargetOptions(target.candidates)}\nResponda com o numero do item que devo ajustar.`,
        eventType: "whatsapp.intent.clarification_needed",
        detail: "Pedido de reducao de gramas com mais de um alimento compativel.",
      };
    }
    if (target.kind !== "matched") continue;
    const previousGrams = Number(items[target.index].estimatedGrams || 0), nextGrams = Math.max(previousGrams - adjustment.gramsDelta, MIN_GRAMS);
    applied.push({ foodName: itemName(items[target.index]), previousGrams, nextGrams });
    items = items.map((item, index) => index === target.index ? scale(item, nextGrams) as Item : item);
  }
  if (!applied.length) return { handled: true, action: "clarification_needed" as const, reply: `Nao encontrei ${intent.adjustments.map(x => x.targetFood).filter(Boolean).join(", ") || "esses alimentos"} na ${context}. Me diga quais itens devo ajustar.`, eventType: "whatsapp.intent.clarification_needed", detail: "Pedido de reducao de gramas sem alimento compativel." };
  const updated = await updateMeal(userId, { mealId: meal.id, mealLabel: meal.mealLabel, occurredAt: new Date(meal.occurredAt).toISOString(), notes: meal.notes, items: items as MealItemInput[] });
  const lines = applied.map(x => `• ${x.foodName}: de ${fmt(x.previousGrams)} g para ${fmt(x.nextGrams)} g`);
  return {
    handled: true,
    action: "meal_item_grams_adjusted" as const,
    reply: buildWhatsAppMealActionReplyMessage(updated, {
      title: applied.length === 1 ? "Alimento ajustado" : "Alimentos ajustados",
      actionLines: [...lines, `Recalculei os macros da ${context}.`],
    }),
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${applied.length} item(ns) reduzido(s) por comando do WhatsApp em ${context}.`,
    data: { mealId: updated.id, mealLabel: meal.mealLabel, adjustments: applied },
  };
}
