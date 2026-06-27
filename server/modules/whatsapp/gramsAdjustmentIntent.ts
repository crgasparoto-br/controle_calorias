import { listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";

type Meal = Awaited<ReturnType<typeof listMeals>>[number];
type Item = NonNullable<Meal["items"]>[number];
const MEALS = ["cafe da manha", "almoco", "jantar", "lanche da tarde", "lanche", "ceia"];
const WINDOW_MS = 24 * 60 * 60 * 1000;

function norm(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function fmt(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value); }
function itemName(item: Item) { return item.foodName || item.canonicalName || "item"; }
function labelRx(label: string) { return label.replace(/\s+/g, "\\s+"); }
function mealFromText(text: string) { return MEALS.find(label => new RegExp(`\\b(?:do|da|de|no|na|ao|a|para)\\s+(?:refeicao\\s+)?${labelRx(label)}\\b`).test(text)) ?? null; }
function cleanFood(value: string | null, mealLabel: string | null) {
  if (!value) return null;
  let cleaned = value.replace(/^\s*(?:o|a|os|as|do|da|de|dos|das)\s+/i, "").trim();
  if (mealLabel) cleaned = cleaned.replace(new RegExp(`\\s+(?:do|da|de|no|na|ao|a|para)\\s+(?:refeicao\\s+)?${labelRx(mealLabel)}\\s*$`, "i"), "").trim();
  return cleaned || null;
}
function parse(text: string) {
  const normalized = norm(text);
  if (!/\b(?:diminuir|diminui|diminuia|reduzir|reduz|reduza|tirar)\b/.test(normalized)) return null;
  const mealLabel = mealFromText(normalized);
  const adjustments: Array<{ gramsDelta: number; targetFood: string | null }> = [];
  const rx = /(\d+(?:[,.]\d+)?)\s*(?:g|gr|gramas?|ml|mililitros?)\b(?:\s+(?:do|da|de)\s+((?:(?!\d|\be\s+\d|[,;]\s*\d)\S+\s*)+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(normalized)) !== null) {
    const gramsDelta = Number(match[1].replace(",", "."));
    if (Number.isFinite(gramsDelta) && gramsDelta > 0) adjustments.push({ gramsDelta, targetFood: cleanFood(match[2]?.trim() ?? null, mealLabel) });
  }
  return adjustments.length ? { mealLabel, adjustments } : null;
}
function score(item: Item, food: string) {
  const wanted = norm(food), text = norm(`${item.foodName ?? ""} ${item.canonicalName ?? ""}`);
  if (!wanted || !text) return 0;
  if (text === wanted) return 4;
  if (text.includes(wanted) || wanted.includes(norm(itemName(item)))) return 3;
  const words = wanted.split(" ").filter(Boolean);
  return words.filter(word => text.split(" ").includes(word)).length;
}
function findItem(items: Item[], food: string | null) {
  if (!items.length) return -1;
  if (!food) return items.length - 1;
  return items.map((item, index) => ({ index, score: score(item, food) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score)[0]?.index ?? -1;
}
function findMeal(meals: Meal[], intent: NonNullable<ReturnType<typeof parse>>) {
  if (intent.mealLabel) return meals.find(meal => norm(meal.mealLabel ?? "").includes(intent.mealLabel!)) ?? null;
  const targets = intent.adjustments.filter(x => x.targetFood);
  return targets.length ? meals.find(meal => targets.every(target => findItem(meal.items ?? [], target.targetFood) >= 0)) ?? meals[0] ?? null : meals[0] ?? null;
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
  for (const adj of intent.adjustments) {
    const idx = findItem(items, adj.targetFood);
    if (idx < 0) continue;
    const previousGrams = Number(items[idx].estimatedGrams || 0), nextGrams = Math.max(previousGrams - adj.gramsDelta, 1);
    applied.push({ foodName: itemName(items[idx]), previousGrams, nextGrams });
    items = items.map((item, index) => index === idx ? scale(item, nextGrams) as Item : item);
  }
  if (!applied.length) return { handled: true, action: "clarification_needed" as const, reply: `Nao encontrei ${intent.adjustments.map(x => x.targetFood).filter(Boolean).join(", ") || "esses alimentos"} na ${context}. Me diga quais itens devo ajustar.`, eventType: "whatsapp.intent.clarification_needed", detail: "Pedido de reducao de gramas sem alimento compativel." };
  const updated = await updateMeal(userId, { mealId: meal.id, mealLabel: meal.mealLabel, occurredAt: new Date(meal.occurredAt).toISOString(), notes: meal.notes, items: items as MealItemInput[] });
  const lines = applied.map(x => `• ${x.foodName}: de ${fmt(x.previousGrams)} g para ${fmt(x.nextGrams)} g`).join("\n");
  return { handled: true, action: "meal_item_grams_adjusted" as const, reply: `Ajustes realizados na ${context}:\n${lines}\nRecalculei os macros.`, eventType: "whatsapp.intent.meal_item_grams_adjusted", detail: `${applied.length} item(ns) ajustado(s) por comando do WhatsApp em ${context}.`, data: { mealId: updated.id, mealLabel: meal.mealLabel, adjustments: applied } };
}
