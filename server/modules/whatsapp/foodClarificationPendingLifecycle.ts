import type {
  WhatsAppPendingOperationRecord,
  WhatsAppPendingOperationRepository,
} from "../../repositories/whatsappPendingOperationRepository";
import type {
  FoodClarificationCandidate,
  PendingFoodClarificationTarget,
} from "./foodClarificationContract";
import type { WhatsappIntentResult } from "./intent/types";
import { buildWhatsAppRecoverableErrorReplyMessage } from "./replyMessages";

export type FoodClarificationLifecycleDependencies = {
  repository: WhatsAppPendingOperationRepository;
  persistSafely: PersistClarificationSafely;
  restorePending: (
    userId: number,
    target: PendingFoodClarificationTarget,
    now: Date
  ) => ReturnType<WhatsAppPendingOperationRepository["createPendingOperation"]>;
  buildPendingData: (
    pending: WhatsAppPendingOperationRecord,
    target: PendingFoodClarificationTarget
  ) => Record<string, unknown>;
};

type ClarificationPersistenceOutcome =
  | { status: "success"; result: WhatsappIntentResult }
  | { status: "safe_to_retry" }
  | { status: "verification_required"; result: WhatsappIntentResult };

export type PersistClarificationSafely = (
  userId: number,
  target: PendingFoodClarificationTarget,
  candidate: FoodClarificationCandidate,
  occurredAt: Date,
  timeZone: string,
  explicitQuantity?: { quantity: number; unit: string },
  explicitIdentity?: string
) => Promise<ClarificationPersistenceOutcome>;

export type FoodClarificationProcessingClaim = {
  id: number;
  version: number;
};

function usesProcessingLease(target: PendingFoodClarificationTarget) {
  const resolutionContext = (
    target as PendingFoodClarificationTarget & {
      resolutionContext?: unknown;
    }
  ).resolutionContext;
  return Boolean(resolutionContext);
}

export async function claimFoodClarificationReply(
  repository: WhatsAppPendingOperationRepository,
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  now: Date
): Promise<{
  claimed: boolean;
  processingClaim?: FoodClarificationProcessingClaim;
}> {
  if (!usesProcessingLease(target)) {
    return repository.claimPendingOperation({
      id: pending.id,
      expectedVersion: pending.version,
      now,
    });
  }

  const claim = await repository.beginPendingOperationProcessing({
    id: pending.id,
    expectedVersion: pending.version,
    now,
  });
  return claim.claimed && claim.version !== undefined
    ? {
        claimed: true,
        processingClaim: { id: pending.id, version: claim.version },
      }
    : { claimed: false };
}

export async function recreatePendingAfterSafeFailure(
  deps: FoodClarificationLifecycleDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  now: Date
) {
  return deps.restorePending(userId, target, now);
}

function retryableResult(
  deps: FoodClarificationLifecycleDependencies,
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  version: number
): WhatsappIntentResult {
  const released = {
    ...pending,
    state: "active" as const,
    version,
  };
  return {
    handled: true,
    action: "food_clarification_retryable_failure",
    reply: buildWhatsAppRecoverableErrorReplyMessage(
      `Não consegui concluir o registro agora. Mantive ${target.normalizedCandidate} pendente para nova tentativa.`
    ),
    eventType: "whatsapp.food_clarification.retryable_failure",
    detail:
      "Falha comprovadamente anterior à mutação liberou a lease e preservou a mesma pendência persistente.",
    data: deps.buildPendingData(released, target),
  };
}

async function requireReview(
  deps: FoodClarificationLifecycleDependencies,
  claim: FoodClarificationProcessingClaim,
  now: Date
) {
  return deps.repository.requirePendingOperationVerification({
    id: claim.id,
    expectedVersion: claim.version,
    now,
  });
}

function withReviewState(
  result: WhatsappIntentResult,
  claim: FoodClarificationProcessingClaim,
  reviewRequired: boolean
): WhatsappIntentResult {
  return {
    ...result,
    data: {
      ...(result.data ?? {}),
      pendingOperationId: claim.id,
      pendingState: reviewRequired ? "review_required" : "processing",
      verificationRequired: true,
      retryBlockedToPreventDuplicate: true,
    },
  };
}

