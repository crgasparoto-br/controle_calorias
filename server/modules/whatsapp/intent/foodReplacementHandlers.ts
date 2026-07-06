import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import { formatTargetMealItemOptions, formatTotalsLine, replaceMealItemFood, toMealItemInput, toMealItemInputs } from "./mealItemHelpers";
import { resolveTargetMealItemInMeals } from "./mealTargetResolution";
import { formatNumber } from "./textUtils";
import type { FoodReplacementIntent, WhatsappIntentResult } from "./types";

type MealRecord = Awaited<ReturnType<typeof listMeals>>[number];
type MutableMealRecord = MealRecord & { items: MealItemInput[] };

function ambiguousReplacementReply(targetFood: string, options: string, context = "na última refeição") {
  return {
    handled: true,
    action: "clarification_needed",
    reply: `Encontrei mais de um item para ${targetFood} ${context}:\n${options}\nResponda com o número do item que devo trocar.`,
    eventType: "whatsapp.intent.clarification_needed",
    detail: "Pedido de substituição de alimento com mais de um item compatível.",
  } satisfies WhatsappIntentResult;
}

function toMutableMeals(meals: MealRecord[]): MutableMealRecord[] {
  return meals.map(meal => ({
    ...meal,
    items: toMealItemInputs(meal.items),
  }));
}

async function updateMealItems(userId: number, meal: MutableMealRecord) {
  return updateMeal(userId, {
    mealId: meal.id,
    mealLabel: meal.mealLabel,
    occurredAt: new Date(meal.occurredAt).toISOString(),
    notes: meal.notes,
    items: meal.items,
  });
}

function contextWithPreposition(scope: string) {
  return scope === "same_day_meals" ? "nas refeições do dia" : "na última refeição";
}

export async function handleFoodReplacementIntents(userId: number, replacements: FoodReplacementIntent[]): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  if (!meals.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para corrigir. Me diga qual alimento devo trocar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem refeição recente disponível.",
    };
  }

  const mutableMeals = toMutableMeals(meals);
  const changedMealIndexes = new Set<number>();
  const applied: Array<{ from: string; to: string; item: MealItemInput; scope: string }> = [];
  const notFound: string[] = [];

  for (const replacement of replacements) {
    const target = resolveTargetMealItemInMeals(mutableMeals, replacement.fromFood);
    if (target.kind === "ambiguous") {
      return ambiguousReplacementReply(replacement.fromFood, formatTargetMealItemOptions(target.candidates), contextWithPreposition(target.scope));
    }
    if (target.kind !== "matched") {
      notFound.push(replacement.fromFood);
      continue;
    }

    const replacedItem = replaceMealItemFood(toMealItemInput(target.meal.items[target.index]), replacement.toFood);
    target.meal.items = target.meal.items.map((item, index) => index === target.index ? replacedItem : item);
    changedMealIndexes.add(target.mealIndex);
    applied.push({ from: target.item.foodName, to: replacement.toFood, item: replacedItem, scope: target.scope });
  }

  if (applied.length === 0) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei ${notFound.join(", ")} nas refeições de hoje. Me diga qual alimento devo trocar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem item compatível nas refeições do dia.",
    };
  }

  const updatedMeals = await Promise.all([...changedMealIndexes].map(index => updateMealItems(userId, mutableMeals[index])));

  let reply: string;
  if (applied.length === 1) {
    const { from, to, item, scope } = applied[0];
    const recalculationSource = item.source === "catalog" ? "com base no catálogo" : "por estimativa";
    reply = `Troquei ${from} por ${to} ${contextWithPreposition(scope)} e recalculei os macros ${recalculationSource}. Quantidade mantida: ${formatNumber(item.estimatedGrams)} g. Estimativa: ${formatTotalsLine(item)}.`;
  } else {
    const context = applied.some(item => item.scope === "same_day_meals") ? "nas refeições do dia" : "na última refeição";
    const lines = applied.map(({ from, to, item }) => `• ${from} → ${to}: ${formatNumber(item.estimatedGrams)} g | ${formatTotalsLine(item)}`);
    const notFoundNote = notFound.length ? `\nNão encontrei nas refeições de hoje: ${notFound.join(", ")}.` : "";
    reply = `Troquei os seguintes alimentos ${context} e recalculei os macros:\n${lines.join("\n")}${notFoundNote}`;
  }

  return {
    handled: true,
    action: "meal_item_replaced",
    reply,
    eventType: "whatsapp.intent.meal_item_replaced",
    detail: `${applied.length} alimento(s) substituído(s) via WhatsApp com macros recalculados.`,
    data: {
      mealId: updatedMeals[0]?.id,
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
