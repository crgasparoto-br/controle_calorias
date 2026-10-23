import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";

/**
 * Issue #1302: single V2 read contract / cache-through orchestrator.
 * No production entrypoint is switched to V2 before the ADR Gate A.
 */
export type FoodKnowledgeRequest = {
  normalizedName: string;
  brand?: string | null;
  barcode?: string | null;
  userId: number | null;
  resolverVersion: string;
  policyVersion: string;
  now?: Date;
};

export type NutritionFacts = {
  caloriesKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  basisQuantity: number;
  basisUnit: "g" | "ml" | "serving";
};

export type GovernedFoodMatch = {
  kind: "match";
  matchingEvidence: "barcode" | "exact_variant" | "personal_alias" | "global_alias" | "generic_family";
  foodId: number;
  variantId: number;
  profileId: number;
  variantName: string;
  sourceId: number;
  sourceVersion: string;
  sourceReference: string;
  nutrition: NutritionFacts;
  governanceStatus: "verified" | "provisional";
  portions: ReadonlyArray<{ label: string; unit: string; quantity: number; grams: number; status: string }>;
};

export type FoodKnowledgeLocalResult =
  | GovernedFoodMatch
  | { kind: "miss"; reason: "not_found" | "incompatible_evidence" | "no_governed_profile" | "invalid_request" }
  | { kind: "conflict"; reason: "multiple_identities" | "material_nutrition_conflict" };

export type ExternalProvisionalCandidate = {
  sourceId: number;
  sourceReference: string;
  nutrition: NutritionFacts;
  /** Unverified identity assertions from the provider, never SKU proof. */
  identity?: { name?: string | null; brand?: string | null; barcode?: string | null };
};

export type FoodKnowledgeResult =
  | FoodKnowledgeLocalResult
  | { kind: "provisional"; origin: "external"; persisted: boolean; sourceId: number; sourceReference: string; nutrition: NutritionFacts }
  | { kind: "unavailable"; reason: "provider_unavailable" | "external_evidence_invalid" | "governed_store_unavailable" };

export interface FoodKnowledgeStore {
  readLocal(request: FoodKnowledgeRequest): Promise<FoodKnowledgeLocalResult>;
  readPendingEvidence(request: FoodKnowledgeRequest): Promise<ExternalProvisionalCandidate | { kind: "conflict" } | null>;
  stagePendingEvidence(request: FoodKnowledgeRequest, candidate: ExternalProvisionalCandidate): Promise<boolean>;
}

export type FoodExternalLookup = (request: FoodKnowledgeRequest) => Promise<ExternalProvisionalCandidate | null>;

/** This is a consistency predicate, not an independent food resolver.
 * Exact user-supplied barcode/brand constraints cannot be erased by
 * an external candidate or replayed from a cache. These are assertions,
 * not independent evidence sufficient for verified commercial nutrition. */
export function isExternalFoodAssertionConsistent(
  request: FoodKnowledgeRequest,
  candidate: ExternalProvisionalCandidate,
): boolean {
  const identity = candidate.identity;
  if (identity !== undefined &&
      (!identity || typeof identity !== "object" || Array.isArray(identity) ||
        (identity.name !== undefined && identity.name !== null && typeof identity.name !== "string") ||
        (identity.brand !== undefined && identity.brand !== null && typeof identity.brand !== "string") ||
        (identity.barcode !== undefined && identity.barcode !== null && typeof identity.barcode !== "string"))) {
    return false;
  }
  const brand = request.brand?.trim();
  const barcode = request.barcode?.trim();
  const name = normalizeFoodName(request.normalizedName);
  // An external source's macros are usable only when it asserts an identity
  // compatible with the requested food, including generic/brandless lookups.
  // A URL or grant authorizes the source, but does not identify its contents.
  if (!identity || (name && normalizeFoodName(identity.name ?? "") !== name)) return false;
  if (barcode && identity.barcode?.trim() !== barcode) return false;
  // A name-only request cannot select nutrition for one particular SKU.
  // A matching explicit barcode is sufficient to scope a branded candidate,
  // even when the user did not separately state its brand.
  if (!barcode && (identity.barcode?.trim() || (!brand && normalizeFoodName(identity.brand ?? "")))) {
    return false;
  }
  if (brand && normalizeFoodName(identity.brand ?? "") !== normalizeFoodName(brand)) return false;
  return true;
}

