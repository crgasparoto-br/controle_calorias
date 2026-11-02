/**
 * #1308 / D1: contract-level entrypoint for the Food Intelligence Resolver V2.
 *
 * An entrypoint supplies evidence and an already-authorised MealOperation. It
 * never owns identity, nutrition, persistence, or the user's meal destination.
 * This service is deliberately write-free: the V1 DTO cannot yet represent a
 * V2 decision faithfully (§21.1). A native V2 transaction adapter is required
 * before serving these decisions in production.
 */
import { comprehendFoodLanguage, type LinguisticLexiconStore } from "./linguisticComprehension";
import { resolveFoodObservation, type FoodResolverContext } from "./resolver";
import type { FoodKnowledgeStore } from "./knowledgeRead";
import {
  parseFoodObservation, parseFoodOperationEnvelope, parseFoodResolutionDecision,
  type FoodObservation, type FoodOperationEnvelope, type FoodResolutionDecision,
} from "./schemas";

export const FOOD_D1_ENTRYPOINTS = [
  "text", "audio_transcript", "addition", "edit", "plate_image",
  "packaging", "nutrition_label", "continuation", "simulator",
] as const;
export type FoodD1Entrypoint = (typeof FOOD_D1_ENTRYPOINTS)[number];

/** Only an authorised transcription/OCR boundary may supply source text. */
export type FoodD1Evidence =
  | {
      kind: "surface";
      modality: "text" | "audio_transcript" | "image";
      rawText: string;
      sourceRef: string;
      imageRegionRole?: "front_identity" | "caption";
      transcriptionConfidence?: number | null;
    }
  | { kind: "structured"; observations: readonly FoodObservation[] };

export type FoodD1Target = {
  observationId: string;
  /** Null only for a deferred sibling not yet written in a pinned operation. */
  mealItemId: string | null;
  /** A prior structured decision, not a re-parsed reply or V1 semanticContract. */
  previousDecision: FoodResolutionDecision | null;
};

export type FoodD1Request = {
  /** The authenticated user supplied by the server, not a claim from the client. */
  authenticatedUserId: number;
  entrypoint: FoodD1Entrypoint;
  envelope: FoodOperationEnvelope;
  evidence: FoodD1Evidence;
  targets?: readonly FoodD1Target[];
  now?: Date;
};

export type FoodD1ItemResult = {
  observationId: string;
  /** Null means create/add; non-null means update that exact physical item. */
  mealItemId: string | null;
  decision: FoodResolutionDecision;
  disposition: "ready" | "deferred" | "rejected";
  /** Stable, structured failure causes; never fabricate nutrition or food ID. */
  reasonCodes: readonly string[];
};

export type FoodD1Result = {
  schemaVersion: 2;
  operationKey: string;
  traceId: string;
  entrypoint: FoodD1Entrypoint;
  /** This is a dry decision plan, not evidence of committed meal writes. */
  committed: false;
  items: FoodD1ItemResult[];
  registeredCount: 0;
  readyCount: number;
  skippedCount: number;
};

export type FoodD1Dependencies = {
  lexicon: LinguisticLexiconStore;
  knowledge: FoodKnowledgeStore;
  /** Source authorization belongs to the authenticated channel boundary. */
  authorizeEvidence: (request: {
    ownerUserId: number; entrypoint: FoodD1Entrypoint; evidence: FoodD1Evidence;
  }) => Promise<boolean>;
  /** A physical item ID must be owned by this user before any edit/label. */
  authorizeExistingItem: (request: {
    ownerUserId: number; mealItemId: string;
  }) => Promise<boolean>;
};

/** A label and a clarification are bound to an existing item's structured state. */
const CONTINUATIONS = new Set<FoodD1Entrypoint>(["nutrition_label", "continuation"]);
const MUTATIONS = new Set<FoodD1Entrypoint>(["edit", "nutrition_label", "continuation"]);

function validateEnvelope(request: FoodD1Request): FoodOperationEnvelope {
  const parsed = parseFoodOperationEnvelope(request.envelope);
  if (!parsed.ok) throw new Error("invalid-food-d1-envelope:" + parsed.code);
  if (!Number.isSafeInteger(request.authenticatedUserId) ||
      request.authenticatedUserId <= 0 ||
      parsed.value.ownerUserId !== request.authenticatedUserId) {
    throw new Error("food-d1-owner-mismatch");
  }
  if (!FOOD_D1_ENTRYPOINTS.includes(request.entrypoint)) {
    throw new Error("unsupported-food-d1-entrypoint");
  }
  if (request.now && Number.isNaN(request.now.getTime())) {
    throw new Error("invalid-food-d1-time");
  }
  return parsed.value;
}

