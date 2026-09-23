import { createHash } from "node:crypto";
import {
  getDb,
  getUserWhatsappConnection,
  listUserMeals,
  logInferenceEvent,
  logPersistenceWarning,
  updateUserMeal,
} from "./db";
import { refreshCatalogCache } from "./catalogRuntime";
import type { MealDraftItem } from "./nutritionEngineTypes";
import {
  createDrizzleFoodCatalogRepository,
  type FoodCatalogRepository,
  type NutritionResearchUpsertInput,
} from "./repositories/foodCatalogRepository";
import {
  listPersistedWhatsappLearningArtifacts,
  persistWhatsappLearningArtifact,
  type WhatsappLearningArtifact,
} from "./modules/whatsapp/learningArtifactPersistence";
import { createDrizzleWhatsAppPendingOperationRepository } from "./repositories/whatsappPendingOperationRepository";
import { supersedeActiveWhatsappPendingOperations } from "./modules/whatsapp/pendingOperationPrecedence";
import { sendWhatsAppLogicalReply } from "./modules/whatsapp/replyTransport";
import { textReply } from "./modules/whatsapp/replyContract";
import {
  NUTRITION_LABEL_PHOTO_REQUEST_ORIGIN,
  PENDING_NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
} from "./modules/whatsapp/nutritionLabelPhotoInteraction";

export const NUTRITION_LABEL_CANDIDATE_KIND = "nutrition_label_candidate";
export const NUTRITION_LABEL_CANDIDATE_AUDIT_KIND =
  "nutrition_label_candidate_audit";
export const NUTRITION_LABEL_PHOTO_REQUEST_TYPE =
  PENDING_NUTRITION_LABEL_PHOTO_REQUEST_TYPE;
export const NUTRITION_LABEL_PHOTO_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export type NutritionLabelCandidateStatus =
  | "pending_review"
  | "photo_requested"
  | "published"
  | "rejected"
  | "rolled_back";

export type NutritionLabelCandidate = {
  identityKey: string;
  userId: number;
  mealId?: number | null;
  itemIndex: number;
  sourceText?: string | null;
  foodName: string;
  canonicalName: string;
  brand: string | null;
  productVariant: string | null;
  barcode?: string | null;
  servingLabel: string;
  servingUnit: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  sourceUrls: string[];
  sourceEvidence: string;
  sourceVerifiedAt: string;
  sourceConfidence: number;
  status: NutritionLabelCandidateStatus;
  publishedCatalogId?: number | null;
  photoRequestedAt?: string | null;
  photoReceivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NutritionLabelCandidateAudit = {
  candidateId: number;
  identityKey: string;
  action:
    | "created"
    | "photo_requested"
    | "photo_received"
    | "published"
    | "rejected"
    | "rolled_back";
  actorUserId?: number | null;
  detail: string;
  createdAt: string;
};

export type NutritionLabelPhotoRequestTarget = {
  kind: "nutrition_label_photo_request";
  candidateId?: number;
  mealId?: number;
  itemIndex?: number;
  identityKey: string;
  originalFoodName: string;
  originalCanonicalName?: string | null;
  originalBrand?: string | null;
  originalProductVariant?: string | null;
  originalBarcode?: string | null;
  originalQuantity?: number | null;
  originalUnit?: string | null;
  originalEstimatedGrams?: number | null;
  sourceMessageId?: string | null;
  instructionText: string;
  actions: readonly { id: string; title: string }[];
};

export type NutritionLabelPhotoClarificationCandidate = {
  sourcePendingOperationId: number | null;
  sourceLocked?: boolean;
  candidateId?: number;
  mealId?: number;
  itemIndex?: number;
  identityKey: string;
  originalFoodName: string;
  originalCanonicalName: string;
  originalBrand: string | null;
  originalProductVariant: string | null;
};

export type NutritionLabelPhotoClarificationTarget = {
  kind: "nutrition_label_photo_clarification";
  candidates: NutritionLabelPhotoClarificationCandidate[];
  evidenceItem: MealDraftItem;
  sourceText?: string | null;
  sourceMessageId?: string | null;
  instructionText: string;
  actions: readonly [{ id: "cancel"; title: string }];
};

export function isNutritionLabelPhotoRequestTarget(
  value: unknown
): value is NutritionLabelPhotoRequestTarget {
  const target = value as Partial<NutritionLabelPhotoRequestTarget> | null;
  return Boolean(
    target &&
      target.kind === "nutrition_label_photo_request" &&
      (Number.isInteger(target.candidateId) ||
        (Number.isInteger(target.mealId) && Number.isInteger(target.itemIndex))) &&
      typeof target.identityKey === "string" &&
      Array.isArray(target.actions) &&
      target.actions.some(action => action?.id === "cancel")
  );
}

export function isNutritionLabelPhotoClarificationTarget(
  value: unknown
): value is NutritionLabelPhotoClarificationTarget {
  const target = value as Partial<NutritionLabelPhotoClarificationTarget> | null;
  return Boolean(
    target &&
      target.kind === "nutrition_label_photo_clarification" &&
      Array.isArray(target.candidates) &&
      target.candidates.length > 0 &&
      target.evidenceItem &&
      typeof target.instructionText === "string" &&
      Array.isArray(target.actions) &&
      target.actions.some(action => action?.id === "cancel")
  );
}

type CandidateArtifact = WhatsappLearningArtifact<NutritionLabelCandidate>;

export const pendingOperationRepository =
  createDrizzleWhatsAppPendingOperationRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });

