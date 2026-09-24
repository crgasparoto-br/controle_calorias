import type { MealDraftItem } from "./nutritionEngineTypes";
import { listPersistedWhatsappLearningArtifacts } from "./modules/whatsapp/learningArtifactPersistence";
import {
  NUTRITION_LABEL_CANDIDATE_AUDIT_KIND,
  NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
  findCandidateArtifact,
  nowIso,
  pendingOperationRepository,
  recordCandidateAudit,
  toCandidate,
  updateCandidate,
  type NutritionLabelCandidate,
  type NutritionLabelCandidateAudit,
} from "./nutritionLabelCandidateService";

export async function markNutritionLabelPhotoReceived(input: {
  candidateId: number;
  userId: number;
}) {
  const artifact = await findCandidateArtifact(input.candidateId);
  if (!artifact || artifact.value.userId !== input.userId) return null;
  const updated = await updateCandidate(artifact, {
    photoReceivedAt: nowIso(),
    status:
      artifact.value.status === "published" ? "published" : "pending_review",
  });
  await recordCandidateAudit({
    candidateId: artifact.id,
    identityKey: artifact.value.identityKey,
    action: "photo_received",
    actorUserId: input.userId,
    detail:
      "Foto recebida após solicitação administrativa; aguardando evidência nutricional válida para atualização do candidato.",
  });
  return updated;
}
export function buildNutritionLabelPhotoActions() {
  return [
    {
      id: "cancel",
      label: "Cancelar",
      effect: "cancel",
      description: "Encerrar o pedido de nova foto.",
    },
  ] as const;
}

export async function cancelNutritionLabelPhotoRequest(input: {
  userId: number;
  pendingOperationId: number;
}) {
  const pending = await pendingOperationRepository.getPendingOperationById(
    input.pendingOperationId
  );
  if (
    !pending ||
    pending.userId !== input.userId ||
    pending.type !== NUTRITION_LABEL_PHOTO_REQUEST_TYPE
  ) {
    return {
      handled: true,
      action: "nutrition_label_photo_request_unavailable",
      reply:
        "Esse pedido de foto já não está disponível. Envie um novo comando se ainda precisar corrigir o rótulo.",
      eventType: "whatsapp.nutrition_label_photo_request.unavailable",
      detail:
        "Callback de nova foto não correspondeu a uma pendência ativa do usuário.",
    } as const;
  }
  const cancelled = await pendingOperationRepository.cancelPendingOperation(
    pending.id
  );
  return {
    handled: true,
    action: "nutrition_label_photo_request_cancelled",
    reply: cancelled.cancelled
      ? "Pedido de nova foto cancelado. Nenhum candidato foi alterado."
      : "O pedido de nova foto já foi encerrado.",
    eventType: "whatsapp.nutrition_label_photo_request.cancelled",
    detail: cancelled.cancelled
      ? "Pendência de foto cancelada sem mutação nutricional."
      : "Pendência de foto já estava encerrada.",
  } as const;
}

export async function applyNutritionLabelPhotoToCandidate(input: {
  candidateId: number;
  userId: number;
  sourceText?: string | null;
  item: MealDraftItem;
}) {
  const artifact = await findCandidateArtifact(input.candidateId);
  if (!artifact || artifact.value.userId !== input.userId) return null;
  const candidate = toCandidate({
    userId: input.userId,
    mealId: artifact.value.mealId,
    itemIndex: artifact.value.itemIndex,
    sourceText: input.sourceText ?? artifact.value.sourceText,
    item: input.item,
  });
  if (!candidate) return null;
  const updated = await updateCandidate(artifact, {
    ...candidate,
    identityKey: artifact.value.identityKey,
    foodName: artifact.value.foodName,
    canonicalName: artifact.value.canonicalName,
    brand: artifact.value.brand,
    productVariant: artifact.value.productVariant,
    barcode: artifact.value.barcode ?? null,
    status: "pending_review",
    publishedCatalogId: artifact.value.publishedCatalogId ?? null,
    photoReceivedAt: nowIso(),
    createdAt: artifact.value.createdAt,
  });
  await recordCandidateAudit({
    candidateId: artifact.id,
    identityKey: artifact.value.identityKey,
    action: "photo_received",
    actorUserId: input.userId,
    detail:
      "Nova foto legível aplicada ao candidato original; a publicação continua bloqueada até revisão administrativa.",
  });
  return updated;
}

export function buildNutritionLabelCandidateAuditSummary(
  audit: NutritionLabelCandidateAudit
) {
  return {
    action: audit.action,
    actorUserId: audit.actorUserId ?? null,
    detail: audit.detail,
    createdAt: audit.createdAt,
  };
}

export async function listNutritionLabelCandidateAudits(candidateId: number) {
  const artifacts =
    await listPersistedWhatsappLearningArtifacts<NutritionLabelCandidateAudit>({
      scope: "global",
      kind: NUTRITION_LABEL_CANDIDATE_AUDIT_KIND,
    });
  return (artifacts ?? [])
    .filter(artifact => artifact.value?.candidateId === candidateId)
    .sort((left, right) =>
      right.value.createdAt.localeCompare(left.value.createdAt)
    )
    .map(artifact => ({ id: artifact.id, ...artifact.value }));
}
