import type { MealDraftItem } from "./nutritionEngineTypes";
import { logInferenceEvent } from "./db";
import {
  NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
  buildCandidateIdentityKey,
  isNutritionLabelPhotoClarificationTarget,
  isNutritionLabelPhotoRequestTarget,
  normalize,
  pendingOperationRepository,
  type NutritionLabelPhotoClarificationCandidate,
  type NutritionLabelPhotoClarificationTarget,
  type NutritionLabelPhotoRequestTarget,
} from "./nutritionLabelCandidateService";
import {
  applyNutritionLabelClarificationCandidate,
  buildNutritionLabelClarificationCandidates,
  claimNutritionLabelClarificationSource,
  createNutritionLabelPhotoClarification,
  isValidNutritionLabelEvidence,
  listActiveNutritionLabelOperations,
  listActiveNutritionLabelPhotoRequests,
  nutritionLabelCandidateLabel,
  nutritionLabelCommercialConflict,
  nutritionLabelConflictResolutionSatisfied,
  nutritionLabelIdentityScore,
  nutritionLabelProductOverlap,
} from "./nutritionLabelPhotoRequestService";

export function parseNutritionLabelPhotoClarificationText(
  target: NutritionLabelPhotoClarificationTarget,
  text?: string | null
) {
  const normalizedText = normalize(text);
  if (normalizedText === "cancelar" || normalizedText === "cancela")
    return "cancel";
  const numeric = normalizedText.match(/^(?:opcao )?(\d{1,2})$/);
  if (numeric) {
    const index = Number(numeric[1]) - 1;
    if (
      index >= 0 &&
      index < target.candidates.length &&
      nutritionLabelConflictResolutionSatisfied(
        target.evidenceItem,
        target.candidates[index],
        text
      )
    )
      return "select:" + String(index);
  }
  const matches = target.candidates
    .map((candidate, index) => ({
      index,
      score: nutritionLabelIdentityScore(text, candidate),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  if (
    matches.length === 1 ||
    (matches.length > 1 && matches[0].score > matches[1].score)
  ) {
    const candidate = target.candidates[matches[0].index];
    if (
      candidate &&
      nutritionLabelConflictResolutionSatisfied(
        target.evidenceItem,
        candidate,
        text
      )
    ) {
      return "select:" + String(matches[0].index);
    }
  }
  if (
    target.candidates.length === 1 &&
    ["sim", "confirmar", "confirmo"].includes(normalizedText) &&
    nutritionLabelConflictResolutionSatisfied(
      target.evidenceItem,
      target.candidates[0],
      text
    )
  )
    return "select:0";
  return null;
}
async function cancelNutritionLabelClarificationSources(
  target: NutritionLabelPhotoClarificationTarget
) {
  for (const candidate of target.candidates) {
    if (!candidate.sourcePendingOperationId || candidate.sourceLocked) continue;
    await pendingOperationRepository.cancelPendingOperation(
      candidate.sourcePendingOperationId
    );
  }
}

export async function resolveNutritionLabelPhotoClarificationText(input: {
  userId: number;
  pendingOperation: {
    id: number;
    userId: number;
    type: string;
    target: unknown;
    state: string;
    version: number;
  };
  text?: string | null;
}) {
  if (
    input.pendingOperation.userId !== input.userId ||
    input.pendingOperation.state !== "active" ||
    !isNutritionLabelPhotoClarificationTarget(input.pendingOperation.target)
  ) {
    return null;
  }
  const target = input.pendingOperation.target;
  const action = parseNutritionLabelPhotoClarificationText(target, input.text);
  if (!action) return null;
  if (action === "cancel") {
    await pendingOperationRepository.cancelPendingOperation(
      input.pendingOperation.id
    );
    await cancelNutritionLabelClarificationSources(target);
    return {
      handled: true as const,
      action: "nutrition_label_photo_clarification_cancelled",
      reply:
        "Atualização por rótulo cancelada. O alimento provisório foi mantido sem alterações.",
      eventType: "whatsapp.nutrition_label_photo_clarification.cancelled",
      detail: "Continuação de rótulo cancelada sem mutação.",
    };
  }
  const index = Number(action.slice("select:".length));
  const candidate = target.candidates[index];
  if (!candidate) return null;
  const clarificationClaim =
    await pendingOperationRepository.claimPendingOperation({
      id: input.pendingOperation.id,
      expectedVersion: input.pendingOperation.version,
    });
  if (!clarificationClaim.claimed) return null;
  const sourceClaimed = await claimNutritionLabelClarificationSource(
    input.userId,
    candidate
  );
  if (!sourceClaimed) {
    return {
      handled: true as const,
      action: "nutrition_label_photo_clarification_unavailable",
      reply:
        "Essa atualização já foi concluída, cancelada ou expirou. Nenhum alimento foi alterado novamente.",
      eventType: "whatsapp.nutrition_label_photo_clarification.unavailable",
      detail:
        "Fonte correlacionada não estava mais ativa; mutação duplicada bloqueada.",
    };
  }
  try {
    const updated = await applyNutritionLabelClarificationCandidate({
      userId: input.userId,
      candidate,
      item: target.evidenceItem,
      sourceText: target.sourceText,
    });
    if (!updated) {
      return {
        handled: true as const,
        action: "nutrition_label_photo_clarification_stale",
        reply:
          "O alimento mudou desde a solicitação do rótulo e não foi alterado novamente. Envie um novo rótulo se ainda precisar corrigir os nutrientes.",
        eventType: "whatsapp.nutrition_label_photo_clarification.stale",
        detail: "Item não preservou identidade/estado provisório esperado.",
      };
    }
    return {
      handled: true as const,
      action: "nutrition_label_photo_clarification_completed",
      reply:
        "Atualizei os nutrientes de " +
        nutritionLabelCandidateLabel(candidate) +
        " usando a foto já enviada, mantendo a identidade comercial e sem criar nova refeição.",
      eventType: "whatsapp.nutrition_label_photo_clarification.completed",
      detail:
        "Evidência persistida aplicada uma única vez após confirmação explícita.",
    };
  } catch (error) {
    const recovery = await createNutritionLabelPhotoClarification({
      userId: input.userId,
      candidates: [
        {
          ...candidate,
          sourcePendingOperationId: null,
          sourceLocked: true,
        },
      ],
      item: target.evidenceItem,
      sourceText: target.sourceText,
      sourceMessageId: target.sourceMessageId,
      retry: true,
    });
    return {
      handled: true as const,
      action: "nutrition_label_photo_clarification_persistence_failed",
      reply: recovery
        ? recovery.target.instructionText
        : "Não consegui concluir a atualização. O item provisório foi preservado e nenhuma publicação global foi feita.",
      eventType:
        "whatsapp.nutrition_label_photo_clarification.persistence_failed",
      detail:
        error instanceof Error
          ? "Falha ao persistir atualização nutricional: " + error.message
          : "Falha desconhecida ao persistir atualização nutricional.",
    };
  }
}

export async function cancelClaimedNutritionLabelPhotoClarification(input: {
  userId: number;
  pendingOperation: { userId: number; target: unknown };
}) {
  if (
    input.pendingOperation.userId !== input.userId ||
    !isNutritionLabelPhotoClarificationTarget(input.pendingOperation.target)
  ) {
    return null;
  }
  await cancelNutritionLabelClarificationSources(input.pendingOperation.target);
  return {
    handled: true as const,
    action: "nutrition_label_photo_clarification_cancelled",
    reply:
      "Atualização por rótulo cancelada. O alimento provisório foi mantido sem alterações.",
    eventType: "whatsapp.nutrition_label_photo_clarification.cancelled",
    detail: "Callback cancelou as fontes correlacionadas sem mutação.",
  };
}

export async function resolveNutritionLabelPhotoEvidence(input: {
  userId: number;
  item?: MealDraftItem | null;
  sourceText?: string | null;
  captionText?: string | null;
  sourceMessageId?: string | null;
}) {
  const allOperations = await listActiveNutritionLabelOperations(input.userId);
  const activeClarification = allOperations.find(operation =>
    isNutritionLabelPhotoClarificationTarget(operation.target)
  );
  if (
    activeClarification &&
    isNutritionLabelPhotoClarificationTarget(activeClarification.target)
  ) {
    return {
      handled: true as const,
      action: "nutrition_label_photo_clarification_waiting",
      reply: activeClarification.target.instructionText,
      eventType: "whatsapp.nutrition_label_photo_clarification.waiting",
      detail:
        "Continuação já persistida manteve a evidência anterior e bloqueou nova interpretação.",
    };
  }

  const requests = allOperations.filter(operation =>
    isNutritionLabelPhotoRequestTarget(operation.target)
  );
  if (!requests.length) return { handled: false as const };
  if (!isValidNutritionLabelEvidence(input.item)) {
    return {
      handled: true as const,
      action: "nutrition_label_photo_unreadable",
      reply:
        "Recebi a imagem, mas não consegui validar uma tabela nutricional completa. A solicitação continua aberta; envie uma foto legível da porção e dos nutrientes.",
      eventType: "whatsapp.nutrition_label_photo.unreadable",
      detail:
        "Evidência nutrition_label incompleta; nenhuma pendência foi consumida.",
    };
  }

  const labelItem = input.item;
  const candidates = await buildNutritionLabelClarificationCandidates(
    input.userId,
    requests
  );
  if (!candidates.length) {
    return {
      handled: true as const,
      action: "nutrition_label_photo_stale_targets",
      reply:
        "Os itens vinculados a essa solicitação não estão mais disponíveis. Nenhuma refeição foi alterada.",
      eventType: "whatsapp.nutrition_label_photo.stale_targets",
      detail:
        "Pendências não puderam ser correlacionadas aos itens persistidos do usuário.",
    };
  }

  const captionMatches = candidates
    .map(candidate => ({
      candidate,
      score: nutritionLabelIdentityScore(input.captionText, candidate),
    }))
    .filter(match => match.score > 0)
    .sort((left, right) => right.score - left.score);
  const labelMatches = candidates
    .map(candidate => ({
      candidate,
      score: nutritionLabelIdentityScore(
        [labelItem.foodName, labelItem.canonicalName, labelItem.brand]
          .filter(Boolean)
          .join(" "),
        candidate
      ),
    }))
    .filter(match => match.score > 0)
    .sort((left, right) => right.score - left.score);

  let selected =
    captionMatches.length === 1 ||
    (captionMatches.length > 1 &&
      captionMatches[0].score > captionMatches[1].score)
      ? captionMatches[0].candidate
      : labelMatches.length === 1 ||
          (labelMatches.length > 1 &&
            labelMatches[0].score > labelMatches[1].score)
        ? labelMatches[0].candidate
        : candidates.length === 1
          ? candidates[0]
          : null;

  if (!selected) {
    const clarification = await createNutritionLabelPhotoClarification({
      userId: input.userId,
      candidates,
      item: labelItem,
      sourceText: input.sourceText,
      sourceMessageId: input.sourceMessageId,
    });
    return {
      handled: true as const,
      action: "nutrition_label_photo_selection_requested",
      reply: clarification
        ? clarification.target.instructionText
        : "Não consegui persistir a seleção do item. Nenhuma refeição foi alterada.",
      eventType: clarification
        ? "whatsapp.nutrition_label_photo_selection.requested"
        : "whatsapp.nutrition_label_photo_selection.persistence_failed",
      detail: clarification
        ? "Ambiguidade entre itens persistida antes da pergunta de seleção."
        : "Falha ao persistir a seleção; nenhuma mutação foi executada.",
    };
  }

  const conflict = nutritionLabelCommercialConflict(labelItem, selected);
  const explicitOriginalIdentity =
    nutritionLabelProductOverlap(input.captionText, selected) > 0 ||
    nutritionLabelProductOverlap(
      [labelItem.foodName, labelItem.canonicalName, labelItem.brand]
        .filter(Boolean)
        .join(" "),
      selected
    ) > 0;
  if (conflict || !explicitOriginalIdentity) {
    const clarification = await createNutritionLabelPhotoClarification({
      userId: input.userId,
      candidates: [selected],
      item: labelItem,
      sourceText: input.sourceText,
      sourceMessageId: input.sourceMessageId,
      conflict,
    });
    return {
      handled: true as const,
      action: "nutrition_label_photo_identity_confirmation_requested",
      reply: clarification
        ? clarification.target.instructionText
        : "Não consegui persistir a confirmação da identidade. Nenhuma refeição foi alterada.",
      eventType: clarification
        ? "whatsapp.nutrition_label_photo_identity_confirmation.requested"
        : "whatsapp.nutrition_label_photo_identity_confirmation.persistence_failed",
      detail: clarification
        ? "Conflito/insuficiência de identidade preservou a foto e bloqueou mutação."
        : "Falha ao persistir confirmação de identidade; nenhuma mutação foi executada.",
    };
  }

  const sourceClaimed = await claimNutritionLabelClarificationSource(
    input.userId,
    selected
  );
  if (!sourceClaimed) {
    return {
      handled: true as const,
      action: "nutrition_label_photo_concurrent_or_stale",
      reply:
        "Essa solicitação já foi concluída, cancelada ou substituída. Não alterei o alimento novamente.",
      eventType: "whatsapp.nutrition_label_photo.concurrent_or_stale",
      detail:
        "Claim compare-and-set falhou e bloqueou atualização duplicada.",
    };
  }

  try {
    const updated = await applyNutritionLabelClarificationCandidate({
      userId: input.userId,
      candidate: selected,
      item: labelItem,
      sourceText: input.sourceText,
    });
    if (!updated) {
      return {
        handled: true as const,
        action: "nutrition_label_photo_stale_item",
        reply:
          "O item mudou desde a solicitação do rótulo e não foi alterado novamente.",
        eventType: "whatsapp.nutrition_label_photo.stale_item",
        detail:
          "Item não preservou identidade/estado provisório esperado após claim.",
      };
    }
    return {
      handled: true as const,
      action: "nutrition_label_photo_applied",
      reply:
        "Atualizei os nutrientes de " +
        nutritionLabelCandidateLabel(selected) +
        " usando o rótulo, sem criar nova refeição e sem trocar a identidade comercial.",
      eventType: "whatsapp.nutrition_label_photo.applied",
      detail:
        "Rótulo correlacionado por usuário, pendência e identidade após claim compare-and-set.",
    };
  } catch (error) {
    const recovery = await createNutritionLabelPhotoClarification({
      userId: input.userId,
      candidates: [
        {
          ...selected,
          sourcePendingOperationId: null,
          sourceLocked: true,
        },
      ],
      item: labelItem,
      sourceText: input.sourceText,
      sourceMessageId: input.sourceMessageId,
      retry: true,
    });
    return {
      handled: true as const,
      action: "nutrition_label_photo_persistence_failed",
      reply: recovery
        ? recovery.target.instructionText
        : "Não consegui concluir a atualização. O item provisório foi preservado e nenhuma publicação global foi feita.",
      eventType: "whatsapp.nutrition_label_photo.persistence_failed",
      detail:
        error instanceof Error
          ? "Falha após análise do rótulo: " + error.message
          : "Falha desconhecida após análise do rótulo.",
    };
  }
}