export function nowIso() {
  return new Date().toISOString();
}

export function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCandidateIdentityKey(item: MealDraftItem) {
  const identity = [
    normalize(item.brand),
    normalize(item.canonicalName || item.foodName),
    normalize(item.productVariant || item.resolution?.productVariant),
    normalize(item.resolution?.barcode),
  ].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

function toArtifact(candidate: CandidateArtifact | null) {
  return candidate && candidate.value?.identityKey ? candidate : null;
}

async function listCandidateArtifacts() {
  const artifacts =
    await listPersistedWhatsappLearningArtifacts<NutritionLabelCandidate>({
      scope: "global",
      kind: NUTRITION_LABEL_CANDIDATE_KIND,
    });
  return (artifacts ?? [])
    .map(toArtifact)
    .filter((item): item is CandidateArtifact => Boolean(item));
}

export async function findCandidateArtifact(candidateId: number) {
  return (
    (await listCandidateArtifacts()).find(
      candidate => candidate.id === candidateId
    ) ?? null
  );
}

async function persistCandidate(
  candidate: NutritionLabelCandidate,
  createdAt?: Date
) {
  return persistWhatsappLearningArtifact({
    scope: "global",
    kind: NUTRITION_LABEL_CANDIDATE_KIND,
    key: candidate.identityKey,
    value: candidate,
    createdAt,
  });
}

export async function recordCandidateAudit(input: {
  candidateId: number;
  identityKey: string;
  action: NutritionLabelCandidateAudit["action"];
  actorUserId?: number | null;
  detail: string;
}) {
  const createdAt = nowIso();
  const value: NutritionLabelCandidateAudit = {
    ...input,
    createdAt,
  };
  await persistWhatsappLearningArtifact({
    scope: "global",
    kind: NUTRITION_LABEL_CANDIDATE_AUDIT_KIND,
    key: `${input.identityKey}:${input.action}:${createdAt}`,
    value,
  });
  return value;
}

export function toCandidate(input: {
  userId: number;
  mealId?: number | null;
  itemIndex: number;
  sourceText?: string | null;
  item: MealDraftItem;
}): NutritionLabelCandidate | null {
  const resolution = input.item.resolution;
  if (resolution?.nutritionOrigin !== "nutrition_label") return null;
  const sourceEvidence = resolution.sourceEvidence?.trim();
  const sourceVerifiedAt = resolution.sourceVerifiedAt
    ? new Date(resolution.sourceVerifiedAt).toISOString()
    : nowIso();
  const sourceUrls = [...(resolution.sourceUrls ?? [])].filter(url =>
    /^https?:\/\//i.test(url)
  );
  if (!sourceEvidence || !sourceVerifiedAt) return null;
  if (
    !Number.isFinite(input.item.estimatedGrams) ||
    input.item.estimatedGrams <= 0
  )
    return null;

  const createdAt = nowIso();
  const sourceConfidence = Math.min(
    Math.max(resolution.sourceConfidence ?? input.item.confidence, 0),
    1
  );
  return {
    identityKey: buildCandidateIdentityKey(input.item),
    userId: input.userId,
    mealId: input.mealId ?? null,
    itemIndex: input.itemIndex,
    sourceText: input.sourceText ?? null,
    foodName: input.item.foodName,
    canonicalName: input.item.canonicalName,
    brand: input.item.brand ?? null,
    productVariant:
      input.item.productVariant ?? resolution.productVariant ?? null,
    barcode: resolution.barcode ?? null,
    servingLabel: input.item.portionText,
    servingUnit: input.item.unit,
    gramsPerServing: input.item.estimatedGrams,
    calories: input.item.calories,
    protein: input.item.protein,
    carbs: input.item.carbs,
    fat: input.item.fat,
    fiber: input.item.classification?.fiberGrams ?? null,
    sourceUrls: sourceUrls.length
      ? sourceUrls
      : [`nutrition-label://${buildCandidateIdentityKey(input.item)}`],
    sourceEvidence,
    sourceVerifiedAt,
    sourceConfidence,
    status: "pending_review",
    publishedCatalogId: null,
    photoRequestedAt: null,
    photoReceivedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function recordNutritionLabelCandidates(input: {
  userId: number;
  mealId?: number | null;
  sourceText?: string | null;
  items: MealDraftItem[];
  itemIndexes?: number[];
}) {
  const created: NutritionLabelCandidate[] = [];
  for (const [arrayIndex, item] of input.items.entries()) {
    const itemIndex = input.itemIndexes?.[arrayIndex] ?? arrayIndex;
    const candidate = toCandidate({ ...input, item, itemIndex });
    if (!candidate) continue;
    const existing = (await listCandidateArtifacts()).find(
      artifact => artifact.value.identityKey === candidate.identityKey
    );
    const next = existing
      ? {
          ...existing.value,
          ...candidate,
          status: (existing.value.status === "published"
            ? "published"
            : "pending_review") as NutritionLabelCandidateStatus,
          publishedCatalogId: existing.value.publishedCatalogId ?? null,
          photoRequestedAt: existing.value.photoRequestedAt ?? null,
          createdAt: existing.value.createdAt,
          updatedAt: nowIso(),
        }
      : candidate;
    await persistCandidate(
      next,
      existing ? new Date(existing.value.createdAt) : undefined
    );
    const artifact =
      existing ??
      (await findCandidateArtifactByIdentity(candidate.identityKey));
    await recordCandidateAudit({
      candidateId: artifact?.id ?? 0,
      identityKey: candidate.identityKey,
      action: existing ? "photo_received" : "created",
      actorUserId: input.userId,
      detail: existing
        ? "Evidência de rótulo recebida novamente; candidato atualizado sem alterar o catálogo ativo."
        : "Evidência nutricional de rótulo registrada como candidata pendente de revisão administrativa.",
    });
    created.push(next);
  }
  return created;
}

async function findCandidateArtifactByIdentity(identityKey: string) {
  return (
    (await listCandidateArtifacts()).find(
      candidate => candidate.value.identityKey === identityKey
    ) ?? null
  );
}

export async function listNutritionLabelCandidates(
  input: {
    status?: NutritionLabelCandidateStatus;
    userId?: number;
  } = {}
) {
  const artifacts = await listCandidateArtifacts();
  return artifacts
    .filter(artifact => !input.status || artifact.value.status === input.status)
    .filter(
      artifact => input.userId == null || artifact.value.userId === input.userId
    )
    .sort((left, right) =>
      right.value.updatedAt.localeCompare(left.value.updatedAt)
    )
    .map(artifact => ({ id: artifact.id, ...artifact.value }));
}

export async function updateCandidate(
  artifact: CandidateArtifact,
  patch: Partial<NutritionLabelCandidate>
) {
  const next = {
    ...artifact.value,
    ...patch,
    updatedAt: nowIso(),
  };
  await persistCandidate(next, new Date(artifact.value.createdAt));
  return { id: artifact.id, ...next };
}

function createCatalogInput(
  candidate: NutritionLabelCandidate
): NutritionResearchUpsertInput {
  const catalogIdentityKey = `nutrition-label-v1:${candidate.identityKey}`;
  return {
    researchIdentityKey: catalogIdentityKey,
    barcode: candidate.barcode ?? null,
    slug: `nutrition-label-${candidate.identityKey.slice(0, 48)}`,
    name: candidate.canonicalName || candidate.foodName,
    aliases: JSON.stringify(
      [
        candidate.foodName,
        candidate.canonicalName,
        ...(candidate.brand ? [candidate.brand] : []),
      ].filter(Boolean)
    ),
    brandName: candidate.brand,
    productVariant: candidate.productVariant,
    servingLabel: candidate.servingLabel,
    servingUnit: candidate.servingUnit,
    gramsPerServing: candidate.gramsPerServing,
    calories: candidate.calories,
    protein: candidate.protein,
    carbs: candidate.carbs,
    fat: candidate.fat,
    fiber: candidate.fiber ?? null,
    sourceUrls: JSON.stringify(candidate.sourceUrls),
    sourceEvidence: candidate.sourceEvidence,
    sourceVerifiedAt: new Date(candidate.sourceVerifiedAt),
    sourceConfidence: Math.max(candidate.sourceConfidence, 0.85),
    dataSource: "nutrition_label",
  };
}

export async function publishNutritionLabelCandidate(input: {
  candidateId: number;
  adminUserId: number;
  repository?: FoodCatalogRepository;
}) {
  const artifact = await findCandidateArtifact(input.candidateId);
  if (!artifact) throw new Error("Candidato nutricional não encontrado.");
  if (
    artifact.value.status === "rejected" ||
    artifact.value.status === "rolled_back"
  ) {
    throw new Error("Candidato nutricional encerrado não pode ser publicado.");
  }
  const repository =
    input.repository ??
    createDrizzleFoodCatalogRepository({
      getDb,
      onWarning: logPersistenceWarning,
    });
  const publishedCatalogId = await repository.upsertResearchedNutrition?.(
    createCatalogInput(artifact.value)
  );
  if (!publishedCatalogId)
    throw new Error("Catálogo global indisponível; candidato não publicado.");
  await refreshCatalogCache();
  const updated = await updateCandidate(artifact, {
    status: "published",
    publishedCatalogId,
  });
  await recordCandidateAudit({
    candidateId: artifact.id,
    identityKey: artifact.value.identityKey,
    action: "published",
    actorUserId: input.adminUserId,
    detail: `Candidato publicado no catálogo global como foodCatalog=${publishedCatalogId}.`,
  });
  logInferenceEvent({
    userId: artifact.value.userId,
    origin: "web",
    status: "success",
    eventType: "nutrition_label_candidate.published",
    detail: `Candidato ${artifact.id} publicado globalmente pelo administrador ${input.adminUserId}.`,
  });
  return updated;
}

export async function rejectNutritionLabelCandidate(input: {
  candidateId: number;
  adminUserId: number;
  reason?: string;
}) {
  const artifact = await findCandidateArtifact(input.candidateId);
  if (!artifact) throw new Error("Candidato nutricional não encontrado.");
  const updated = await updateCandidate(artifact, { status: "rejected" });
  await recordCandidateAudit({
    candidateId: artifact.id,
    identityKey: artifact.value.identityKey,
    action: "rejected",
    actorUserId: input.adminUserId,
    detail:
      input.reason?.trim() || "Candidato rejeitado na revisão administrativa.",
  });
  return updated;
}

export async function rollbackNutritionLabelCandidate(input: {
  candidateId: number;
  adminUserId: number;
  repository?: FoodCatalogRepository;
}) {
  const artifact = await findCandidateArtifact(input.candidateId);
  if (!artifact) throw new Error("Candidato nutricional não encontrado.");
  if (!artifact.value.publishedCatalogId)
    throw new Error("Candidato ainda não possui publicação para rollback.");
  const repository =
    input.repository ??
    createDrizzleFoodCatalogRepository({
      getDb,
      onWarning: logPersistenceWarning,
    });
  const rolledBack = await repository.deprecateById?.(
    artifact.value.publishedCatalogId
  );
  if (!rolledBack)
    throw new Error("Entrada publicada não encontrada para rollback.");
  await refreshCatalogCache();
  const updated = await updateCandidate(artifact, { status: "rolled_back" });
  await recordCandidateAudit({
    candidateId: artifact.id,
    identityKey: artifact.value.identityKey,
    action: "rolled_back",
    actorUserId: input.adminUserId,
    detail: `Publicação foodCatalog=${artifact.value.publishedCatalogId} desativada por rollback.`,
  });
  return updated;
}

export async function requestNutritionLabelCandidatePhoto(input: {
  candidateId: number;
  adminUserId: number;
}) {
  const artifact = await findCandidateArtifact(input.candidateId);
  if (!artifact) throw new Error("Candidato nutricional não encontrado.");
  if (!artifact.value.userId)
    throw new Error("Candidato sem usuário de origem para solicitar foto.");
  const superseded = await supersedeActiveWhatsappPendingOperations(
    artifact.value.userId
  );
  if (!superseded)
    throw new Error(
      "Não foi possível substituir a pendência anterior do WhatsApp."
    );

  const target: NutritionLabelPhotoRequestTarget = {
    kind: "nutrition_label_photo_request",
    candidateId: artifact.id,
    identityKey: artifact.value.identityKey,
    originalFoodName: artifact.value.foodName,
    originalCanonicalName: artifact.value.canonicalName,
    originalBrand: artifact.value.brand,
    originalProductVariant: artifact.value.productVariant,
    originalBarcode: artifact.value.barcode ?? null,
    originalQuantity: 1,
    originalUnit: artifact.value.servingUnit,
    originalEstimatedGrams: artifact.value.gramsPerServing,
    sourceMessageId: null,
    instructionText: `Envie uma foto legível do rótulo de ${artifact.value.foodName}, mostrando a tabela nutricional e a porção. Não registre o alimento novamente; esta foto será usada para corrigir os nutrientes provisórios.`,
    actions: [{ id: "cancel", title: "Cancelar" }],
  };
  const pending = await pendingOperationRepository.createPendingOperation({
    userId: artifact.value.userId,
    type: NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
    origin: NUTRITION_LABEL_PHOTO_REQUEST_ORIGIN,
    target,
    ttlMs: NUTRITION_LABEL_PHOTO_REQUEST_TTL_MS,
  });
  if (!pending)
    throw new Error(
      "Não foi possível persistir a solicitação de foto antes do envio."
    );

  const connection = await getUserWhatsappConnection(artifact.value.userId);
  if (!connection?.phoneNumber)
    throw new Error("Usuário sem conexão WhatsApp ativa.");
  const delivery = await sendWhatsAppLogicalReply(
    connection.phoneNumber,
    textReply(target.instructionText),
    undefined,
    { origin: NUTRITION_LABEL_PHOTO_REQUEST_ORIGIN }
  );
  if (!delivery.ok)
    throw new Error(
      delivery.sends[0]?.detail || "Falha ao solicitar a foto pelo WhatsApp."
    );

  const updated = await updateCandidate(artifact, {
    status: "photo_requested",
    photoRequestedAt: nowIso(),
  });
  await recordCandidateAudit({
    candidateId: artifact.id,
    identityKey: artifact.value.identityKey,
    action: "photo_requested",
    actorUserId: input.adminUserId,
    detail:
      "Solicitação de foto legível enviada pelo WhatsApp e pendência persistida antes do outbound.",
  });
  return {
    candidate: updated,
    pendingOperationId: pending.id,
    delivery: delivery.sends[0]?.detail ?? "Mensagem enviada pelo WhatsApp.",
  };
}

export async function createProvisionalNutritionLabelPhotoRequests(input: {
  userId: number;
  mealId: number;
  items: MealDraftItem[];
  sourceMessageId?: string | null;
}) {
  const created: number[] = [];
  for (const [itemIndex, item] of input.items.entries()) {
    if (
      item.resolution?.nutritionOrigin !== "provisional_estimate" ||
      item.resolution.nutritionVerified !== false
    ) {
      continue;
    }

    let existingOperations: Awaited<
      ReturnType<NonNullable<typeof pendingOperationRepository.listActivePendingOperationsByType>>
    > = [];
    if (pendingOperationRepository.listActivePendingOperationsByType) {
      existingOperations =
        await pendingOperationRepository.listActivePendingOperationsByType(
          input.userId,
          NUTRITION_LABEL_PHOTO_REQUEST_TYPE
        );
    } else if (pendingOperationRepository.getActivePendingOperationByType) {
      const existing =
        await pendingOperationRepository.getActivePendingOperationByType(
          input.userId,
          NUTRITION_LABEL_PHOTO_REQUEST_TYPE
        );
      existingOperations = existing ? [existing] : [];
    }
    const existing = existingOperations.find(operation => {
      const target = operation.target as Partial<NutritionLabelPhotoRequestTarget> | null;
      return target?.mealId === input.mealId && target.itemIndex === itemIndex;
    });
    if (
      existing &&
      isNutritionLabelPhotoRequestTarget(existing.target)
    ) {
      created.push(existing.id);
      continue;
    }

    const target: NutritionLabelPhotoRequestTarget = {
      kind: "nutrition_label_photo_request",
      mealId: input.mealId,
      itemIndex,
      identityKey: buildCandidateIdentityKey(item),
      originalFoodName: item.foodName,
      originalCanonicalName: item.canonicalName,
      originalBrand: item.brand ?? null,
      originalProductVariant:
        item.productVariant ?? item.resolution?.productVariant ?? null,
      originalBarcode: item.resolution?.barcode ?? null,
      originalQuantity: item.quantity,
      originalUnit: item.unit,
      originalEstimatedGrams: item.estimatedGrams,
      sourceMessageId: input.sourceMessageId ?? null,
      instructionText: `Envie uma foto legível do rótulo de ${item.foodName}, mostrando a tabela nutricional e a porção. Não registre o alimento novamente; esta foto será usada para atualizar os nutrientes provisórios já registrados.`,
      actions: [{ id: "cancel", title: "Cancelar" }],
    };
    const pending = await pendingOperationRepository.createPendingOperation({
      userId: input.userId,
      type: NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
      origin: NUTRITION_LABEL_PHOTO_REQUEST_ORIGIN,
      target,
      ttlMs: NUTRITION_LABEL_PHOTO_REQUEST_TTL_MS,
    });
    if (pending) created.push(pending.id);
  }
  return created;
}

export * from "./nutritionLabelPhotoRequestService";
export * from "./nutritionLabelPhotoClarificationService";
export * from "./nutritionLabelPhotoMutationService";
