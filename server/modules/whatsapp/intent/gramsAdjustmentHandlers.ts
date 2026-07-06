import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import {
  MIN_FOOD_GRAMS,
  findQuantityCorrectionTargets,
  findTargetMealItem,
  formatCorrectionOptions,
  formatTargetMealItemOptions,
  resolveTargetMealItem,
  scaleMealItem,
  scaleMealItemQuantity,
  toMealItemInput,
  toMealItemInputs,
} from "./mealItemHelpers";
import { formatNumber } from "./textUtils";
import type { GramsAdjustmentItem, GramsIncrementItem, QuantityCorrectionIntent, WhatsappIntentResult } from "./types";

function ambiguousTargetReply(targetFood: string | null, options: string, context = "última refeição") {
  return {
    handled: true,
    action: "clarification_needed",
    reply: `Encontrei mais de um item para ${targetFood ?? "esse alimento"} na ${context}:\n${options}\nResponda com o número do item que devo ajustar.`,
    eventType: "whatsapp.intent.clarification_needed",
    detail: "Pedido de ajuste de gramas com mais de um alimento compatível.",
  } satisfies WhatsappIntentResult;
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
  const latestMeal = (await listMeals(input.userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem refeição recente disponível.",
    } satisfies WhatsappIntentResult;
  }

  const latestItems = toMealItemInputs(latestMeal.items);
  const target = resolveTargetMealItem(latestItems, input.targetFood);
  if (target.kind === "ambiguous") {
    return ambiguousTargetReply(input.targetFood, formatTargetMealItemOptions(target.candidates));
  }
  if (target.kind !== "matched") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei esse alimento na última refeição. Me diga qual item devo ajustar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem alimento compatível na última refeição.",
    } satisfies WhatsappIntentResult;
  }

  const previousGrams = Number(target.item.estimatedGrams || 0);
  const nextGrams = Math.max(input.resolveNextGrams(previousGrams), MIN_FOOD_GRAMS);
  const nextItems = latestMeal.items.map((item, index) => index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item);
  const updatedMeal = await updateMeal(input.userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: nextItems as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Ajustei ${target.item.foodName}: de ${formatNumber(previousGrams)} g para ${formatNumber(nextGrams)} g na última refeição e recalculei os macros.`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: input.detail,
    data: {
      mealId: updatedMeal.id,
      foodName: target.item.foodName,
      previousGrams,
      nextGrams,
    },
  } satisfies WhatsappIntentResult;
}

export async function handleMealItemMultiAdjustment(userId: number, adjustments: GramsAdjustmentItem[]): Promise<WhatsappIntentResult> {
  const latestMeal = (await listMeals(userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem refeição recente disponível.",
    };
  }

  const appliedAdjustments: Array<{ foodName: string; previousGrams: number; nextGrams: number }> = [];
  const notFoundFoods: string[] = [];
  let updatedItems = [...latestMeal.items];

  for (const adjustment of adjustments) {
    const currentItems = toMealItemInputs(updatedItems);
    const target = resolveTargetMealItem(currentItems, adjustment.targetFood);
    if (target.kind === "ambiguous") {
      return ambiguousTargetReply(adjustment.targetFood, formatTargetMealItemOptions(target.candidates));
    }
    if (target.kind !== "matched") {
      if (adjustment.targetFood) {
        notFoundFoods.push(adjustment.targetFood);
      }
      continue;
    }

    const previousGrams = Number(target.item.estimatedGrams || 0);
    const nextGrams = Math.max(previousGrams - adjustment.gramsDelta, MIN_FOOD_GRAMS);
    appliedAdjustments.push({ foodName: target.item.foodName, previousGrams, nextGrams });
    updatedItems = updatedItems.map((item, index) =>
      index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item,
    );
  }

  if (!appliedAdjustments.length) {
    const foods = adjustments.map(a => a.targetFood).filter(Boolean).join(", ");
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei ${foods || "esses alimentos"} na última refeição. Me diga quais itens devo ajustar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem alimentos compatíveis na última refeição.",
    };
  }

  const updatedMeal = await updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: updatedItems as MealItemInput[],
  });

  const adjustmentLines = appliedAdjustments
    .map(a => `• ${a.foodName}: de ${formatNumber(a.previousGrams)} g para ${formatNumber(a.nextGrams)} g`)
    .join("\n");
  const notFoundSuffix = notFoundFoods.length
    ? `\nNão encontrei na última refeição: ${notFoundFoods.join(", ")}.`
    : "";

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Ajustes realizados na última refeição:\n${adjustmentLines} e recalculei os macros.${notFoundSuffix}`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${appliedAdjustments.length} item(ns) ajustado(s) via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      adjustments: appliedAdjustments,
    },
  };
}

export async function handleMealItemMultiIncrement(userId: number, increments: GramsIncrementItem[]): Promise<WhatsappIntentResult> {
  const latestMeal = (await listMeals(userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de incremento de gramas sem refeição recente disponível.",
    };
  }

  const appliedIncrements: Array<{ foodName: string; previousGrams: number; nextGrams: number }> = [];
  const notFoundFoods: string[] = [];
  let updatedItems = [...latestMeal.items];

  for (const increment of increments) {
    const currentItems = toMealItemInputs(updatedItems);
    const target = resolveTargetMealItem(currentItems, increment.targetFood);
    if (target.kind === "ambiguous") {
      return ambiguousTargetReply(increment.targetFood, formatTargetMealItemOptions(target.candidates));
    }
    if (target.kind !== "matched") {
      if (increment.targetFood) {
        notFoundFoods.push(increment.targetFood);
      }
      continue;
    }

    const previousGrams = Number(target.item.estimatedGrams || 0);
    const nextGrams = Math.max(previousGrams + increment.gramsDelta, MIN_FOOD_GRAMS);
    appliedIncrements.push({ foodName: target.item.foodName, previousGrams, nextGrams });
    updatedItems = updatedItems.map((item, index) =>
      index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item,
    );
  }

  if (!appliedIncrements.length) {
    const foods = increments.map(i => i.targetFood).filter(Boolean).join(", ");
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei ${foods || "esses alimentos"} na última refeição. Me diga quais itens devo ajustar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de incremento de gramas sem alimentos compatíveis na última refeição.",
    };
  }

  const updatedMeal = await updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: updatedItems as MealItemInput[],
  });

  const incrementLines = appliedIncrements
    .map(a => `• ${a.foodName}: de ${formatNumber(a.previousGrams)} g para ${formatNumber(a.nextGrams)} g`)
    .join("\n");
  const notFoundSuffix = notFoundFoods.length
    ? `\nNão encontrei na última refeição: ${notFoundFoods.join(", ")}.`
    : "";

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Ajustes realizados na última refeição:\n${incrementLines} e recalculei os macros.${notFoundSuffix}`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${appliedIncrements.length} item(ns) incrementado(s) via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      increments: appliedIncrements,
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
