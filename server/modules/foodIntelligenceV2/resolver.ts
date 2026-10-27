/**
 * #1305 — Food Intelligence Resolver V2, núcleo de domínio (sem cutover).
 *
 * Consome FoodObservation validada e conhecimento governado #1302.
 * Não interpreta MealOperation, não grava refeições, não faz matching fuzzy
 * não calibrado (#1306) e não promove evidência externa a conhecimento verificado.
 */
import { createHash } from "node:crypto";
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import { FOOD_QUANTITY_EPSILON, normalizeUnitToken } from "./contracts";
import { canPreserveAcceptedIdentity, discardSupersededDerivedEvidence,
  discardSupersededUserIdentityEvidence, hasConflictingIdentityEvidence } from "./resolutionContinuity";
import { isCurrentKnowledgeValidity } from "./knowledgeValidity";
import { foodPortionSnapshotSchema, isCurrentPortion, portionEvidenceReference, portionConversionEvidenceIds } from "./portionProvenance";
import {
  declaredPhysicalAmount, hasConflictingVerifiedNutritionEvidence,
} from "./nutritionConsistency";
import {
  isNutritionFacts, readThroughGovernedKnowledge,
  type FoodExternalLookup, type FoodKnowledgeStore, type GovernedFoodMatch,
} from "./knowledgeRead";
import {
  parseFoodObservation, parseFoodResolutionDecision,
  type FoodObservation, type FoodResolutionDecision,
  type FoodEvidence,
} from "./schemas";

export interface FoodResolverContext {
  traceId: string;
  userId: number | null;
  knowledgeRevision: string;
  policyVersion: string;
  resolverVersion: string;
  /** Must be a previously validated decision for the same observation/trace. */
  previousDecision?: FoodResolutionDecision;
  now?: Date;
}

/** #1306 will supply a calibrated policy before residual search can decide.
 * This interface is deliberately not invoked by the C2 core. */
export interface ResidualFoodCandidateSearch {
  search(observation: Readonly<FoodObservation>): Promise<readonly unknown[]>;
}

type Quantity = FoodResolutionDecision["quantity"];
type Nutrition = FoodResolutionDecision["nutrition"];
const blankNutrition = (): Nutrition => ({
  profileId: null, sourceId: null, verified: false, provisional: false,
  basis: null, consumed: null, snapshotHash: null, evidenceIds: [],
});
const blankQuantity = (): Quantity => ({
  value: null, unit: null, grams: null, milliliters: null,
  portionId: null, portionSnapshot: null, source: null, measureKind: null, confidence: null, evidenceIds: [],
});

function amount(value: number, unit: string): { basis: "g" | "ml" | "serving"; value: number } | null {
  const physical = declaredPhysicalAmount(value, unit);
  return physical && Number.isFinite(physical.amount) && physical.amount > 0
    ? { basis: physical.basis, value: physical.amount } : null;
}

function makeEvidence(
  observation: FoodObservation, existing: FoodEvidence[], field: FoodEvidence["field"],
  value: number | string, unit: string | null, sourceId: number | null,
  verified: boolean, origin: FoodEvidence["origin"],
  anchor: FoodEvidence["anchor"] = observation.surfaceSpan,
): string {
  const ids = new Set(existing.map(item => item.evidenceId));
  let index = existing.length;
  while (ids.has("r-" + index)) index++;
  const evidenceId = "r-" + index;
  existing.push({
    evidenceId, field, value, unit, sourceId, verified, origin,
    confidence: null, anchor,
  });
  return evidenceId;
}

/** Numeric claims are reconciled by physical dimension, never raw spelling.
 * Household units have no implicit conversion into grams, milliliters or servings. */
function sameDeclaredQuantity(
  leftValue: number, leftUnit: string | null,
  rightValue: number, rightUnit: string | null,
): boolean {
  if (!leftUnit || !rightUnit) return false;
  const left = amount(leftValue, leftUnit);
  const right = amount(rightValue, rightUnit);
  if (left || right) {
    return !!left && !!right && left.basis === right.basis &&
      Math.abs(left.value - right.value) <= FOOD_QUANTITY_EPSILON;
  }
  return normalizeUnitToken(leftUnit) === normalizeUnitToken(rightUnit) &&
    Math.abs(leftValue - rightValue) <= FOOD_QUANTITY_EPSILON;
}

/** Strong numeric evidence cannot be used as provenance for a different quantity.
 * Compare direct value+unit claims and converted physical facts separately;
 * the latter is meaningful only after a governed conversion was performed. */