export function isNutritionFacts(value: unknown): value is NutritionFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const nutrition = value as Partial<NutritionFacts>;
  return (
    typeof nutrition.basisQuantity === "number" &&
    Number.isFinite(nutrition.basisQuantity) && nutrition.basisQuantity > 0 &&
    (nutrition.basisUnit === "g" || nutrition.basisUnit === "ml" || nutrition.basisUnit === "serving") &&
    [nutrition.caloriesKcal, nutrition.proteinG, nutrition.carbG, nutrition.fatG]
      .every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)
  );
}

/**
 * Knowledge and exact evidence first; then user-scoped pending evidence; then
 * at most one external request. The provider never decides governance status.
 * Persistence remains denied until explicit per-source license/privacy grants.
 */
export async function readThroughGovernedKnowledge(
  request: FoodKnowledgeRequest,
  store: FoodKnowledgeStore,
  externalLookup?: FoodExternalLookup,
): Promise<FoodKnowledgeResult> {
  if (
    !request.normalizedName.trim() && !request.barcode?.trim() ||
    !request.policyVersion.trim() ||
    !request.resolverVersion.trim() ||
    (request.userId !== null && (!Number.isSafeInteger(request.userId) || request.userId <= 0)) ||
    (request.now !== undefined && Number.isNaN(request.now.getTime()))
  ) {
    return { kind: "miss", reason: "invalid_request" };
  }

  let local: FoodKnowledgeLocalResult;
  try { local = await store.readLocal(request); }
  catch { return { kind: "unavailable", reason: "governed_store_unavailable" }; }
  // A confirmed personal identity without eligible nutrition remains unresolved.
  // Do not fetch a homonymous generic candidate or replay unrelated evidence.
  if (local.kind !== "miss" || local.reason === "no_governed_profile") return local;

  // Barcode assertions and explicitly branded inputs cannot be silently
  // substituted with a generic food by the external provider or local cache.
  if (request.userId !== null) {
    let cached: Awaited<ReturnType<FoodKnowledgeStore["readPendingEvidence"]>>;
    try { cached = await store.readPendingEvidence(request); }
    catch { return { kind: "unavailable", reason: "governed_store_unavailable" }; }
    if (cached && "kind" in cached && cached.kind === "conflict") return { kind: "conflict", reason: "material_nutrition_conflict" };
    if (cached && "nutrition" in cached && isNutritionFacts(cached.nutrition) &&
        isExternalFoodAssertionConsistent(request, cached)) {
      return {
        kind: "provisional", origin: "external", persisted: true,
        sourceId: cached.sourceId, sourceReference: cached.sourceReference,
        nutrition: cached.nutrition,
      };
    }
  }
  if (!externalLookup) return local;

  let candidate: ExternalProvisionalCandidate | null;
  try { candidate = await externalLookup(request); }
  catch { return { kind: "unavailable", reason: "provider_unavailable" }; }
  if (!candidate) return { kind: "unavailable", reason: "provider_unavailable" };
  if (
    !Number.isSafeInteger(candidate.sourceId) || candidate.sourceId <= 0 ||
    typeof candidate.sourceReference !== "string" ||
    !/^https:\/\//i.test(candidate.sourceReference) ||
    candidate.sourceReference.length > 500 ||
    !isNutritionFacts(candidate.nutrition) ||
    !isExternalFoodAssertionConsistent(request, candidate)
  ) {
    return { kind: "unavailable", reason: "external_evidence_invalid" };
  }

  let persisted = false;
  if (request.userId !== null) {
    try { persisted = await store.stagePendingEvidence(request, candidate); }
    catch { persisted = false; } // Retrieval still yields explicitly nonpersistent provisional facts.
  }
  return {
    kind: "provisional",
    origin: "external",
    persisted,
    sourceId: candidate.sourceId,
    sourceReference: candidate.sourceReference,
    nutrition: candidate.nutrition,
  };
}
