import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import {
  MIN_FOOD_GRAMS,
  findQuantityCorrectionTargets,
  formatCorrectionOptions,
  formatTargetMealItemOptions,
  scaleMealItem,
  scaleMealItemQuantity,
  toMealItemInput,
  toMealItemInputs,
} from "./mealItemHelpers";
import { resolveTargetMealItemInMeals } from "./mealTargetResolution";
import { formatNumber } from "./textUtils";
import type { GramsAdjustmentItem, GramsIncrementItem, QuantityCorrectionIntent, WhatsappIntentResult } from "./types";

type MealRecord = Awaited<ReturnType<typeof listMeals>>[number];
type MutableMealRecord = MealRecord & { items: MealItemInput[] };

function contextWithPreposition(scope: string) {
  return scope === "same_day_meals" ? "nas refeições do dia" : "na última refeição";
}

function ambiguousTargetReply(targetFood: string | null, options: string, context = "na última refeição") {
  return {
    handled: true,
    action: "clarification_needed",
    reply: `Encontrei mais de um item para ${targetFood ?? "esse alimento"} ${context}:\n${options}\nResponda com o número do item que devo ajustar.`,
    eventType: "whatsapp.intent.clarification_needed",
    detail: "Pedido de ajuste de gramas com mais de um alimento compatível.",
  } satisfies WhatsappIntentResult;
}

function toMutableMeals(meals: MealRecord[]): MutableMealRecord[] {
  return meals.map(meal => ({
    ...meal,
    items: [...(meal.items ?? [])] as MealItemInput[],
  }));
}

async function updateMealItems(userId: number, meal: MutableMealRecord) {
  return updateMeal(userId, {
    mealId: meal.id,
    mealLabel: meal.mealLabel,
    occurredAt: new Date(meal.occurredAt).toISOString(),
    notes: meal.notes,
    items: meal.items as MealItemInput[],
  });
}

function adjustmentContext(scopes: string[]) {
  return scopes.some(scope => scope === "same_day_meals") ? "nas refeições do dia" : "na última refeição";
}

export async function handleQuantityCorrectionIntent(userId: number, correction: QuantityCorrectionIntent): Promise<WhatsappIntentResult> {
  const latestMeal = (await listMeals(userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei um item recente para corrigir. Qual item devo corrigir?",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de correção de quantidade sem item recente disponível.",
    };
  }

  const latestItems = toMealItemInputs(latestMeal.items);
  const targets = findQuantityCorrectionTargets(latestItems, correction);
  if (!targets.length) {
    const previous = correction.previousQuantity && correction.previousUnit
      ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
      : "essa quantidade";
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei um item recente com ${previous}. Qual item devo corrigir?`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de correção de quantidade sem item compatível na refeição recente.",
    };
  }

  if (targets.length > 1) {
    const previous = correction.previousQuantity && correction.previousUnit
      ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
      : "essa quantidade";
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Encontrei mais de um item com ${previous}. Qual deseja alterar? ${formatCorrectionOptions(targets)}`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de correção de quantidade com mais de um item compatível.",
    };
  }

  const target = targets[0];
  const nextItems = latestMeal.items.map((item, index) => index === target.index
    ? scaleMealItemQuantity(toMealItemInput(item), correction.nextQuantity, correction.nextUnit)
    : item);
  const updatedMeal = await updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: nextItems as MealItemInput[],
  });

  const previous = correction.previousQuantity && correction.previousUnit
    ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
    : target.item.portionText;
  const next = `${formatNumber(correction.nextQuantity)}${correction.nextUnit}`;
  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Atualizei de ${previous} para ${next}.`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `Quantidade de ${target.item.foodName} corrigida por contexto curto via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      foodName: target.item.foodName,
      previousQuantity: correction.previousQuantity,
      previousUnit: correction.previousUnit,
      nextQuantity: correction.nextQuantity,
      nextUnit: correction.nextUnit,
    },
  };
}

async function updateLatestMealItemGrams(input: {
  userId: number;
  targetFood: string | null;
  resolveNextGrams: (previousGrams: number) => number;
  detail: string;
}) {
  const meals = await listMeals(input.userId);
  if (!meals.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem refeição recente disponível.",
    } satisfies WhatsappIntentResult;
  }

  const mutableMeals = toMutableMeals(meals);
  const target = resolveTargetMealItemInMeals(mutableMeals, input.targetFood);
  if (target.kind === "ambiguous") {
    return ambiguousTargetReply(input.targetFood, formatTargetMealItemOptions(target.candidates), contextWithPreposition(target.scope));
  }
  if (target.kind !== "matched") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei esse alimento nas refeições de hoje. Me diga qual item devo ajustar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem alimento compatível nas refeições do dia.",
    } satisfies WhatsappIntentResult;
  }

  const previousGrams = Number(target.item.estimatedGrams || 0);
  const nextGrams = Math.max(input.resolveNextGrams(previousGrams), MIN_FOOD_GRAMS);
  target.meal.items = target.meal.items.map((item, index) => index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item);
  const updatedMeal = await updateMealItems(input.userId, target.meal);

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Ajustei ${target.item.foodName}: de ${formatNumber(previousGrams)} g para ${formatNumber(nextGrams)} g ${contextWithPreposition(target.scope)} e recalculei os macros.`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${input.detail} Escopo da busca: ${target.scopeLabel}.`,
    data: {
      mealId: updatedMeal.id,
      foodName: target.item.foodName,
      previousGrams,
      nextGrams,
    },
  } satisfies WhatsappIntentResult;
}

