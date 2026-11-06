import { calculateMealTotals } from "../../../shared/mealTotals";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import * as dbRuntime from "../../db";
import * as nutritionRuntime from "../../nutritionEngine";
import { estimateGramsFromQuantity } from "../../mealTextParsing";
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
  persistClarificationResultSafely,
  type FoodClarificationDependencies,
} from "./foodClarificationPersistence";
import {
  claimFoodClarificationReply,
  persistFoodClarificationReply,
  recreatePendingAfterSafeFailure,
  type FoodClarificationLifecycleDependencies,
  type PersistClarificationSafely,
} from "./foodClarificationPendingLifecycle";
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
  listMeals: (userId, options) => mealRuntime.listMeals(userId, options),
  updateMeal: (userId, input) => mealRuntime.updateMeal(userId, input),
  removeMeal: (userId, mealId) => mealRuntime.removeMeal(userId, mealId),
  createWhatsappMeal: async (userId, input) => {
    const processed = {
      detectedMealLabel: input.detectedMealLabel,
      sourceText: input.sourceText,
      transcript: input.transcript,
      reasoning: input.reasoning,
      confidence: input.confidence,
      needsConfirmation: false,
      items: input.items,
      totals: calculateMealTotals(input.items),
    };
    const draft = dbRuntime.createPendingMealInference(
      userId,
      "whatsapp",
      processed,
      input.media
    );
    const saved = await dbRuntime.confirmPendingMeal({
      draftId: draft.draftId,
      userId,
      mealLabel: input.detectedMealLabel || "Refeição",
      occurredAt: input.occurredAt,
      notes: input.sourceText || undefined,
      items: input.items,
    });
    const reloaded = (await mealRuntime.listMeals(userId)).find(
      meal => meal.id === saved.id
    );
    if (!reloaded) {
      throw new Error("A refeição criada não pôde ser recarregada.");
    }
    return reloaded;
  },
};

function result(
  input: Omit<WhatsappFoodClarificationResult, "handled">
): WhatsappFoodClarificationResult {
  return { handled: true, ...input };
}

function unavailable(
  detail: string,
  options?: { reply?: string; data?: Record<string, unknown> }
): WhatsappFoodClarificationResult {
  return result({
    action: "food_clarification_unavailable",
    reply: options?.reply ?? buildWhatsAppCallbackUnavailableReplyMessage(),
    eventType: "whatsapp.food_clarification.unavailable",
    detail,
    ...(options?.data ? { data: options.data } : {}),
  });
}

function canonicalizeFoodClarificationTarget(
  target: PendingFoodClarificationTarget
): PendingFoodClarificationTarget {
  return {
    ...target,
    interactionId: getFoodClarificationInteractionId(target.pendingKind),
  };
}

function reprompt(
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  eventType: string,
  detail: string
) {
  return result({
    action: "food_clarification_reprompted",
    reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
    eventType,
    detail,
    data: buildFoodClarificationPendingData(pending, target),
  });
}

function isSugarComplementQuantityTarget(
  target: PendingFoodClarificationTarget
) {
  const resolutionContext = (
    target as PendingFoodClarificationTarget & {
      resolutionContext?: { mode?: string; componentName?: string };
    }
  ).resolutionContext;
  return (
    resolutionContext?.mode === "complete_caloric_complement" &&
    resolutionContext.componentName === "açúcar"
  );
}

function isSupportedSugarQuantityUnit(unit: string) {
  const normalized = unit
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:g|gr|grama|gramas|kg|quilo|quilos|mg|miligrama|miligramas|colher de cha|colheres de cha|colher de sopa|colheres de sopa|sache|saches|pacote|pacotes)$/.test(
    normalized
  );
}

