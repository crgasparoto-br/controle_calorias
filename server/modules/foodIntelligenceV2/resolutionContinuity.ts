/** Continuity is bound to facts accepted by the same validated decision.
 * This does not discover aliases or decide a new identity by text similarity. */
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import type { FoodObservation, FoodResolutionDecision } from "./schemas";

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
