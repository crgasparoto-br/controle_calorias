import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import {
  prepareCountableFoodRegistrationResolved,
  type CountableFoodResolvedMeasure,
} from "../../countableFoodQuantity";
import { requestWhatsappConfirmedTextMealQuantityClarification } from "./foodQuantityClarification";
import type { WhatsappIntentResult } from "./intent/types";
import {
  MealInferenceError,
  processMealInput,
  type MealProcessingResult,
} from "../../nutritionEngine";
import { createWhatsappMealIntentRegistrationDetailsInteraction } from "./mealIntentRegistrationDetailsInteraction";
import { parseFoodText } from "../../mealTextParsing";

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
  const prepared = await prepareCountableFoodRegistrationResolved(
    input.userId,
    text,
    input.resolvedSegments?.map(item => item.segmentIndex)
  );
  const resolvedSegments = [...(input.resolvedSegments ?? [])];
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
            timeZone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
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
          userTimezone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
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
      ...(input.resolvedSegments ? { resolvedSegments } : {}),
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
      userTimezone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
      messageId: input.inboundMessageId,
      resolvedSegments: input.resolvedSegments ? resolvedSegments : undefined,
      instructionText: `Não encontrei uma gramatura verificável nem uma média usual segura para ${firstPending.segment}. Informe somente o peso ou volume correspondente, por exemplo 20 g.`,
    });
  return { kind: "clarification", result: clarification };
}
