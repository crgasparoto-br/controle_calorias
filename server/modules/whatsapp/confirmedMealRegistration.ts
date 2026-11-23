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
  buildWhatsAppRegisteredPersistedMealReplyMessage,
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
import { assertUnmigratedFoodD1EntrypointsOff,
  assertUnmigratedFoodD1WhatsAppTextEntrypointsOff } from "../foodIntelligenceV2/publicUnmigratedEntrypoints";
import { createFoodD1PublicWhatsAppRegistration,
  type PublicD1WhatsAppDependencies } from "../foodIntelligenceV2/publicWhatsAppRegistration";
import { createFoodD1PublicWhatsAppVisualRegistration,
  fromTrustedD1WhatsAppMediaDataUrl,
  isAnyD1WhatsAppVisualEntrypointSelected,
  type PublicD1WhatsAppVisualDependencies } from "../foodIntelligenceV2/publicWhatsAppVisualRegistration";
import { createFoodD1WhatsAppContinuation,
  type FoodD1WhatsAppContinuationDependencies } from "../foodIntelligenceV2/publicWhatsAppContinuation";
import { extractD1VisualSurfaces } from "../foodIntelligenceV2/publicVisualSurfaces";
import { comprehendFoodLanguage } from "../foodIntelligenceV2/linguisticComprehension";
import { stageFoodD1WhatsAppPending, readActiveFoodD1WhatsAppPending,
  updateFoodD1WhatsAppPending, consumeFoodD1WhatsAppPending } from "../foodIntelligenceV2/publicWhatsAppPendingRepository";
import { foodD1WhatsAppReplayFence } from "../foodIntelligenceV2/publicWhatsAppReplayFence";
import { hasActiveWhatsappPendingInDb } from "../foodIntelligenceV2/publicSimulator";
import { governedLinguisticLexiconStore } from "../foodIntelligenceV2/linguisticLexiconRepository";
import { createFoodV2KnowledgeRepository } from "../foodIntelligenceV2/repository";
import { runFoodD1Migration } from "../foodIntelligenceV2/entrypointRunner";
import {
  parseD1WhatsAppExistingItemCommand,
  parseD1WhatsAppVisualIntent,
  parseMealCommandFromWhatsApp,
} from "./mealCommandParser";
import { createWhatsAppD1NutritionLabelService } from "./d1NutritionLabelRegistration";
import { getCurrentWhatsappInboundContentType,
  getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
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
  /** Only a validated, previously persisted V1 pending owner may set this. */
  legacyV1Pending?: boolean;
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
  tryRunD1Registration: typeof tryRunPublicFoodD1WhatsAppRegistration;
  requestPartialRegistrationClarification: (
    input: RequestPartialConfirmedTextMealQuantityInput,
  ) => Promise<WhatsappIntentResult>;
};

type Meal = Awaited<ReturnType<typeof dbRuntime.listUserMeals>>[number];
type WhatsAppD1RegistrationDependencies = Partial<Omit<PublicD1WhatsAppDependencies,
  "readCanonicalOperation" | "renderCommittedMeal">> & {
  parseOperation?: typeof parseMealCommandFromWhatsApp;
  readMeal?: (userId: number, mealId: number) => Promise<Meal | null>;
};

