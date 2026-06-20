import { roundNutritionValue } from "../../../shared/mealTotals";
import { getCatalogCache } from "../../catalogRuntime";
import type { MealDraftItem } from "../../nutritionEngine";
import { fuzzyMatchesWords } from "../../fuzzyTextMatch";
import { listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const MIN_FOOD_GRAMS = 1;
const RECENT_REPLACEMENT_WINDOW_MS = 30 * 60 * 1000;
const RECENT_REPLACEMENT_MEAL_LIMIT = 5;
const HEURISTIC_REPLACEMENT_NUTRITION_PER_100G = {
  calories: 150,
  protein: 6,
  carbs: 15,
  fat: 5,
};

export type WhatsappContextualFoodReplacementResult = {
  action: "meal_item_replaced" | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

type FoodReplacementIntent = {
  fromFood: string;
  toFood: string;
};

type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string | null;
  source?: "web" | "whatsapp";
  items?: MealDraftItem[];
};

type ReplacementContext = "first" | "second" | "previous" | "latest" | null;

type ReplacementCandidate = {
  meal: ExistingMeal;
  target: {
    item: MealItemInput;
    index: number;
  };
  replacement: FoodReplacementIntent;
};

const ptBrNumberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function cleanCatalogFoodName(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number) {
  return ptBrNumberFormatter.format(value);
}

function formatReplyTime(value: number | string | Date) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SAO_PAULO_TIME_ZONE,
  });
}

function formatTotalsLine(item: MealItemInput) {
  return `${formatNumber(item.calories)} kcal | Prot. ${formatNumber(item.protein)} g | Carb. ${formatNumber(item.carbs)} g | Gord. ${formatNumber(item.fat)} g`;
}

function cleanTargetFoodText(value?: string) {
  return value
    ?.replace(/\b(?:ontem|hoje|agora|por favor|pfv)\b/gi, "")
    .replace(/\b(?:na|no|da|do|em)\s+(?:primeira|segunda|ultima|última)\s+(?:imagem|foto)\b/gi, "")
    .replace(/\b(?:na|no|da|do|em)\s+(?:imagem|foto)\s+anterior\b/gi, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^\b(?:o|a|os|as|do|da|de|dos|das)\b\s+/i, "")
    .trim() || null;
}

function parseFoodReplacementIntent(text: string): FoodReplacementIntent | null {
  const correctionMatch = text.match(/\b(?:n[aã]o)\s+(?:é|e|era)\s+(.+?)\s+(?:é|e|era)\s+(.+)$/i);
  const swapMatch = text.match(/\b(?:trocar|troque|troca|mudar|alterar|corrigir|substituir|substitua)\b\s+(.+?)\s+(?:por|para)\s+(.+)$/i);
  const match = correctionMatch || swapMatch;
  if (!match) return null;

  const fromFood = cleanTargetFoodText(match[1]);
  const toFood = cleanTargetFoodText(match[2]);
  if (!fromFood || !toFood || /\d/.test(toFood)) return null;

  return { fromFood, toFood };
}

function parseFoodReplacementIntents(text: string) {
  const segments = text.split(/\s*[,;]\s*(?=n[aã]o\b)|\s+e\s+(?=n[aã]o\b)/i);
  const results: FoodReplacementIntent[] = [];
  for (const segment of segments) {
    const intent = parseFoodReplacementIntent(segment.trim());
    if (intent) results.push(intent);
  }
  return results.length > 0 ? results : null;
}

function parseReplacementContext(text: string): ReplacementContext {
  const normalized = normalizeIntentText(text);
  if (/\bprimeir[ao]\s+(?:imagem|foto)\b/.test(normalized)) return "first";
  if (/\bsegund[ao]\s+(?:imagem|foto)\b/.test(normalized)) return "second";
  if (/\b(?:imagem|foto)\s+anterior\b/.test(normalized)) return "previous";
  if (/\b(?:ultima|ultimo|mais recente)\s+(?:imagem|foto)\b/.test(normalized)) return "latest";
  return null;
}