async function readObservations(
  request: FoodD1Request, envelope: FoodOperationEnvelope, lexicon: LinguisticLexiconStore,
): Promise<FoodObservation[]> {
  if (request.evidence.kind === "structured") {
    const ids = new Set<string>();
    return request.evidence.observations.map(item => {
      const parsed = parseFoodObservation(item);
      if (!parsed.ok) throw new Error("invalid-food-d1-observation:" + parsed.code);
      if (ids.has(parsed.value.observationId)) throw new Error("duplicate-food-d1-observation");
      ids.add(parsed.value.observationId);
      if (parsed.value.lexiconRevision !== envelope.revisions.lexicon) {
        throw new Error("food-d1-lexicon-version-mismatch");
      }
      return parsed.value;
    });
  }

  // Multi-modal fusion must happen as structured, provenance-preserving
  // observations; selecting the first transcript/label would lose evidence.
  if (CONTINUATIONS.has(request.entrypoint)) {
    throw new Error("food-d1-continuation-requires-structured-evidence");
  }
  if (request.entrypoint === "text" && request.evidence.modality !== "text" ||
      request.entrypoint === "audio_transcript" && request.evidence.modality !== "audio_transcript") {
    throw new Error("food-d1-entrypoint-modality-mismatch");
  }
  if (request.evidence.modality === "image" &&
      !request.evidence.imageRegionRole) {
    throw new Error("food-d1-image-requires-authorised-ocr-role");
  }
  if (request.evidence.modality !== "image" && request.evidence.imageRegionRole) {
    throw new Error("food-d1-image-role-on-non-image");
  }
  if (request.entrypoint === "plate_image" &&
      (request.evidence.modality !== "image" || request.evidence.imageRegionRole !== "caption")) {
    throw new Error("food-d1-plate-image-evidence-required");
  }
  if (request.entrypoint === "packaging" &&
      (request.evidence.modality !== "image" || request.evidence.imageRegionRole !== "front_identity")) {
    throw new Error("food-d1-package-identity-required");
  }
  if (!request.evidence.rawText.trim()) throw new Error("food-d1-empty-evidence");
  return comprehendFoodLanguage({
    rawText: request.evidence.rawText,
    sourceRef: request.evidence.sourceRef,
    modality: request.evidence.modality,
    imageRegionRole: request.evidence.imageRegionRole,
    transcriptionConfidence: request.evidence.transcriptionConfidence,
    ownerUserId: envelope.ownerUserId,
    lexiconRevision: envelope.revisions.lexicon,
    locale: "pt-BR",
    now: request.now,
    // S3 cannot be enabled until the corresponding calibrated policy is approved.
  }, lexicon);
}

/**
 * Reuse the same LCL and resolver for all nine entrypoint classes.
 * No V1 result is fed back as observation and no meal is saved here.
 */
