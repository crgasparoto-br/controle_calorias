import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import * as dbRuntime from "../../db";
import * as nutritionRuntime from "../../nutritionEngine";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import * as mealRuntime from "../meals/service";
import type { WhatsappIntentResult } from "./intent/types";
import {
  buildConfirmationInstruction,
  buildFoodClarificationActions,
  buildFoodClarificationPendingData,
  buildPendingFoodClarificationTarget,
  buildQuantityInstruction,
  buildSelectionInstruction,
  getFoodClarificationInteractionId,
  hasSafeCanonicalPortion,
  isCompleteWhatsappCommand,
  isExpectedWhatsappFoodClarificationAction,
  isPendingFoodClarificationTarget,
  parseCountedFoodRequest,
  parseFoodClarificationQuantityReply,
  parseFoodClarificationSelectionReply,
  PENDING_FOOD_CLARIFICATION_ORIGIN,
  PENDING_FOOD_CLARIFICATION_TTL_MS,
  PENDING_FOOD_CLARIFICATION_TYPE,
  resolveFoodClarificationCandidates,
  type FoodClarificationCandidate,
  type PendingFoodClarificationTarget,
} from "./foodClarificationContract";
import { planFoodClarification } from "./foodClarificationPlan";
import {
  persistResolvedFoodSafely,
  type FoodClarificationDependencies,
} from "./foodClarificationPersistence";
import {
  buildWhatsAppActionCancelledReplyMessage,
  buildWhatsAppCallbackUnavailableReplyMessage,
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";
import {
  isStandaloneWhatsappCancellationWord,
  isStandaloneWhatsappCommandWord,
  isStandaloneWhatsappConfirmationWord,
} from "./standaloneCommandWords";

export {
  hasSafeCanonicalPortion,
  isExpectedWhatsappFoodClarificationAction,
  isPendingFoodClarificationTarget,
  parseCountedFoodRequest,
  PENDING_FOOD_CLARIFICATION_ORIGIN,
  PENDING_FOOD_CLARIFICATION_TTL_MS,
  PENDING_FOOD_CLARIFICATION_TYPE,
  resolveFoodClarificationCandidates,
} from "./foodClarificationContract";
export type {
  CountedFoodRequest,
  FoodClarificationCandidate,
  FoodClarificationClassification,
  FoodClarificationKind,
  PendingFoodClarificationTarget,
} from "./foodClarificationContract";

export type WhatsappFoodClarificationResult = WhatsappIntentResult;

const defaultRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: dbRuntime.getDb,
  onWarning: dbRuntime.logPersistenceWarning,
});

const defaultDependencies: FoodClarificationDependencies = {
  repository: defaultRepository,
  processFood: input => nutritionRuntime.processMealInput(input),
  getHabits: userId => dbRuntime.getHabitSnapshots(userId),
  createMeal: (userId, input) => mealRuntime.createManualMeal(userId, input),
  listMeals: userId => mealRuntime.listMeals(userId),
  updateMeal: (userId, input) => mealRuntime.updateMeal(userId, input),
  removeMeal: (userId, mealId) => mealRuntime.removeMeal(userId, mealId),
};

function result(input: Omit<WhatsappFoodClarificationResult, "handled">): WhatsappFoodClarificationResult {
  return { handled: true, ...input };
}

function unavailable(detail: string): WhatsappFoodClarificationResult {
  return result({
    action: "food_clarification_unavailable",
    reply: buildWhatsAppCallbackUnavailableReplyMessage(),
    eventType: "whatsapp.food_clarification.unavailable",
    detail,
  });
}

function canonicalizeFoodClarificationTarget(
  target: PendingFoodClarificationTarget,
): PendingFoodClarificationTarget {
  return {
    ...target,
    interactionId: getFoodClarificationInteractionId(target.pendingKind),
  };
}