function getCatalogFoodNames(food: ReturnType<typeof getCatalogCache>[number]) {
  return [food.name, ...food.aliases]
    .map(alias => normalizeCatalogText(alias))
    .filter(Boolean);
}

function findCatalogFood(foodName: string) {
  const normalized = normalizeCatalogText(cleanCatalogFoodName(foodName));
  if (!normalized) return null;

  const catalogSource = getCatalogCache();
  return catalogSource.find(food => getCatalogFoodNames(food).some(alias => alias === normalized))
    ?? catalogSource.find(food => getCatalogFoodNames(food).some(alias => normalized.includes(alias) || alias.includes(normalized)))
    ?? catalogSource.find(food => getCatalogFoodNames(food).some(alias => fuzzyMatchesWords(normalized, alias)))
    ?? null;
}

function deriveQuantityFromPortionText(portionText: string) {
  const match = portionText.trim().match(/^(\d+(?:[,.]\d+)?)/u);
  if (!match) return null;

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function deriveUnitFromPortionText(portionText: string) {
  const normalized = portionText
    .trim()
    .replace(/^\d+(?:[,.]\d+)?\s*/u, "")
    .trim();

  return normalized || "porção";
}

function toMealItemInput(item: MealDraftItem): MealItemInput {
  const quantityUnit = item as MealDraftItem & Partial<Pick<MealItemInput, "quantity" | "unit" | "brand">>;

  return {
    ...item,
    ...(quantityUnit.brand ? { brand: quantityUnit.brand } : {}),
    quantity: quantityUnit.quantity ?? deriveQuantityFromPortionText(item.portionText) ?? item.servings,
    unit: quantityUnit.unit?.trim() || deriveUnitFromPortionText(item.portionText),
  };
}

function toMealItemInputs(items: MealDraftItem[] | undefined): MealItemInput[] {
  return (items ?? []).map(toMealItemInput);
}

function findTargetMealItem(items: MealItemInput[], targetFood: string) {
  const normalizedTarget = normalizeIntentText(targetFood);
  const index = items.findIndex(item => {
    const foodName = normalizeIntentText(item.foodName);
    const canonicalName = normalizeIntentText(item.canonicalName);
    return foodName.includes(normalizedTarget)
      || canonicalName.includes(normalizedTarget)
      || normalizedTarget.includes(foodName)
      || fuzzyMatchesWords(normalizedTarget, foodName)
      || fuzzyMatchesWords(normalizedTarget, canonicalName);
  });

  if (index < 0) return null;
  return { item: items[index], index };
}

function buildCatalogMealItem(item: MealItemInput, nextFoodName: string, nextGrams: number, catalogFood: ReturnType<typeof getCatalogCache>[number]): MealItemInput {
  const factor = nextGrams / catalogFood.gramsPerServing;
  return {
    ...item,
    foodName: nextFoodName,
    canonicalName: catalogFood.name,
    estimatedGrams: nextGrams,
    portionText: item.portionText || `${formatNumber(nextGrams)} g`,
    quantity: item.quantity ?? nextGrams,
    unit: item.unit ?? "g",
    servings: Math.max(nextGrams / catalogFood.gramsPerServing, 0.1),
    calories: roundNutritionValue(catalogFood.calories * factor),
    protein: roundNutritionValue(catalogFood.protein * factor),
    carbs: roundNutritionValue(catalogFood.carbs * factor),
    fat: roundNutritionValue(catalogFood.fat * factor),
    confidence: Math.min(Math.max(Number(item.confidence || 0.8), 0.1), 0.95),
    source: "catalog",
  };
}

function buildHeuristicReplacementItem(item: MealItemInput, nextFoodName: string, nextGrams: number): MealItemInput {
  const factor = nextGrams / 100;
  return {
    ...item,
    foodName: nextFoodName,
    canonicalName: nextFoodName,
    estimatedGrams: nextGrams,
    portionText: item.portionText || `${formatNumber(nextGrams)} g`,
    quantity: item.quantity ?? nextGrams,
    unit: item.unit ?? "g",
    servings: Math.max(Number(item.servings || 1), 0.1),
    calories: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.calories * factor),
    protein: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.protein * factor),
    carbs: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.carbs * factor),
    fat: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.fat * factor),
    confidence: Math.min(Number(item.confidence || 0.8), 0.7),
    source: "heuristic",
  };
}

