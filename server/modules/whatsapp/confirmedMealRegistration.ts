import { calculateMealTotals } from "../../../shared/mealTotals";
import * as dbRuntime from "../../db";
import * as nutritionRuntime from "../../nutritionEngine";
import type { MealProcessingResult } from "../../nutritionEngine";
import * as consolidationRuntime from "./mealConsolidationService";
import * as goalProgressRuntime from "./goalProgressService";
import {
  buildWhatsAppConsolidatedMealReplyMessage,
  buildWhatsAppMealReplyMessage,
  buildWhatsAppPartialRegistrationWarning,
} from "./replyMessages";
import { buildMealSemanticContract } from "../../mealSemanticContract";
import type { WhatsappIntentResult } from "./intent/types";
import type { CountableFoodPendingItem } from "../../countableFoodQuantity";
import {
  prepareWhatsappCountableFoodRegistration,
  type ResolvedRegistrationSegment,
} from "./countableFoodRegistrationGate";
import { splitFoodTextSegments } from "../../mealTextParsing";
import { ensureCurrentIrreversibleEffectAllowed } from "../../_core/effectFenceContext";
import type { RequestPartialConfirmedTextMealQuantityInput } from "./foodQuantityClarificationTypes";

export type ConfirmedMealRegistrationOutcome =
  | { status: "registered"; result: WhatsappIntentResult }
  | { status: "clarification_requested"; result: WhatsappIntentResult }
  | { status: "details_needed"; prompt: string; detail: string; context?: nutritionRuntime.MealInferenceErrorContext }
  | { status: "safe_to_retry"; prompt: string; detail: string }
  | { status: "blocked_after_possible_mutation"; prompt: string; detail: string };

export type ConfirmedWhatsAppMealRegistrationInput = {
  userId: number;
  registrationText: string;
  originalText: string;
  occurredAt: Date;
  receivedAt?: Date;
  userTimezone: string;
  inboundMessageId?: string | null;
  skipCountablePreflight?: boolean;
  resolvedSegments?: ResolvedRegistrationSegment[];
};

type ConfirmedMealRegistrationDependencies = {
  processMeal: typeof nutritionRuntime.processMealInput;
  getHabits: typeof dbRuntime.getHabitSnapshots;
  createDraft: typeof dbRuntime.createPendingMealInference;
  confirmMeal: typeof dbRuntime.confirmPendingMeal;
  consolidateMeal: typeof consolidationRuntime.consolidateWhatsAppMealAfterSave;
  getGoalProgress: typeof goalProgressRuntime.getWhatsAppMealGoalProgress;
  prepareCountableFoodRegistration: typeof prepareWhatsappCountableFoodRegistration;
  requestPartialRegistrationClarification: (
    input: RequestPartialConfirmedTextMealQuantityInput,
  ) => Promise<WhatsappIntentResult>;
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
  prepareCountableFoodRegistration: input => prepareWhatsappCountableFoodRegistration(input),
  requestPartialRegistrationClarification: async input => {
    const {
      requestWhatsappPartialConfirmedTextMealQuantityClarification,
    } = await import("./foodQuantityClarification");
    return requestWhatsappPartialConfirmedTextMealQuantityClarification(input);
  },
};

const PARTIAL_CONTINUATION_FALLBACK =
  "Não consegui guardar uma pergunta de continuação. O registro seguro foi salvo; os itens listados permanecem fora da refeição. Para incluí-los, envie depois uma nova mensagem com a quantidade exata de cada item.";