function hasConflictingQuantityEvidence(quantity: Quantity, evidence: readonly FoodEvidence[]): boolean {
  const verified = evidence.filter(item => item.verified &&
    typeof item.value === "number" && Number.isFinite(item.value));
  const valueClaims = verified.filter(item => item.field === "quantity.value");
  for (const claim of valueClaims) {
    if (quantity.value !== null &&
        !sameDeclaredQuantity(quantity.value, quantity.unit, claim.value as number, claim.unit)) {
      return true;
    }
  }
  for (let i = 1; i < valueClaims.length; i++) {
    if (!sameDeclaredQuantity(valueClaims[0].value as number, valueClaims[0].unit,
        valueClaims[i].value as number, valueClaims[i].unit)) return true;
  }
  for (const [field, physical, unit] of [
    ["quantity.grams", quantity.grams, "g"],
    ["quantity.milliliters", quantity.milliliters, "ml"],
  ] as const) {
    const claims = verified.filter(item => item.field === field);
    for (const claim of claims) {
      if (!sameDeclaredQuantity(claim.value as number, claim.unit, claim.value as number, unit)) {
        return true;
      }
      if (physical !== null && Math.abs(physical - (claim.value as number)) > FOOD_QUANTITY_EPSILON) {
        return true;
      }
    }
    if (claims.some(claim =>
      Math.abs((claim.value as number) - (claims[0].value as number)) > FOOD_QUANTITY_EPSILON)) return true;
  }
  return false;
}

function quantityFromObservation(
  observation: FoodObservation, evidence: FoodEvidence[], match: GovernedFoodMatch | null,
  previous: FoodResolutionDecision | null, now: Date,
): { quantity: Quantity; incompatiblePrevious: boolean } {
  const q = observation.quantityHints;
  const prior = previous?.quantity;
  let quantity = blankQuantity();
  let incompatiblePrevious = false;
  if (prior && (prior.value !== null || prior.grams !== null || prior.milliliters !== null)) {
    // A fresh lookup revalidates the conversion even for a same-ID edited portion.
    quantity = withoutUnconfirmedPortion({ ...prior, evidenceIds: [...prior.evidenceIds] }, previous?.evidence ?? []);
    incompatiblePrevious = q.value !== null && q.unit !== null && prior.value !== null &&
      !sameDeclaredQuantity(prior.value, prior.unit, q.value, q.unit);
  } else if (q.value !== null && q.unit !== null) {
    quantity.value = q.value;
    quantity.unit = q.unit;
    quantity.source = "observation";
    quantity.measureKind = "exact";
    quantity.evidenceIds = observation.evidence.filter(item =>
      item.field.startsWith("quantity.") && item.value !== null).map(item => item.evidenceId);
    const physical = amount(q.value, q.unit);
    if (physical?.basis === "g") quantity.grams = physical.value;
    if (physical?.basis === "ml") quantity.milliliters = physical.value;
    if (quantity.evidenceIds.length === 0) {
      quantity.evidenceIds.push(makeEvidence(observation, evidence, "quantity.value", q.value, q.unit, null, false, "text"));
    }
  }
  const value = quantity.value;
  const unit = quantity.unit;
  if (value !== null && unit !== null && !amount(value, unit) && match && !incompatiblePrevious) {
    const key = normalizeFoodName(unit);
    const eligible = match.portions.flatMap(candidate => {
      const checked = foodPortionSnapshotSchema.safeParse(candidate);
      if (!checked.success) return [];
      const p = checked.data;
      return isCurrentPortion(p, now) && p.variantId === match.variantId &&
        p.foodEntityId === match.foodId &&
        (normalizeFoodName(p.unit) === key || normalizeFoodName(p.label) === key) ? [p] : [];
    });
    if (eligible.length === 1) {
      const portion = eligible[0];
      const grams = value * portion.grams / portion.quantity;
      if (Number.isFinite(grams) && grams > 0) {
        quantity.grams = grams;
        quantity.portionId = portion.portionId;
        quantity.portionSnapshot = portion;
        quantity.source = "governed_portion";
        quantity.measureKind = portion.measureKind;
        quantity.confidence = portion.confidence;
        for (const [field, fact, physicalUnit] of [
          ["quantity.portionId", portion.portionId, null], ["quantity.grams", grams, "g"],
        ] as const) {
          const id = makeEvidence(observation, evidence, field, fact, physicalUnit, portion.sourceId, true, "catalog");
          // A catalog record is not anchored to the user's text span.
          evidence[evidence.length - 1].anchor = {
            sourceRef: portionEvidenceReference(portion), span: null, region: null,
          };
          quantity.evidenceIds.push(id);
        }
      }
    }
  }
  return { quantity, incompatiblePrevious };
}

/** Uma gramatura de porção pertence à variante usada para convertê-la.
 * Com identidade concorrente, só a quantidade expressa pelo usuário sobrevive. */
