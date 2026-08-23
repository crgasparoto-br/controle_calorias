import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { normalizeMeasurementUnit } from "../../../shared/measurementUnits";
import { convertFoodPortionToGrams, getGlobalFoodCatalogItem } from "../foods/service";
import { listMeals } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { resolveTargetMealItemInMeals } from "./intent/mealTargetResolution";
import { scaleMealItem, toMealItemInput } from "./intent/mealItemHelpers";
import {
  updateMealsWithCompensation,
  describeMealBatchMutationFailure,
  type MealBatchMutationChange,
} from "./mealBatchMutation";
import {
  createPendingMealItemSelection,
  type MealItemPendingSelectionStep,
  type MealItemSelectionCompanionAction,
} from "./mealItemSelectionCallback";
import { requestWhatsappMealItemIncrementQuantityClarification } from "./foodQuantityClarification";
import { composeWhatsAppMealActionReplies } from "./mealActionReplyComposer";
import {
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";
import type { WhatsappIntentResult } from "./intent/types";
import type {
  MixedMealItemIncrementOperation,
  MixedMealItemIncrementPlan,
  MixedIncrementTarget,
} from "./mixedMealItemIncrementPlanTypes";

type MealRecord = Awaited<ReturnType<typeof listMeals>>[number];
type MutableMeal = MealRecord & { items: MealItemInput[] };

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toMutableMeals(meals: MealRecord[]): MutableMeal[] {
  return meals.map(meal => ({ ...meal, items: [...(meal.items ?? [])] as MealItemInput[] }));
}

function toTarget(meal: MutableMeal, itemIndex: number): MixedIncrementTarget {
  const item = meal.items[itemIndex];
  return {
    mealId: meal.id,
    mealLabel: meal.mealLabel,
    itemIndex,
    itemName: item.foodName,
  };
}

function sameCandidate(item: MealItemInput, target: MixedIncrementTarget) {
  return normalize(item.foodName) === normalize(target.itemName);
}

function normalizeCountableUnit(value: string) {
  const normalized = normalizeMeasurementUnit(value);
  if (normalized === "fatia") return "fatia";
  if (normalized === "un") return "unidade";
  return null;
}

function portionSupportsUnit(
  portion: { label: string; unit: string },
  requested: "fatia" | "unidade",
) {
  const requestedNormalized = requested === "unidade" ? "un" : "fatia";
  return normalizeMeasurementUnit(portion.unit) === requestedNormalized
    || normalizeMeasurementUnit(portion.label.replace(/^\d+(?:[,.]\d+)?\s*/u, "")) === requestedNormalized;
}

async function resolveCountableGrams(
  userId: number,
  item: MealItemInput,
  operation: MixedMealItemIncrementOperation,
) {
  const foodId = item.foodId;
  const requestedUnit = operation.unit;
  if ((requestedUnit !== "fatia" && requestedUnit !== "unidade") || !foodId) return null;

  try {
    const food = await getGlobalFoodCatalogItem(userId, foodId);
    const matching = food.portions.filter(portion => portionSupportsUnit(portion, requestedUnit));
    if (matching.length !== 1) return null;
    const portion = matching[0];
    const converted = await convertFoodPortionToGrams(userId, {
      foodId,
      portionId: portion.id,
      quantity: operation.quantity,
    });
    return converted.grams > 0 ? converted.grams : null;
  } catch {
    return null;
  }
}

function selectionCandidate(input: { meal: MutableMeal; index: number }) {
  const item = input.meal.items[input.index];
  return {
    mealId: input.meal.id,
    mealLabel: input.meal.mealLabel,
    itemIndex: input.index,
    itemName: item.foodName,
  };
}

function targetStillValid(meals: MutableMeal[], target: MixedIncrementTarget) {
  const meal = meals.find(candidate => candidate.id === target.mealId);
  if (!meal?.items?.length) return null;
  const indexed = meal.items[target.itemIndex];
  if (indexed && sameCandidate(indexed, target)) {
    return { meal, index: target.itemIndex, item: indexed };
  }
  const matches = meal.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => sameCandidate(item, target));
  return matches.length === 1
    ? { meal, index: matches[0].index, item: matches[0].item }
    : null;
}

function applyOperationToItem(
  item: MealItemInput,
  operation: MixedMealItemIncrementOperation,
) {
  const previousGrams = Number(item.estimatedGrams || 0);
  const nextGrams = previousGrams + Number(operation.gramsDelta || 0);
  const scaled = scaleMealItem(toMealItemInput(item), nextGrams);

  if (operation.unit !== "fatia" && operation.unit !== "unidade") return scaled;

  const currentUnit = normalizeCountableUnit(item.unit ?? "");
  if (currentUnit !== operation.unit || !Number.isFinite(Number(item.quantity))) {
    return scaled;
  }

  const nextQuantity = Number(item.quantity) + operation.quantity;
  const unitLabel = operation.unit === "fatia"
    ? (nextQuantity === 1 ? "fatia" : "fatias")
    : (nextQuantity === 1 ? "unidade" : "unidades");

  return {
    ...scaled,
    quantity: nextQuantity,
    unit: operation.unit,
    portionText: `${nextQuantity} ${unitLabel}`,
  };
}

