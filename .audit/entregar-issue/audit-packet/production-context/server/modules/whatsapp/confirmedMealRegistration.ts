import { calculateMealTotals } from "../../../shared/mealTotals";
import * as dbRuntime from "../../db";
import * as nutritionRuntime from "../../nutritionEngine";
import type { MealProcessingResult } from "../../nutritionEngine";
import * as consolidationRuntime from "./mealConsolidationService";
import * as goalProgressRuntime from "./goalProgressService";
import {
  buildWhatsAppConsolidatedMealReplyMessage,
  buildWhatsAppMealReplyMessage,
} from "./replyMessages";
import type { WhatsappIntentResult } from "./intent/types";

export type ConfirmedMealRegistrationOutcome =
  | { status: "registered"; result: WhatsappIntentResult }
  | { status: "details_needed"; prompt: string; detail: string }
  | { status: "safe_to_retry"; prompt: string; detail: string }
  | { status: "blocked_after_possible_mutation"; prompt: string; detail: string };

type ConfirmedMealRegistrationDependencies = {
  processMeal: typeof nutritionRuntime.processMealInput;
  getHabits: typeof dbRuntime.getHabitSnapshots;
  createDraft: typeof dbRuntime.createPendingMealInference;
  confirmMeal: typeof dbRuntime.confirmPendingMeal;
  consolidateMeal: typeof consolidationRuntime.consolidateWhatsAppMealAfterSave;
  getGoalProgress: typeof goalProgressRuntime.getWhatsAppMealGoalProgress;
};

const defaultDependencies: ConfirmedMealRegistrationDependencies = {
  processMeal: input => nutritionRuntime.processMealInput(input),
  getHabits: userId => dbRuntime.getHabitSnapshots(userId),
  createDraft: (userId, origin, processed, media) =>
    dbRuntime.createPendingMealInference(userId, origin, processed, media),
  confirmMeal: input => dbRuntime.confirmPendingMeal(input),
  consolidateMeal: (deps, meal, timeZone) =>
    consolidationRuntime.consolidateWhatsAppMealAfterSave(deps, meal, timeZone),
  getGoalProgress: (userId, occurredAt, timeZone) =>
    goalProgressRuntime.getWhatsAppMealGoalProgress(userId, occurredAt, timeZone),
};

function safeClarificationPrompt(error: unknown) {
  if (
    error instanceof nutritionRuntime.MealInferenceError &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  return "Não consegui interpretar todos os dados da refeição. Informe somente o detalhe que ficou faltando, como quantidade, peso, volume ou marca.";
}

export function createConfirmedMealRegistrationService(
  overrides: Partial<ConfirmedMealRegistrationDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };

  return async function execute(input: {
    userId: number;
    registrationText: string;
    originalText: string;
    occurredAt: Date;
    userTimezone: string;
  }): Promise<ConfirmedMealRegistrationOutcome> {
    let mutationMayHaveStarted = false;

    try {
      const processed = await deps.processMeal({
        text: input.registrationText,
        habits: await deps.getHabits(input.userId),
        occurredAt: input.occurredAt,
        timeZone: input.userTimezone,
      });

      const draft = deps.createDraft(input.userId, "whatsapp", processed, []);
      mutationMayHaveStarted = true;
      const savedMeal = await deps.confirmMeal({
        draftId: draft.draftId,
        userId: input.userId,
        mealLabel: processed.detectedMealLabel || "Refeição",
        occurredAt: input.occurredAt.toISOString(),
        notes: input.originalText,
        items: processed.items,
      });

      const consolidation = await deps.consolidateMeal(
        {
          listUserMeals: (...args) => dbRuntime.listUserMeals(...args),
          updateUserMeal: (...args) => dbRuntime.updateUserMeal(...args),
          removeUserMeal: (...args) => dbRuntime.removeUserMeal(...args),
        },
        savedMeal,
        input.userTimezone,
      );
      const replyMeal = consolidation.meal;
      const persistedReplyInput: MealProcessingResult = {
        ...processed,
        sourceText: input.originalText,
        detectedMealLabel: replyMeal.mealLabel,
        items: replyMeal.items ?? [],
        totals: calculateMealTotals(replyMeal.items ?? []),
      };

      let goalProgress:
        | Awaited<ReturnType<typeof goalProgressRuntime.getWhatsAppMealGoalProgress>>
        | undefined;
      try {
        goalProgress = await deps.getGoalProgress(
          input.userId,
          input.occurredAt,
          input.userTimezone,
        );
      } catch {
        goalProgress = undefined;
      }

      const reply =
        consolidation.action === "updated"
          ? buildWhatsAppConsolidatedMealReplyMessage(replyMeal, {
              registeredAt: input.occurredAt,
              goalProgress,
              timeZone: input.userTimezone,
            })
          : buildWhatsAppMealReplyMessage(persistedReplyInput, {
              registeredAt: input.occurredAt,
              goalProgress,
              timeZone: input.userTimezone,
            });

      return {
        status: "registered",
        result: {
          handled: true,
          action: "meal_item_added",
          reply,
          eventType: "whatsapp.meal_intent_decision.registered",
          detail:
            "Texto original processado pelo pipeline nutricional canônico em modo de consumo confirmado e estado recarregado antes da resposta.",
          data: {
            mealId: replyMeal.id,
            originalTextPreserved: true,
            originalTextResumed: true,
            ambiguityReclassified: false,
          },
        },
      };
    } catch (error) {
      if (mutationMayHaveStarted) {
        return {
          status: "blocked_after_possible_mutation",
          prompt:
            "Não consegui confirmar com segurança o estado final do registro. Para evitar duplicidade, não tente novamente agora. Consulte seus registros e, se a refeição não aparecer, envie a descrição completa em uma nova mensagem.",
          detail:
            "Falha após o início possível da mutação bloqueou retry cego da decisão consumo x sugestão.",
        };
      }

      if (error instanceof nutritionRuntime.MealInferenceError) {
        return {
          status: "details_needed",
          prompt: safeClarificationPrompt(error),
          detail:
            "O pipeline nutricional solicitou somente dados alimentares adicionais antes de qualquer mutação.",
        };
      }

      return {
        status: "safe_to_retry",
        prompt:
          "Não consegui processar a refeição agora, mas sua descrição continua guardada. Tente escolher Registrar novamente em alguns instantes.",
        detail:
          "Falha comprovadamente anterior à mutação permite restaurar a decisão persistente.",
      };
    }
  };
}

export const executeConfirmedWhatsAppMealRegistration =
  createConfirmedMealRegistrationService();
