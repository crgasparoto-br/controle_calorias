import type { WhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import type { WhatsAppLogicalReply } from "./replyContract";

export type ChoiceProcessingClaim = { id: number; version: number };
export type SelectionIntentResult = {
  handled: true;
  action: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};
type ProcessingRepository = Pick<
  WhatsAppPendingOperationRepository,
  | "completePendingOperationProcessing"
  | "releasePendingOperationProcessing"
  | "requirePendingOperationVerification"
>;

function choiceReviewRequiredResult(
  claim: ChoiceProcessingClaim,
  detail: string
) {
  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply:
      "Não consegui confirmar com segurança se a seleção foi aplicada. Confira a refeição antes de repetir o pedido; nenhuma repetição automática será feita.",
    eventType: "whatsapp.intent.meal_item_selection_review_required",
    detail,
    data: { pendingOperationId: claim.id, fallbackBlocked: true },
  };
}

export async function requireChoiceReview(
  repository: ProcessingRepository,
  claim: ChoiceProcessingClaim,
  now: Date | undefined,
  detail: string
) {
  const review = await repository.requirePendingOperationVerification({
    id: claim.id,
    expectedVersion: claim.version,
    now,
  });
  if (!review.required) {
    throw new Error(
      "Não foi possível persistir review_required para uma seleção de resultado incerto."
    );
  }
  return choiceReviewRequiredResult(claim, detail);
}

export async function settleChoiceProcessingClaim(
  repository: ProcessingRepository,
  claim: ChoiceProcessingClaim,
  result: SelectionIntentResult,
  now?: Date
): Promise<SelectionIntentResult> {
  const eventType =
    typeof result.eventType === "string" ? result.eventType : "";
  const data =
    result.data && typeof result.data === "object" ? result.data : {};
  const nextPendingId = Number(data.pendingOperationId);
  const hasSuccessor =
    Number.isSafeInteger(nextPendingId) &&
    nextPendingId > 0 &&
    nextPendingId !== claim.id;

  if (
    result.action === "meal_item_grams_adjusted" ||
    result.action === "meal_item_replaced" ||
    hasSuccessor
  ) {
    const completed = await repository.completePendingOperationProcessing({
      id: claim.id,
      expectedVersion: claim.version,
      now,
    });
    return completed.completed
      ? result
      : requireChoiceReview(
          repository,
          claim,
          now,
          "O efeito pode ter sido aplicado, mas a conclusão durável da pendência não foi confirmada."
        );
  }

  if (
    eventType === "whatsapp.intent.meal_item_selection_batch_failed" &&
    data.rollbackSucceeded === true
  ) {
    const released = await repository.releasePendingOperationProcessing({
      id: claim.id,
      expectedVersion: claim.version,
      now,
    });
    return released.released
      ? result
      : requireChoiceReview(
          repository,
          claim,
          now,
          "O rollback foi relatado, mas não consegui confirmar a liberação durável da pendência."
        );
  }

  if (
    (eventType === "whatsapp.intent.meal_item_selection_requested" &&
      !hasSuccessor) ||
    eventType === "whatsapp.intent.meal_item_selection_invalid" ||
    eventType === "whatsapp.intent.meal_item_selection_resource_not_found"
  ) {
    const released = await repository.releasePendingOperationProcessing({
      id: claim.id,
      expectedVersion: claim.version,
      now,
    });
    return released.released
      ? result
      : requireChoiceReview(
          repository,
          claim,
          now,
          "A resposta não alterou a refeição, mas a liberação durável da pendência não foi confirmada."
        );
  }

  return requireChoiceReview(
    repository,
    claim,
    now,
    "O resultado da seleção não permite confirmar com segurança se houve mutação."
  );
}