async function recreatePendingAfterSafeFailure(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  occurredAt: Date,
) {
  const canonicalTarget = canonicalizeFoodClarificationTarget(target);
  return deps.repository.createPendingOperation({
    userId,
    type: PENDING_FOOD_CLARIFICATION_TYPE,
    origin: PENDING_FOOD_CLARIFICATION_ORIGIN,
    target: canonicalTarget,
    ttlMs: PENDING_FOOD_CLARIFICATION_TTL_MS,
    now: occurredAt,
  });
}

async function persistWithRecovery(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  candidate: FoodClarificationCandidate,
  occurredAt: Date,
  timeZone: string,
  explicitQuantity?: { quantity: number; unit: string },
): Promise<WhatsappFoodClarificationResult> {
  const canonicalTarget = canonicalizeFoodClarificationTarget(target);
  const outcome = await persistResolvedFoodSafely(
    deps,
    userId,
    canonicalTarget,
    candidate,
    occurredAt,
    timeZone,
    explicitQuantity,
  );
  if (outcome.status !== "safe_to_retry") return outcome.result;

  const recreated = await recreatePendingAfterSafeFailure(deps, userId, canonicalTarget, occurredAt);
  if (!recreated) {
    return result({
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "A gravação não foi iniciada, mas não consegui restaurar a pergunta pendente. Envie a mensagem alimentar completa novamente.",
      ),
      eventType: "whatsapp.food_clarification.retry_restore_failed",
      detail: "Falha anterior à mutação não conseguiu recriar a pendência persistente.",
      data: {
        interactionId: canonicalTarget.interactionId,
        originalTextPreserved: true,
        retryRequiresFullMessage: true,
      },
    });
  }

  return result({
    action: "food_clarification_retryable_failure",
    reply: buildWhatsAppRecoverableErrorReplyMessage(
      `Não consegui concluir o registro agora. Mantive ${canonicalTarget.normalizedCandidate} pendente para nova tentativa.`,
    ),
    eventType: "whatsapp.food_clarification.retryable_failure",
    detail: "Falha comprovadamente anterior à mutação recriou a pendência sem descartar o texto original.",
    data: buildFoodClarificationPendingData(recreated, recreated.target as PendingFoodClarificationTarget),
  });
}

function reprompt(
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  eventType: string,
  detail: string,
) {
  return result({
    action: "food_clarification_reprompted",
    reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
    eventType,
    detail,
    data: buildFoodClarificationPendingData(pending, target),
  });
}

