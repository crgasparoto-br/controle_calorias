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

const pendingOperationRepository =
  createDrizzleWhatsAppPendingOperationRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });

function nowIso() {
  return new Date().toISOString();
}

function normalize(value: string | null | undefined) {
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

async function findCandidateArtifact(candidateId: number) {
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

async function recordCandidateAudit(input: {
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

function toCandidate(input: {
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

async function updateCandidate(
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

async function listActiveNutritionLabelOperations(userId: number) {
  const pending = pendingOperationRepository.listActivePendingOperationsByType
    ? await pendingOperationRepository.listActivePendingOperationsByType(
        userId,
        NUTRITION_LABEL_PHOTO_REQUEST_TYPE
      )
    : pendingOperationRepository.getActivePendingOperationByType
      ? [
          await pendingOperationRepository.getActivePendingOperationByType(
            userId,
            NUTRITION_LABEL_PHOTO_REQUEST_TYPE
          ),
        ]
      : [await pendingOperationRepository.getActivePendingOperation(userId)];
  return pending.filter(
    (operation): operation is NonNullable<typeof operation> =>
      Boolean(
        operation &&
          operation.userId === userId &&
          operation.type === NUTRITION_LABEL_PHOTO_REQUEST_TYPE
      )
  );
}

async function listActiveNutritionLabelPhotoRequests(userId: number) {
  return (await listActiveNutritionLabelOperations(userId)).filter(operation =>
    isNutritionLabelPhotoRequestTarget(operation.target)
  );
}

function matchesNutritionLabelPhotoTarget(
  target: NutritionLabelPhotoRequestTarget,
  labelItem?: MealDraftItem
) {
  if (!labelItem) return target.candidateId != null;
  if (target.candidateId != null) return true;
  if (target.identityKey === buildCandidateIdentityKey(labelItem)) return true;
  const targetName = normalize(target.originalFoodName);
  const labelNames = [labelItem.foodName, labelItem.canonicalName]
    .map(normalize)
    .filter(Boolean);
  return labelNames.some(
    name => name.includes(targetName) || targetName.includes(name)
  );
}

export async function claimNutritionLabelPhotoRequest(
  userId: number,
  labelItem?: MealDraftItem
) {
  const requests = await listActiveNutritionLabelPhotoRequests(userId);
  const matching = requests.filter(request =>
    matchesNutritionLabelPhotoTarget(
      request.target as NutritionLabelPhotoRequestTarget,
      labelItem
    )
  );
  const pending =
    matching.length === 1
      ? matching[0]
      : requests.length === 1 &&
          (Boolean(labelItem) ||
            (requests[0].target as NutritionLabelPhotoRequestTarget).candidateId != null)
        ? requests[0]
        : null;
  if (!pending) return null;
  const claimed = await pendingOperationRepository.claimPendingOperation({
    id: pending.id,
    expectedVersion: pending.version,
  });
  return claimed.claimed ? pending : null;
}

export async function hasActiveNutritionLabelPhotoRequest(userId: number) {
  return (await listActiveNutritionLabelPhotoRequests(userId)).length > 0;
}

function roundNutritionValue(value: number) {
  return Math.round(value * 10) / 10;
}

function buildMealItemFromNutritionLabel(
  original: MealDraftItem,
  label: MealDraftItem
): MealDraftItem {
  const originalGrams = Number(original.estimatedGrams);
  const labelGrams = Number(label.estimatedGrams);
  const ratio =
    originalGrams > 0 && labelGrams > 0 ? originalGrams / labelGrams : 1;
  return {
    ...original,
    calories: roundNutritionValue(label.calories * ratio),
    protein: roundNutritionValue(label.protein * ratio),
    carbs: roundNutritionValue(label.carbs * ratio),
    fat: roundNutritionValue(label.fat * ratio),
    confidence: Math.max(original.confidence, label.confidence),
    source: label.source,
    resolution: {
      ...original.resolution,
      nutritionOrigin: "nutrition_label",
      nutritionVerified: true,
      productVariant:
        original.resolution?.productVariant ?? original.productVariant ?? null,
      barcode: original.resolution?.barcode ?? null,
      sourceUrls:
        label.resolution?.sourceUrls ?? original.resolution?.sourceUrls,
      sourceEvidence:
        label.resolution?.sourceEvidence ?? original.resolution?.sourceEvidence,
      sourceVerifiedAt:
        label.resolution?.sourceVerifiedAt ??
        original.resolution?.sourceVerifiedAt,
      sourceConfidence:
        label.resolution?.sourceConfidence ?? label.confidence,
    },
  };
}

export async function applyNutritionLabelPhotoToMeal(input: {
  mealId: number;
  itemIndex: number;
  userId: number;
  item: MealDraftItem;
  expectedIdentityKey?: string | null;
}) {
  const meal = (await listUserMeals(input.userId)).find(
    candidate => candidate.id === input.mealId
  );
  const original = meal?.items?.[input.itemIndex];
  if (!meal || !original) return null;
  if (
    original.resolution?.nutritionOrigin !== "provisional_estimate" ||
    original.resolution.nutritionVerified !== false
  ) {
    return null;
  }
  if (
    input.expectedIdentityKey &&
    buildCandidateIdentityKey(original) !== input.expectedIdentityKey
  ) {
    return null;
  }
  if (
    input.item.resolution?.nutritionOrigin !== "nutrition_label" ||
    input.item.resolution.nutritionVerified !== true ||
    !input.item.resolution.sourceEvidence?.trim() ||
    !Number.isFinite(input.item.estimatedGrams) ||
    input.item.estimatedGrams <= 0
  ) {
    return null;
  }

  const updatedItem = buildMealItemFromNutritionLabel(original, input.item);
  const updatedMeal = await updateUserMeal(
    {
      userId: input.userId,
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      occurredAt: new Date(meal.occurredAt).toISOString(),
      notes: meal.notes,
      items: meal.items.map((item, index) =>
        index === input.itemIndex ? updatedItem : item
      ),
    },
    { logEvent: false }
  );

  await recordNutritionLabelCandidates({
    userId: input.userId,
    mealId: meal.id,
    sourceText: meal.sourceText,
    items: [updatedItem],
    itemIndexes: [input.itemIndex],
  });
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "success",
    eventType: "nutrition_label_photo.meal_item_updated",
    detail: JSON.stringify({
      mealId: input.mealId,
      itemIndex: input.itemIndex,
      correctionOrigin: "nutrition_label",
      previousNutrition: {
        calories: original.calories,
        protein: original.protein,
        carbs: original.carbs,
        fat: original.fat,
      },
      updatedNutrition: {
        calories: updatedItem.calories,
        protein: updatedItem.protein,
        carbs: updatedItem.carbs,
        fat: updatedItem.fat,
      },
      commercialIdentityPreserved: true,
    }),
  });
  return updatedMeal;
}

function nutritionLabelIdentityTokens(value: string | null | undefined) {
  return normalize(value)
    .split(" ")
    .filter(token =>
      token.length >= 3 &&
      !["tipo", "produto", "marca", "porcao"].includes(token)
    );
}

function nutritionLabelTokenOverlap(left: string[], right: string[]) {
  return left.filter(token =>
    right.some(candidate =>
      token === candidate ||
      (token.length >= 4 &&
        candidate.length >= 4 &&
        (token.startsWith(candidate) || candidate.startsWith(token)))
    )
  ).length;
}

function nutritionLabelIdentityScore(
  text: string | null | undefined,
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  const normalizedText = normalize(text);
  if (!normalizedText) return 0;
  let score = 0;
  const brand = normalize(candidate.originalBrand);
  if (brand && normalizedText.includes(brand)) score += 8;
  const canonical = normalize(candidate.originalCanonicalName);
  if (canonical && normalizedText.includes(canonical)) score += 6;
  score += nutritionLabelTokenOverlap(
    nutritionLabelIdentityTokens(normalizedText),
    [
      ...nutritionLabelIdentityTokens(candidate.originalFoodName),
      ...nutritionLabelIdentityTokens(candidate.originalCanonicalName),
    ]
  );
  return score;
}

function nutritionLabelValuesCompatible(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function nutritionLabelCommercialConflict(
  item: MealDraftItem,
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  const brandConflict =
    Boolean(item.brand && candidate.originalBrand) &&
    !nutritionLabelValuesCompatible(item.brand, candidate.originalBrand);
  const variant =
    item.productVariant ?? item.resolution?.productVariant ?? null;
  const variantConflict =
    Boolean(variant && candidate.originalProductVariant) &&
    !nutritionLabelValuesCompatible(
      variant,
      candidate.originalProductVariant
    );
  return brandConflict || variantConflict;
}

function isValidNutritionLabelEvidence(
  item?: MealDraftItem | null
): item is MealDraftItem {
  if (!item) return false;
  return Boolean(
    item.resolution?.nutritionOrigin === "nutrition_label" &&
      item.resolution.nutritionVerified === true &&
      item.resolution.sourceEvidence?.trim() &&
      Number.isFinite(item.estimatedGrams) &&
      item.estimatedGrams > 0 &&
      [item.calories, item.protein, item.carbs, item.fat].every(
        value => Number.isFinite(value) && value >= 0
      )
  );
}

function nutritionLabelCandidateLabel(
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  const brand = candidate.originalBrand?.trim();
  return brand &&
    !normalize(candidate.originalFoodName).includes(normalize(brand))
    ? candidate.originalFoodName + " (" + brand + ")"
    : candidate.originalFoodName;
}

async function buildNutritionLabelClarificationCandidates(
  userId: number,
  requests: Awaited<ReturnType<typeof listActiveNutritionLabelPhotoRequests>>
) {
  const meals = await listUserMeals(userId);
  const candidates: NutritionLabelPhotoClarificationCandidate[] = [];
  for (const request of requests) {
    const target = request.target as NutritionLabelPhotoRequestTarget;
    const meal = Number.isInteger(target.mealId)
      ? meals.find(candidate => candidate.id === target.mealId)
      : null;
    const original =
      meal && Number.isInteger(target.itemIndex)
        ? meal.items?.[target.itemIndex!]
        : null;
    if (
      Number.isInteger(target.mealId) &&
      Number.isInteger(target.itemIndex) &&
      !original
    ) {
      continue;
    }
    candidates.push({
      sourcePendingOperationId: request.id,
      sourceLocked: false,
      candidateId: target.candidateId,
      mealId: target.mealId,
      itemIndex: target.itemIndex,
      identityKey: target.identityKey,
      originalFoodName: target.originalFoodName,
      originalCanonicalName:
        target.originalCanonicalName ??
        original?.canonicalName ??
        target.originalFoodName,
      originalBrand: target.originalBrand ?? original?.brand ?? null,
      originalProductVariant:
        target.originalProductVariant ??
        original?.productVariant ??
        original?.resolution?.productVariant ??
        null,
    });
  }
  return candidates;
}

async function createNutritionLabelPhotoClarification(input: {
  userId: number;
  candidates: NutritionLabelPhotoClarificationCandidate[];
  item: MealDraftItem;
  sourceText?: string | null;
  sourceMessageId?: string | null;
  conflict?: boolean;
  retry?: boolean;
}) {
  const labels = input.candidates.map(nutritionLabelCandidateLabel);
  const instructionText =
    input.candidates.length > 1
      ? "Recebi o rótulo, mas há mais de um item provisório possível. Qual item devo atualizar? " +
        labels.map((label, index) => String(index + 1) + ". " + label).join(" | ") +
        ". Responda com o número ou o nome do item. A foto ficará guardada até a escolha."
      : input.retry
        ? "Não consegui concluir a atualização de " +
          labels[0] +
          ". A foto do rótulo continua guardada. Confirme o nome ou a marca para tentar novamente, ou envie CANCELAR."
        : input.conflict
          ? "O rótulo recebido conflita com a identidade já confirmada de " +
            labels[0] +
            ". Não vou trocar a marca ou a variante automaticamente. Confirme o nome ou a marca correta, ou envie CANCELAR."
          : "Recebi o rótulo, mas a identidade não ficou inequívoca. A foto continua guardada. Confirme que ele pertence a " +
            labels[0] +
            ", ou envie CANCELAR.";
  const target: NutritionLabelPhotoClarificationTarget = {
    kind: "nutrition_label_photo_clarification",
    candidates: input.candidates,
    evidenceItem: input.item,
    sourceText: input.sourceText ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    instructionText,
    actions: [{ id: "cancel", title: "Cancelar" }],
  };
  const pending = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
    origin: NUTRITION_LABEL_PHOTO_REQUEST_ORIGIN,
    target,
    ttlMs: NUTRITION_LABEL_PHOTO_REQUEST_TTL_MS,
  });
  return pending ? { pending, target } : null;
}

async function claimNutritionLabelClarificationSource(
  userId: number,
  candidate: NutritionLabelPhotoClarificationCandidate
) {
  if (candidate.sourceLocked) return true;
  if (!candidate.sourcePendingOperationId) return false;
  const source = await pendingOperationRepository.getPendingOperationById(
    candidate.sourcePendingOperationId
  );
  if (
    !source ||
    source.userId !== userId ||
    source.state !== "active" ||
    source.type !== NUTRITION_LABEL_PHOTO_REQUEST_TYPE ||
    new Date(source.expiresAt).getTime() < Date.now() ||
    !isNutritionLabelPhotoRequestTarget(source.target)
  ) {
    return false;
  }
  const claimed = await pendingOperationRepository.claimPendingOperation({
    id: source.id,
    expectedVersion: source.version,
  });
  return claimed.claimed;
}

async function applyNutritionLabelClarificationCandidate(input: {
  userId: number;
  candidate: NutritionLabelPhotoClarificationCandidate;
  item: MealDraftItem;
  sourceText?: string | null;
}) {
  if (
    Number.isInteger(input.candidate.mealId) &&
    Number.isInteger(input.candidate.itemIndex)
  ) {
    return applyNutritionLabelPhotoToMeal({
      mealId: input.candidate.mealId!,
      itemIndex: input.candidate.itemIndex!,
      userId: input.userId,
      item: input.item,
      expectedIdentityKey: input.candidate.identityKey,
    });
  }
  if (Number.isInteger(input.candidate.candidateId)) {
    return applyNutritionLabelPhotoToCandidate({
      candidateId: input.candidate.candidateId!,
      userId: input.userId,
      sourceText: input.sourceText,
      item: input.item,
    });
  }
  return null;
}

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
    if (index >= 0 && index < target.candidates.length)
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
  )
    return "select:" + String(matches[0].index);
  if (
    target.candidates.length === 1 &&
    ["sim", "confirmar", "confirmo"].includes(normalizedText)
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
        [input.item.foodName, input.item.canonicalName, input.item.brand]
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
      item: input.item,
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

  const conflict = nutritionLabelCommercialConflict(input.item, selected);
  const explicitOriginalIdentity =
    nutritionLabelIdentityScore(input.captionText, selected) > 0 ||
    nutritionLabelIdentityScore(
      [input.item.foodName, input.item.canonicalName, input.item.brand]
        .filter(Boolean)
        .join(" "),
      selected
    ) > 0;
  if (conflict || !explicitOriginalIdentity) {
    const clarification = await createNutritionLabelPhotoClarification({
      userId: input.userId,
      candidates: [selected],
      item: input.item,
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
      item: input.item,
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
      item: input.item,
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