async function handlePendingClarificationReply(
  deps: FoodClarificationDependencies,
  lifecycleDeps: FoodClarificationLifecycleDependencies,
  userId: number,
  pending: WhatsAppPendingOperationRecord,
  target: PendingFoodClarificationTarget,
  text: string | null | undefined,
  occurredAt: Date,
  timeZone: string
): Promise<WhatsappFoodClarificationResult | "new_command"> {
  if (pending.state === "processing" || pending.state === "review_required") {
    const needsReview = pending.state === "review_required";
    return unavailable(
      needsReview
        ? "Pending operation em review_required; retry bloqueado para evitar duplicidade."
        : "Pending operation ainda possui uma processing lease ativa.",
      {
        reply: buildWhatsAppClarificationReplyMessage(
          needsReview
            ? "O resultado pode já ter sido aplicado. Confira a refeição antes de tentar novamente; não vou repetir a alteração automaticamente."
            : "Esta quantidade ainda está sendo processada. Aguarde a confirmação antes de reenviar."
        ),
        data: {
          ...buildFoodClarificationPendingData(pending, target),
          pendingState: pending.state,
          retryBlockedToPreventDuplicate: true,
        },
      }
    );
  }
  if (pending.state !== "active")
    return unavailable("A pendência alimentar não está em estado ativo.");

  if (isStandaloneWhatsappCancellationWord(text)) {
    const cancelled = await deps.repository.cancelPendingOperation(
      pending.id,
      occurredAt
    );
    if (!cancelled.cancelled)
      return unavailable("A pendência alimentar já não estava ativa.");
    return result({
      action: "food_clarification_cancelled",
      reply: buildWhatsAppActionCancelledReplyMessage(
        "Não registrei o alimento pendente."
      ),
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
        "Resposta incompatível não consumiu a pendência aberta de quantidade."
      );
    }
    const resolutionMode = (target as { resolutionContext?: { mode?: string } })
      .resolutionContext?.mode;
    if (
      (resolutionMode === "complete_mixed_increment_plan" ||
        resolutionMode === "complete_confirmed_text_meal" ||
        resolutionMode === "complete_partial_confirmed_text_meal") &&
      !estimateGramsFromQuantity(quantity.quantity, quantity.unit)
    ) {
      return reprompt(
        pending,
        target,
        "whatsapp.food_clarification.invalid_mass_volume_response",
        "Resposta sem massa/volume explícitos não consumiu a pendência aberta."
      );
    }

    if (
      isSugarComplementQuantityTarget(target) &&
      !isSupportedSugarQuantityUnit(quantity.unit)
    ) {
      return reprompt(
        pending,
        target,
        "whatsapp.food_clarification.invalid_component_unit",
        "Unidade incompatível com açúcar não consumiu a pendência aberta."
      );
    }

    const claim = await claimFoodClarificationReply(
      deps.repository,
      pending,
      target,
      occurredAt
    );
    if (!claim.claimed)
      return unavailable("Claim atômico da quantidade falhou.");
    const candidate = target.candidates[target.selectedCandidateIndex ?? 0] ?? {
      name: target.normalizedCandidate,
      servingLabel: `${quantity.quantity} ${quantity.unit}`,
      gramsPerServing: quantity.quantity,
      brandName: null,
      isBrandedProduct: false,
      matchKind: "exact" as const,
    };
    return persistFoodClarificationReply(lifecycleDeps, {
      userId,
      pending,
      target: canonicalizeFoodClarificationTarget(target),
      candidate,
      occurredAt,
      timeZone,
      explicitQuantity: quantity,
      processingClaim: claim.processingClaim,
    });
  }

  if (target.pendingKind === "identity") {
    const identity = text?.trim() ?? "";
    if (!identity || isCompleteWhatsappCommand(identity)) {
      if (isCompleteWhatsappCommand(identity)) return "new_command";
      return reprompt(
        pending,
        target,
        "whatsapp.food_clarification.invalid_identity_response",
        "Resposta vazia não consumiu a identidade comercial pendente."
      );
    }
    const claim = await claimFoodClarificationReply(
      deps.repository,
      pending,
      target,
      occurredAt
    );
    if (!claim.claimed)
      return unavailable("Claim atômico da identidade falhou.");
    const candidate = target.candidates[target.selectedCandidateIndex ?? 0] ?? {
      name: target.normalizedCandidate,
      servingLabel: "identidade informada pelo usuário",
      gramsPerServing: 0,
      brandName: null,
      isBrandedProduct: false,
      matchKind: "exact" as const,
    };
    return persistFoodClarificationReply(lifecycleDeps, {
      userId,
      pending,
      target: canonicalizeFoodClarificationTarget(target),
      candidate,
      occurredAt,
      timeZone,
      explicitIdentity: identity,
      processingClaim: claim.processingClaim,
    });
  }

  let selectedIndex = target.selectedCandidateIndex ?? 0;
  if (target.pendingKind === "confirmation") {
    if (!isStandaloneWhatsappConfirmationWord(text)) {
      if (isCompleteWhatsappCommand(text)) return "new_command";
      return reprompt(
        pending,
        target,
        "whatsapp.food_clarification.invalid_confirmation_response",
        "Resposta incompatível não consumiu a confirmação alimentar."
      );
    }
  } else {
    const selection = parseFoodClarificationSelectionReply(
      text,
      target.candidates.length
    );
    if (selection === null || selection < 0) {
      if (isCompleteWhatsappCommand(text)) return "new_command";
      return reprompt(
        pending,
        target,
        "whatsapp.food_clarification.invalid_selection_response",
        "Opção inválida não consumiu a seleção alimentar."
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
      instructionText: buildQuantityInstruction(
        candidate?.name ?? target.normalizedCandidate
      ),
    };
    const transitioned = await deps.repository.supersedePendingOperation(
      pending.id,
      occurredAt
    );
    if (!transitioned.superseded) {
      return unavailable(
        "A seleção não pôde ser convertida em pergunta aberta de quantidade."
      );
    }
    const recreated = await recreatePendingAfterSafeFailure(
      lifecycleDeps,
      userId,
      quantityTarget,
      occurredAt
    );
    if (!recreated) {
      return result({
        action: "food_clarification_blocked",
        reply: buildWhatsAppRecoverableErrorReplyMessage(
          "Não consegui manter a solicitação de quantidade. Envie novamente a mensagem alimentar completa."
        ),
        eventType: "whatsapp.food_clarification.quantity_restore_failed",
        detail:
          "Seleção sem porção segura não conseguiu criar a pendência aberta.",
      });
    }
    return result({
      action: "food_clarification_reprompted",
      reply: buildWhatsAppClarificationReplyMessage(
        quantityTarget.instructionText
      ),
      eventType: "whatsapp.food_clarification.canonical_portion_missing",
      detail:
        "Candidato selecionado não possui porção canônica segura; o sistema pediu quantidade explícita.",
      data: buildFoodClarificationPendingData(recreated, quantityTarget),
    });
  }

  const claim = await claimFoodClarificationReply(
    deps.repository,
    pending,
    target,
    occurredAt
  );
  if (!claim.claimed)
    return unavailable("Claim atômico da confirmação/seleção falhou.");
  return persistFoodClarificationReply(lifecycleDeps, {
    userId,
    pending,
    target: canonicalizeFoodClarificationTarget({
      ...target,
      selectedCandidateIndex: selectedIndex,
    }),
    candidate,
    occurredAt,
    timeZone,
    processingClaim: claim.processingClaim,
  });
}

async function supersedeActive(
  deps: FoodClarificationDependencies,
  userId: number,
  occurredAt: Date
) {
  const active = await deps.repository.getActivePendingOperation(
    userId,
    occurredAt
  );
  if (!active) return true;
  const transitioned = await deps.repository.supersedePendingOperation(
    active.id,
    occurredAt
  );
  return transitioned.superseded;
}

async function createPending(
  deps: FoodClarificationDependencies,
  userId: number,
  target: PendingFoodClarificationTarget,
  occurredAt: Date
): Promise<WhatsappFoodClarificationResult> {
  if (!(await supersedeActive(deps, userId, occurredAt))) {
    return result({
      action: "food_clarification_blocked",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui substituir a operação pendente com segurança. Cancele a anterior e envie o alimento novamente."
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
        "Não consegui guardar o contexto do alimento com segurança. Envie a mensagem completa novamente."
      ),
      eventType: "whatsapp.food_clarification.persistence_unavailable",
      detail: "Persistência indisponível; fallback nutricional bloqueado.",
    });
  }

  return result({
    action: "food_clarification_requested",
    reply: buildWhatsAppClarificationReplyMessage(
      canonicalTarget.instructionText
    ),
    eventType: "whatsapp.food_clarification.requested",
    detail:
      "Pergunta específica criada em whatsappPendingOperations com contrato consumível pela #858.",
    data: buildFoodClarificationPendingData(created, canonicalTarget),
  });
}