async function resolvePendingText(
  deps: FoodClarificationDependencies,
  userId: number,
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  text: string | null | undefined,
  occurredAt: Date,
  timeZone: string,
): Promise<WhatsappFoodClarificationResult | "new_command"> {
  if (isStandaloneWhatsappCancellationWord(text)) {
    const cancelled = await deps.repository.cancelPendingOperation(pending.id);
    if (!cancelled.cancelled) return unavailable("A pendência alimentar já não estava ativa.");
    return result({
      action: "food_clarification_cancelled",
      reply: buildWhatsAppActionCancelledReplyMessage("Não registrei o alimento pendente."),
      eventType: "whatsapp.food_clarification.cancelled",
      detail: "Pendência alimentar cancelada sem mutação.",
      data: {
        ...buildFoodClarificationPendingData(pending, target),
        pendingState: "cancelled",
      },
    });
  }

  if (target.pendingKind === "quantity") {
    const quantity = parseFoodClarificationQuantityReply(text);
    if (!quantity) {
      if (isCompleteWhatsappCommand(text)) return "new_command";
      return reprompt(
        pending,
        target,
        "whatsapp.food_clarification.invalid_quantity_response",
        "Resposta incompatível não consumiu a pendência aberta de quantidade.",
      );
    }

    const claimed = await deps.repository.claimPendingOperation({ id: pending.id, expectedVersion: pending.version });
    if (!claimed.claimed) return unavailable("Claim atômico da quantidade falhou.");
    const candidate = target.candidates[target.selectedCandidateIndex ?? 0] ?? {
      name: target.normalizedCandidate,
      servingLabel: `${quantity.quantity} ${quantity.unit}`,
      gramsPerServing: quantity.quantity,
      brandName: null,
      isBrandedProduct: false,
      matchKind: "exact" as const,
    };
    return persistWithRecovery(deps, userId, target, candidate, occurredAt, timeZone, quantity);
  }

  let selectedIndex = target.selectedCandidateIndex ?? 0;
  if (target.pendingKind === "confirmation") {
    if (!isStandaloneWhatsappConfirmationWord(text)) {
      if (isCompleteWhatsappCommand(text)) return "new_command";
      return reprompt(
        pending,
        target,
        "whatsapp.food_clarification.invalid_confirmation_response",
        "Resposta incompatível não consumiu a confirmação alimentar.",
      );
    }
  } else {
    const selection = parseFoodClarificationSelectionReply(text, target.candidates.length);
    if (selection === null || selection < 0) {
      if (isCompleteWhatsappCommand(text)) return "new_command";
      return reprompt(
        pending,
        target,
        "whatsapp.food_clarification.invalid_selection_response",
        "Opção inválida não consumiu a seleção alimentar.",
      );
    }
    selectedIndex = selection;
  }

  const candidate = target.candidates[selectedIndex];
  if (!candidate || !hasSafeCanonicalPortion(candidate)) {
    const quantityTarget: PendingFoodClarificationTarget = {
      ...target,
      interactionId: getFoodClarificationInteractionId("quantity"),
      pendingKind: "quantity",
      classification: "open",
      selectedCandidateIndex: candidate ? selectedIndex : null,
      actions: buildFoodClarificationActions("quantity", target.candidates),
      instructionText: buildQuantityInstruction(candidate?.name ?? target.normalizedCandidate),
    };
    const transitioned = await deps.repository.supersedePendingOperation(pending.id);
    if (!transitioned.superseded) {
      return unavailable("A seleção não pôde ser convertida em pergunta aberta de quantidade.");
    }
    const recreated = await recreatePendingAfterSafeFailure(deps, userId, quantityTarget, occurredAt);
    if (!recreated) {
      return result({
        action: "food_clarification_blocked",
        reply: buildWhatsAppRecoverableErrorReplyMessage(
          "Não consegui manter a solicitação de quantidade. Envie novamente a mensagem alimentar completa.",
        ),
        eventType: "whatsapp.food_clarification.quantity_restore_failed",
        detail: "Seleção sem porção segura não conseguiu criar a pendência aberta.",
      });
    }
    return result({
      action: "food_clarification_reprompted",
      reply: buildWhatsAppClarificationReplyMessage(quantityTarget.instructionText),
      eventType: "whatsapp.food_clarification.canonical_portion_missing",
      detail: "Candidato selecionado não possui porção canônica segura; o sistema pediu quantidade explícita.",
      data: buildFoodClarificationPendingData(recreated, quantityTarget),
    });
  }

  const claimed = await deps.repository.claimPendingOperation({ id: pending.id, expectedVersion: pending.version });
  if (!claimed.claimed) return unavailable("Claim atômico da confirmação/seleção falhou.");
  return persistWithRecovery(
    deps,
    userId,
    { ...target, selectedCandidateIndex: selectedIndex },
    candidate,
    occurredAt,
    timeZone,
  );
}

async function supersedeActive(
  deps: FoodClarificationDependencies,
  userId: number,
  occurredAt: Date,
) {
  const active = await deps.repository.getActivePendingOperation(userId, occurredAt);
  if (!active) return true;
  const transitioned = await deps.repository.supersedePendingOperation(active.id);
  return transitioned.superseded;
}

