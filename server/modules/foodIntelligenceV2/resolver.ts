/**
 * #1305 — Food Intelligence Resolver V2, núcleo de domínio (sem cutover).
 *
 * Consome FoodObservation validada e conhecimento governado #1302.
 * Não interpreta MealOperation, não grava refeições, não faz matching fuzzy
 * não calibrado (#1306) e não promove evidência externa a conhecimento verificado.
 */
import { createHash } from "node:crypto";
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import { normalizeUnitToken } from "./contracts";
import { declaredPhysicalAmount } from "./nutritionConsistency";
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
  portionId: null, source: null, measureKind: null, confidence: null, evidenceIds: [],
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
): string {
  const ids = new Set(existing.map(item => item.evidenceId));
  let index = existing.length;
  while (ids.has("r-" + index)) index++;
  const evidenceId = "r-" + index;
  existing.push({
    evidenceId, field, value, unit, sourceId, verified, origin,
    confidence: null, anchor: observation.surfaceSpan,
  });
  return evidenceId;
}

function quantityFromObservation(
  observation: FoodObservation, evidence: FoodEvidence[], match: GovernedFoodMatch | null,
  previous: FoodResolutionDecision | null,
): { quantity: Quantity; incompatiblePrevious: boolean } {
  const q = observation.quantityHints;
  const quantity = blankQuantity();
  const prior = previous?.quantity;
  if (q.value === null || q.unit === null) {
    if (prior && (prior.value !== null || prior.grams !== null || prior.milliliters !== null)) {
      // Carry the exact structured fact and its original evidence; never reparse a string.
      return { quantity: { ...prior, evidenceIds: [...prior.evidenceIds] }, incompatiblePrevious: false };
    }
    return { quantity, incompatiblePrevious: false };
  }
  if (prior?.value !== null && prior?.value !== undefined &&
      (prior.value !== q.value || normalizeUnitToken(prior.unit) !== normalizeUnitToken(q.unit))) {
    // New conflicting assertion: do not overwrite a previously accepted quantity.
    return { quantity: { ...prior, evidenceIds: [...prior.evidenceIds] }, incompatiblePrevious: true };
  }
  const matchingIds = observation.evidence.filter(item =>
    item.field.startsWith("quantity.") && item.value !== null).map(item => item.evidenceId);
  quantity.value = q.value;
  quantity.unit = q.unit;
  quantity.evidenceIds = matchingIds;
  quantity.source = "observation";
  quantity.measureKind = "exact";
  const physical = amount(q.value, q.unit);
  if (physical?.basis === "g") quantity.grams = physical.value;
  if (physical?.basis === "ml") quantity.milliliters = physical.value;
  if (quantity.evidenceIds.length === 0) {
    quantity.evidenceIds.push(makeEvidence(observation, evidence, "quantity.value", q.value, q.unit, null, false, "text"));
  }
  // Portion conversion uses only source-granted, current V2 portions returned by #1302.
  // A named household unit is NOT guessed from a package or a generic average.
  if (!physical && match) {
    const key = normalizeFoodName(q.unit);
    const eligible = match.portions.filter(p =>
      p.status === "verified" && Number.isFinite(p.quantity) && p.quantity > 0 &&
      Number.isFinite(p.grams) && p.grams > 0 &&
      (normalizeFoodName(p.unit) === key || normalizeFoodName(p.label) === key));
    if (eligible.length === 1) {
      const grams = q.value * eligible[0].grams / eligible[0].quantity;
      if (Number.isFinite(grams) && grams > 0) {
        quantity.grams = grams;
        quantity.source = "governed_portion";
        quantity.evidenceIds.push(makeEvidence(observation, evidence, "quantity.grams", grams, "g", null, true, "catalog"));
      }
    }
  }
  return { quantity, incompatiblePrevious: false };
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

function snapshot(match: GovernedFoodMatch): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify({
    variantId: match.variantId, profileId: match.profileId,
    sourceId: match.sourceId, sourceVersion: match.sourceVersion,
    sourceReference: match.sourceReference, nutrition: match.nutrition,
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
  const evidenceIds = (["calories", "protein", "carbs", "fat"] as const).map(key =>
    makeEvidence(observation, evidence, "nutrition." + key,
      values[key], key === "calories" ? "kcal" : "g",
      match.sourceId, verified, "catalog"));
  return {
    profileId: match.profileId, sourceId: match.sourceId,
    verified, provisional: !verified,
    basis: { quantity: match.nutrition.basisQuantity, unit: basisUnit, values },
    consumed, snapshotHash: snapshot(match), evidenceIds,
  };
}

function sameObservation(previous: FoodResolutionDecision | undefined, context: FoodResolverContext, observation: FoodObservation) {
  if (!previous) return false;
  return previous.traceId === context.traceId &&
    previous.knowledgeRevision === context.knowledgeRevision &&
    previous.policyVersion === context.policyVersion &&
    previous.observationIds.length === 1 && previous.observationIds[0] === observation.observationId &&
    parseFoodResolutionDecision(previous).ok;
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
  const evidence: FoodEvidence[] = [...observation.evidence];
  if (previous) {
    for (const item of previous.evidence) {
      if (!evidence.some(other => other.evidenceId === item.evidenceId)) evidence.push(item);
    }
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
      .update(JSON.stringify([context.traceId, observation.observationId])).digest("hex"),
    revision: previous ? previous.revision + 1 : 1,
    observationIds: [observation.observationId], traceId: context.traceId,
    status: "unknown", nextAction: "clarify", identity,
    quantity: blankQuantity(), nutrition: blankNutrition(), classification: null,
    unresolvedFields: ["identity", "variant", "quantity", "nutrition"],
    reasonCodes: ["unknown_surface"], alternatives: [], evidence,
    knowledgeRevision: context.knowledgeRevision, policyVersion: context.policyVersion,
  };
  const negative = evidence.some(item =>
    item.field === "classification.isFood" && item.value === false &&
    item.verified && item.unit === null);
  if (negative) {
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
    const hint = observation.identityHints;
    const previousIdentity = previous?.identity;
    const compatibleIdentityHints = !!previousIdentity &&
      (hint.foodName === null || normalizeFoodName(hint.foodName) ===
        normalizeFoodName(previousIdentity.canonicalName ?? "")) &&
      (hint.brand === null || normalizeFoodName(hint.brand) ===
        normalizeFoodName(previousIdentity.brand ?? "")) &&
      (hint.barcode === null || hint.barcode === previousIdentity.barcode) &&
      (hint.variant === null || normalizeFoodName(hint.variant) ===
        normalizeFoodName(previousIdentity.variant ?? "")) &&
      (hint.preparation.length === 0 ||
        JSON.stringify(hint.preparation) === JSON.stringify(previousIdentity.preparation)) &&
      (hint.qualifiers.length === 0 ||
        JSON.stringify(hint.qualifiers) === JSON.stringify(previousIdentity.qualifiers));
    const changedIdentityEvidence = observation.evidence.some(item =>
      (item.field.startsWith("identity.") || item.field.startsWith("variant.")) &&
      item.value !== null && !previous?.evidence.some(old =>
        old.field === item.field && old.value === item.value));
    if (previous && previous.identity.canonicalName !== null &&
        compatibleIdentityHints && !changedIdentityEvidence) {
      const q = observation.quantityHints;
      const prior = previous.quantity;
      const quantityConflict = q.value !== null && q.unit !== null &&
        (prior.value !== q.value ||
          normalizeUnitToken(prior.unit) !== normalizeUnitToken(q.unit));
      const preserved: FoodResolutionDecision = {
        ...previous, revision: previous.revision + 1, evidence,
        status: quantityConflict ? "partially_resolved" : previous.status,
        nextAction: quantityConflict ? "clarify" : previous.nextAction,
        unresolvedFields: quantityConflict
          ? Array.from(new Set([...previous.unresolvedFields, "quantity"]))
          : previous.unresolvedFields,
        reasonCodes: quantityConflict
          ? Array.from(new Set([...previous.reasonCodes, "source_conflict"]))
          : previous.reasonCodes,
      };
      const checked = parseFoodResolutionDecision(preserved);
      if (checked.ok) return checked.value;
    }
    const request = {
      normalizedName: normalizeFoodName(observation.identityHints.foodName ?? ""),
      brand: observation.identityHints.brand,
      barcode: observation.identityHints.barcode,
      userId: context.userId,
      resolverVersion: context.resolverVersion,
      policyVersion: context.policyVersion,
      now: context.now,
    };
    const knowledge = await readThroughGovernedKnowledge(request, store, externalLookup);
    const match = knowledge.kind === "match" &&
      sourceCompatibleWithExplicitAttributes(observation, knowledge) ? knowledge : null;
    const incompatibleAttributes = knowledge.kind === "match" && match === null;
    const { quantity, incompatiblePrevious } = quantityFromObservation(observation, evidence, match, previous);
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
      identity.variant = match.variantName;
      identity.brand = observation.identityHints.brand;
      identity.preparation = observation.identityHints.preparation;
      identity.qualifiers = observation.identityHints.qualifiers;
      identity.evidenceIds = observation.evidence.filter(item =>
        item.field.startsWith("identity.") || item.field.startsWith("variant.")).map(item => item.evidenceId);
      identity.evidenceIds.push(makeEvidence(observation, evidence, "variant.variantId", match.variantId,
        null, match.sourceId, match.governanceStatus === "verified", "catalog"));
      if (observation.identityHints.barcode !== null) {
        identity.barcode = observation.identityHints.barcode;
        identity.evidenceIds.push(makeEvidence(observation, evidence, "identity.barcode",
          identity.barcode, null, null, false, "barcode"));
      }
      decision.unresolvedFields = decision.unresolvedFields.filter(field => field !== "identity" && field !== "variant");
      // A provisional governed profile is not yet an authorized estimate:
      // #1306 must calibrate the policy by family before it is usable.
      decision.nutrition = match.governanceStatus === "verified"
        ? nutritionFromMatch(observation, match, quantity, evidence)
        : blankNutrition();
      if (decision.nutrition.consumed !== null) {
        decision.unresolvedFields = decision.unresolvedFields.filter(field => field !== "nutrition");
      }
      if (incompatiblePrevious) {
        decision.unresolvedFields = Array.from(new Set([...decision.unresolvedFields, "quantity"]));
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
    } else if (incompatibleAttributes) {
      decision.reasonCodes = ["brand_variant_unresolved"];
    } else if (knowledge.kind === "unavailable") {
      decision.reasonCodes = [knowledge.reason === "provider_unavailable" ?
        "provider_unavailable" : "context_unavailable"];
      decision.nextAction = "retry";
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
    if (observation.alternatives.length >= 2 && alternatives.length < 2) {
      decision.status = "unknown";
      decision.nextAction = "clarify";
      decision.reasonCodes = ["source_conflict"];
      decision.unresolvedFields = ["identity", "variant", "nutrition"];
      decision.identity = {
        candidateKey: null, foodEntityId: null, variantId: null,
        canonicalName: null, brand: null, variant: null, preparation: [],
        qualifiers: [], barcode: null, confidence: null, evidenceIds: [],
      };
      decision.nutrition = blankNutrition();
    } else if (alternatives.length >= 2) {
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