export async function resolveFoodD1Entrypoint(
  request: FoodD1Request, deps: FoodD1Dependencies,
): Promise<FoodD1Result> {
  const envelope = validateEnvelope(request);
  let sourceAuthorized = false;
  try {
    sourceAuthorized = await deps.authorizeEvidence({
      ownerUserId: envelope.ownerUserId, entrypoint: request.entrypoint,
      evidence: request.evidence,
    });
  } catch { /* A missing/broken authorization source is a hard stop. */ }
  if (!sourceAuthorized) throw new Error("food-d1-evidence-not-authorized");
  const observations = await readObservations(request, envelope, deps.lexicon);
  if (!observations.length) throw new Error("food-d1-no-observations");
  const targetByObservation = new Map<string, FoodD1Target>();
  const usedMealItems = new Set<string>();
  for (const target of request.targets ?? []) {
    const physicalId = target.mealItemId;
    const pendingSibling = request.entrypoint === "continuation" && physicalId === null;
    if (!target.observationId?.trim() ||
        (physicalId !== null && (typeof physicalId !== "string" || !physicalId.trim())) ||
        (physicalId === null && !pendingSibling) ||
        targetByObservation.has(target.observationId) ||
        (physicalId !== null && usedMealItems.has(physicalId))) {
      throw new Error("food-d1-ambiguous-item-target");
    }
    if (physicalId !== null) {
      let ownsTarget = false;
      try {
        ownsTarget = await deps.authorizeExistingItem({
          ownerUserId: envelope.ownerUserId, mealItemId: physicalId,
        });
      } catch { /* An inaccessible item must never be mutated. */ }
      if (!ownsTarget) throw new Error("food-d1-item-not-authorized");
      usedMealItems.add(physicalId);
    } else if (!target.previousDecision) {
      // No physical item exists yet: require the original structured state.
      // The native transaction independently checks the pinned observation.
      throw new Error("food-d1-previous-structured-decision-required");
    }
    targetByObservation.set(target.observationId, target);
  }

  const observationIds = new Set(observations.map(item => item.observationId));
  for (const target of targetByObservation.values()) {
    if (!observationIds.has(target.observationId)) {
      throw new Error("food-d1-target-not-in-operation");
    }
    if (target.previousDecision !== null) {
      const parsed = parseFoodResolutionDecision(target.previousDecision);
      if (!parsed.ok) throw new Error("invalid-food-d1-previous-decision");
      if (parsed.value.ownerUserId !== envelope.ownerUserId ||
          parsed.value.traceId !== envelope.traceId ||
          !parsed.value.observationIds.includes(target.observationId)) {
        throw new Error("food-d1-previous-decision-scope-mismatch");
      }
    }
  }
  if (!MUTATIONS.has(request.entrypoint) && targetByObservation.size > 0) {
    throw new Error("food-d1-addition-must-not-update-existing-item");
  }
  if (MUTATIONS.has(request.entrypoint) &&
      observations.some(item => !targetByObservation.has(item.observationId))) {
    throw new Error("food-d1-existing-item-target-required");
  }
  if (CONTINUATIONS.has(request.entrypoint) &&
      observations.some(item => targetByObservation.get(item.observationId)?.previousDecision === null)) {
    throw new Error("food-d1-previous-structured-decision-required");
  }

  const context: Omit<FoodResolverContext, "previousDecision"> = {
    traceId: envelope.traceId,
    userId: envelope.ownerUserId,
    knowledgeRevision: envelope.revisions.knowledge,
    policyVersion: envelope.revisions.policy,
    resolverVersion: envelope.revisions.resolver,
    now: request.now,
  };
  // Each observation owns one result. A failed or ambiguous sibling never
  // disappears from the response nor causes an implicit partial meal write.
  const items: FoodD1ItemResult[] = [];
  for (const observation of observations) {
    const target = targetByObservation.get(observation.observationId);
    const decision = await resolveFoodObservation(observation, {
      ...context, previousDecision: target?.previousDecision ?? undefined,
    }, deps.knowledge);
    // OCR by itself is not a verified nutritional label. A label without
    // independently sourced, verified nutrient facts cannot overwrite the
    // physical item with old or fabricated macros. An identity mismatch also
    // pauses the update rather than changing a different item silently.
    const previousIdentity = target?.previousDecision?.identity;
    const labelIdentityChanged = request.entrypoint === "nutrition_label" &&
      previousIdentity !== undefined && (
        previousIdentity.foodEntityId !== null &&
        decision.identity.foodEntityId !== previousIdentity.foodEntityId ||
        previousIdentity.variantId !== null &&
        decision.identity.variantId !== previousIdentity.variantId
      );
    const labelSourceVerified = observation.evidence.some(evidence =>
      evidence.field.startsWith("nutrition.") &&
      evidence.origin === "nutrition_label" &&
      evidence.verified && evidence.sourceId !== null);
    const labelBlocked = request.entrypoint === "nutrition_label" &&
      (labelIdentityChanged || !labelSourceVerified);
    const disposition: FoodD1ItemResult["disposition"] =
      decision.nextAction === "reject" ? "rejected" :
      labelBlocked ? "deferred" :
      decision.status === "resolved" && decision.nutrition.consumed !== null
        ? "ready" : "deferred";
    items.push({
      observationId: observation.observationId,
      mealItemId: target?.mealItemId ?? null,
      decision, disposition,
      reasonCodes: labelBlocked
        ? [...decision.reasonCodes,
          ...(labelIdentityChanged ? ["label_identity_mismatch"] : []),
          ...(!labelSourceVerified ? ["label_evidence_unverified"] : [])]
        : decision.reasonCodes,
    });
  }
  return {
    schemaVersion: 2,
    operationKey: envelope.idempotencyKey,
    traceId: envelope.traceId,
    entrypoint: request.entrypoint,
    committed: false,
    items,
    registeredCount: 0,
    readyCount: items.filter(item => item.disposition === "ready").length,
    skippedCount: items.filter(item => item.disposition !== "ready").length,
  };
}