async function createPending(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  occurredAt: Date,
): Promise<WhatsappFoodClarificationResult> {
  if (!await supersedeActive(deps, userId, occurredAt)) {
    return result({
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui substituir a operação pendente com segurança. Cancele a anterior e envie o alimento novamente.",
      ),
      eventType: "whatsapp.food_clarification.pending_replacement_blocked",
      detail: "Uma operação anterior não pôde ser marcada como substituída.",
    });
  }

  const canonicalTarget = canonicalizeFoodClarificationTarget(target);
  const created = await deps.repository.createPendingOperation({
    userId,
    type: PENDING_FOOD_CLARIFICATION_TYPE,
    origin: PENDING_FOOD_CLARIFICATION_ORIGIN,
    target: canonicalTarget,
    ttlMs: PENDING_FOOD_CLARIFICATION_TTL_MS,
    now: occurredAt,
  });
  if (!created) {
    return result({
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui guardar o contexto do alimento com segurança. Envie a mensagem completa novamente.",
      ),
      eventType: "whatsapp.food_clarification.persistence_unavailable",
      detail: "Persistência indisponível; fallback nutricional bloqueado.",
    });
  }

  return result({
    action: "food_clarification_requested",
    reply: buildWhatsAppClarificationReplyMessage(canonicalTarget.instructionText),
    eventType: "whatsapp.food_clarification.requested",
    detail: "Pergunta específica criada em whatsappPendingOperations com contrato consumível pela #858.",
    data: buildFoodClarificationPendingData(created, canonicalTarget),
  });
}