export function createWhatsappFoodClarificationService(
  overrides: Partial<FoodClarificationDependencies> = {}
) {
  const deps = { ...defaultDependencies, ...overrides };
  const persistSafely: PersistClarificationSafely = (...args) =>
    persistClarificationResultSafely(deps, ...args);
  const lifecycleDeps: FoodClarificationLifecycleDependencies = {
    repository: deps.repository,
    persistSafely,
    restorePending: (userId, target, now) =>
      deps.repository.createPendingOperation({
        userId,
        type: PENDING_FOOD_CLARIFICATION_TYPE,
        origin: PENDING_FOOD_CLARIFICATION_ORIGIN,
        target,
        ttlMs: PENDING_FOOD_CLARIFICATION_TTL_MS,
        now,
      }),
    buildPendingData: buildFoodClarificationPendingData,
  };

  const handle = async (input: {
    userId: number;
    text?: string | null;
    receivedAt?: Date;
    userTimezone: string;
    messageId?: string | null;
  }): Promise<WhatsappFoodClarificationResult | null> => {
    const occurredAt = input.receivedAt ?? new Date();
    const text = input.text?.trim() ?? "";
    const active = await deps.repository.getActivePendingOperation(
      input.userId,
      occurredAt
    );

    if (
      active?.type === PENDING_FOOD_CLARIFICATION_TYPE &&
      isPendingFoodClarificationTarget(active.target)
    ) {
      const pendingResult = await handlePendingClarificationReply(
        deps,
        lifecycleDeps,
        input.userId,
        active,
        active.target,
        text,
        occurredAt,
        input.userTimezone
      );
      if (pendingResult !== "new_command") return pendingResult;

      const transitioned = await deps.repository.supersedePendingOperation(
        active.id,
        occurredAt
      );
      if (!transitioned.superseded) {
        return result({
          action: "food_clarification_blocked",
          reply: buildWhatsAppRecoverableErrorReplyMessage(
            "Não consegui substituir a operação pendente com segurança. Cancele a anterior e tente novamente."
          ),
          eventType: "whatsapp.food_clarification.pending_replacement_blocked",
          detail:
            "Novo comando completo bloqueado porque a pendência alimentar não pôde ser substituída.",
        });
      }
    } else if (active && isStandaloneWhatsappCommandWord(text)) {
      return null;
    }

    if (isStandaloneWhatsappCommandWord(text)) {
      return result({
        action: "food_clarification_standalone_command_blocked",
        reply: buildWhatsAppClarificationReplyMessage(
          "Não encontrei uma operação compatível pendente. Envie a mensagem completa, por exemplo: registrar 100 g de arroz."
        ),
        eventType: "whatsapp.food_clarification.standalone_command_blocked",
        detail:
          "Comando isolado bloqueado antes de parser, LLM e persistência nutricional.",
      });
    }

    const request = parseCountedFoodRequest(text);
    if (!request) return null;

    const candidates = resolveFoodClarificationCandidates(
      request.normalizedCandidate
    );
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
      const outcome = await persistClarificationResultSafely(
        deps,
        input.userId,
        target,
        plan.candidate,
        occurredAt,
        input.userTimezone
      );
      if (outcome.status !== "safe_to_retry") return outcome.result;
      return createPending(deps, input.userId, target, occurredAt);
    }

    if (plan.kind === "confirmation") {
      return createPending(
        deps,
        input.userId,
        buildPendingFoodClarificationTarget({
          request,
          pendingKind: "confirmation",
          candidates: [plan.candidate],
          selectedCandidateIndex: 0,
          instructionText: buildConfirmationInstruction(plan.candidate.name),
          messageId: input.messageId,
        }),
        occurredAt
      );
    }

    if (plan.kind === "selection") {
      return createPending(
        deps,
        input.userId,
        buildPendingFoodClarificationTarget({
          request,
          pendingKind: "selection",
          candidates: plan.candidates,
          instructionText: buildSelectionInstruction(plan.candidates),
          messageId: input.messageId,
        }),
        occurredAt
      );
    }

    return createPending(
      deps,
      input.userId,
      buildPendingFoodClarificationTarget({
        request,
        pendingKind: "quantity",
        candidates: plan.candidates,
        selectedCandidateIndex: plan.candidates.length === 1 ? 0 : null,
        instructionText: buildQuantityInstruction(request.normalizedCandidate),
        messageId: input.messageId,
      }),
      occurredAt
    );
  };

  const completeClaimedCallback = async (input: {
    userId: number;
    pendingOperation: WhatsAppPendingOperationRecord;
    action: string;
    receivedAt?: Date;
    userTimezone?: string | null;
  }): Promise<WhatsappFoodClarificationResult> => {
    const target = input.pendingOperation.target;
    if (
      !isPendingFoodClarificationTarget(target) ||
      !isExpectedWhatsappFoodClarificationAction(target, input.action)
    ) {
      return unavailable(
        "Callback não corresponde ao contrato alimentar persistido."
      );
    }

    if (input.action === "cancel") {
      return result({
        action: "food_clarification_cancelled",
        reply: buildWhatsAppActionCancelledReplyMessage(
          "Não registrei o alimento pendente."
        ),
        eventType: "whatsapp.food_clarification.cancelled",
        detail: "Callback cancelou a operação já reivindicada sem mutação.",
      });
    }

    const index =
      input.action === "confirm"
        ? (target.selectedCandidateIndex ?? 0)
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
        instructionText: buildQuantityInstruction(
          candidate?.name ?? target.normalizedCandidate
        ),
      };
      const recreated = await recreatePendingAfterSafeFailure(
        lifecycleDeps,
        input.userId,
        quantityTarget,
        input.receivedAt ?? new Date()
      );
      if (!recreated) {
        return result({
          action: "food_clarification_blocked",
          reply: buildWhatsAppRecoverableErrorReplyMessage(
            "Não consegui manter a solicitação de quantidade. Envie novamente a mensagem alimentar completa."
          ),
          eventType: "whatsapp.food_clarification.quantity_restore_failed",
          detail:
            "Callback sem porção segura não conseguiu recriar a pendência aberta.",
        });
      }
      return result({
        action: "food_clarification_reprompted",
        reply: buildWhatsAppClarificationReplyMessage(
          quantityTarget.instructionText
        ),
        eventType: "whatsapp.food_clarification.canonical_portion_missing",
        detail: "Callback não inferiu unidade sem porção canônica segura.",
        data: buildFoodClarificationPendingData(recreated, quantityTarget),
      });
    }

    return persistFoodClarificationReply(lifecycleDeps, {
      userId: input.userId,
      pending: input.pendingOperation,
      target: canonicalizeFoodClarificationTarget({
        ...target,
        selectedCandidateIndex: index,
      }),
      candidate,
      occurredAt: input.receivedAt ?? new Date(),
      timeZone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
    });
  };

  return { handle, completeClaimedCallback };
}

const defaultService = createWhatsappFoodClarificationService();
export const handleWhatsappFoodClarification = defaultService.handle;
export const completeClaimedWhatsappFoodClarificationCallback =
  defaultService.completeClaimedCallback;
