import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { calculateMealTotals } from "../../../shared/mealTotals";
import {
  prepareCountableFoodRegistrationResolved,
  type CountableFoodResolvedMeasure,
} from "../../countableFoodQuantity";
import { buildItemFromCatalog } from "../../mealItemBuilders";
import { buildMealSemanticContract } from "../../mealSemanticContract";
import { requestWhatsappConfirmedTextMealQuantityClarification } from "./foodQuantityClarification";
import type { WhatsappIntentResult } from "./intent/types";
import {
  MealInferenceError,
  processMealInput,
  type MealProcessingResult,
} from "../../nutritionEngine";
import { createWhatsappMealIntentRegistrationDetailsInteraction } from "./mealIntentRegistrationDetailsInteraction";
import { buildPortionText, parseFoodText } from "../../mealTextParsing";

export type ResolvedRegistrationSegment = {
  segmentIndex: number;
  processed: MealProcessingResult;
};
export type CountableRegistrationContinuation = {
  registrationSegments: string[];
  itemIndex: number;
  resolvedSegments: ResolvedRegistrationSegment[];
  occurredAt: string;
  userTimezone: string;
  clarification: NonNullable<MealInferenceError["context"]>;
};

export type CountableFoodRegistrationGateResult =
  | {
      kind: "ready";
      registrationText: string;
      resolutions: CountableFoodResolvedMeasure[];
      resolvedSegments?: ResolvedRegistrationSegment[];
    }
  | { kind: "clarification"; result: WhatsappIntentResult };

function applyResolvedCommercialMeasure(input: {
  resolved: CountableFoodResolvedMeasure;
  processed: MealProcessingResult;
  occurredAt?: Date;
  userTimezone: string;
}): MealProcessingResult {
  const food = input.resolved.commercialFood;
  const referenceItem = input.processed.items[0];
  const grams = input.resolved.resolution.grams;
  if (
    !food ||
    !input.resolved.request.brand ||
    input.processed.items.length !== 1 ||
    !referenceItem ||
    !Number.isFinite(grams) ||
    grams <= 0 ||
    !Number.isFinite(food.gramsPerServing) ||
    food.gramsPerServing <= 0
  ) {
    return input.processed;
  }

  const request = input.resolved.request;
  const processingInput = {
    text: request.segment,
    occurredAt: input.occurredAt,
    timeZone: input.userTimezone,
  };
  const item = {
    ...buildItemFromCatalog(food, {
      foodName: request.foodName,
      brand: request.brand,
      quantity: request.count,
      unit: request.requestedUnit,
      portionText: buildPortionText(request.count, request.requestedUnit),
      servings: Math.max(grams / food.gramsPerServing, 0.25),
      estimatedGrams: grams,
      estimatedCalories: 0,
      estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
      confidence: referenceItem.confidence,
      foodClassification: referenceItem.classification,
    }),
    resolution: referenceItem.resolution,
  };
  const semanticContract = buildMealSemanticContract({
    processingInput,
    sourceText: request.segment,
    items: [item],
  });

  return {
    ...input.processed,
    sourceText: request.segment,
    items: [item],
    totals: calculateMealTotals([item]),
    semanticContract,
  };
}