export function createWhatsappFoodClarificationService(
  overrides: Partial<FoodClarificationDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };

  const handle = async (input: {
    userId: number;
    text?: string | null;
    receivedAt?: Date;
    userTimezone: string;
    messageId?: string | null;
  }): Promise<WhatsappFoodClarificationResult | null> => {
    const occurredAt = input.receivedAt ?? new Date();
    const text = input.text?.trim() ?? "";
    const active = await deps.repository.getActivePendingOperation(input.userId, occurredAt);

    if (active?.type === PENDING_FOOD_CLARIFICATION_TYPE && isPendingFoodClarificationTarget(active.target)) {
      const pendingResult = await resolvePendingText(
        deps,
        input.userId,
        active,
        active.target,
        text,
        occurredAt,
        input.userTimezone,
      );
      if (pendingResult !== "new_command") return pendingResult;

      const transitioned = await deps.repository.supersedePendingOperation(active.id);
      if (!transitioned.superseded) {
        return result({
          action: "food_clarification_blocked",
          reply: buildWhatsAppRecoverableErrorReplyMessage(
            "Não consegui substituir a operação pendente com segurança. Cancele a anterior e tente novamente.",
          ),
          eventType: "whatsapp.food_clarification.pending_replacement_blocked",
          detail: "Novo comando completo bloqueado porque a pendência alimentar não pôde ser substituída.",
        });
      }
    } else if (active && isStandaloneWhatsappCommandWord(text)) {
      return null;
    }

    if (isStandaloneWhatsappCommandWord(text)) {
      return result({
        action: "food_clarification_standalone_command_blocked",
        reply: buildWhatsAppClarificationReplyMessage(
          "Não encontrei uma operação compatível pendente. Envie a mensagem completa, por exemplo: registrar 100 g de arroz.",
        ),
        eventType: "whatsapp.food_clarification.standalone_command_blocked",
        detail: "Comando isolado bloqueado antes de parser, LLM e persistência nutricional.",
      });
    }

    const request = parseCountedFoodRequest(text);
    if (!request) return null;

    const candidates = resolveFoodClarificationCandidates(request.normalizedCandidate);
    const plan = planFoodClarification(request, candidates);

    if (plan.kind === "register") {
      const target = buildPendingFoodClarificationTarget({
        request,
        pendingKind: "confirmation",
        candidates: [plan.candidate],
        selectedCandidateIndex: 0,
        instructionText: buildConfirmationInstruction(plan.candidate.name),
        messageId: input.messageId,
      });
      const outcome = await persistResolvedFoodSafely(
        deps,
        input.userId,
        target,
        plan.candidate,
        occurredAt,
        input.userTimezone,
      );
      if (outcome.status !== "safe_to_retry") return outcome.result;
      return createPending(deps, input.userId, target, occurredAt);
    }

    if (plan.kind === "confirmation") {
      return createPending(deps, input.userId, buildPendingFoodClarificationTarget({
        request,
        pendingKind: "confirmation",
        candidates: [plan.candidate],
        selectedCandidateIndex: 0,
        instructionText: buildConfirmationInstruction(plan.candidate.name),
        messageId: input.messageId,
      }), occurredAt);
    }

    if (plan.kind === "selection") {
      return createPending(deps, input.userId, buildPendingFoodClarificationTarget({
        request,
        pendingKind: "selection",
        candidates: plan.candidates,
        instructionText: buildSelectionInstruction(plan.candidates),
        messageId: input.messageId,
      }), occurredAt);
    }

    return createPending(deps, input.userId, buildPendingFoodClarificationTarget({
      request,
      pendingKind: "quantity",
      candidates: plan.candidates,
      selectedCandidateIndex: plan.candidates.length === 1 ? 0 : null,
      instructionText: buildQuantityInstruction(request.normalizedCandidate),
      messageId: input.messageId,
    }), occurredAt);
  };

  const completeClaimedCallback = async (input: {
    userId: number;
    pendingOperation: WhatsAppPendingOperationRecord;
    action: string;
    receivedAt?: Date;
    userTimezone?: string | null;
  }): Promise<WhatsappFoodClarificationResult> => {
    const target = input.pendingOperation.target;
    if (!isPendingFoodClarificationTarget(target)
      || !isExpectedWhatsappFoodClarificationAction(target, input.action)) {
      return unavailable("Callback não corresponde ao contrato alimentar persistido.");
    }

    if (input.action === "cancel") {
      return result({
        action: "food_clarification_cancelled",
        reply: buildWhatsAppActionCancelledReplyMessage("Não registrei o alimento pendente."),
        eventType: "whatsapp.food_clarification.cancelled",
        detail: "Callback cancelou a operação já reivindicada sem mutação.",
      });
    }

    const index = input.action === "confirm"
      ? target.selectedCandidateIndex ?? 0
      : Number(input.action.match(/^select:(\d+)$/)?.[1] ?? Number.NaN);
    const candidate = target.candidates[index];
    if (!candidate || !hasSafeCanonicalPortion(candidate)) {
      const quantityTarget: PendingFoodClarificationTarget = {
        ...target,
        interactionId: getFoodClarificationInteractionId("quantity"),
        pendingKind: "quantity",
        classification: "open",
        selectedCandidateIndex: Number.isInteger(index) ? index : null,
        actions: buildFoodClarificationActions("quantity", target.candidates),
        instructionText: buildQuantityInstruction(candidate?.name ?? target.normalizedCandidate),
      };
      const recreated = await recreatePendingAfterSafeFailure(
        deps,
        input.userId,
        quantityTarget,
        input.receivedAt ?? new Date(),
      );
      if (!recreated) {
        return result({
          action: "food_clarification_blocked",
          reply: buildWhatsAppRecoverableErrorReplyMessage(
            "Não consegui manter a solicitação de quantidade. Envie novamente a mensagem alimentar completa.",
          ),
          eventType: "whatsapp.food_clarification.quantity_restore_failed",
          detail: "Callback sem porção segura não conseguiu recriar a pendência aberta.",
        });
      }
      return result({
        action: "food_clarification_reprompted",
        reply: buildWhatsAppClarificationReplyMessage(quantityTarget.instructionText),
        eventType: "whatsapp.food_clarification.canonical_portion_missing",
        detail: "Callback não inferiu unidade sem porção canônica segura.",
        data: buildFoodClarificationPendingData(recreated, quantityTarget),
      });
    }

    return persistWithRecovery(
      deps,
      input.userId,
      { ...target, selectedCandidateIndex: index },
      candidate,
      input.receivedAt ?? new Date(),
      input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
    );
  };

  return { handle, completeClaimedCallback };
}

const defaultService = createWhatsappFoodClarificationService();
export const handleWhatsappFoodClarification = defaultService.handle;
export const completeClaimedWhatsappFoodClarificationCallback = defaultService.completeClaimedCallback;