function withoutUnconfirmedPortion(quantity: Quantity, evidence: readonly FoodEvidence[]): Quantity {
  if (quantity.source !== "governed_portion") return quantity;
  const derivedIds = portionConversionEvidenceIds(quantity, [...evidence]);
  return {
    ...quantity, grams: null, portionId: null, portionSnapshot: null,
    source: "observation", measureKind: "exact", confidence: null,
    evidenceIds: quantity.evidenceIds.filter(id => !derivedIds.has(id)),
  };
}

/** Uma hipótese única pode ser descartada apenas por evidência exata,
 * mesma identidade, atributos e quantidade; S2/S3 que exige clarificação
 * explícita nunca é transformada em decisão por score. */
function soleHypothesisIsRedundant(
  observation: FoodObservation, match: GovernedFoodMatch | null,
): boolean {
  if (observation.alternatives.length !== 1 ||
      observation.unresolvedReason !== null || !match ||
      match.governanceStatus !== "verified" ||
      (match.matchingEvidence !== "exact_variant" && match.matchingEvidence !== "barcode")) return false;
  const original = observation.identityHints;
  const candidate = observation.alternatives[0].identityHints;
  const name = normalizeFoodName(match.variantName);
  if (!name || normalizeFoodName(original.foodName ?? "") !== name ||
      normalizeFoodName(candidate.foodName ?? "") !== name) return false;
  const attributes = (hints: typeof original) => JSON.stringify({
    brand: normalizeFoodName(hints.brand ?? ""),
    barcode: hints.barcode,
    variant: normalizeFoodName(hints.variant ?? ""),
    preparation: hints.preparation.map(normalizeFoodName),
    qualifiers: hints.qualifiers.map(item => [
      normalizeFoodName(item.value), item.attributeCode, item.role,
    ]),
  });
  const quantity = observation.quantityHints;
  const alternativeQuantity = observation.alternatives[0].quantityHints;
  const sameQuantity = quantity.value === null && alternativeQuantity.value === null ||
    quantity.value !== null && alternativeQuantity.value !== null &&
    sameDeclaredQuantity(quantity.value, quantity.unit,
      alternativeQuantity.value, alternativeQuantity.unit);
  return attributes(original) === attributes(candidate) && sameQuantity;
}

function sourceCompatibleWithExplicitAttributes(
  observation: FoodObservation, match: GovernedFoodMatch,
): boolean {
  // #1302 currently returns a governed variant label, not a full materiality
  // proof snapshot. Do not silently drop explicit attributes when a generic
  // name matches. This conservative gate must be replaced by governed
  // variant-attribute compatibility rather than widening fuzzy thresholds.
  // The trusted store must return a binding to the exact asserted commercial identity.
  // A generic-family hit or an unbound exact_variant claim is not SKU evidence.
  const brand = observation.identityHints.brand?.trim();
  const barcode = observation.identityHints.barcode?.trim();
  if ((brand || barcode) && match.matchingEvidence === "generic_family") return false;
  if (brand && (!match.matchedBrand ||
      normalizeFoodName(match.matchedBrand) !== normalizeFoodName(brand))) return false;
  if (barcode && (match.matchingEvidence !== "barcode" ||
      match.matchedBarcode?.trim() !== barcode)) return false;
  const governed = normalizeFoodName(match.variantName);
  const observed = normalizeFoodName(observation.identityHints.foodName ?? "");
  const assertions = [
    observation.identityHints.variant,
    ...observation.identityHints.preparation,
    ...observation.identityHints.qualifiers.map(item => item.value),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  // A partial lexical overlap (e.g. "zero" inside "zero lactose") is not a
  // governed materiality judgment. Until #1302 exposes indexed attributes,
  // require the same complete variant name as well as the explicit assertions.
  return assertions.length === 0 ||
    (observed === governed &&
      assertions.every(value => governed.includes(normalizeFoodName(value))));
}

function snapshot(match: GovernedFoodMatch, quantity: Quantity): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify({
    variantId: match.variantId, profileId: match.profileId,
    matchingEvidence: match.matchingEvidence,
    matchedBrand: match.matchedBrand ?? null, matchedBarcode: match.matchedBarcode ?? null,
    sourceId: match.sourceId, sourceVersion: match.sourceVersion,
    sourceReference: match.sourceReference, nutrition: match.nutrition,
    portion: quantity.portionSnapshot ?? null,
  })).digest("hex");
}