function snapshot(meal: MutableMeal | MealRecord) {
  return {
    id: meal.id,
    mealLabel: meal.mealLabel,
    occurredAt: meal.occurredAt,
    notes: meal.notes,
    items: [...(meal.items ?? [])] as MealItemInput[],
  };
}

function stalePlanResult(): WhatsappIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: buildWhatsAppClarificationReplyMessage(
      "A refeição mudou durante a confirmação. Nada foi alterado; faça o pedido novamente.",
    ),
    eventType: "whatsapp.intent.meal_item_increment_plan_stale",
    detail: "Plano misto ficou obsoleto antes da mutação e foi bloqueado sem efeito parcial.",
  };
}

async function applyReadyPlan(
  userId: number,
  plan: MixedMealItemIncrementPlan,
): Promise<WhatsappIntentResult> {
  const currentMeals = toMutableMeals(await listMeals(userId));
  const originalById = new Map(currentMeals.map(meal => [meal.id, snapshot(meal)]));
  const actionLines = new Map<number, string[]>();
  const changed = new Set<number>();

  for (const operation of plan.operations) {
    if (!operation.target || !operation.gramsDelta || operation.gramsDelta <= 0) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: buildWhatsAppClarificationReplyMessage(
          "Ainda falta resolver uma quantidade antes de aplicar este ajuste.",
        ),
        eventType: "whatsapp.intent.meal_item_increment_plan_not_ready",
        detail: "Plano misto bloqueado porque ainda existe operação sem alvo ou delta resolvido.",
      };
    }

    const resolved = targetStillValid(currentMeals, operation.target);
    if (!resolved) return stalePlanResult();

    const previousGrams = Number(resolved.item.estimatedGrams || 0);
    const nextItem = applyOperationToItem(resolved.item, operation);
    resolved.meal.items = resolved.meal.items.map((item, index) =>
      index === resolved.index ? nextItem : item,
    );
    changed.add(resolved.meal.id);
    actionLines.set(resolved.meal.id, [
      ...(actionLines.get(resolved.meal.id) ?? []),
      `• ${resolved.item.foodName}: de ${previousGrams} g para ${nextItem.estimatedGrams} g`,
    ]);
  }

  const changes: MealBatchMutationChange[] = currentMeals
    .filter(meal => changed.has(meal.id))
    .map(meal => ({ before: originalById.get(meal.id)!, after: snapshot(meal) }));

  try {
    const updatedMeals = await updateMealsWithCompensation(userId, changes);
    return {
      handled: true,
      action: "meal_item_grams_adjusted",
      reply: await composeWhatsAppMealActionReplies({
        userId,
        timeZone: plan.timeZone,
        entries: updatedMeals.map(meal => ({
          meal,
          options: {
            title: plan.operations.length > 1 ? "Alimentos ajustados" : "Alimento ajustado",
            actionLines: actionLines.get(meal.id) ?? [],
          },
        })),
      }),
      eventType: "whatsapp.intent.meal_item_grams_adjusted",
      detail: `${plan.operations.length} operação(ões) do plano misto aplicada(s) em lote após revalidação.`,
      data: {
        affectedMealIds: updatedMeals.map(meal => meal.id),
        actionCount: plan.operations.length,
      },
    };
  } catch (error) {
    const failure = describeMealBatchMutationFailure(error);
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppRecoverableErrorReplyMessage(failure.userMessage),
      eventType: "whatsapp.intent.meal_item_increment_plan_batch_failed",
      detail: failure.detail,
      data: {
        rollbackSucceeded: failure.rollbackSucceeded,
        affectedMealIds: changes.map(change => change.after.id),
      },
    };
  }
}

