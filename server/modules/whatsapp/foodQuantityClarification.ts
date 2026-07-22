import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRepository,
} from "../../repositories/whatsappPendingOperationRepository";
import {
  buildFoodClarificationActions,
  buildFoodClarificationPendingData,
  buildPendingFoodClarificationTarget,
  buildQuantityInstruction,
  PENDING_FOOD_CLARIFICATION_ORIGIN,
  PENDING_FOOD_CLARIFICATION_TTL_MS,
  PENDING_FOOD_CLARIFICATION_TYPE,
  type CountedFoodRequest,
  type FoodClarificationCandidate,
  type PendingFoodClarificationTarget,
} from "./foodClarificationContract";
import type { WhatsappIntentResult } from "./intent/types";
import {
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";

export type MealItemCorrectionContext = {
  mode: "replace_latest_item";
  mealId: number;
  itemIndex: number;
  originalFoodName: string;
  replacementFoodName: string;
};

export type FoodQuantityClarificationTarget = PendingFoodClarificationTarget & {
  resolutionContext?: MealItemCorrectionContext;
};

type ClarificationDependencies = {
  repository: WhatsAppPendingOperationRepository;
};

const defaultRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function result(
  input: Omit<WhatsappIntentResult, "handled">
): WhatsappIntentResult {
  return { handled: true, ...input };
}

function buildRequest(
  foodName: string,
  originalText: string
): CountedFoodRequest {
  const normalized = foodName.trim();
  return {
    originalText,
    originalCandidate: normalized,
    normalizedCandidate: normalized,
    normalizationChanged: false,
    count: 1,
  };
}

function buildCandidate(
  foodName: string,
  brandName?: string | null
): FoodClarificationCandidate {
  return {
    name: foodName.trim(),
    servingLabel: "quantidade informada pelo usuário",
    gramsPerServing: 0,
    brandName: brandName?.trim() || null,
    isBrandedProduct: Boolean(brandName?.trim()),
    matchKind: "exact",
  };
}

async function supersedeAllActive(
  repository: WhatsAppPendingOperationRepository,
  userId: number,
  occurredAt: Date
) {
  for (let index = 0; index < 20; index += 1) {
    const active = await repository.getActivePendingOperation(
      userId,
      occurredAt
    );
    if (!active) return true;
    const transition = await repository.supersedePendingOperation(active.id);
    if (!transition.superseded) return false;
  }
  return !(await repository.getActivePendingOperation(userId, occurredAt));
}

export function createFoodQuantityClarificationService(
  overrides: Partial<ClarificationDependencies> = {}
) {
  const deps: ClarificationDependencies = {
    repository: overrides.repository ?? defaultRepository,
  };

  const createQuantityClarification = async (input: {
    userId: number;
    foodName: string;
    brandName?: string | null;
    originalText: string;
    receivedAt?: Date;
    messageId?: string | null;
    resolutionContext?: MealItemCorrectionContext;
  }): Promise<WhatsappIntentResult> => {
    const occurredAt = input.receivedAt ?? new Date();
    const foodName = input.foodName.trim();
    if (!foodName) {
      return result({
        action: "food_clarification_blocked",
        reply: buildWhatsAppRecoverableErrorReplyMessage(
          "Não consegui identificar o alimento com segurança. Envie novamente o nome e a quantidade."
        ),
        eventType: "whatsapp.food_clarification.invalid_identity",
        detail:
          "Clarificação de quantidade bloqueada sem identidade alimentar.",
      });
    }

    if (
      !(await supersedeAllActive(deps.repository, input.userId, occurredAt))
    ) {
      return result({
        action: "food_clarification_blocked",
        reply: buildWhatsAppRecoverableErrorReplyMessage(
          "Não consegui substituir a operação pendente com segurança. Cancele a anterior e tente novamente."
        ),
        eventType: "whatsapp.food_clarification.pending_replacement_blocked",
        detail:
          "Clarificação de quantidade não substituiu a pendência anterior.",
      });
    }

    const candidate = buildCandidate(foodName, input.brandName);
    const baseTarget = buildPendingFoodClarificationTarget({
      request: buildRequest(foodName, input.originalText),
      pendingKind: "quantity",
      candidates: [candidate],
      selectedCandidateIndex: 0,
      instructionText: buildQuantityInstruction(foodName),
      messageId: input.messageId,
    });
    const target: FoodQuantityClarificationTarget = {
      ...baseTarget,
      actions: buildFoodClarificationActions("quantity", [candidate]),
      ...(input.resolutionContext
        ? { resolutionContext: input.resolutionContext }
        : {}),
    };

    const created = await deps.repository.createPendingOperation({
      userId: input.userId,
      type: PENDING_FOOD_CLARIFICATION_TYPE,
      origin: PENDING_FOOD_CLARIFICATION_ORIGIN,
      target,
      ttlMs: PENDING_FOOD_CLARIFICATION_TTL_MS,
      now: occurredAt,
    });

    if (!created) {
      return result({
        action: "food_clarification_blocked",
        reply: buildWhatsAppRecoverableErrorReplyMessage(
          "Não consegui guardar a pergunta de quantidade com segurança. Envie o alimento e a quantidade novamente."
        ),
        eventType: "whatsapp.food_clarification.persistence_unavailable",
        detail: "Clarificação de quantidade não foi persistida.",
      });
    }

    return result({
      action: "food_clarification_requested",
      reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
      eventType: "whatsapp.food_clarification.requested",
      detail: input.resolutionContext
        ? "Correção do último alimento aguardando quantidade em pendência persistente."
        : "Alimento identificado por imagem aguardando quantidade em pendência persistente.",
      data: buildFoodClarificationPendingData(created, target),
    });
  };

  return {
    requestImageFoodQuantity: (input: {
      userId: number;
      foodName: string;
      brandName?: string | null;
      receivedAt?: Date;
      messageId?: string | null;
    }) =>
      createQuantityClarification({
        ...input,
        originalText: `Imagem com ${input.foodName.trim()}`,
      }),
    requestLatestFoodCorrectionQuantity: (input: {
      userId: number;
      mealId: number;
      itemIndex: number;
      originalFoodName: string;
      replacementFoodName: string;
      receivedAt?: Date;
      messageId?: string | null;
    }) =>
      createQuantityClarification({
        userId: input.userId,
        foodName: input.replacementFoodName,
        originalText: `Corrigir último alimento para ${input.replacementFoodName.trim()}`,
        receivedAt: input.receivedAt,
        messageId: input.messageId,
        resolutionContext: {
          mode: "replace_latest_item",
          mealId: input.mealId,
          itemIndex: input.itemIndex,
          originalFoodName: input.originalFoodName,
          replacementFoodName: input.replacementFoodName,
        },
      }),
  };
}

const defaultService = createFoodQuantityClarificationService();
export const requestWhatsappImageFoodQuantityClarification =
  defaultService.requestImageFoodQuantity;
export const requestWhatsappLatestFoodCorrectionQuantity =
  defaultService.requestLatestFoodCorrectionQuantity;