export async function requestPartialRegistrationContinuation(
  input: {
    userId: number;
    originalText: string;
    skippedItems: CountableFoodPendingItem[];
    receivedAt: Date;
    userTimezone: string;
    inboundMessageId?: string | null;
    meal: { id: number; mealLabel: string; occurredAt: Date | string | number };
  },
  requestClarification =
    defaultDependencies.requestPartialRegistrationClarification,
) {
  const pendingItems = input.skippedItems.map(item => ({
    segmentIndex: item.segmentIndex,
    segment: item.segment,
    foodName: item.foodName,
    brand: item.brand,
    count: item.count,
    requestedUnit: item.requestedUnit,
  }));

  try {
    const mealOccurredAt =
      input.meal.occurredAt instanceof Date
        ? input.meal.occurredAt
        : new Date(input.meal.occurredAt);
    const result = await requestClarification({
      userId: input.userId,
      originalText: input.originalText,
      pendingItems,
      currentPendingIndex: 0,
      resolvedQuantities: pendingItems.map(() => null),
      occurredAt: mealOccurredAt,
      receivedAt: input.receivedAt,
      userTimezone: input.userTimezone,
      messageId: input.inboundMessageId ?? null,
      expectedMealId: input.meal.id,
      expectedMealLabel: input.meal.mealLabel,
      expectedMealOccurredAt: mealOccurredAt.toISOString(),
    });
    if (
      result.eventType === "whatsapp.food_clarification.requested" &&
      Number.isSafeInteger(result.data?.pendingOperationId)
    ) {
      return { persisted: true as const, result, reply: result.reply };
    }
  } catch {
    // O segmento seguro já foi salvo; a resposta abaixo não promete retomada.
  }

  return {
    persisted: false as const,
    result: null,
    reply: PARTIAL_CONTINUATION_FALLBACK,
  };
}

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

  return async function execute(
    input: ConfirmedWhatsAppMealRegistrationInput,
  ): Promise<ConfirmedMealRegistrationOutcome> {
    let mutationMayHaveStarted = false;

    try {
      let registrationText = input.registrationText;
      let resolvedSegments = input.resolvedSegments;
      let skippedItems: CountableFoodPendingItem[] | undefined;
      if (!input.skipCountablePreflight) {
        const prepared = await deps.prepareCountableFoodRegistration({
          userId: input.userId,
          text: input.registrationText,
          originalText: input.originalText,
          inboundMessageId: input.inboundMessageId,
          receivedAt: input.receivedAt ?? input.occurredAt,
          userTimezone: input.userTimezone,
          resolvedSegments: input.resolvedSegments,
        });
        if (prepared.kind === "clarification") {
          return { status: "clarification_requested", result: prepared.result };
        }
        registrationText = prepared.registrationText;
        resolvedSegments = prepared.resolvedSegments ?? resolvedSegments;
        skippedItems = prepared.skippedItems;
      }

      const processingInput = {
        text: registrationText,
        habits: await deps.getHabits(input.userId),
        occurredAt: input.occurredAt,
        timeZone: input.userTimezone,
      };
      let processed: MealProcessingResult;
      if (resolvedSegments?.length) {
        const parts: MealProcessingResult[] = [];
        for (const [segmentIndex, text] of splitFoodTextSegments(
          registrationText
        ).entries()) {
          const saved = resolvedSegments.find(
            item => item.segmentIndex === segmentIndex
          );
          parts.push(
            saved?.processed ??
              (await deps.processMeal({ ...processingInput, text }))
          );
        }
        const items = parts.flatMap(part => part.items);
        const semanticContract = buildMealSemanticContract({
          processingInput: {
            ...processingInput,
            text: input.originalText,
          },
          sourceText: input.originalText,
          items,
        });
        processed = {
          ...parts[0],
          sourceText: input.originalText,
          items,
          totals: calculateMealTotals(items),
          semanticContract,
        };
      } else {
        processed = await deps.processMeal(processingInput);
      }

      await ensureCurrentIrreversibleEffectAllowed();
      const draft = deps.createDraft(input.userId, "whatsapp", processed, []);
      mutationMayHaveStarted = true;
      await ensureCurrentIrreversibleEffectAllowed();
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
          updateUserMeal: async (...args) => {
            await ensureCurrentIrreversibleEffectAllowed();
            return dbRuntime.updateUserMeal(...args);
          },
          removeUserMeal: async (...args) => {
            await ensureCurrentIrreversibleEffectAllowed();
            return dbRuntime.removeUserMeal(...args);
          },
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
      const partialWarning = skippedItems?.length
        ? buildWhatsAppPartialRegistrationWarning(
            skippedItems.map(item => ({
              segment: item.segment,
              reason:
                item.identityClarification?.message ??
                "Não encontrei uma gramatura ou porção segura. Informe o peso ou volume correspondente.",
            })),
          )
        : null;
      const partialContinuation = skippedItems?.length
        ? await requestPartialRegistrationContinuation(
            {
              userId: input.userId,
              originalText: input.originalText,
              skippedItems,
              receivedAt: input.receivedAt ?? input.occurredAt,
              userTimezone: input.userTimezone,
              inboundMessageId: input.inboundMessageId,
              meal: replyMeal,
            },
            deps.requestPartialRegistrationClarification,
          )
        : null;
      const continuationPending = partialContinuation?.persisted ?? false;
      const partialContinuationNotice = skippedItems?.length
        ? partialContinuation?.reply ?? PARTIAL_CONTINUATION_FALLBACK
        : null;

      return {
        status: "registered",
        result: {
          handled: true,
          action: "meal_item_added",
          reply: [reply, partialWarning, partialContinuationNotice]
            .filter((part): part is string => Boolean(part))
            .join("\n\n"),
          eventType: "whatsapp.meal_intent_decision.registered",
          detail:
            "Texto original processado pelo pipeline nutricional canônico em modo de consumo confirmado e estado recarregado antes da resposta.",
          data: {
            mealId: replyMeal.id,
            originalTextPreserved: true,
            originalTextResumed: true,
            ambiguityReclassified: false,
            ...(skippedItems?.length
              ? {
                  partialRegistration: true,
                  omittedItemCount: skippedItems.length,
                  continuationPending,
                  ...(continuationPending && partialContinuation?.result?.data
                    ? { continuation: partialContinuation.result.data }
                    : {}),
                }
              : {}),
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
          context: error.context,
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
