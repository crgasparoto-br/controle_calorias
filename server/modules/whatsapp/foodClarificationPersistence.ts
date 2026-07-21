import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type * as dbRuntime from "../../db";
import { normalizeText } from "../../mealTextParsing";
import type * as nutritionRuntime from "../../nutritionEngine";
import type { MealDraftItem } from "../../nutritionEngineTypes";
import type * as mealRuntime from "../meals/service";
import type { WhatsappIntentResult } from "./intent/types";
import {
  buildFoodClarificationRegistrationText,
  type FoodClarificationCandidate,
  type PendingFoodClarificationTarget,
} from "./foodClarificationContract";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import { consolidateWhatsAppMealAfterSave } from "./mealConsolidationService";
import { buildWhatsAppRecoverableErrorReplyMessage } from "./replyMessages";

export type FoodClarificationDependencies = {
  repository: import("../../repositories/whatsappPendingOperationRepository").WhatsAppPendingOperationRepository;
  processFood: typeof nutritionRuntime.processMealInput;
  getHabits: typeof dbRuntime.getHabitSnapshots;
  createMeal: typeof mealRuntime.createManualMeal;
  listMeals: typeof mealRuntime.listMeals;
  updateMeal: typeof mealRuntime.updateMeal;
  removeMeal: typeof mealRuntime.removeMeal;
};

export type ResolvedFoodPersistenceOutcome =
  | { status: "success"; result: WhatsappIntentResult }
  | { status: "safe_to_retry" }
  | { status: "verification_required"; result: WhatsappIntentResult };

type ExistingMeal = Awaited<ReturnType<FoodClarificationDependencies["listMeals"]>>[number];

function sameLogicalMeal(
  meal: { mealLabel: string; occurredAt: Date | number | string },
  mealLabel: string,
  occurredAt: Date,
  timeZone: string,
) {
  return normalizeText(meal.mealLabel) === normalizeText(mealLabel)
    && getDateKeyInTimeZone(new Date(meal.occurredAt), timeZone) === getDateKeyInTimeZone(occurredAt, timeZone);
}

function normalizeFingerprintItem(item: MealDraftItem) {
  return {
    foodName: item.foodName,
    canonicalName: item.canonicalName,
    quantity: item.quantity,
    unit: item.unit,
    estimatedGrams: item.estimatedGrams,
  };
}

function mealStateFingerprint(meals: ExistingMeal[]) {
  return JSON.stringify(meals
    .map(meal => ({
      id: meal.id,
      mealLabel: meal.mealLabel,
      occurredAt: new Date(meal.occurredAt).toISOString(),
      items: (meal.items ?? []).map(normalizeFingerprintItem),
    }))
    .sort((left, right) => left.id - right.id));
}

async function captureMealState(deps: FoodClarificationDependencies, userId: number) {
  try {
    return mealStateFingerprint(await deps.listMeals(userId));
  } catch {
    return null;
  }
}

async function persistResolvedFood(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  candidate: FoodClarificationCandidate,
  occurredAt: Date,
  timeZone: string,
  explicitQuantity?: { quantity: number; unit: string },
): Promise<WhatsappIntentResult> {
  const processed = await deps.processFood({
    text: buildFoodClarificationRegistrationText(target, candidate, explicitQuantity),
    habits: await deps.getHabits(userId),
    occurredAt,
    timeZone,
  });
  if (!processed.items.length) throw new Error("A resolução não produziu alimento válido.");

  const meals = await deps.listMeals(userId);
  const existing = meals.find(meal => sameLogicalMeal(meal, processed.detectedMealLabel, occurredAt, timeZone));
  const notes = target.originalText;

  const saved = existing
    ? await deps.updateMeal(userId, {
        mealId: existing.id,
        mealLabel: existing.mealLabel,
        occurredAt: new Date(existing.occurredAt).toISOString(),
        notes: existing.notes || notes,
        items: [...(existing.items ?? []), ...processed.items] as MealDraftItem[],
      })
    : await deps.createMeal(userId, {
        mealLabel: processed.detectedMealLabel || "Refeição",
        occurredAt: occurredAt.toISOString(),
        notes,
        items: processed.items,
      });

  const consolidated = existing
    ? { action: "updated" as const, meal: saved }
    : await consolidateWhatsAppMealAfterSave({
        listUserMeals: deps.listMeals,
        updateUserMeal: input => deps.updateMeal(input.userId, {
          mealId: input.mealId,
          mealLabel: input.mealLabel,
          occurredAt: input.occurredAt,
          notes: input.notes,
          items: input.items,
        }),
        removeUserMeal: deps.removeMeal,
      }, saved, timeZone);

  const meal = consolidated.meal;
  const reply = await composeWhatsAppMealActionReply({
    userId,
    meal,
    timeZone,
    options: {
      title: consolidated.action === "updated" ? "Alimento adicionado" : "Alimento registrado",
      actionLines: [`Registrei ${target.normalizedCandidate} usando a quantidade resolvida para a mensagem original.`],
      mealResultState: consolidated.action === "updated" ? "updated" : "registered",
    },
  });

  return {
    handled: true,
    action: "food_clarification_completed",
    reply,
    eventType: "whatsapp.food_clarification.completed",
    detail: "Pendência alimentar resolvida com serviço canônico, consolidação e estado persistido recarregado.",
    data: {
      mealId: meal.id,
      interactionId: target.interactionId,
      originalTextPreserved: true,
      normalizedCandidate: target.normalizedCandidate,
      resolvedQuantity: explicitQuantity ?? { count: target.count, servingLabel: candidate.servingLabel },
    },
  };
}

/**
 * Executa a resolução e diferencia falha anterior à gravação de falha cujo
 * efeito de domínio pode já ter sido persistido. Somente o primeiro caso pode
 * recriar a pendência automaticamente; no segundo, o usuário deve revisar o
 * estado antes de tentar novamente, evitando duplicidade.
 */
export async function persistResolvedFoodSafely(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  candidate: FoodClarificationCandidate,
  occurredAt: Date,
  timeZone: string,
  explicitQuantity?: { quantity: number; unit: string },
): Promise<ResolvedFoodPersistenceOutcome> {
  const before = await captureMealState(deps, userId);
  try {
    return {
      status: "success",
      result: await persistResolvedFood(deps, userId, target, candidate, occurredAt, timeZone, explicitQuantity),
    };
  } catch {
    const after = await captureMealState(deps, userId);
    if (before !== null && after !== null && before === after) {
      return { status: "safe_to_retry" };
    }

    return {
      status: "verification_required",
      result: {
        handled: true,
        action: "food_clarification_unavailable",
        reply: buildWhatsAppRecoverableErrorReplyMessage(
          `Não consegui confirmar o resumo final de ${target.normalizedCandidate}. Verifique seus registros antes de tentar novamente para evitar duplicidade.`,
        ),
        eventType: "whatsapp.food_clarification.persistence_verification_required",
        detail: "Falha após possível mutação não recriou a pendência; o estado deve ser verificado antes de nova tentativa.",
        data: {
          interactionId: target.interactionId,
          originalTextPreserved: true,
          normalizedCandidate: target.normalizedCandidate,
          verificationRequired: true,
          retryBlockedToPreventDuplicate: true,
        },
      },
    };
  }
}
