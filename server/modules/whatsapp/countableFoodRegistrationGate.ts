import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { calculateMealTotals } from "../../../shared/mealTotals";
import {
  prepareCountableFoodRegistrationResolved,
  type CountableFoodResolvedMeasure,
} from "../../countableFoodQuantity";
import {
  buildItemFromCatalog,
  clampConfidence,
  isResearchVerifiedCatalogFood,
} from "../../mealItemBuilders";
import { resolveMealLabel } from "../../mealLabelResolver";
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

function materializeResolvedCommercialSegment(input: {
  resolved: CountableFoodResolvedMeasure;
  occurredAt?: Date;
  userTimezone: string;
}): MealProcessingResult {
  const food = input.resolved.commercialFood;
  const request = input.resolved.request;
  const grams = input.resolved.resolution.grams;
  const measure = input.resolved.resolution;
  if (
    !food ||
    !request.brand ||
    !Number.isFinite(grams) ||
    grams <= 0 ||
    !Number.isFinite(food.gramsPerServing) ||
    food.gramsPerServing <= 0
  ) {
    throw new Error("Resolved commercial countable measure is incomplete.");
  }

  const confidence = clampConfidence(food.sourceConfidence ?? 0.95);
  const processingInput = {
    text: request.segment,
    occurredAt: input.occurredAt,
    timeZone: input.userTimezone,
  };
  const researched = isResearchVerifiedCatalogFood(food);
  const item: MealProcessingResult["items"][number] = {
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
      confidence,
      foodClassification: null,
    }),
    resolution: {
      productVariant: food.productVariant ?? null,
      nutritionOrigin: researched ? "web_research" : "catalog",
      nutritionVerified: true,
      sourceUrls: [...(food.sourceUrls ?? [])],
      sourceEvidence: food.sourceEvidence ?? null,
      sourceVerifiedAt: food.sourceVerifiedAt ?? null,
      sourceConfidence: food.sourceConfidence ?? confidence,
      ambiguity: null,
      measureResolution: {
        kind: measure.kind,
        grams,
        requestedQuantity: "requestedQuantity" in measure
          ? measure.requestedQuantity
          : request.count,
        requestedUnit: "requestedUnit" in measure
          ? measure.requestedUnit
          : request.requestedUnit,
        sourceUrls: "sourceUrls" in measure ? [...measure.sourceUrls] : [],
        sourceEvidence: "evidence" in measure ? measure.evidence : null,
        referenceCount: "referenceCount" in measure ? measure.referenceCount : 1,
        verified: true,
      },
    },
  };
  const semanticContract = buildMealSemanticContract({
    processingInput,
    sourceText: request.segment,
    items: [item],
  });

  return {
    detectedMealLabel: resolveMealLabel(processingInput, request.segment),
    sourceText: request.segment,
    confidence,
    needsConfirmation: false,
    reasoning:
      "Identidade comercial, porção e nutrição reutilizadas da resolução canônica já comprovada.",
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

  // Uma medida contável comercial já comprovada é uma decisão monotônica:
  // materialize o item a partir do próprio CatalogFood validado e não o envie
  // novamente ao processMealInput como se fosse uma nova alegação do usuário.
  for (const resolved of prepared.resolutions) {
    if (
      !resolved.commercialFood ||
      !resolved.request.brand ||
      resolvedSegments.some(item => item.segmentIndex === resolved.segmentIndex)
    )
      continue;

    resolvedSegments.push({
      segmentIndex: resolved.segmentIndex,
      processed: materializeResolvedCommercialSegment({
        resolved,
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