/** Provisional nutrition is never labelled verified, including external/cache candidates. */
function nutritionFromMatch(
  observation: FoodObservation, match: GovernedFoodMatch,
  quantity: Quantity, evidence: FoodEvidence[],
): Nutrition {
  const empty = blankNutrition();
  if (!isNutritionFacts(match.nutrition) ||
      !Number.isSafeInteger(match.profileId) || match.profileId <= 0 ||
      !Number.isSafeInteger(match.sourceId) || match.sourceId <= 0 ||
      !match.sourceVersion.trim() || !match.sourceReference.trim()) return empty;
  const basisUnit = match.nutrition.basisUnit;
  const declared = quantity.value !== null && quantity.unit !== null
    ? amount(quantity.value, quantity.unit) : null;
  const physical = basisUnit === "g" ? quantity.grams :
    basisUnit === "ml" ? quantity.milliliters :
      declared?.basis === "serving" ? declared.value : null;
  if (physical === null || !Number.isFinite(physical) || physical <= 0) return empty;
  const factor = physical / match.nutrition.basisQuantity;
  const values = {
    calories: match.nutrition.caloriesKcal, protein: match.nutrition.proteinG,
    carbs: match.nutrition.carbG, fat: match.nutrition.fatG,
    fiber: null, sugar: null, sodiumMg: null,
  };
  const consumed = {
    calories: values.calories * factor, protein: values.protein * factor,
    carbs: values.carbs * factor, fat: values.fat * factor,
    fiber: null, sugar: null, sodiumMg: null,
  };
  if (![...Object.values(values), ...Object.values(consumed)]
      .every(value => value === null || Number.isFinite(value))) return empty;
  const verified = match.governanceStatus === "verified";
  // A governed nutrient belongs to the selected versioned profile, never the
  // user's text span. The snapshot also binds the exact variant and portion.
  const nutrientAnchor: FoodEvidence["anchor"] = {
    sourceRef: "food-nutrition-profile:" + match.profileId + ":" + snapshot(match, quantity),
    span: null, region: null,
  };
  const evidenceIds = (["calories", "protein", "carbs", "fat"] as const).map(key =>
    makeEvidence(observation, evidence, "nutrition." + key,
      values[key], key === "calories" ? "kcal" : "g",
      match.sourceId, verified, "catalog", nutrientAnchor));
  return {
    profileId: match.profileId, sourceId: match.sourceId,
    verified, provisional: !verified,
    basis: { quantity: match.nutrition.basisQuantity, unit: basisUnit, values },
    consumed, snapshotHash: snapshot(match, quantity), evidenceIds,
  };
}

function sameObservation(previous: FoodResolutionDecision | undefined, context: FoodResolverContext, observation: FoodObservation) {
  if (!previous || !parseFoodResolutionDecision(previous).ok || context.userId === null) return false;
  // Older V2 snapshots may only carry an owner inside knowledgeValidity. If
  // neither binding exists, re-resolve without importing any prior evidence.
  const owner = previous.ownerUserId === undefined
    ? previous.knowledgeValidity?.userId : previous.ownerUserId;
  return owner === context.userId &&
    (previous.knowledgeValidity === undefined || previous.knowledgeValidity.userId === context.userId) &&
    previous.traceId === context.traceId &&
    previous.observationIds.length === 1 && previous.observationIds[0] === observation.observationId;
}

/**
 * Total for valid FoodObservation inputs and operational failures. Unknown,
 * conflicting and offline knowledge produce typed fail-closed decisions.
 * Malformed observations/context are contract errors (never persisted).
 */
