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
export const NUTRITION_LABEL_EVIDENCE_KIND = "nutrition_label_evidence";
export const NUTRITION_LABEL_PHOTO_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export type NutritionLabelCandidateStatus =
  | "pending_review"
  | "photo_requested"
  | "photo_received"
  | "processing"
  | "error_retryable"
  | "evidence_unreadable"
  | "identity_conflict"
  | "published"
  | "rejected"
  | "rolled_back";

export type NutritionLabelEvidenceReferenceStatus =
  | "photo_received"
  | "processing"
  | "pending_review"
  | "error_retryable"
  | "evidence_unreadable"
  | "identity_conflict";

export type NutritionLabelEvidenceReference = {
  evidenceHash: string;
  storageKey: string;
  storageUrl?: string | null;
  mimeType: string;
  receivedAt: string;
  status: NutritionLabelEvidenceReferenceStatus;
};

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
  evidenceKind: "label_photo" | "label_url" | "manual_reference";
  extractionMethod: "manual" | "ocr" | "ai_assisted" | "rule_normalized";
  nutritionOriginal: {
    servingLabel: string;
    servingUnit: string;
    grams: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number | null;
  };
  nutritionPer100g: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number | null;
  } | null;
  fieldConfidence: Record<string, number | null>;
  evidenceReference?: NutritionLabelEvidenceReference | null;
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
    | "edited"
    | "photo_requested"
    | "photo_received"
    | "processing"
    | "error_retryable"
    | "evidence_unreadable"
    | "identity_conflict"
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

export type NutritionLabelEvidenceInput = {
  userId: number;
  sourceMessageId: string;
  storageKey: string;
  storageUrl?: string | null;
  mimeType: string;
  originalFileName?: string | null;
};

export async function persistNutritionLabelEvidenceReference(
  input: NutritionLabelEvidenceInput,
  status: NutritionLabelEvidenceReferenceStatus = "photo_received"
) {
  const evidenceHash = createHash("sha256")
    .update(
      [input.userId, input.sourceMessageId, input.storageKey, input.mimeType].join(
        "|"
      )
    )
    .digest("hex");
  const existing = (
    (await listPersistedWhatsappLearningArtifacts<{
      userId: number;
      sourceMessageId: string;
      evidenceHash: string;
      storageKey: string;
      storageUrl?: string | null;
      mimeType: string;
      status: string;
      receivedAt: string;
    }>({
      scope: "global",
      kind: NUTRITION_LABEL_EVIDENCE_KIND,
    })) ?? []
  ).find(artifact => artifact.value.evidenceHash === evidenceHash);
  if (existing?.value.status === "pending_review")
    return existing.value as NutritionLabelEvidenceReference;
  const persisted = await persistWhatsappLearningArtifact({
    scope: "global",
    kind: NUTRITION_LABEL_EVIDENCE_KIND,
    key: evidenceHash,
    value: {
      userId: input.userId,
      sourceMessageId: input.sourceMessageId,
      evidenceHash,
      storageKey: input.storageKey,
      storageUrl: input.storageUrl ?? null,
      mimeType: input.mimeType,
      originalFileName: input.originalFileName ?? null,
      receivedAt: existing?.value.receivedAt ?? nowIso(),
      status,
    },
  });
  return (persisted?.value as NutritionLabelEvidenceReference | undefined) ?? null;
}

