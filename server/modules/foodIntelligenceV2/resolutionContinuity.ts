/** Continuity is bound to facts accepted by the same validated decision.
 * This does not discover aliases or decide a new identity by text similarity. */
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import type { FoodEvidence, FoodObservation, FoodResolutionDecision } from "./schemas";
import type { GovernedFoodMatch } from "./knowledgeRead";
import { portionConversionEvidenceIds } from "./portionProvenance";

export function canPreserveAcceptedIdentity(
  observation: FoodObservation, previous: FoodResolutionDecision,
): boolean {
  const identity = previous.identity;
  if (identity.canonicalName === null || observation.alternatives.length > 0) return false;
  const acceptedIds = new Set(identity.evidenceIds);
  const accepted = previous.evidence.filter(item => acceptedIds.has(item.evidenceId));
  const governedVariant = identity.variantId !== null && accepted.some(item =>
    item.field === "variant.variantId" && item.value === identity.variantId &&
    item.verified && item.origin === "catalog");
  const acceptedName = (value: string | null): boolean => value === null ||
    normalizeFoodName(value) === normalizeFoodName(identity.canonicalName ?? "") ||
    (governedVariant && accepted.some(item =>
      item.field === "identity.foodName" && typeof item.value === "string" &&
      item.verified && (item.origin === "memory" || item.origin === "catalog") &&
      normalizeFoodName(item.value) === normalizeFoodName(value)));
  const hint = observation.identityHints;
  const compatibleHints = acceptedName(hint.foodName) &&
    (hint.brand === null || normalizeFoodName(hint.brand) === normalizeFoodName(identity.brand ?? "")) &&
    (hint.barcode === null || hint.barcode === identity.barcode) &&
    (hint.variant === null || normalizeFoodName(hint.variant) === normalizeFoodName(identity.variant ?? "")) &&
    (hint.preparation.length === 0 || JSON.stringify(hint.preparation) === JSON.stringify(identity.preparation)) &&
    (hint.qualifiers.length === 0 || JSON.stringify(hint.qualifiers) === JSON.stringify(identity.qualifiers));
  if (!compatibleHints) return false;
  return !observation.evidence.some(item =>
    (item.field.startsWith("identity.") || item.field.startsWith("variant.")) &&
    item.value !== null &&
    !accepted.some(old => old.field === item.field && old.value === item.value) &&
    !(item.field === "identity.foodName" && typeof item.value === "string" && acceptedName(item.value)));
}

/** A governed lookup must reconcile every independent, verified identity
 * claim. A matching candidate does not override a different verified ID. */
export function hasConflictingIdentityEvidence(
  observation: FoodObservation, match: GovernedFoodMatch,
  evidence: readonly FoodEvidence[], lookupName: string, acceptedName?: string | null,
): boolean {
  const sameText = (actual: unknown, expected: string | null | undefined) =>
    typeof actual === "string" && !!expected &&
    normalizeFoodName(actual) === normalizeFoodName(expected);
  return evidence.some(item => {
    if (!item.verified || item.value === null) return false;
    switch (item.field) {
      case "variant.variantId": return item.value !== match.variantId;
      case "variant.foodEntityId": return item.value !== match.foodId;
      case "variant.candidateKey": return item.value !== "variant:" + match.variantId;
      case "identity.foodName":
        return !sameText(item.value, match.variantName) && !sameText(item.value, lookupName) &&
          !sameText(item.value, acceptedName);
      case "identity.brand": return !sameText(item.value, match.matchedBrand);
      case "identity.barcode": return item.value !== match.matchedBarcode;
      case "identity.variant":
        // The explicit variant can be a material qualifier inside the complete
        // governed label; source compatibility already validates that claim.
        return !sameText(item.value, match.variantName) &&
          !sameText(item.value, observation.identityHints.variant);
      case "identity.preparation":
        return !observation.identityHints.preparation.some(value => sameText(item.value, value));
      case "identity.qualifiers":
        return !observation.identityHints.qualifiers.some(value => sameText(item.value, value.value));
      default: return false;
    }
  });
}

/** Keep old derived facts in the previous immutable decision, not in the new
 * identity's evidence scope. Independently supplied incoming claims survive. */
export function discardSupersededDerivedEvidence(
  observation: FoodObservation, previous: FoodResolutionDecision,
  evidence: FoodResolutionDecision["evidence"],
): void {
  const incomingIds = new Set(observation.evidence.map(item => item.evidenceId));
  const derivedIds = new Set([...previous.nutrition.evidenceIds,
    ...portionConversionEvidenceIds(previous.quantity, previous.evidence)]);
  // Independently supplied claims survive. Derived lookup conclusions are
  // refreshed by the authoritative read and remain in the prior snapshot.
  const acceptedIds = new Set(previous.identity.evidenceIds);
  for (const item of previous.evidence) {
    if (acceptedIds.has(item.evidenceId) && (
      (item.field === "variant.variantId" && item.origin === "catalog" &&
        item.anchor.sourceRef === "food-variant:" + previous.identity.variantId) ||
      (item.field === "identity.foodName" && (item.origin === "catalog" || item.origin === "memory") &&
        item.anchor.sourceRef === "food-lookup:" + previous.decisionId))) {
      derivedIds.add(item.evidenceId);
    }
  }
  for (let i = evidence.length - 1; i >= 0; i--) {
    if (derivedIds.has(evidence[i].evidenceId) && !incomingIds.has(evidence[i].evidenceId)) evidence.splice(i, 1);
  }
}
