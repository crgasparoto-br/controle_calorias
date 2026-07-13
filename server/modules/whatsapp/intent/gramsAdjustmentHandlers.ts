import {
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppItemNotFoundReplyMessage,
  buildWhatsAppMealActionReplyMessage,
} from "../replyMessages";
import { listMeals, updateMeal } from "../../meals/service";
import type { MealItemInput } from "../../meals/schemas";
import {
  createPendingMealItemSelection,
  type MealItemSelectionAction,
  type MealItemSelectionCompanionAction,
} from "../mealItemSelectionCallback";
import {
  MIN_FOOD_GRAMS,
  findQuantityCorrectionTargets,
  scaleMealItem,
  scaleMealItemQuantity,
  toMealItemInput,
  toMealItemInputs,
} from "./mealItemHelpers";
import { resolveTargetMealItemInMeals, type MealItemTargetCandidate } from "./mealTargetResolution";
import { formatNumber } from "./textUtils";
import type { GramsAdjustmentItem, GramsIncrementItem, QuantityCorrectionIntent, WhatsappIntentResult } from "./types";

type MealRecord = Awaited<ReturnType<typeof listMeals>>[number];
type MutableMealRecord = MealRecord & { items: MealItemInput[] };
type Candidate = MealItemTargetCandidate<MutableMealRecord>;
type AppliedGramsChange = {
  targetFood: string | null;
  foodName: string;
  previousGrams: number;
  nextGrams: number;
  scope: string;
  scopeLabel: string;
  candidate: MealItemSelectionCompanionAction["candidate"];
  action: MealItemSelectionAction;
};
type PendingGramsTarget = {
  targetFood: string | null;
  context: string;
  scopeLabel: string;
  candidates: Candidate[];
  selectionAction: MealItemSelectionAction;
};

function contextWithPreposition(scope: string) {
  return scope === "same_day_meals" ? "nas refeições do dia" : "na última refeição";
}