function settlementFailure(claim: FoodClarificationProcessingClaim) {
  return {
    handled: true as const,
    action: "food_clarification_unavailable" as const,
    reply: buildWhatsAppRecoverableErrorReplyMessage(
      "A operação pode ter sido aplicada. Confira a refeição antes de tentar novamente para evitar duplicidade."
    ),
    eventType: "whatsapp.food_clarification.processing_settlement_required",
    detail:
      "A conclusão da lease não foi confirmada após o efeito; repetição automática foi bloqueada para revisão.",
    data: {
      pendingOperationId: claim.id,
      pendingState: "review_required",
      verificationRequired: true,
      retryBlockedToPreventDuplicate: true,
    },
  };
}

async function settleProcessingOutcome(
  deps: FoodClarificationLifecycleDependencies,
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  claim: FoodClarificationProcessingClaim,
  now: Date,
  outcome: ClarificationPersistenceOutcome
): Promise<WhatsappIntentResult> {
  const outcomeWithResult = outcome as Extract<
    ClarificationPersistenceOutcome,
    { result: WhatsappIntentResult }
  >;
  const settlements = {
    safe_to_retry: async () => {
      const released = await deps.repository.releasePendingOperationProcessing({
        id: claim.id,
        expectedVersion: claim.version,
        now,
      });
      if (released.released)
        return retryableResult(deps, pending, target, claim.version + 1);
      const review = await requireReview(deps, claim, now);
      return withReviewState(
        {
          handled: true,
          action: "food_clarification_unavailable",
          reply: buildWhatsAppRecoverableErrorReplyMessage(
            "Não consegui confirmar se a operação começou. Confira a refeição antes de tentar novamente."
          ),
          eventType: "whatsapp.food_clarification.processing_release_required",
          detail:
            "A falha parecia anterior à mutação, mas a liberação da lease não foi confirmada.",
        },
        claim,
        review.required
      );
    },
    verification_required: async () => {
      const review = await requireReview(deps, claim, now);
      return withReviewState(outcomeWithResult.result, claim, review.required);
    },
    success: async () => {
      const completed =
        await deps.repository.completePendingOperationProcessing({
          id: claim.id,
          expectedVersion: claim.version,
          now,
        });
      if (completed.completed) return outcomeWithResult.result;

      const review = await requireReview(deps, claim, now);
      return review.required
        ? withReviewState(settlementFailure(claim), claim, true)
        : settlementFailure(claim);
    },
  } satisfies Record<
    ClarificationPersistenceOutcome["status"],
    () => Promise<WhatsappIntentResult>
  >;
  return settlements[outcome.status]();
}

export async function persistFoodClarificationReply(
  deps: FoodClarificationLifecycleDependencies,
  input: {
    userId: number;
    pending: WhatsAppPendingOperationRecord;
    target: PendingFoodClarificationTarget;
    candidate: FoodClarificationCandidate;
    occurredAt: Date;
    timeZone: string;
    explicitQuantity?: { quantity: number; unit: string };
    explicitIdentity?: string;
    processingClaim?: FoodClarificationProcessingClaim;
  }
): Promise<WhatsappIntentResult> {
  const outcome = await deps.persistSafely(
    input.userId,
    input.target,
    input.candidate,
    input.occurredAt,
    input.timeZone,
    input.explicitQuantity,
    input.explicitIdentity
  );

  if (input.processingClaim) {
    return settleProcessingOutcome(
      deps,
      input.pending,
      input.target,
      input.processingClaim,
      input.occurredAt,
      outcome
    );
  }

  if ("result" in outcome) return outcome.result;
  const recreated = await recreatePendingAfterSafeFailure(
    deps,
    input.userId,
    input.target,
    input.occurredAt
  );
  if (!recreated) {
    return {
      handled: true,
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "A gravação não foi iniciada, mas não consegui restaurar a pergunta pendente. Envie a mensagem alimentar completa novamente."
      ),
      eventType: "whatsapp.food_clarification.retry_restore_failed",
      detail:
        "Falha anterior à mutação não conseguiu recriar a pendência persistente.",
      data: {
        interactionId: input.target.interactionId,
        originalTextPreserved: true,
        retryRequiresFullMessage: true,
      },
    };
  }

  return {
    handled: true,
    action: "food_clarification_retryable_failure",
    reply: buildWhatsAppRecoverableErrorReplyMessage(
      `Não consegui concluir o registro agora. Mantive ${input.target.normalizedCandidate} pendente para nova tentativa.`
    ),
    eventType: "whatsapp.food_clarification.retryable_failure",
    detail:
      "Falha comprovadamente anterior à mutação recriou a pendência sem descartar o texto original.",
    data: deps.buildPendingData(recreated, input.target),
  };
}