async function requestSelection(
  userId: number,
  plan: MixedMealItemIncrementPlan,
  meals: MutableMeal[],
  pendingIndexes: number[],
) {
  const [firstIndex, ...remainingIndexes] = pendingIndexes;
  const firstOperation = plan.operations[firstIndex];
  const firstResolution = resolveTargetMealItemInMeals(meals, firstOperation.targetFood, plan.timeZone);
  if (firstResolution.kind !== "ambiguous") {
    throw new Error("Seleção pendente deixou de ser ambígua antes da persistência.");
  }

  const companionActions: MealItemSelectionCompanionAction[] = [];
  for (const [operationIndex, operation] of plan.operations.entries()) {
    if (!operation.target) continue;
    companionActions.push({
      candidate: operation.target,
      action: { kind: "mixed_increment_target", operationIndex },
    });
  }

  const remainingSelections: MealItemPendingSelectionStep[] = remainingIndexes.map(operationIndex => {
    const operation = plan.operations[operationIndex];
    const resolved = resolveTargetMealItemInMeals(meals, operation.targetFood, plan.timeZone);
    if (resolved.kind !== "ambiguous") {
      throw new Error("Seleção remanescente deixou de ser ambígua.");
    }
    return {
      targetFood: operation.targetFood,
      action: { kind: "mixed_increment_target", operationIndex },
      contextLabel: resolved.scope === "same_day_meals" ? "nas refeições do dia" : "na última refeição",
      candidates: resolved.candidates.map(candidate =>
        selectionCandidate({ meal: candidate.meal as MutableMeal, index: candidate.index }),
      ),
    };
  });

  return createPendingMealItemSelection(userId, {
    targetFood: firstOperation.targetFood,
    action: { kind: "mixed_increment_target", operationIndex: firstIndex },
    contextLabel: firstResolution.scope === "same_day_meals" ? "nas refeições do dia" : "na última refeição",
    resultTitle: "Alimentos ajustados",
    candidates: firstResolution.candidates.map(candidate =>
      selectionCandidate({ meal: candidate.meal as MutableMeal, index: candidate.index }),
    ),
    companionActions,
    remainingSelections,
    continuation: { kind: "mixed_increment_plan", plan },
  });
}

export async function continueMixedMealItemIncrementPlan(
  userId: number,
  inputPlan: MixedMealItemIncrementPlan,
): Promise<WhatsappIntentResult> {
  const plan: MixedMealItemIncrementPlan = {
    ...inputPlan,
    timeZone: inputPlan.timeZone || DEFAULT_APP_TIME_ZONE,
    operations: inputPlan.operations.map(operation => ({
      ...operation,
      target: operation.target ? { ...operation.target } : undefined,
    })),
  };

  const allMeals = await listMeals(userId);
  const meals = toMutableMeals(
    plan.mealLabel
      ? allMeals.filter(meal => normalize(meal.mealLabel) === normalize(plan.mealLabel!))
      : allMeals,
  );

  if (!meals.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(
        plan.mealLabel
          ? `Não encontrei a refeição ${plan.mealLabel} para ajustar.`
          : "Não encontrei uma refeição recente para ajustar.",
      ),
      eventType: "whatsapp.intent.meal_item_increment_plan_meal_not_found",
      detail: "Plano misto não encontrou refeição candidata e não aplicou mutação.",
    };
  }

  const ambiguousIndexes: number[] = [];
  for (const [index, operation] of plan.operations.entries()) {
    if (operation.target) continue;
    const target = resolveTargetMealItemInMeals(meals, operation.targetFood, plan.timeZone);
    if (target.kind === "ambiguous") {
      ambiguousIndexes.push(index);
      continue;
    }
    if (target.kind !== "matched") {
      return {
        handled: true,
        action: "clarification_needed",
        reply: buildWhatsAppClarificationReplyMessage(
          `Não encontrei ${operation.targetFood ?? "um dos alimentos"} com segurança. Nada foi alterado.`,
        ),
        eventType: "whatsapp.intent.meal_item_increment_plan_target_not_found",
        detail: "Plano misto bloqueado por alvo ausente antes de qualquer mutação.",
      };
    }
    operation.target = toTarget(target.meal as MutableMeal, target.index);
  }

  if (ambiguousIndexes.length) {
    return requestSelection(userId, plan, meals, ambiguousIndexes);
  }

  for (const [index, operation] of plan.operations.entries()) {
    if (operation.gramsDelta && operation.gramsDelta > 0) continue;

    if (operation.unit === "g" || operation.unit === "ml") {
      operation.gramsDelta = operation.quantity;
      operation.resolvedBy = "explicit_mass_or_volume";
      continue;
    }

    if (!operation.target) continue;
    const current = targetStillValid(meals, operation.target);
    if (!current) return stalePlanResult();

    const countableUnit = operation.unit ? normalizeCountableUnit(operation.unit) : null;
    if (countableUnit) {
      const grams = await resolveCountableGrams(userId, current.item, operation);
      if (grams) {
        operation.gramsDelta = grams;
        operation.resolvedBy = "canonical_portion";
        continue;
      }
    }

    return requestWhatsappMealItemIncrementQuantityClarification({
      userId,
      foodName: current.item.foodName,
      originalText: plan.originalText,
      plan,
      operationIndex: index,
      receivedAt: new Date(),
      instructionText: operation.unit
        ? `Não encontrei uma conversão segura para ${operation.quantity} ${operation.unit} de ${current.item.foodName}. Informe somente o peso ou volume correspondente, por exemplo 20 g.`
        : `Não consegui inferir a unidade de ${current.item.foodName} com segurança. Informe somente o incremento em gramas ou ml, por exemplo 20 g.`,
    });
  }

  return applyReadyPlan(userId, plan);
}