function replaceMealItemFood(item: MealItemInput, nextFoodName: string): MealItemInput {
  const nextGrams = Math.max(Number(item.estimatedGrams || 0), MIN_FOOD_GRAMS);
  const catalogFood = findCatalogFood(nextFoodName);
  return catalogFood
    ? buildCatalogMealItem(item, nextFoodName, nextGrams, catalogFood)
    : buildHeuristicReplacementItem(item, nextFoodName, nextGrams);
}

function getRecentCorrectionMeals(meals: ExistingMeal[], receivedAt: Date, context: ReplacementContext) {
  const receivedTime = receivedAt.getTime();
  const sorted = [...meals]
    .filter(meal => (meal.items?.length ?? 0) > 0)
    .filter(meal => !meal.source || meal.source === "whatsapp")
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const insideWindow = sorted.filter(meal => {
    const occurredAt = new Date(meal.occurredAt).getTime();
    return occurredAt <= receivedTime + 60_000 && occurredAt >= receivedTime - RECENT_REPLACEMENT_WINDOW_MS;
  });
  const recentMeals = (insideWindow.length ? insideWindow : sorted).slice(0, RECENT_REPLACEMENT_MEAL_LIMIT);

  if (!context) return recentMeals;

  const ascending = [...recentMeals].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const selected = context === "first"
    ? ascending[0]
    : context === "second"
      ? ascending[1]
      : context === "previous"
        ? recentMeals[1]
        : recentMeals[0];
  return selected ? [selected] : [];
}

function findReplacementCandidates(meals: ExistingMeal[], replacement: FoodReplacementIntent): ReplacementCandidate[] {
  return meals.flatMap(meal => {
    const target = findTargetMealItem(toMealItemInputs(meal.items), replacement.fromFood);
    return target ? [{ meal, target, replacement }] : [];
  });
}

function formatCandidateOptions(candidates: ReplacementCandidate[]) {
  return candidates
    .map((candidate, index) => `${index + 1}. ${candidate.meal.mealLabel} às ${formatReplyTime(candidate.meal.occurredAt)} - ${candidate.target.item.foodName}`)
    .join(" ");
}