export async function resolveFoodObservation(
  observationInput: FoodObservation,
  context: FoodResolverContext,
  store: FoodKnowledgeStore,
  externalLookup?: FoodExternalLookup,
): Promise<FoodResolutionDecision> {
  const parsed = parseFoodObservation(observationInput);
  if (!parsed.ok) throw new TypeError("FoodObservation V2 inválida: " + parsed.code);
  const observation = parsed.value;
  if (!context.traceId?.trim() || !context.knowledgeRevision?.trim() ||
      !context.policyVersion?.trim() || !context.resolverVersion?.trim() ||
      context.userId !== null && (!Number.isSafeInteger(context.userId) || context.userId <= 0)) {
    throw new TypeError("FoodResolverContext inválido");
  }
  const previous = sameObservation(context.previousDecision, context, observation)
    ? context.previousDecision ?? null : null;
  const now = context.now ?? new Date();
  const evidence: FoodEvidence[] = [...observation.evidence];
  if (previous) {
    for (const item of previous.evidence) {
      if (!evidence.some(other => other.evidenceId === item.evidenceId)) evidence.push(item);
    }
    // A verified statement on a new user turn supersedes older user-origin
    // assertions for the same changed field, not independent source proof.
    discardSupersededUserIdentityEvidence(observation, previous, evidence);
  }
  const identity = {
    candidateKey: null as string | null,
    foodEntityId: null as number | null, variantId: null as number | null,
    canonicalName: null as string | null, brand: null as string | null,
    variant: null as string | null, preparation: [] as string[],
    qualifiers: [] as FoodObservation["identityHints"]["qualifiers"],
    barcode: null as string | null, confidence: null as number | null,
    evidenceIds: [] as string[],
  };
  const decision: FoodResolutionDecision = {
    schemaVersion: 2,
    decisionId: previous?.decisionId ?? "resolution:" + createHash("sha256")
      .update(JSON.stringify([context.userId, context.traceId, observation.observationId])).digest("hex"),
    revision: previous ? previous.revision + 1 : 1,
    observationIds: [observation.observationId], traceId: context.traceId,
    ownerUserId: context.userId,
    status: "unknown", nextAction: "clarify", identity,
    quantity: blankQuantity(), nutrition: blankNutrition(), classification: null,
    unresolvedFields: ["identity", "variant", "quantity", "nutrition"],
    reasonCodes: ["unknown_surface"], alternatives: [], evidence,
    knowledgeRevision: context.knowledgeRevision, policyVersion: context.policyVersion,
  };
  const verifiedFoodClaims = evidence.filter(item =>
    item.field === "classification.isFood" && typeof item.value === "boolean" &&
    item.verified && item.unit === null);
  const negative = verifiedFoodClaims.some(item => item.value === false);
  const positive = verifiedFoodClaims.some(item => item.value === true);
  if (negative && positive) {
    // Two independently accepted classifications must not be collapsed into a
    // rejection simply because one of them says this is not food.
    decision.reasonCodes = ["source_conflict"];
  } else if (negative) {
    decision.reasonCodes = ["non_food"];
    decision.nextAction = "reject";
  } else if (observation.locale.status === "unsupported") {
    decision.reasonCodes = ["unsupported_locale"];
  } else if (observation.unresolvedReason === "unreadable_evidence" ||
             observation.unresolvedReason === "image_identity_unresolved") {
    decision.reasonCodes = [observation.unresolvedReason];
  } else {
    // Continuation without a fresh identity assertion must not erase previously
    // accepted identity, nutritional provenance, or quantity. An identity claim
    // in the evidence envelope counts as new only when it differs materially.
    const compatiblePreviousIdentity = previous !== null && canPreserveAcceptedIdentity(observation, previous);
    const fillsMissingQuantity = previous !== null &&
      (previous.quantity.value === null || previous.quantity.unit === null) &&
      observation.quantityHints.value !== null && observation.quantityHints.unit !== null;
    if (previous && previous.nextAction !== "retry" && !fillsMissingQuantity &&
        previous.knowledgeRevision === context.knowledgeRevision &&
        previous.policyVersion === context.policyVersion &&
        isCurrentKnowledgeValidity(previous.knowledgeValidity, now, context.userId, context.resolverVersion) &&
        (!previous.quantity.portionSnapshot || isCurrentPortion(previous.quantity.portionSnapshot, now)) &&
        compatiblePreviousIdentity) {
      const q = observation.quantityHints;
      const prior = previous.quantity;
      const quantityConflict = (q.value !== null && q.unit !== null &&
        prior.value !== null && prior.unit !== null &&
        !sameDeclaredQuantity(prior.value, prior.unit, q.value, q.unit)) ||
        hasConflictingQuantityEvidence(prior, evidence);
      const nutritionConflict = hasConflictingVerifiedNutritionEvidence(previous.nutrition, evidence);
      const conflict = quantityConflict || nutritionConflict;
      const preserved: FoodResolutionDecision = {
        ...previous, ownerUserId: context.userId, revision: previous.revision + 1, evidence,
        status: conflict ? "partially_resolved" : previous.status,
        nextAction: conflict ? "clarify" : previous.nextAction,
        unresolvedFields: conflict
          ? Array.from(new Set([
            ...previous.unresolvedFields,
            ...(quantityConflict ? ["quantity" as const] : []),
            ...(nutritionConflict ? ["nutrition" as const] : []),
          ]))
          : previous.unresolvedFields,
        reasonCodes: conflict
          ? Array.from(new Set([...previous.reasonCodes, "source_conflict" as const]))
          : previous.reasonCodes,
      };
      const checked = parseFoodResolutionDecision(preserved);
      if (checked.ok) return checked.value;
    }
    if (previous) discardSupersededDerivedEvidence(observation, previous, evidence);
    // Repeat the actual governed query (including personal aliases) when the
    // reply contains only a missing field, without guessing a canonical name.
    const acceptedLookup = previous?.evidence.find(item => previous.identity.evidenceIds.includes(item.evidenceId) &&
      item.field === "identity.foodName" && item.verified && item.sourceId === null &&
      (item.origin === "catalog" || item.origin === "memory") && typeof item.value === "string");
    const acceptedName = typeof acceptedLookup?.value === "string"
      ? acceptedLookup.value : previous?.identity.canonicalName;
    const effectiveObservation = compatiblePreviousIdentity && previous ? {
      ...observation,
      identityHints: {
        ...observation.identityHints,
        foodName: observation.identityHints.foodName ?? acceptedName ?? null,
        brand: observation.identityHints.brand ?? previous.identity.brand,
        barcode: observation.identityHints.barcode ?? previous.identity.barcode,
        variant: observation.identityHints.variant ?? previous.identity.variant,
        preparation: observation.identityHints.preparation.length > 0
          ? observation.identityHints.preparation : previous.identity.preparation,
        qualifiers: observation.identityHints.qualifiers.length > 0
          ? observation.identityHints.qualifiers : previous.identity.qualifiers,
      },
    } : observation;
    const request = {
      normalizedName: normalizeFoodName(effectiveObservation.identityHints.foodName ?? ""),
      brand: effectiveObservation.identityHints.brand,
      barcode: effectiveObservation.identityHints.barcode,
      userId: context.userId,
      resolverVersion: context.resolverVersion,
      policyVersion: context.policyVersion,
      now,
    };
    const knowledge = await readThroughGovernedKnowledge(request, store, externalLookup);
    const eligibleMatch = knowledge.kind === "match" &&
      sourceCompatibleWithExplicitAttributes(effectiveObservation, knowledge) ? knowledge : null;
    const conflictingHypotheses = observation.alternatives.length > 0 &&
      !soleHypothesisIsRedundant(observation, eligibleMatch);
    const identityEvidenceConflict = eligibleMatch !== null &&
      hasConflictingIdentityEvidence(effectiveObservation, eligibleMatch, evidence, request.normalizedName,
        compatiblePreviousIdentity && previous?.identity.variantId === eligibleMatch.variantId &&
          previous.identity.foodEntityId === eligibleMatch.foodId ? acceptedName : null);
    // Não usar porção ou perfil de uma identidade ainda concorrente.
    const match = conflictingHypotheses || identityEvidenceConflict ? null : eligibleMatch;
    const incompatibleAttributes = knowledge.kind === "match" && eligibleMatch === null;
    const inferred = quantityFromObservation(observation, evidence, match, previous, now);
    const quantity = conflictingHypotheses || identityEvidenceConflict
      ? withoutUnconfirmedPortion(inferred.quantity, evidence) : inferred.quantity;
    const incompatiblePrevious = inferred.incompatiblePrevious;
    const quantityEvidenceConflict = hasConflictingQuantityEvidence(quantity, evidence);
    decision.quantity = quantity;
    if (quantity.value !== null || quantity.grams !== null || quantity.milliliters !== null) {
      decision.unresolvedFields = decision.unresolvedFields.filter(field => field !== "quantity");
    }
    if (match && Number.isSafeInteger(match.foodId) && match.foodId > 0 &&
        Number.isSafeInteger(match.variantId) && match.variantId > 0 && match.variantName.trim()) {
      identity.foodEntityId = match.foodId;
      identity.variantId = match.variantId;
      identity.candidateKey = "variant:" + match.variantId;
      identity.canonicalName = match.variantName;
      // Preserve the explicit, compatible variant label separately from the
      // full canonical food name so equivalent replies retain the same fact.
      identity.variant = effectiveObservation.identityHints.variant ?? match.variantName;
      identity.brand = request.brand ?? null;
      identity.preparation = effectiveObservation.identityHints.preparation;
      identity.qualifiers = effectiveObservation.identityHints.qualifiers;
      identity.evidenceIds = observation.evidence.filter(item =>
        item.field.startsWith("identity.") || item.field.startsWith("variant.")).map(item => item.evidenceId);
      if (previous?.identity.foodEntityId === match.foodId && previous.identity.variantId === match.variantId) {
        // Reconfirmation of the same governed identity retains independent
        // accepted claims omitted by a quantity-only reply. Superseded derived
        // facts were removed above and cannot be relinked by ID alone.
        const acceptedIds = new Set(previous.identity.evidenceIds);
        for (const item of evidence) {
          if (!acceptedIds.has(item.evidenceId) || identity.evidenceIds.includes(item.evidenceId)) continue;
          const accepted = previous.evidence.find(old => old.evidenceId === item.evidenceId);
          if (accepted && JSON.stringify(accepted) === JSON.stringify(item)) identity.evidenceIds.push(item.evidenceId);
        }
      }
      identity.evidenceIds.push(makeEvidence(observation, evidence, "variant.variantId", match.variantId,
        null, match.sourceId, match.governanceStatus === "verified", "catalog"));
      evidence[evidence.length - 1].anchor = {
        sourceRef: "food-variant:" + match.variantId, span: null, region: null,
      };
      if (match.governanceStatus === "verified" && request.normalizedName) {
        // Retain the surface accepted by this governed lookup (including a
        // family name accompanying a barcode), not just explicit aliases.
        // Identity acceptance is not attributed to the nutrition source.
        identity.evidenceIds.push(makeEvidence(observation, evidence, "identity.foodName",
          request.normalizedName, null, null, true,
          match.matchingEvidence === "personal_alias" ? "memory" : "catalog"));
        evidence[evidence.length - 1].anchor = {
          sourceRef: "food-lookup:" + decision.decisionId, span: null, region: null,
        };
      }
      if (request.barcode != null) {
        identity.barcode = request.barcode;
        identity.evidenceIds.push(makeEvidence(observation, evidence, "identity.barcode",
          identity.barcode, null, null, false, "barcode"));
      }
      decision.unresolvedFields = decision.unresolvedFields.filter(field => field !== "identity" && field !== "variant");
      if (isCurrentKnowledgeValidity(match.knowledgeValidity, now, context.userId, context.resolverVersion)) {
        decision.knowledgeValidity = match.knowledgeValidity;
      }
      // A provisional governed profile is not yet an authorized estimate:
      // #1306 must calibrate the policy by family before it is usable.
      decision.nutrition = match.governanceStatus === "verified" &&
        !incompatiblePrevious && !quantityEvidenceConflict
        ? nutritionFromMatch(observation, match, quantity, evidence)
        : blankNutrition();
      const nutritionEvidenceConflict =
        hasConflictingVerifiedNutritionEvidence(decision.nutrition, evidence);
      if (nutritionEvidenceConflict) decision.nutrition = blankNutrition();
      if (decision.nutrition.consumed !== null) {
        decision.unresolvedFields = decision.unresolvedFields.filter(field => field !== "nutrition");
      }
      if (incompatiblePrevious || quantityEvidenceConflict || nutritionEvidenceConflict) {
        decision.unresolvedFields = Array.from(new Set([
          ...decision.unresolvedFields,
          ...(incompatiblePrevious || quantityEvidenceConflict ? ["quantity" as const] : []),
          "nutrition" as const,
        ]));
        decision.reasonCodes = ["source_conflict"];
      } else if (match.governanceStatus !== "verified") {
        decision.reasonCodes = ["policy_not_calibrated"];
      } else if (decision.unresolvedFields.includes("quantity")) {
        decision.reasonCodes = ["quantity_missing"];
      } else if (decision.unresolvedFields.includes("nutrition")) {
        decision.reasonCodes = ["quantity_conversion_unproven"];
      } else {
        decision.reasonCodes = [];
      }
      decision.status = decision.unresolvedFields.length === 0 ? "resolved" : "partially_resolved";
      decision.nextAction = decision.status === "resolved" ? "propose" : "clarify";
    } else if (identityEvidenceConflict) {
      decision.reasonCodes = ["source_conflict"];
    } else if (quantityEvidenceConflict || incompatiblePrevious) {
      decision.reasonCodes = ["source_conflict"];
      decision.unresolvedFields = Array.from(new Set([...decision.unresolvedFields, "quantity"]));
    } else if (incompatibleAttributes) {
      decision.reasonCodes = ["brand_variant_unresolved"];
    } else if (knowledge.kind === "unavailable") {
      decision.reasonCodes = [knowledge.reason === "provider_unavailable" ?
        "provider_unavailable" : "context_unavailable"];
      decision.nextAction = "retry";
      if (previous && compatiblePreviousIdentity &&
          previous.knowledgeRevision === context.knowledgeRevision &&
          previous.policyVersion === context.policyVersion &&
          isCurrentKnowledgeValidity(previous.knowledgeValidity, now, context.userId, context.resolverVersion)) {
        const accepted = previous.evidence.filter(item => previous.identity.evidenceIds.includes(item.evidenceId));
        // Preserve proved identity while a newly supplied quantity still needs
        // a profile read. An ID collision must not relabel different evidence.
        if (accepted.every(item => !evidence.some(current => current.evidenceId === item.evidenceId &&
            JSON.stringify(current) !== JSON.stringify(item)))) {
          for (const item of accepted) {
            if (!evidence.some(current => current.evidenceId === item.evidenceId)) evidence.push(item);
          }
          decision.identity = { ...previous.identity, evidenceIds: [...previous.identity.evidenceIds] };
          decision.status = "partially_resolved";
          decision.unresolvedFields = decision.unresolvedFields.filter(field => field !== "identity" && field !== "variant");
          decision.knowledgeValidity = previous.knowledgeValidity;
        }
      }
    } else if (knowledge.kind === "conflict") {
      decision.reasonCodes = ["source_conflict"];
    } else if (knowledge.kind === "provisional") {
      // A candidate without governed identity is not a completed SKU/food;
      // source attribution alone does not permit registration.
      decision.reasonCodes = [observation.identityHints.brand || observation.identityHints.barcode ?
        "commercial_identity_unverified" : "policy_not_calibrated"];
    } else if (knowledge.kind === "miss" && knowledge.reason === "incompatible_evidence") {
      decision.reasonCodes = ["brand_variant_unresolved"];
    } else if (knowledge.kind === "miss" && knowledge.reason === "no_governed_profile") {
      decision.reasonCodes = ["commercial_nutrition_unverified"];
    }
    // Competing, independently anchored observation hypotheses cannot be
    // silently discarded even when a candidate lookup yielded a single match.
    const identitySurfaceEvidence = observation.evidence.filter(item =>
      (item.field.startsWith("identity.") || item.field.startsWith("variant.")) &&
      item.value !== null).map(item => item.evidenceId);
    // LCL S2 ambiguity can carry multiple hypotheses with the original surface
    // evidence rather than a separate evidenceId for each hypothesis. Never
    // drop such competing meanings just because their per-hypothesis list is
    // empty; link them to the observed surface or fail closed without a choice.
    const alternatives = observation.alternatives
      .map(item => ({
        candidateKey: item.hypothesisId,
        foodEntityId: null, variantId: null,
        name: item.identityHints.foodName ?? "",
        brand: item.identityHints.brand, variant: item.identityHints.variant,
        preparation: item.identityHints.preparation,
        qualifiers: item.identityHints.qualifiers,
        evidenceIds: item.evidenceIds.length > 0 ? item.evidenceIds : identitySurfaceEvidence,
        confidence: item.confidence,
      })).filter(item => item.name.length > 0 && item.evidenceIds.length > 0);
    if (conflictingHypotheses && alternatives.length < 2) {
      decision.status = "unknown";
      decision.nextAction = "clarify";
      decision.alternatives = alternatives;
      decision.reasonCodes = ["source_conflict"];
      decision.unresolvedFields = quantity.value === null && quantity.grams === null &&
        quantity.milliliters === null
        ? ["identity", "variant", "quantity", "nutrition"]
        : ["identity", "variant", "nutrition"];
      decision.identity = {
        candidateKey: null, foodEntityId: null, variantId: null,
        canonicalName: null, brand: null, variant: null, preparation: [],
        qualifiers: [], barcode: null, confidence: null, evidenceIds: [],
      };
      decision.nutrition = blankNutrition();
    } else if (conflictingHypotheses && alternatives.length >= 2) {
      decision.status = "ambiguous";
      decision.nextAction = "clarify";
      decision.alternatives = alternatives;
      decision.reasonCodes = ["source_conflict"];
      decision.unresolvedFields = quantity.value === null ? ["identity", "variant", "quantity", "nutrition"] : ["identity", "variant", "nutrition"];
      // No single alternative may borrow a profile/identity from the candidate read.
      decision.identity = {
        candidateKey: null, foodEntityId: null, variantId: null,
        canonicalName: null, brand: null, variant: null, preparation: [],
        qualifiers: [], barcode: null, confidence: null, evidenceIds: [],
      };
      decision.nutrition = blankNutrition();
    }
  }
  const valid = parseFoodResolutionDecision(decision);
  if (!valid.ok) {
    // A valid observation may exhaust the bounded decision evidence envelope.
    // Discard only generated, uncommitted decision evidence and fail closed;
    // never return a payload that failed the public Zod contract.
    const fallback: FoodResolutionDecision = {
      ...decision, status: "unknown", nextAction: "retry",
      identity: { candidateKey: null, foodEntityId: null, variantId: null,
        canonicalName: null, brand: null, variant: null, preparation: [],
        qualifiers: [], barcode: null, confidence: null, evidenceIds: [] },
      quantity: blankQuantity(), nutrition: blankNutrition(),
      classification: null, alternatives: [],
      evidence: [...observation.evidence],
      unresolvedFields: ["identity", "variant", "quantity", "nutrition"],
      reasonCodes: ["decision_validation_failed"],
    };
    const checked = parseFoodResolutionDecision(fallback);
    if (!checked.ok) throw new TypeError("Invariante de contrato da decisão V2 violada");
    return checked.value;
  }
  return valid.value;
}

/** Resolves each valid observation independently; one ambiguous item cannot
 * erase decisions for other items in the same turn. No meal write occurs here. */
export async function resolveFoodObservations(
  observations: readonly FoodObservation[], context: Omit<FoodResolverContext, "previousDecision">,
  store: FoodKnowledgeStore, externalLookup?: FoodExternalLookup,
): Promise<FoodResolutionDecision[]> {
  const ids = new Set<string>();
  for (const item of observations) {
    if (ids.has(item.observationId)) throw new TypeError("observationId duplicado");
    ids.add(item.observationId);
  }
  return Promise.all(observations.map(item => resolveFoodObservation(item, context, store, externalLookup)));
}