function targetLabel(targetFood: string | null) {
  return targetFood ?? "alvo não informado";
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

function toMutableMeals(meals: MealRecord[]): MutableMealRecord[] {
  return meals.map(meal => ({ ...meal, items: [...(meal.items ?? [])] as MealItemInput[] }));
}

function toSelectionCandidate(candidate: Candidate) {
  return {
    mealId: candidate.meal.id,
    mealLabel: candidate.meal.mealLabel,
    itemIndex: candidate.index,
    itemName: candidate.item.foodName,
  };
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

function buildUpdatedMealsReply(updatedMeals: MealRecord[], title: string, actionLines: string[]) {
  return updatedMeals
    .map(meal => buildWhatsAppMealActionReplyMessage(meal, { title, actionLines }))
    .join("\n\n");
}

async function ambiguousTargetReply(input: {
  userId: number;
  targetFood: string | null;
  candidates: Candidate[];
  action: MealItemSelectionAction;
  companionActions?: MealItemSelectionCompanionAction[];
  context?: string;
  scopeLabel?: string;
}): Promise<WhatsappIntentResult> {
  const selectionResult = await createPendingMealItemSelection(input.userId, {
    targetFood: input.targetFood,
    action: input.action,
    contextLabel: input.context ?? "na última refeição",
    resultTitle: "Alimento ajustado",
    candidates: input.candidates.map(toSelectionCandidate),
    companionActions: input.companionActions,
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

  const targets = findQuantityCorrectionTargets(toMealItemInputs(latestMeal.items), correction);
  if (!targets.length) {
    const previous = correction.previousQuantity && correction.previousUnit
      ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
      : "essa quantidade";
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppItemNotFoundReplyMessage({ target: `um item recente com ${previous}`, context: "", instruction: "Qual item devo corrigir?" }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de correção de quantidade sem item compatível na refeição recente.",
    };
  }

  if (targets.length > 1) {
    const mutableMeal = { ...latestMeal, items: [...latestMeal.items] as MealItemInput[] };
    const previous = correction.previousQuantity && correction.previousUnit
      ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
      : "essa quantidade";
    return ambiguousTargetReply({
      userId,
      targetFood: `item com ${previous}`,
      candidates: targets.map(target => ({ ...target, meal: mutableMeal, mealIndex: 0 })),
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
    reply: buildWhatsAppMealActionReplyMessage(updatedMeal, {
      title: "Quantidade corrigida",
      actionLines: [`Atualizei ${target.item.foodName}: de ${previous} para ${next}.`],
    }),
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `Quantidade de ${target.item.foodName} corrigida por contexto curto via WhatsApp.`,
    data: { mealId: updatedMeal.id, foodName: target.item.foodName, previousQuantity: correction.previousQuantity, previousUnit: correction.previousUnit, nextQuantity: correction.nextQuantity, nextUnit: correction.nextUnit },
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
      action: input.selectionAction,
      context: contextWithPreposition(target.scope),
      scopeLabel: target.scopeLabel,
    });
  }
  if (target.kind !== "matched") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppItemNotFoundReplyMessage({ target: input.targetFood, context: "nas refeições de hoje", instruction: "Me diga qual item devo ajustar." }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: targetMatchDetail({ prefix: "Pedido de ajuste de gramas sem alimento compatível nas refeições do dia.", targetFood: input.targetFood, scopeLabel: "refeições do dia", ambiguous: false }),
    } satisfies WhatsappIntentResult;
  }

  const previousGrams = Number(target.item.estimatedGrams || 0);
  const nextGrams = Math.max(input.resolveNextGrams(previousGrams), MIN_FOOD_GRAMS);
  target.meal.items = target.meal.items.map((item, index) => index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item);
  const updatedMeal = await updateMealItems(input.userId, target.meal);
  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: buildWhatsAppMealActionReplyMessage(updatedMeal, {
      title: "Alimento ajustado",
      actionLines: [`Ajustei ${target.item.foodName}: de ${formatNumber(previousGrams)} g para ${formatNumber(nextGrams)} g ${contextWithPreposition(target.scope)} e recalculei os macros.`],
    }),
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: targetMatchDetail({ prefix: input.detail, targetFood: input.targetFood, selectedFoodName: target.item.foodName, scopeLabel: target.scopeLabel, ambiguous: false }),
    data: { mealId: updatedMeal.id, foodName: target.item.foodName, previousGrams, nextGrams },
  } satisfies WhatsappIntentResult;
}

async function handleMultiGramsChange(input: {
  userId: number;
  changes: Array<{ targetFood: string | null; delta: number }>;
  detailPrefix: string;
}): Promise<WhatsappIntentResult> {
  const meals = await listMeals(input.userId);
  if (!meals.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage("Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada."),
      eventType: "whatsapp.intent.clarification_needed",
      detail: `${input.detailPrefix} sem refeição recente disponível.`,
    };
  }

  const mutableMeals = toMutableMeals(meals);
  const changedMealIndexes = new Set<number>();
  const applied: AppliedGramsChange[] = [];
  const pending: PendingGramsTarget[] = [];
  const notFound: string[] = [];

  for (const change of input.changes) {
    const target = resolveTargetMealItemInMeals(mutableMeals, change.targetFood);
    if (target.kind === "ambiguous") {
      pending.push({
        targetFood: change.targetFood,
        context: contextWithPreposition(target.scope),
        scopeLabel: target.scopeLabel,
        candidates: target.candidates,
        selectionAction: { kind: "grams_delta", delta: change.delta },
      });
      continue;
    }
    if (target.kind !== "matched") {
      if (change.targetFood) notFound.push(change.targetFood);
      continue;
    }

    const previousGrams = Number(target.item.estimatedGrams || 0);
    const nextGrams = Math.max(previousGrams + change.delta, MIN_FOOD_GRAMS);
    const action: MealItemSelectionAction = { kind: "grams_delta", delta: change.delta };
    const candidate = { mealId: target.meal.id, mealLabel: target.meal.mealLabel, itemIndex: target.index, itemName: target.item.foodName };
    target.meal.items = target.meal.items.map((item, index) => index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item);
    changedMealIndexes.add(target.mealIndex);
    applied.push({ targetFood: change.targetFood, foodName: target.item.foodName, previousGrams, nextGrams, scope: target.scope, scopeLabel: target.scopeLabel, candidate, action });
  }

  if (pending.length) {
    const firstPending = pending[0];
    return ambiguousTargetReply({
      userId: input.userId,
      targetFood: firstPending.targetFood,
      candidates: firstPending.candidates,
      action: firstPending.selectionAction,
      companionActions: applied.map(item => ({ candidate: item.candidate, action: item.action })),
      context: firstPending.context,
      scopeLabel: firstPending.scopeLabel,
    });
  }

  if (!applied.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppItemNotFoundReplyMessage({ target: notFound.join(", ") || "esses alimentos", context: "nas refeições de hoje", instruction: "Me diga quais itens devo ajustar." }),
      eventType: "whatsapp.intent.clarification_needed",
      detail: `${input.detailPrefix} sem alimentos compatíveis nas refeições do dia.`,
    };
  }

  const updatedMeals = await Promise.all([...changedMealIndexes].map(index => updateMealItems(input.userId, mutableMeals[index])));
  const actionLines = [
    ...applied.map(item => `• ${item.foodName}: de ${formatNumber(item.previousGrams)} g para ${formatNumber(item.nextGrams)} g`),
    ...(notFound.length ? [`Não encontrei nas refeições de hoje: ${notFound.join(", ")}.`] : []),
  ];
  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: buildUpdatedMealsReply(updatedMeals, applied.length === 1 ? "Alimento ajustado" : "Alimentos ajustados", actionLines),
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${applied.length} item(ns) ajustado(s) via WhatsApp sem ambiguidade pendente.`,
    data: { mealId: updatedMeals[0]?.id, affectedMealIds: updatedMeals.map(meal => meal.id), adjustments: applied.map(({ candidate: _candidate, action: _action, scope: _scope, scopeLabel: _scopeLabel, targetFood: _targetFood, ...item }) => item) },
  };
}

export async function handleMealItemMultiAdjustment(userId: number, adjustments: GramsAdjustmentItem[]): Promise<WhatsappIntentResult> {
  return handleMultiGramsChange({
    userId,
    changes: adjustments.map(item => ({ targetFood: item.targetFood, delta: -item.gramsDelta })),
    detailPrefix: "Pedido de ajuste de gramas",
  });
}

export async function handleMealItemMultiIncrement(userId: number, increments: GramsIncrementItem[]): Promise<WhatsappIntentResult> {
  return handleMultiGramsChange({
    userId,
    changes: increments.map(item => ({ targetFood: item.targetFood, delta: item.gramsDelta })),
    detailPrefix: "Pedido de incremento de gramas",
  });
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