export async function handleMealItemMultiAdjustment(userId: number, adjustments: GramsAdjustmentItem[]): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  if (!meals.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem refeição recente disponível.",
    };
  }

  const mutableMeals = toMutableMeals(meals);
  const changedMealIndexes = new Set<number>();
  const appliedAdjustments: Array<{ foodName: string; previousGrams: number; nextGrams: number; scope: string }> = [];
  const notFoundFoods: string[] = [];

  for (const adjustment of adjustments) {
    const target = resolveTargetMealItemInMeals(mutableMeals, adjustment.targetFood);
    if (target.kind === "ambiguous") {
      return ambiguousTargetReply(adjustment.targetFood, formatTargetMealItemOptions(target.candidates), contextWithPreposition(target.scope));
    }
    if (target.kind !== "matched") {
      if (adjustment.targetFood) {
        notFoundFoods.push(adjustment.targetFood);
      }
      continue;
    }

    const previousGrams = Number(target.item.estimatedGrams || 0);
    const nextGrams = Math.max(previousGrams - adjustment.gramsDelta, MIN_FOOD_GRAMS);
    appliedAdjustments.push({ foodName: target.item.foodName, previousGrams, nextGrams, scope: target.scope });
    target.meal.items = target.meal.items.map((item, index) =>
      index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item,
    );
    changedMealIndexes.add(target.mealIndex);
  }

  if (!appliedAdjustments.length) {
    const foods = adjustments.map(a => a.targetFood).filter(Boolean).join(", ");
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei ${foods || "esses alimentos"} nas refeições de hoje. Me diga quais itens devo ajustar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem alimentos compatíveis nas refeições do dia.",
    };
  }

  const updatedMeals = await Promise.all([...changedMealIndexes].map(index => updateMealItems(userId, mutableMeals[index])));
  const context = adjustmentContext(appliedAdjustments.map(adjustment => adjustment.scope));

  const adjustmentLines = appliedAdjustments
    .map(a => `• ${a.foodName}: de ${formatNumber(a.previousGrams)} g para ${formatNumber(a.nextGrams)} g`)
    .join("\n");
  const notFoundSuffix = notFoundFoods.length
    ? `\nNão encontrei nas refeições de hoje: ${notFoundFoods.join(", ")}.`
    : "";

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Ajustes realizados ${context}:\n${adjustmentLines} e recalculei os macros.${notFoundSuffix}`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${appliedAdjustments.length} item(ns) ajustado(s) via WhatsApp. Escopo da busca: ${context}.`,
    data: {
      mealId: updatedMeals[0]?.id,
      adjustments: appliedAdjustments.map(({ scope: _scope, ...adjustment }) => adjustment),
    },
  };
}

export async function handleMealItemMultiIncrement(userId: number, increments: GramsIncrementItem[]): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  if (!meals.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de incremento de gramas sem refeição recente disponível.",
    };
  }

  const mutableMeals = toMutableMeals(meals);
  const changedMealIndexes = new Set<number>();
  const appliedIncrements: Array<{ foodName: string; previousGrams: number; nextGrams: number; scope: string }> = [];
  const notFoundFoods: string[] = [];

  for (const increment of increments) {
    const target = resolveTargetMealItemInMeals(mutableMeals, increment.targetFood);
    if (target.kind === "ambiguous") {
      return ambiguousTargetReply(increment.targetFood, formatTargetMealItemOptions(target.candidates), contextWithPreposition(target.scope));
    }
    if (target.kind !== "matched") {
      if (increment.targetFood) {
        notFoundFoods.push(increment.targetFood);
      }
      continue;
    }

    const previousGrams = Number(target.item.estimatedGrams || 0);
    const nextGrams = Math.max(previousGrams + increment.gramsDelta, MIN_FOOD_GRAMS);
    appliedIncrements.push({ foodName: target.item.foodName, previousGrams, nextGrams, scope: target.scope });
    target.meal.items = target.meal.items.map((item, index) =>
      index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item,
    );
    changedMealIndexes.add(target.mealIndex);
  }

  if (!appliedIncrements.length) {
    const foods = increments.map(i => i.targetFood).filter(Boolean).join(", ");
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei ${foods || "esses alimentos"} nas refeições de hoje. Me diga quais itens devo ajustar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de incremento de gramas sem alimentos compatíveis nas refeições do dia.",
    };
  }

  const updatedMeals = await Promise.all([...changedMealIndexes].map(index => updateMealItems(userId, mutableMeals[index])));
  const context = adjustmentContext(appliedIncrements.map(increment => increment.scope));

  const incrementLines = appliedIncrements
    .map(a => `• ${a.foodName}: de ${formatNumber(a.previousGrams)} g para ${formatNumber(a.nextGrams)} g`)
    .join("\n");
  const notFoundSuffix = notFoundFoods.length
    ? `\nNão encontrei nas refeições de hoje: ${notFoundFoods.join(", ")}.`
    : "";

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Ajustes realizados ${context}:\n${incrementLines} e recalculei os macros.${notFoundSuffix}`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${appliedIncrements.length} item(ns) incrementado(s) via WhatsApp. Escopo da busca: ${context}.`,
    data: {
      mealId: updatedMeals[0]?.id,
      increments: appliedIncrements.map(({ scope: _scope, ...increment }) => increment),
    },
  };
}

export async function handleMealItemReplacement(userId: number, replacement: { targetFood: string; nextGrams: number }): Promise<WhatsappIntentResult> {
  return updateLatestMealItemGrams({
    userId,
    targetFood: replacement.targetFood,
    resolveNextGrams: () => replacement.nextGrams,
    detail: `Quantidade de ${replacement.targetFood} substituída para ${formatNumber(replacement.nextGrams)} g via WhatsApp.`,
  });
}