export async function findNutritionLabelEvidenceReference(input: {
  userId: number;
  sourceMessageId: string;
}) {
  const artifacts = await listPersistedWhatsappLearningArtifacts<{
    userId: number;
    sourceMessageId: string;
    evidenceHash: string;
    storageKey: string;
    storageUrl?: string | null;
    mimeType: string;
    receivedAt: string;
    status: NutritionLabelEvidenceReferenceStatus;
  }>({
    scope: "global",
    kind: NUTRITION_LABEL_EVIDENCE_KIND,
  });
  const evidence = (artifacts ?? []).find(
    artifact =>
      artifact.value.userId === input.userId &&
      artifact.value.sourceMessageId === input.sourceMessageId
  );
  return evidence?.value ?? null;
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
  const grams = input.item.estimatedGrams;
  const per100 = (value: number) =>
    Number.isFinite(value) && grams > 0 ? (value * 100) / grams : null;
  const extractionMethod =
    input.item.source === "heuristic" ? "ai_assisted" : "manual";
  const evidenceKind = /foto|imagem|whatsapp|arquivo/i.test(sourceEvidence)
    ? "label_photo"
    : sourceUrls.length
      ? "label_url"
      : "manual_reference";
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
    evidenceKind,
    extractionMethod,
    nutritionOriginal: {
      servingLabel: input.item.portionText,
      servingUnit: input.item.unit,
      grams,
      calories: input.item.calories,
      protein: input.item.protein,
      carbs: input.item.carbs,
      fat: input.item.fat,
      fiber: input.item.classification?.fiberGrams ?? null,
    },
    nutritionPer100g: {
      calories: per100(input.item.calories) ?? 0,
      protein: per100(input.item.protein) ?? 0,
      carbs: per100(input.item.carbs) ?? 0,
      fat: per100(input.item.fat) ?? 0,
      fiber: per100(input.item.classification?.fiberGrams ?? Number.NaN),
    },
    fieldConfidence: {
      calories: sourceConfidence,
      protein: sourceConfidence,
      carbs: sourceConfidence,
      fat: sourceConfidence,
      fiber: input.item.classification?.fiberGrams == null ? null : sourceConfidence,
    },
    evidenceReference: null,
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
  evidenceReference?: NutritionLabelEvidenceReference | null;
}) {
  const created: NutritionLabelCandidate[] = [];
  for (const [arrayIndex, item] of input.items.entries()) {
    const itemIndex = input.itemIndexes?.[arrayIndex] ?? arrayIndex;
    const candidateFromItem = toCandidate({ ...input, item, itemIndex });
    if (!candidateFromItem) continue;
    const candidate = input.evidenceReference
      ? { ...candidateFromItem, evidenceReference: input.evidenceReference }
      : candidateFromItem;
    const existing = (await listCandidateArtifacts()).find(
      artifact => artifact.value.identityKey === candidate.identityKey
    );
    const next = existing
      ? {
          ...existing.value,
          ...candidate,
          evidenceReference:
            existing.value.evidenceReference ?? candidate.evidenceReference,
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

export async function listNutritionLabelReviewQueue(input: {
  status?: NutritionLabelCandidateStatus | "all";
  page?: number;
  pageSize?: number;
} = {}) {
  const all = await listNutritionLabelCandidates();
  const activeStatuses: NutritionLabelCandidateStatus[] = [
    "pending_review",
    "photo_requested",
    "photo_received",
    "processing",
    "error_retryable",
    "evidence_unreadable",
    "identity_conflict",
  ];
  const filtered = all.filter(candidate =>
    input.status && input.status !== "all"
      ? candidate.status === input.status
      : activeStatuses.includes(candidate.status)
  );
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    pendingTotal: all.filter(candidate => activeStatuses.includes(candidate.status)).length,
  };
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

export type NutritionLabelCandidateEditInput = {
  candidateId: number;
  adminUserId: number;
  foodName: string;
  canonicalName: string;
  brand: string | null;
  productVariant: string | null;
  barcode: string | null;
  servingLabel: string;
  servingUnit: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
};

export async function updateNutritionLabelCandidate(
  input: NutritionLabelCandidateEditInput
) {
  const artifact = await findCandidateArtifact(input.candidateId);
  if (!artifact) throw new Error("Candidato nutricional não encontrado.");
  const editableStatuses: NutritionLabelCandidateStatus[] = [
    "pending_review",
    "photo_requested",
    "photo_received",
    "error_retryable",
    "evidence_unreadable",
    "identity_conflict",
  ];
  if (!editableStatuses.includes(artifact.value.status)) {
    throw new Error(
      "Este candidato não pode ser editado no estado atual; revise a evidência ou faça rollback antes de continuar."
    );
  }

  const nextValues = {
    foodName: input.foodName.trim(),
    canonicalName: input.canonicalName.trim(),
    brand: input.brand?.trim() || null,
    productVariant: input.productVariant?.trim() || null,
    barcode: input.barcode?.trim() || null,
    servingLabel: input.servingLabel.trim(),
    servingUnit: input.servingUnit.trim(),
    gramsPerServing: input.gramsPerServing,
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    fiber: input.fiber,
  } satisfies Pick<
    NutritionLabelCandidate,
    | "foodName"
    | "canonicalName"
    | "brand"
    | "productVariant"
    | "barcode"
    | "servingLabel"
    | "servingUnit"
    | "gramsPerServing"
    | "calories"
    | "protein"
    | "carbs"
    | "fat"
    | "fiber"
  >;
  const changedFields = Object.entries(nextValues)
    .filter(
      ([field, value]) =>
        artifact.value[field as keyof typeof nextValues] !== value
    )
    .map(([field]) => field);
  const updated = await updateCandidate(artifact, {
    ...nextValues,
    nutritionPer100g: {
      calories: (input.calories * 100) / input.gramsPerServing,
      protein: (input.protein * 100) / input.gramsPerServing,
      carbs: (input.carbs * 100) / input.gramsPerServing,
      fat: (input.fat * 100) / input.gramsPerServing,
      fiber:
        input.fiber == null
          ? null
          : (input.fiber * 100) / input.gramsPerServing,
    },
    extractionMethod: "manual",
    status: "pending_review",
  });
  await recordCandidateAudit({
    candidateId: artifact.id,
    identityKey: artifact.value.identityKey,
    action: "edited",
    actorUserId: input.adminUserId,
    detail: `Candidato editado pelo administrador; campos alterados: ${
      changedFields.length ? changedFields.join(", ") : "nenhum"
    }. Evidência original preservada e publicação continua exigindo aprovação.`,
  });
  return updated;
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
  if (
    !["pending_review", "published"].includes(artifact.value.status) ||
    !artifact.value.sourceEvidence?.trim()
  ) {
    throw new Error(
      "Candidato ainda está em processamento ou sem evidência revisável; publicação bloqueada."
    );
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
    const dedupeKey = `${NUTRITION_LABEL_PHOTO_REQUEST_TYPE}:${input.userId}:${input.mealId}:${itemIndex}`;
    const pending = await pendingOperationRepository.createPendingOperation({
      userId: input.userId,
      type: NUTRITION_LABEL_PHOTO_REQUEST_TYPE,
      origin: NUTRITION_LABEL_PHOTO_REQUEST_ORIGIN,
      target,
      dedupeKey,
      ttlMs: NUTRITION_LABEL_PHOTO_REQUEST_TTL_MS,
    });
    if (pending) created.push(pending.id);
  }
  return created;
}

export * from "./nutritionLabelPhotoRequestService";
export * from "./nutritionLabelPhotoClarificationService";
export * from "./nutritionLabelPhotoMutationService";