export async function prepareWhatsappCountableFoodRegistration(input: {
  userId: number;
  text?: string | null;
  originalText?: string | null;
  inboundMessageId?: string | null;
  receivedAt?: Date;
  userTimezone?: string;
  resolvedSegments?: ResolvedRegistrationSegment[];
}): Promise<CountableFoodRegistrationGateResult> {
  const text = input.text?.trim() ?? "";
  const userTimezone = input.userTimezone ?? DEFAULT_APP_TIME_ZONE;
  const prepared = await prepareCountableFoodRegistrationResolved(
    input.userId,
    text,
    input.resolvedSegments?.map(item => item.segmentIndex)
  );
  const resolvedSegments = [...(input.resolvedSegments ?? [])];

  // A gramatura de uma medida contável comercial é uma normalização interna,
  // não uma nova alegação mass-only do usuário. Preserve o resultado semântico
  // já validado para que o registro final não reinterprete "25 g" isoladamente.
  for (const resolved of prepared.resolutions) {
    if (
      !resolved.commercialFood ||
      !resolved.request.brand ||
      resolvedSegments.some(item => item.segmentIndex === resolved.segmentIndex)
    )
      continue;

    const processed = await processMealInput({
      text: resolved.request.segment,
      occurredAt: input.receivedAt,
      timeZone: userTimezone,
    });
    resolvedSegments.push({
      segmentIndex: resolved.segmentIndex,
      processed: applyResolvedCommercialMeasure({
        resolved,
        processed,
        occurredAt: input.receivedAt,
        userTimezone,
      }),
    });
  }

  if (
    input.resolvedSegments ||
    prepared.pendingItems.some(item => item.identityClarification)
  ) {
    for (const [
      segmentIndex,
      segment,
    ] of prepared.registrationSegments.entries()) {
      if (
        prepared.pendingItems.some(
          item => item.segmentIndex === segmentIndex
        ) ||
        resolvedSegments.some(item => item.segmentIndex === segmentIndex)
      )
        continue;
      try {
        resolvedSegments.push({
          segmentIndex,
          processed: await processMealInput({
            text: segment,
            occurredAt: input.receivedAt,
            timeZone: userTimezone,
          }),
        });
      } catch (error) {
        if (
          !(error instanceof MealInferenceError) ||
          !error.context?.clarificationReason
        )
          throw error;
        const parsed = parseFoodText(segment);
        prepared.pendingItems.push({
          segmentIndex,
          segment,
          foodName: parsed.foodName,
          brand: error.context.brand ?? null,
          count: parsed.quantity ?? 1,
          requestedUnit: parsed.unit ?? "un",
          identityClarification: {
            message: error.message,
            context: error.context,
          },
        });
      }
    }
  }
  const firstIdentity = prepared.pendingItems.find(
    item => item.identityClarification
  );
  if (firstIdentity?.identityClarification) {
    const clarification = firstIdentity.identityClarification;
    const result = await createWhatsappMealIntentRegistrationDetailsInteraction(
      {
        userId: input.userId,
        originalText: input.originalText?.trim() || text,
        registrationText: prepared.registrationText,
        inboundMessageId: input.inboundMessageId,
        prompt: clarification.message,
        receivedAt: input.receivedAt,
        countableContext: {
          registrationSegments: prepared.registrationSegments,
          itemIndex: firstIdentity.segmentIndex,
          resolvedSegments,
          occurredAt: (input.receivedAt ?? new Date()).toISOString(),
          userTimezone,
          clarification: clarification.context,
        },
      }
    );
    return {
      kind: "clarification",
      result: result ?? {
        handled: true,
        action: "clarification_needed",
        reply:
          "Não consegui guardar a pergunta com segurança. Nada foi registrado. Envie novamente a descrição da refeição.",
        eventType: "whatsapp.food_clarification.persistence_unavailable",
        detail: "Pendência de identidade não persistida; registro bloqueado.",
      },
    };
  }
  const firstPending = prepared.pendingItems[0];
  if (!firstPending) {
    return {
      kind: "ready",
      registrationText: prepared.registrationText || text,
      resolutions: prepared.resolutions,
      ...(resolvedSegments.length ? { resolvedSegments } : {}),
    };
  }

  const occurredAt = input.receivedAt ?? new Date();
  const clarification =
    await requestWhatsappConfirmedTextMealQuantityClarification({
      userId: input.userId,
      foodName: firstPending.foodName,
      originalText: input.originalText?.trim() || text,
      registrationSegments: prepared.registrationSegments,
      pendingItems: prepared.pendingItems.map(item => ({
        segmentIndex: item.segmentIndex,
        segment: item.segment,
        foodName: item.foodName,
        brand: item.brand,
        count: item.count,
        requestedUnit: item.requestedUnit,
      })),
      currentPendingIndex: 0,
      occurredAt,
      userTimezone,
      messageId: input.inboundMessageId,
      resolvedSegments: resolvedSegments.length ? resolvedSegments : undefined,
      instructionText: `Não encontrei uma gramatura verificável nem uma média usual segura para ${firstPending.segment}. Informe somente o peso ou volume correspondente, por exemplo 20 g.`,
    });
  return { kind: "clarification", result: clarification };
}