export async function executeWhatsappContextualFoodReplacementIntent(
  userId: number,
  input: { text?: string | null; receivedAt?: Date },
): Promise<WhatsappContextualFoodReplacementResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const replacements = parseFoodReplacementIntents(text);
  if (!replacements) return null;

  const receivedAt = input.receivedAt ?? new Date();
  const meals = getRecentCorrectionMeals(await listMeals(userId), receivedAt, parseReplacementContext(text));
  if (!meals.length) {
    return {
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente do WhatsApp para corrigir. Me diga qual refeição devo ajustar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem refeição recente do WhatsApp disponível.",
    };
  }

  const selected: ReplacementCandidate[] = [];
  const ambiguous: ReplacementCandidate[] = [];
  const notFound: string[] = [];

  for (const replacement of replacements) {
    const candidates = findReplacementCandidates(meals, replacement);
    if (candidates.length === 0) {
      notFound.push(replacement.fromFood);
    } else if (candidates.length > 1) {
      ambiguous.push(...candidates);
    } else {
      selected.push(candidates[0]);
    }
  }

  if (ambiguous.length) {
    return {
      action: "clarification_needed",
      reply: `Encontrei esse alimento em mais de uma refeição recente. Qual devo corrigir? ${formatCandidateOptions(ambiguous)}`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento com mais de uma refeição recente compatível.",
      data: {
        options: ambiguous.map(candidate => ({
          mealId: candidate.meal.id,
          mealLabel: candidate.meal.mealLabel,
          foodName: candidate.target.item.foodName,
          occurredAt: new Date(candidate.meal.occurredAt).toISOString(),
        })),
      },
    };
  }

  if (!selected.length) {
    return {
      action: "clarification_needed",
      reply: `Não encontrei ${notFound.join(", ")} nas refeições recentes do WhatsApp. Me diga qual alimento devo trocar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem item compatível nas refeições recentes do WhatsApp.",
    };
  }

  const groups = new Map<number, {
    meal: ExistingMeal;
    items: Array<MealDraftItem | MealItemInput>;
    applied: Array<{ from: string; to: string; item: MealItemInput }>;
  }>();

  for (const candidate of selected) {
    const group = groups.get(candidate.meal.id) ?? {
      meal: candidate.meal,
      items: [...(candidate.meal.items ?? [])],
      applied: [],
    };
    const currentTarget = findTargetMealItem(toMealItemInputs(group.items as MealDraftItem[]), candidate.replacement.fromFood);
    if (!currentTarget) {
      notFound.push(candidate.replacement.fromFood);
      groups.set(candidate.meal.id, group);
      continue;
    }
    const replacedItem = replaceMealItemFood(toMealItemInput(group.items[currentTarget.index] as MealDraftItem), candidate.replacement.toFood);
    group.items = group.items.map((item, index) => index === currentTarget.index ? replacedItem : item);
    group.applied.push({ from: currentTarget.item.foodName, to: candidate.replacement.toFood, item: replacedItem });
    groups.set(candidate.meal.id, group);
  }

  const applied = Array.from(groups.values()).flatMap(group => group.applied.map(item => ({ ...item, meal: group.meal })));
  if (!applied.length) {
    return {
      action: "clarification_needed",
      reply: `Não encontrei ${notFound.join(", ")} nas refeições recentes do WhatsApp. Me diga qual alimento devo trocar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem item compatível após seleção de refeições recentes.",
    };
  }

  const updatedMeals = [];
  for (const group of groups.values()) {
    if (!group.applied.length) continue;
    const updatedMeal = await updateMeal(userId, {
      mealId: group.meal.id,
      mealLabel: group.meal.mealLabel,
      occurredAt: new Date(group.meal.occurredAt).toISOString(),
      notes: group.meal.notes ?? undefined,
      items: group.items as MealItemInput[],
    });
    updatedMeals.push(updatedMeal);
  }

  const notFoundNote = notFound.length ? `\nNão encontrei: ${notFound.join(", ")}.` : "";
  const reply = applied.length === 1
    ? (() => {
        const item = applied[0].item;
        const recalculationSource = item.source === "catalog" ? "com base no catálogo" : "por estimativa";
        return `Troquei ${applied[0].from} por ${applied[0].to} na refeição ${applied[0].meal.mealLabel} das ${formatReplyTime(applied[0].meal.occurredAt)} e recalculei os macros ${recalculationSource}. Quantidade mantida: ${formatNumber(item.estimatedGrams)} g. Estimativa: ${formatTotalsLine(item)}.${notFoundNote}`;
      })()
    : `Troquei os seguintes alimentos nas refeições recentes e recalculei os macros:\n${applied.map(({ from, to, item, meal }) => `• ${meal.mealLabel} às ${formatReplyTime(meal.occurredAt)}: ${from} → ${to}: ${formatNumber(item.estimatedGrams)} g | ${formatTotalsLine(item)}`).join("\n")}${notFoundNote}`;

  return {
    action: "meal_item_replaced",
    reply,
    eventType: "whatsapp.intent.meal_item_replaced",
    detail: `${applied.length} alimento(s) substituído(s) em refeições recentes do WhatsApp com macros recalculados.`,
    data: {
      mealId: updatedMeals[0]?.id,
      mealIds: updatedMeals.map(meal => meal.id),
      previousFoodName: applied[0].from,
      nextFoodName: applied[0].to,
      estimatedGrams: applied[0].item.estimatedGrams,
      calories: applied[0].item.calories,
      protein: applied[0].item.protein,
      carbs: applied[0].item.carbs,
      fat: applied[0].item.fat,
      nutritionSource: applied[0].item.source,
    },
  };
}