export function createWhatsAppD1RegistrationService(
  deps: WhatsAppD1RegistrationDependencies = {},
) {
  return createFoodD1PublicWhatsAppRegistration({
    readAuthorizedContext: deps.readAuthorizedContext ?? (async () => null),
    readActivePending: deps.readActivePending ?? hasActiveWhatsappPendingInDb,
    lexicon: deps.lexicon ?? governedLinguisticLexiconStore,
    knowledge: deps.knowledge ?? createFoodV2KnowledgeRepository(),
    run: deps.run ?? runFoodD1Migration,
    stagePending: deps.stagePending ?? (deps.run ? undefined : stageFoodD1WhatsAppPending),
    comprehend: deps.comprehend,
    readCanonicalOperation: async (rawText, context) => {
      const operation = (deps.parseOperation ?? parseMealCommandFromWhatsApp)(
        rawText, context,
      );
      if (operation.intent !== "add_items_to_meal" || !operation.mealType?.trim() ||
          !(operation.date instanceof Date) || !Number.isFinite(operation.date.getTime()) ||
          !operation.items.length || operation.missingFields.length ||
          operation.items.some(item => !item.foodName?.trim() ||
            item.quantity === null || !Number.isFinite(item.quantity) ||
            item.quantity <= 0 || !item.unit?.trim())) {
        throw new Error("food-d1-whatsapp-public-meal-operation-unresolved");
      }
      return { mealType: operation.mealType, date: operation.date,
        itemCount: operation.items.length };
    },
    renderCommittedMeal: async ({ userId, mealId, registeredAt, timeZone, skipped, recordedItemIds }) => {
      const meal = await (deps.readMeal ??
        (async (ownerUserId, id) => (await dbRuntime.listUserMeals(ownerUserId)).find(entry =>
          entry.id === id && entry.userId === ownerUserId) ?? null))(userId, mealId);
      if (!meal || meal.userId !== userId || meal.id !== mealId ||
          !meal.items || meal.items.length < recordedItemIds.length) {
        throw new Error("food-d1-whatsapp-public-committed-meal-unavailable");
      }
      const rendered = buildWhatsAppRegisteredPersistedMealReplyMessage(meal, {
        registeredAt, timeZone,
      });
      const warning = skipped.length
        ? buildWhatsAppPartialRegistrationWarning(skipped.map((_item, index) => ({
            segment: "Item " + (index + 1),
            reason: "Identidade, medida ou fonte nutricional ainda não confirmada.",
          })))
        : null;
      return warning ? rendered + "\n\n" + warning : rendered;
    },
  });
}
export const tryRunPublicFoodD1WhatsAppRegistration =
  createWhatsAppD1RegistrationService();

/** Uses the exact same readback and logical reply as text/transcription. */
export function createWhatsAppD1VisualRegistrationService(
  overrides: Partial<PublicD1WhatsAppVisualDependencies> = {},
) {
  return createFoodD1PublicWhatsAppVisualRegistration({
    readAuthorizedContext: overrides.readAuthorizedContext ?? (async () => null),
    readActivePending: overrides.readActivePending ?? hasActiveWhatsappPendingInDb,
    extract: overrides.extract ?? extractD1VisualSurfaces,
    comprehend: overrides.comprehend ?? comprehendFoodLanguage,
    lexicon: overrides.lexicon ?? governedLinguisticLexiconStore,
    knowledge: overrides.knowledge ?? createFoodV2KnowledgeRepository(),
    run: overrides.run ?? runFoodD1Migration,
    stagePending: overrides.stagePending ?? (overrides.run ? undefined : stageFoodD1WhatsAppPending),
    renderCommittedMeal: overrides.renderCommittedMeal ?? (async ({
      userId, mealId, registeredAt, timeZone, recordedItemIds,
    }) => {
      const meal = (await dbRuntime.listUserMeals(userId)).find(entry =>
        entry.id === mealId && entry.userId === userId);
      if (!meal || !meal.items || meal.items.length < recordedItemIds.length) {
        throw new Error("food-d1-whatsapp-visual-committed-meal-unavailable");
      }
      return buildWhatsAppRegisteredPersistedMealReplyMessage(meal, {
        registeredAt, timeZone,
      });
    }),
  });
}
const visualRegistration = createWhatsAppD1VisualRegistrationService();
/** Transport owner supplies only its Media API download and user-submitted intent. */
export async function tryRunPublicFoodD1WhatsAppVisualRegistration(input: {
  userId: number; externalMessageId: string | null;
  imageAnalysisUrl: string; caption: string | null | undefined;
  transcript?: string | null; receivedAt: Date; timeZone: string;
}) {
  if (!isAnyD1WhatsAppVisualEntrypointSelected()) return null;
  const intent = parseD1WhatsAppVisualIntent(input.caption);
  return visualRegistration({
    ...input, intent, image: fromTrustedD1WhatsAppMediaDataUrl(input.imageAnalysisUrl),
  });
}

/** Continuation ownership is loaded from the durable V2 pending record,
 * never guessed from the reply text or an in-process conversation. */
