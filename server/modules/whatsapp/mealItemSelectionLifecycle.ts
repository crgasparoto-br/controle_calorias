import {
  PENDING_OPERATION_PROCESSING_LEASE_MS,
  type WhatsAppPendingOperationRecord,
  type WhatsAppPendingOperationRepository,
} from "../../repositories/whatsappPendingOperationRepository";
import { getPendingOperationDispatchStatus } from "../../repositories/whatsappPendingOperationTypes";
import type { WhatsAppLogicalReply } from "./replyContract";
import { buildWhatsAppCallbackResourceNotFoundReplyMessage } from "./replyMessages";
import type { MixedIncrementSelectionContinuation } from "./mixedMealItemIncrementPlanTypes";
import {
  requireChoiceReview,
  settleChoiceProcessingClaim,
  type ChoiceProcessingClaim,
  type SelectionIntentResult,
} from "./mealItemSelectionProcessing";

const PENDING_MEAL_ITEM_SELECTION_TYPE = "meal_item_selection";
const CANCEL_ACTION = "cancel";
const SELECT_ACTION_PREFIX = "select:";

type MealItemSelectionCandidate = {
  mealId: number;
  mealLabel: string;
  itemIndex: number;
  itemName: string;
};

type MealItemSelectionAction =
  | { kind: "grams_delta"; delta: number }
  | { kind: "grams_absolute"; grams: number }
  | { kind: "quantity_absolute"; quantity: number; unit: string }
  | { kind: "replace_food"; targetFood: string }
  | { kind: "mixed_increment_target"; operationIndex: number };

type MealItemSelectionCompanionAction = {
  candidate: MealItemSelectionCandidate;
  action: MealItemSelectionAction;
};

type MealItemPendingSelectionStep = {
  targetFood: string | null;
  action: MealItemSelectionAction;
  contextLabel: string;
  candidates: MealItemSelectionCandidate[];
};

type PendingMealItemSelection = MealItemPendingSelectionStep & {
  resultTitle: string;
  companionActions?: MealItemSelectionCompanionAction[];
  remainingSelections?: MealItemPendingSelectionStep[];
  continuation?: MixedIncrementSelectionContinuation;
};

