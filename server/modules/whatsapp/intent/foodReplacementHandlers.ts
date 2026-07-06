import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import { findTargetMealItem, formatTotalsLine, replaceMealItemFood, toMealItemInput, toMealItemInputs } from "./mealItemHelpers";
import { formatNumber } from "./textUtils";
import type { FoodReplacementIntent, WhatsappIntentResult } from "./types";

export async function handleFoodReplacementIntents(userId: number, replacements: FoodReplacementIntent[]): Promise<WhatsappIntentResult> {
  const latestMeal = (await listMeals(userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para corrigir. Me diga qual alimento devo trocar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem refeição recente disponível.",
    };
  }

  let mutableItems: MealItemInput[] = [...latestMeal.items] as MealItemInput[];
  const applied: Array<{ from: string; to: string; item: MealItemInput }> = [];
  const notFound: string[] = [];

  for (const replacement of replacements) {
    const itemsAsInputs = toMealItemInputs(mutableItems as any);
    const target = findTargetMealItem(itemsAsInputs, replacement.fromFood);
    if (!target) {
      notFound.push(replacement.fromFood);
      continue;
    }
    const replacedItem = replaceMealItemFood(toMealItemInput(mutableItems[target.index] as any), replacement.toFood);
    mutableItems = mutableItems.map((item, index) => index === target.index ? replacedItem : item);
    applied.push({ from: target.item.foodName, to: replacement.toFood, item: replacedItem });
  }

  if (applied.length === 0) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei ${notFound.join(", ")} na última refeição. Me diga qual alimento devo trocar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem item compatível na última refeição.",
    };
  }

  const updatedMeal = await updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: mutableItems,
  });

  let reply: string;
  if (applied.length === 1) {
    const { from, to, item } = applied[0];
    const recalculationSource = item.source === "catalog" ? "com base no catálogo" : "por estimativa";
    reply = `Troquei ${from} por ${to} na última refeição e recalculei os macros ${recalculationSource}. Quantidade mantida: ${formatNumber(item.estimatedGrams)} g. Estimativa: ${formatTotalsLine(item)}.`;
  } else {
    const lines = applied.map(({ from, to, item }) => `• ${from} → ${to}: ${formatNumber(item.estimatedGrams)} g | ${formatTotalsLine(item)}`);
    const notFoundNote = notFound.length ? `\nNão encontrei: ${notFound.join(", ")}.` : "";
    reply = `Troquei os seguintes alimentos na última refeição e recalculei os macros:\n${lines.join("\n")}${notFoundNote}`;
  }

  return {
    handled: true,
    action: "meal_item_replaced",
    reply,
    eventType: "whatsapp.intent.meal_item_replaced",
    detail: `${applied.length} alimento(s) substituído(s) via WhatsApp com macros recalculados.`,
    data: {
      mealId: updatedMeal.id,
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