export function createWhatsAppD1ContinuationService(
  overrides: Partial<FoodD1WhatsAppContinuationDependencies> = {},
) {
  return createFoodD1WhatsAppContinuation({
    readPending: overrides.readPending ?? readActiveFoodD1WhatsAppPending,
    updatePending: overrides.updatePending ?? updateFoodD1WhatsAppPending,
    consumePending: overrides.consumePending ?? consumeFoodD1WhatsAppPending,
    readAuthorizedContext: overrides.readAuthorizedContext ?? (async () => null),
    comprehend: overrides.comprehend ?? comprehendFoodLanguage,
    lexicon: overrides.lexicon ?? governedLinguisticLexiconStore,
    knowledge: overrides.knowledge ?? createFoodV2KnowledgeRepository(),
    run: overrides.run ?? runFoodD1Migration,
    pinInbound: overrides.pinInbound ?? (overrides.run
      ? undefined : input => foodD1WhatsAppReplayFence.pinContinuationInbound(input)),
    renderCommittedMeal: overrides.renderCommittedMeal ?? (async ({
      userId, mealId, registeredAt, timeZone, recordedItemIds,
    }) => {
      const meal = (await dbRuntime.listUserMeals(userId)).find(entry =>
        entry.id === mealId && entry.userId === userId);
      if (!meal || !meal.items || meal.items.length < recordedItemIds.length) {
        throw new Error("food-d1-whatsapp-continuation-committed-meal-unavailable");
      }
      return buildWhatsAppRegisteredPersistedMealReplyMessage(meal, {
        registeredAt, timeZone,
      });
    }),
  });
}
export const tryRunPublicFoodD1WhatsAppContinuation =
  createWhatsAppD1ContinuationService();

/** The external inbound key must never change V2->V1 after an effect. */
export async function assertWhatsAppInboundNotPreviouslyD1Owned(
  userId: number, externalMessageId: string | null | undefined,
) {
  return foodD1WhatsAppReplayFence.rejectPreviouslyV2OwnedInbound({
    ownerUserId: userId, externalMessageId,
  });
}

// Parse the explicit existing-item target at the trusted WhatsApp boundary;
// the D1 adapter receives only an authenticated, typed physical target.
const nutritionLabelRegistration = createWhatsAppD1NutritionLabelService();
export { createWhatsAppD1NutritionLabelService };
export async function tryRunPublicFoodD1WhatsAppNutritionLabel(input: {
  userId: number; externalMessageId: string | null;
  imageAnalysisUrl: string; caption: string | null | undefined;
  timeZone: string;
}) {
  const target = parseD1WhatsAppExistingItemCommand(input.caption);
  if (!target) return null;
  return nutritionLabelRegistration({
    ...input, target,
  });
}

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
  tryRunD1Registration: input => tryRunPublicFoodD1WhatsAppRegistration(input),
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
    // Retain V1 ownership for an already materialized clarification/decision.
    // For new registrations, only messageLifecycle may tag text versus audio:
    // neither a transcript nor a user DTO is allowed to claim provenance.
    const currentInboundId = getCurrentWhatsappInboundExternalMessageId();
    // A persisted V1 clarification targets its original, older inbound ID.
    const priorV1 = Boolean(input.inboundMessageId && currentInboundId &&
      input.inboundMessageId !== currentInboundId);
    if (!input.legacyV1Pending && !priorV1 &&
        !input.skipCountablePreflight && !input.resolvedSegments?.length) {
      const contentType = getCurrentWhatsappInboundContentType();
      const modality = contentType === "text" ? "text" as const :
        contentType === "audio" ? "audio_transcript" as const : null;
      if (modality) {
        const migrated = await deps.tryRunD1Registration({
          userId: input.userId, originalText: input.registrationText,
          externalMessageId: currentInboundId,
          modality, receivedAt: input.receivedAt ?? input.occurredAt,
          timeZone: input.userTimezone,
        });
        if (migrated) return { status: "registered", result: migrated };
        assertUnmigratedFoodD1EntrypointsOff([modality]);
      } else {
        // Unknown, image or mixed-media sources cannot silently choose text.
        assertUnmigratedFoodD1WhatsAppTextEntrypointsOff();
      }
    }
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
