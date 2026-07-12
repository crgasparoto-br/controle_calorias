import {
  buildWhatsAppAuxiliaryReplyMessage,
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppItemNotFoundReplyMessage,
  buildWhatsAppMealActionReplyMessage,
} from "../replyMessages";
import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import { createPendingMealItemSelection, type MealItemSelectionAction } from "../mealItemSelectionCallback";
import {
  MIN_FOOD_GRAMS,
  findQuantityCorrectionTargets,
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
type AppliedGramsChange = { targetFood: string | null; foodName: string; previousGrams: number; nextGrams: number; scope: string; scopeLabel: string };
type PendingGramsTarget = {
  targetFood: string | null;
  options: string;
  context: string;
  scopeLabel: string;
  candidates: Array<{ item: { foodName: string }; index: number }>;
  meal: { id: number; mealLabel: string };
  selectionAction: MealItemSelectionAction;
};

function contextWithPreposition(scope: string) {
  return scope === "same_day_meals" ? "nas refeições do dia" : "na última refeição";
}

function targetLabel(targetFood: string | null) {
  return targetFood ?? "alvo não informado";
}

function formatAppliedDetails(applied: AppliedGramsChange[]) {
  return applied
    .map(item => `alvo "${targetLabel(item.targetFood)}" -> "${item.foodName}" (${item.scopeLabel})`)
    .join("; ");
}

function formatPendingDetails(pendingTargets: PendingGramsTarget[]) {
  return pendingTargets
    .map(item => `alvo "${targetLabel(item.targetFood)}" (${item.scopeLabel})`)
    .join("; ");
}

function targetMatchDetail(params: {
  prefix: string;
  targetFood: string | null;
  selectedFoodName?: string;
  scopeLabel: string;
  ambiguous: boolean;
}) {
  const selected = params.selectedFoodName ? ` Item escolhido: ${params.selectedFoodName}.` : "";
  return `${params.prefix} Alvo usado: ${targetLabel(params.targetFood)}.${selected} Escopo da busca: ${params.scopeLabel}. Ambiguidade: ${params.ambiguous ? "sim" : "não"}.`;
}

async function ambiguousTargetReply(input: {
  userId: number;
  targetFood: string | null;
  candidates: Array<{ item: { foodName: string }; index: number }>;
  meal: { id: number; mealLabel: string };
  action: MealItemSelectionAction;
  context?: string;
  scopeLabel?: string;
}): Promise<WhatsappIntentResult> {
  const context = input.context ?? "na última refeição";
  const selectionResult = await createPendingMealItemSelection(input.userId, {
    targetFood: input.targetFood,
    action: input.action,
    contextLabel: context,
    resultTitle: "Alimento ajustado",
    candidates: input.candidates.map(candidate => ({
      mealId: input.meal.id,
      mealLabel: input.meal.mealLabel,
      itemIndex: candidate.index,
      itemName: candidate.item.foodName,
    })),
  });
  return {
    handled: true,
    action: "clarification_needed",
    reply: selectionResult.reply,
    eventType: selectionResult.eventType,
    detail: targetMatchDetail({
      prefix: "Pedido de ajuste de gramas com mais de um alimento compatível.",
      targetFood: input.targetFood,
      scopeLabel: input.scopeLabel ?? "última refeição",
      ambiguous: true,
    }),
    interactiveReply: selectionResult.interactiveReply,
    data: selectionResult.data,
  };
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

function formatPendingTargets(pendingTargets: PendingGramsTarget[]) {
  return pendingTargets
    .map(pending => `Para ${pending.targetFood ?? "esse alimento"} ${pending.context}:\n${pending.options}`)
    .join("\n");
}

function buildMultiAdjustmentLines(params: {
  applied: AppliedGramsChange[];
  notFoundFoods: string[];
  pendingTargets: PendingGramsTarget[];
}) {
  const context = adjustmentContext(params.applied.map(adjustment => adjustment.scope));
  const adjustmentLines = params.applied
    .map(a => `• ${a.foodName}: de ${formatNumber(a.previousGrams)} g para ${formatNumber(a.nextGrams)} g`);
  const lines = [
    `Ajustes realizados ${context}:`,
    ...adjustmentLines,
    "Recalculei os macros.",
  ];
  if (params.notFoundFoods.length) {
    lines.push(`Não encontrei nas refeições de hoje: ${params.notFoundFoods.join(", ")}.`);
  }
  if (params.pendingTargets.length) {
    lines.push("Preciso confirmar estes itens antes de ajustar:", formatPendingTargets(params.pendingTargets), "Responda com o número do item que devo ajustar.");
  }
  return lines;
}

function buildGramsAdjustmentMealReply(input: {
  meal: MealRecord;
  title: string;
  actionLines: string[];
}) {
  return buildWhatsAppMealActionReplyMessage(input.meal, {
    title: input.title,
    actionLines: input.actionLines,
  });
}

function buildUpdatedMealsAdjustmentReply(input: {
  updatedMeals: MealRecord[];
  title: string;
  actionLines: string[];
}) {
  if (input.updatedMeals.length === 1) {
    return buildGramsAdjustmentMealReply({
      meal: input.updatedMeals[0],
      title: input.title,
      actionLines: input.actionLines,
    });
  }

  return buildWhatsAppAuxiliaryReplyMessage({
    title: input.title,
    lines: input.actionLines,
  });
}

export async function handleQuantityCorrectionIntent(userId: number, correction: QuantityCorrectionIntent): Promise<WhatsappIntentResult> {
  const latestMeal = (await listMeals(userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage("Não encontrei um item recente para corrigir. Qual item devo corrigir?"),
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
      reply: buildWhatsAppItemNotFoundReplyMessage({
        target: `um item recente com ${previous}`,
        context: "",
        instruction: "Qual item devo corrigir?",
      }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de correção de quantidade sem item compatível na refeição recente.",
    };
  }

  if (targets.length > 1) {
    const previous = correction.previousQuantity && correction.previousUnit
      ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
      : "essa quantidade";
    return ambiguousTargetReply({
      userId,
      targetFood: `item com ${previous}`,
      candidates: targets,
      meal: latestMeal,
      action: { kind: "quantity_absolute", quantity: correction.nextQuantity, unit: correction.nextUnit },
      context: "na refeição recente",
      scopeLabel: "refeição recente",
    });
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
    reply: buildGramsAdjustmentMealReply({
      meal: updatedMeal,
      title: "Quantidade corrigida",
      actionLines: [`Atualizei ${target.item.foodName}: de ${previous} para ${next}.`],
    }),
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
  selectionAction: MealItemSelectionAction;
  detail: string;
}) {
  const meals = await listMeals(input.userId);
  if (!meals.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada."),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem refeição recente disponível.",
    } satisfies WhatsappIntentResult;
  }

  const mutableMeals = toMutableMeals(meals);
  const target = resolveTargetMealItemInMeals(mutableMeals, input.targetFood);
  if (target.kind === "ambiguous") {
    return ambiguousTargetReply({
      userId: input.userId,
      targetFood: input.targetFood,
      candidates: target.candidates,
      meal: target.meal,
      action: input.selectionAction,
      context: contextWithPreposition(target.scope),
      scopeLabel: target.scopeLabel,
    });
  }
  if (target.kind !== "matched") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppItemNotFoundReplyMessage({
        target: input.targetFood,
        context: "nas refeições de hoje",
        instruction: "Me diga qual item devo ajustar.",
      }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: targetMatchDetail({
        prefix: "Pedido de ajuste de gramas sem alimento compatível nas refeições do dia.",
        targetFood: input.targetFood,
        scopeLabel: "refeições do dia",
        ambiguous: false,
      }),
    } satisfies WhatsappIntentResult;
  }

  const previousGrams = Number(target.item.estimatedGrams || 0);
  const nextGrams = Math.max(input.resolveNextGrams(previousGrams), MIN_FOOD_GRAMS);
  target.meal.items = target.meal.items.map((item, index) => index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item);
  const updatedMeal = await updateMealItems(input.userId, target.meal);

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: buildGramsAdjustmentMealReply({
      meal: updatedMeal,
      title: "Alimento ajustado",
      actionLines: [`Ajustei ${target.item.foodName}: de ${formatNumber(previousGrams)} g para ${formatNumber(nextGrams)} g ${contextWithPreposition(target.scope)} e recalculei os macros.`],
    }),
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: targetMatchDetail({
      prefix: input.detail,
      targetFood: input.targetFood,
      selectedFoodName: target.item.foodName,
      scopeLabel: target.scopeLabel,
      ambiguous: false,
    }),
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
      reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada."),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem refeição recente disponível.",
    };
  }

  const mutableMeals = toMutableMeals(meals);
  const changedMealIndexes = new Set<number>();
  const appliedAdjustments: AppliedGramsChange[] = [];
  const pendingTargets: PendingGramsTarget[] = [];
  const notFoundFoods: string[] = [];

  for (const adjustment of adjustments) {
    const target = resolveTargetMealItemInMeals(mutableMeals, adjustment.targetFood);
    if (target.kind === "ambiguous") {
      pendingTargets.push({
        targetFood: adjustment.targetFood,
        options: formatTargetMealItemOptions(target.candidates),
        context: contextWithPreposition(target.scope),
        scopeLabel: target.scopeLabel,
        candidates: target.candidates,
        meal: target.meal,
        selectionAction: { kind: "grams_delta", delta: -adjustment.gramsDelta },
      });
      continue;
    }
    if (target.kind !== "matched") {
      if (adjustment.targetFood) {
        notFoundFoods.push(adjustment.targetFood);
      }
      continue;
    }

    const previousGrams = Number(target.item.estimatedGrams || 0);
    const nextGrams = Math.max(previousGrams - adjustment.gramsDelta, MIN_FOOD_GRAMS);
    appliedAdjustments.push({ targetFood: adjustment.targetFood, foodName: target.item.foodName, previousGrams, nextGrams, scope: target.scope, scopeLabel: target.scopeLabel });
    target.meal.items = target.meal.items.map((item, index) =>
      index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item,
    );
    changedMealIndexes.add(target.mealIndex);
  }

  if (!appliedAdjustments.length) {
    if (pendingTargets.length) {
      return ambiguousTargetReply({
        userId,
        targetFood: pendingTargets[0].targetFood,
        candidates: pendingTargets[0].candidates,
        meal: pendingTargets[0].meal,
        action: pendingTargets[0].selectionAction,
        context: pendingTargets[0].context,
        scopeLabel: pendingTargets[0].scopeLabel,
      });
    }
    const foods = adjustments.map(a => a.targetFood).filter(Boolean).join(", ");
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppItemNotFoundReplyMessage({
        target: foods || "esses alimentos",
        context: "nas refeições de hoje",
        instruction: "Me diga quais itens devo ajustar.",
      }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: `Pedido de ajuste de gramas sem alimentos compatíveis nas refeições do dia. Alvos usados: ${foods || "não informados"}. Escopo da busca: refeições do dia. Ambiguidade: não.`,
    };
  }

  const updatedMeals = await Promise.all([...changedMealIndexes].map(index => updateMealItems(userId, mutableMeals[index])));
  const context = adjustmentContext(appliedAdjustments.map(adjustment => adjustment.scope));
  const pendingDetail = pendingTargets.length ? ` Alvos ambíguos: ${formatPendingDetails(pendingTargets)}.` : "";
  const notFoundDetail = notFoundFoods.length ? ` Alvos não encontrados: ${notFoundFoods.join(", ")}.` : "";
  const actionLines = buildMultiAdjustmentLines({ applied: appliedAdjustments, notFoundFoods, pendingTargets });

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: buildUpdatedMealsAdjustmentReply({
      updatedMeals,
      title: appliedAdjustments.length === 1 ? "Alimento ajustado" : "Alimentos ajustados",
      actionLines,
    }),
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${appliedAdjustments.length} item(ns) ajustado(s) via WhatsApp. Matches: ${formatAppliedDetails(appliedAdjustments)}. Escopo da busca: ${context}. Ambiguidade: ${pendingTargets.length ? "sim" : "não"}.${pendingDetail}${notFoundDetail}`,
    data: {
      mealId: updatedMeals[0]?.id,
      adjustments: appliedAdjustments.map(({ scope: _scope, scopeLabel: _scopeLabel, targetFood: _targetFood, ...adjustment }) => adjustment),
    },
  };
}

export async function handleMealItemMultiIncrement(userId: number, increments: GramsIncrementItem[]): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  if (!meals.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada."),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de incremento de gramas sem refeição recente disponível.",
    };
  }

  const mutableMeals = toMutableMeals(meals);
  const changedMealIndexes = new Set<number>();
  const appliedIncrements: AppliedGramsChange[] = [];
  const pendingTargets: PendingGramsTarget[] = [];
  const notFoundFoods: string[] = [];

  for (const increment of increments) {
    const target = resolveTargetMealItemInMeals(mutableMeals, increment.targetFood);
    if (target.kind === "ambiguous") {
      pendingTargets.push({
        targetFood: increment.targetFood,
        options: formatTargetMealItemOptions(target.candidates),
        context: contextWithPreposition(target.scope),
        scopeLabel: target.scopeLabel,
        candidates: target.candidates,
        meal: target.meal,
        selectionAction: { kind: "grams_delta", delta: increment.gramsDelta },
      });
      continue;
    }
    if (target.kind !== "matched") {
      if (increment.targetFood) {
        notFoundFoods.push(increment.targetFood);
      }
      continue;
    }

    const previousGrams = Number(target.item.estimatedGrams || 0);
    const nextGrams = Math.max(previousGrams + increment.gramsDelta, MIN_FOOD_GRAMS);
    appliedIncrements.push({ targetFood: increment.targetFood, foodName: target.item.foodName, previousGrams, nextGrams, scope: target.scope, scopeLabel: target.scopeLabel });
    target.meal.items = target.meal.items.map((item, index) =>
      index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item,
    );
    changedMealIndexes.add(target.mealIndex);
  }

  if (!appliedIncrements.length) {
    if (pendingTargets.length) {
      return ambiguousTargetReply({
        userId,
        targetFood: pendingTargets[0].targetFood,
        candidates: pendingTargets[0].candidates,
        meal: pendingTargets[0].meal,
        action: pendingTargets[0].selectionAction,
        context: pendingTargets[0].context,
        scopeLabel: pendingTargets[0].scopeLabel,
      });
    }
    const foods = increments.map(i => i.targetFood).filter(Boolean).join(", ");
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppItemNotFoundReplyMessage({
        target: foods || "esses alimentos",
        context: "nas refeições de hoje",
        instruction: "Me diga quais itens devo ajustar.",
      }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: `Pedido de incremento de gramas sem alimentos compatíveis nas refeições do dia. Alvos usados: ${foods || "não informados"}. Escopo da busca: refeições do dia. Ambiguidade: não.`,
    };
  }

  const updatedMeals = await Promise.all([...changedMealIndexes].map(index => updateMealItems(userId, mutableMeals[index])));
  const context = adjustmentContext(appliedIncrements.map(increment => increment.scope));
  const pendingDetail = pendingTargets.length ? ` Alvos ambíguos: ${formatPendingDetails(pendingTargets)}.` : "";
  const notFoundDetail = notFoundFoods.length ? ` Alvos não encontrados: ${notFoundFoods.join(", ")}.` : "";
  const actionLines = buildMultiAdjustmentLines({ applied: appliedIncrements, notFoundFoods, pendingTargets });

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: buildUpdatedMealsAdjustmentReply({
      updatedMeals,
      title: appliedIncrements.length === 1 ? "Alimento ajustado" : "Alimentos ajustados",
      actionLines,
    }),
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${appliedIncrements.length} item(ns) incrementado(s) via WhatsApp. Matches: ${formatAppliedDetails(appliedIncrements)}. Escopo da busca: ${context}. Ambiguidade: ${pendingTargets.length ? "sim" : "não"}.${pendingDetail}${notFoundDetail}`,
    data: {
      mealId: updatedMeals[0]?.id,
      increments: appliedIncrements.map(({ scope: _scope, scopeLabel: _scopeLabel, targetFood: _targetFood, ...increment }) => increment),
    },
  };
}

export async function handleMealItemReplacement(userId: number, replacement: { targetFood: string; nextGrams: number }): Promise<WhatsappIntentResult> {
  return updateLatestMealItemGrams({
    userId,
    targetFood: replacement.targetFood,
    resolveNextGrams: () => replacement.nextGrams,
    selectionAction: { kind: "grams_absolute", grams: replacement.nextGrams },
    detail: `Quantidade de ${replacement.targetFood} substituída para ${formatNumber(replacement.nextGrams)} g via WhatsApp.`,
  });
}