type MealItemSelectionResult = {
  handled: true;
  action:
    | "clarification_needed"
    | "meal_item_grams_adjusted"
    | "meal_item_replaced";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

type ClarificationResult = (
  reply: string,
  eventType: string,
  detail: string,
  data?: Record<string, unknown>
) => MealItemSelectionResult;

type CreatePendingMealItemChoice = (
  userId: number,
  pending: PendingMealItemSelection,
  receivedAt?: Date
) => Promise<MealItemSelectionResult>;

type ApplyChoicePlan = (
  userId: number,
  selected: MealItemSelectionCandidate,
  pending: PendingMealItemSelection
) => Promise<MealItemSelectionResult>;

type ParseChoiceIndex = (normalized: string) => number | null;
type IsChoiceCancellation = (normalized: string) => boolean;
type IsCompleteCommand = (text: string) => boolean;
type NormalizeChoiceText = (value: string) => string;

type SelectionLifecycleDependencies = {
  pendingOperationRepository: WhatsAppPendingOperationRepository;
  createPendingMealItemChoice: CreatePendingMealItemChoice;
  applyChoicePlan: ApplyChoicePlan;
  parseChoiceIndex: ParseChoiceIndex;
  isChoiceCancellation: IsChoiceCancellation;
  isCompleteCommand: IsCompleteCommand;
  normalizeChoiceText: NormalizeChoiceText;
  buildMealItemSelectionReply: (
    bodyText: string,
    pendingOperationId: number,
    candidates: MealItemSelectionCandidate[]
  ) => WhatsAppLogicalReply;
  continueMixedIncrementPlan: (
    userId: number,
    plan: MixedIncrementSelectionContinuation["plan"],
    options?: { receivedAt?: Date }
  ) => Promise<SelectionIntentResult>;
  clarificationResult: ClarificationResult;
  buildCancellationResult: () => MealItemSelectionResult;
  buildCallbackResourceNotFoundResult: () => MealItemSelectionResult;
};

function wireChoiceFlow(
  dependencies: SelectionLifecycleDependencies
) {
  const {
    pendingOperationRepository,
    createPendingMealItemChoice,
    applyChoicePlan,
    parseChoiceIndex,
    isChoiceCancellation,
    isCompleteCommand,
    normalizeChoiceText,
    buildMealItemSelectionReply,
    continueMixedIncrementPlan,
    clarificationResult,
    buildCancellationResult,
    buildCallbackResourceNotFoundResult,
  } = dependencies;

  async function continueChoiceOrApply(
    userId: number,
    selected: MealItemSelectionCandidate,
    pending: PendingMealItemSelection,
    receivedAt?: Date
  ): Promise<SelectionIntentResult> {
    const resolvedActions = [
      ...(pending.companionActions ?? []),
      { candidate: selected, action: pending.action },
    ];
    const [next, ...remaining] = pending.remainingSelections ?? [];
    if (next) {
      return createPendingMealItemChoice(
        userId,
        {
          ...next,
          resultTitle: pending.resultTitle,
          companionActions: resolvedActions,
          remainingSelections: remaining,
          continuation: pending.continuation,
        },
        receivedAt
      );
    }

    if (pending.continuation?.kind === "mixed_increment_plan") {
      const plan = {
        ...pending.continuation.plan,
        operations: pending.continuation.plan.operations.map(operation => ({
          ...operation,
          target: operation.target ? { ...operation.target } : undefined,
        })),
      };
      for (const step of resolvedActions) {
        if (step.action.kind !== "mixed_increment_target") continue;
        const operation = plan.operations[step.action.operationIndex];
        if (!operation) continue;
        operation.target = { ...step.candidate };
      }
      return continueMixedIncrementPlan(userId, plan, { receivedAt });
    }

    return applyChoicePlan(userId, selected, pending);
  }

  async function runClaimedSelection(
    userId: number,
    selected: MealItemSelectionCandidate,
    pending: PendingMealItemSelection,
    claim: ChoiceProcessingClaim,
    receivedAt?: Date
  ) {
    let resultProduced = false;
    try {
      const result = await continueChoiceOrApply(
        userId,
        selected,
        pending,
        receivedAt
      );
      resultProduced = true;
      return await settleChoiceProcessingClaim(
        pendingOperationRepository,
        claim,
        result,
        receivedAt
      );
    } catch (error) {
      if (!resultProduced) {
        await requireChoiceReview(
          pendingOperationRepository,
          claim,
          receivedAt,
          "A continuação falhou antes de produzir um resultado durável."
        );
      }
      throw error;
    }
  }

  async function handleTextMealItemChoice(
    userId: number,
    text?: string | null,
    receivedAt?: Date
  ): Promise<SelectionIntentResult | null> {
    const trimmed = text?.trim();
    if (!trimmed) return null;
    const pendingRow: WhatsAppPendingOperationRecord | null =
      await pendingOperationRepository.getActivePendingOperation(
        userId,
        receivedAt
      );
    if (!pendingRow || pendingRow.type !== PENDING_MEAL_ITEM_SELECTION_TYPE)
      return null;
    const dispatchStatus = getPendingOperationDispatchStatus(pendingRow.state);
    if (dispatchStatus !== "ready") {
      const reviewRequired = dispatchStatus === "review_required";
      return clarificationResult(
        reviewRequired
          ? "O resultado da seleção anterior pode ter sido aplicado. Confira a refeição antes de repetir; não farei uma nova tentativa automática."
          : "Essa seleção ainda está sendo processada. Aguarde; se não houver confirmação, confira a refeição antes de repetir.",
        reviewRequired
          ? "whatsapp.intent.meal_item_selection_review_required"
          : "whatsapp.intent.meal_item_selection_processing",
        reviewRequired
          ? "Uma lease abandonada foi encerrada para revisão; nenhuma segunda execução foi iniciada."
          : "Uma reivindicação durável está em andamento; nenhuma segunda execução foi iniciada.",
        { pendingOperationId: pendingRow.id, fallbackBlocked: true }
      );
    }
    const pending = pendingRow.target as PendingMealItemSelection;

    // Uma mensagem completa nova não é complemento da seleção anterior. A
    // pendência é substituída e o roteador continua normalmente.
    if (isCompleteCommand(trimmed)) {
      const superseded =
        await pendingOperationRepository.supersedePendingOperation(
          pendingRow.id,
          receivedAt ?? new Date()
        );
      return superseded.superseded
        ? null
        : clarificationResult(
            "Não consegui substituir a seleção pendente com segurança. Envie CANCELAR e repita o novo comando.",
            "whatsapp.intent.meal_item_selection_replacement_blocked",
            "Novo comando completo bloqueado porque a seleção anterior não pôde ser substituída.",
            { pendingOperationId: pendingRow.id, fallbackBlocked: true }
          );
    }

    const normalized = normalizeChoiceText(trimmed);
    if (isChoiceCancellation(normalized)) {
      await pendingOperationRepository.cancelPendingOperation(
        pendingRow.id,
        receivedAt ?? new Date()
      );
      return buildCancellationResult();
    }

    const representSameOptions = (
      reply: string,
      eventType: string,
      detail: string
    ): MealItemSelectionResult => ({
      ...clarificationResult(reply, eventType, detail, {
        candidateCount: pending.candidates.length,
        pendingOperationId: pendingRow.id,
        interactionId: "meal_item.candidate_selection",
        fallbackBlocked: true,
      }),
      interactiveReply: buildMealItemSelectionReply(
        reply,
        pendingRow.id,
        pending.candidates
      ),
    });

    const index = parseChoiceIndex(normalized);
    if (index === null) {
      return representSameOptions(
        `Escolha uma das opções de 1 a ${pending.candidates.length} ou responda CANCELAR.`,
        "whatsapp.intent.meal_item_selection_needed",
        "Resposta incompatível reapresentou a mesma seleção sem consumir a pendência."
      );
    }
    const selected = pending.candidates[index];
    if (!selected) {
      return representSameOptions(
        `A opção ${index + 1} não existe. Escolha um número entre 1 e ${pending.candidates.length}, ou responda CANCELAR.`,
        "whatsapp.intent.meal_item_selection_invalid",
        "Índice inexistente reapresentou a mesma seleção persistida."
      );
    }
    const claimed =
      await pendingOperationRepository.beginPendingOperationProcessing({
        id: pendingRow.id,
        expectedVersion: pendingRow.version,
        now: receivedAt,
        leaseMs: PENDING_OPERATION_PROCESSING_LEASE_MS,
      });
    if (!claimed.claimed) {
      return clarificationResult(
        buildWhatsAppCallbackResourceNotFoundReplyMessage(),
        "whatsapp.intent.meal_item_selection_already_resolved",
        "A seleção já foi consumida por outra resposta; nenhuma mutação duplicada foi executada.",
        { pendingOperationId: pendingRow.id, fallbackBlocked: true }
      );
    }
    return runClaimedSelection(
      userId,
      selected,
      pending,
      { id: pendingRow.id, version: claimed.version! },
      receivedAt
    );
  }

  async function completeItemChoiceInteractiveCallback(
    userId: number,
    pendingOperation: Pick<WhatsAppPendingOperationRecord, "target"> &
      Partial<Pick<WhatsAppPendingOperationRecord, "id" | "version" | "state">>,
    action: string,
    receivedAt?: Date
  ): Promise<SelectionIntentResult> {
    const pending = pendingOperation.target as PendingMealItemSelection;
    const claim =
      pendingOperation.id &&
      pendingOperation.version &&
      pendingOperation.state === "processing"
        ? { id: pendingOperation.id, version: pendingOperation.version }
        : null;
    if (!claim) {
      return clarificationResult(
        "Não consegui validar a reivindicação da seleção; envie novamente para evitar aplicar a mesma ação mais de uma vez.",
        "whatsapp.intent.meal_item_selection_claim_required",
        "Callback de seleção sem claim processing durável foi bloqueado antes da mutação.",
        { pendingOperationId: pendingOperation.id ?? null, fallbackBlocked: true }
      );
    }
    if (action === CANCEL_ACTION) {
      const result = buildCancellationResult();
      const completed =
        await pendingOperationRepository.completePendingOperationProcessing({
          id: claim.id,
          expectedVersion: claim.version,
          now: receivedAt,
        });
      return completed.completed
        ? result
        : requireChoiceReview(
            pendingOperationRepository,
            claim,
            receivedAt,
            "O cancelamento foi solicitado, mas a conclusão durável da pendência não foi confirmada."
          );
    }
    if (action.startsWith(SELECT_ACTION_PREFIX)) {
      const selected =
        pending.candidates[Number(action.slice(SELECT_ACTION_PREFIX.length))];
      if (!selected) {
        const result = buildCallbackResourceNotFoundResult();
        const released =
          await pendingOperationRepository.releasePendingOperationProcessing({
            id: claim.id,
            expectedVersion: claim.version,
            now: receivedAt,
          });
        return released.released
          ? result
          : requireChoiceReview(
              pendingOperationRepository,
              claim,
              receivedAt,
              "A opção não foi aplicada, mas a liberação durável da pendência não foi confirmada."
            );
      }
      return runClaimedSelection(userId, selected, pending, claim, receivedAt);
    }
    const result = buildCallbackResourceNotFoundResult();
    const released =
      await pendingOperationRepository.releasePendingOperationProcessing({
        id: claim.id,
        expectedVersion: claim.version,
        now: receivedAt,
      });
    return released.released
      ? result
      : requireChoiceReview(
          pendingOperationRepository,
          claim,
          receivedAt,
          "A ação não foi reconhecida, mas a liberação durável da pendência não foi confirmada."
        );
  }

  return { handleTextMealItemChoice, completeItemChoiceInteractiveCallback };
}

export const createMealItemSelectionLifecycle = wireChoiceFlow;
