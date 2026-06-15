export type NutritionSourceType =
  | "manufacturer_label"
  | "curated_catalog"
  | "official_database"
  | "internal_catalog"
  | "trusted_retailer"
  | "community_database"
  | "similar_product"
  | "generic_estimate"
  | "llm_estimate";

export type NutritionSourceQuality = "exact" | "similar" | "generic" | "estimated" | "needs_review";

export type NutritionSourceSelectionReason =
  | "exact_brand_variation_match"
  | "brand_match_without_exact_variation"
  | "curated_or_official_unbranded_match"
  | "trusted_retailer_source_requires_review"
  | "community_source_requires_review"
  | "generic_fallback_used"
  | "estimated_fallback_used"
  | "critical_variation_mismatch_rejected"
  | "branded_product_without_specific_source"
  | "unit_or_portion_uncertain"
  | "no_candidate_available";

export type NutritionSourceCandidate = {
  id: string;
  name: string;
  brandName?: string | null;
  sourceType: NutritionSourceType;
  sourceName?: string | null;
  sourceVersion?: string | null;
  reviewedAt?: string | null;
  confidence?: number | null;
  servingUnit?: string | null;
  aliases?: string[];
};

export type NutritionSourceQuery = {
  foodName: string;
  brandName?: string | null;
  variation?: string | null;
  preparation?: string | null;
  unit?: string | null;
};

export type NutritionSourceSelection = {
  candidate: NutritionSourceCandidate | null;
  quality: NutritionSourceQuality;
  confidence: number;
  isEstimate: boolean;
  reviewRequired: boolean;
  reasons: NutritionSourceSelectionReason[];
  source: {
    type: NutritionSourceType | "none";
    name: string | null;
    version: string | null;
    reviewedAt: string | null;
  };
};

const SOURCE_TYPE_WEIGHT: Record<NutritionSourceType, number> = {
  manufacturer_label: 100,
  curated_catalog: 88,
  official_database: 84,
  internal_catalog: 72,
  trusted_retailer: 66,
  community_database: 44,
  similar_product: 58,
  generic_estimate: 36,
  llm_estimate: 28,
};

const CRITICAL_VARIATIONS = ["zero", "sem acucar", "diet", "light", "integral", "desnatado", "tradicional"];

function normalizeText(value: string | null | undefined) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim() ?? "";
}

function extractCriticalVariations(value: string) {
  return CRITICAL_VARIATIONS.filter(variation => value.includes(variation));
}

function candidateText(candidate: NutritionSourceCandidate) {
  return normalizeText([candidate.name, candidate.brandName, ...(candidate.aliases ?? [])].filter(Boolean).join(" "));
}

function hasBrandMatch(query: NutritionSourceQuery, candidate: NutritionSourceCandidate) {
  const queryBrand = normalizeText(query.brandName);
  if (!queryBrand) return false;
  return candidateText(candidate).includes(queryBrand);
}

function hasNameMatch(query: NutritionSourceQuery, candidate: NutritionSourceCandidate) {
  const queryName = normalizeText(query.foodName);
  const text = candidateText(candidate);
  return Boolean(queryName && (text.includes(queryName) || queryName.includes(normalizeText(candidate.name))));
}

function isEstimateCandidate(candidate: NutritionSourceCandidate) {
  return candidate.sourceType === "generic_estimate" || candidate.sourceType === "llm_estimate";
}

function hasCompatibleVariation(query: NutritionSourceQuery, candidate: NutritionSourceCandidate) {
  const queryText = normalizeText(`${query.foodName} ${query.variation ?? ""}`);
  const candidateVariations = extractCriticalVariations(candidateText(candidate));
  const queryVariations = extractCriticalVariations(queryText);

  if (!queryVariations.length) return true;
  if (!candidateVariations.length) return isEstimateCandidate(candidate);
  return queryVariations.every(variation => candidateVariations.includes(variation));
}

function hasCompatibleUnit(query: NutritionSourceQuery, candidate: NutritionSourceCandidate) {
  const queryUnit = normalizeText(query.unit);
  const servingUnit = normalizeText(candidate.servingUnit);
  return !queryUnit || queryUnit === "porcao" || !servingUnit || queryUnit === servingUnit;
}

function scoreCandidate(query: NutritionSourceQuery, candidate: NutritionSourceCandidate) {
  let score = SOURCE_TYPE_WEIGHT[candidate.sourceType];
  if (hasNameMatch(query, candidate)) score += 16;
  if (hasBrandMatch(query, candidate)) score += 20;
  if (hasCompatibleVariation(query, candidate)) score += 10;
  if (hasCompatibleUnit(query, candidate)) score += 4;
  if (candidate.confidence !== null && candidate.confidence !== undefined) score += candidate.confidence * 10;
  return score;
}

function rankCandidates(query: NutritionSourceQuery, candidates: NutritionSourceCandidate[]) {
  const rejectedReasons: NutritionSourceSelectionReason[] = [];
  const accepted = candidates.filter(candidate => {
    const compatible = hasCompatibleVariation(query, candidate);
    if (!compatible) rejectedReasons.push("critical_variation_mismatch_rejected");
    return compatible;
  });

  return {
    rejectedReasons,
    ranked: accepted
      .map(candidate => ({ candidate, score: scoreCandidate(query, candidate) }))
      .sort((a, b) => b.score - a.score),
  };
}

function classifySelection(query: NutritionSourceQuery, candidate: NutritionSourceCandidate): {
  quality: NutritionSourceQuality;
  reasons: NutritionSourceSelectionReason[];
} {
  const reasons: NutritionSourceSelectionReason[] = [];
  const brandRequested = Boolean(normalizeText(query.brandName));
  const brandMatched = hasBrandMatch(query, candidate);
  const nameMatched = hasNameMatch(query, candidate);

  if (
    brandRequested
    && brandMatched
    && nameMatched
    && ["manufacturer_label", "curated_catalog", "official_database"].includes(candidate.sourceType)
  ) {
    reasons.push("exact_brand_variation_match");
    return { quality: "exact", reasons };
  }

  if (brandRequested && brandMatched && candidate.sourceType === "trusted_retailer") {
    reasons.push("trusted_retailer_source_requires_review");
    return { quality: "similar", reasons };
  }

  if (candidate.sourceType === "community_database") {
    reasons.push("community_source_requires_review");
    return { quality: "needs_review", reasons };
  }

  if (brandRequested && brandMatched) {
    reasons.push("brand_match_without_exact_variation");
    return { quality: "similar", reasons };
  }

  if (!brandRequested && ["curated_catalog", "official_database", "internal_catalog"].includes(candidate.sourceType)) {
    reasons.push("curated_or_official_unbranded_match");
    return { quality: "exact", reasons };
  }

  if (isEstimateCandidate(candidate)) {
    reasons.push("estimated_fallback_used");
    return { quality: "estimated", reasons };
  }

  reasons.push("generic_fallback_used");
  if (brandRequested) reasons.push("branded_product_without_specific_source");
  return { quality: brandRequested ? "generic" : "similar", reasons };
}

function calculateConfidence(candidate: NutritionSourceCandidate, quality: NutritionSourceQuality, unitCompatible: boolean) {
  const base = candidate.confidence ?? {
    exact: 0.92,
    similar: 0.76,
    generic: 0.58,
    estimated: 0.45,
    needs_review: 0.2,
  }[quality];

  return Math.max(0.2, Math.min(0.99, Math.round((unitCompatible ? base : base - 0.18) * 100) / 100));
}

export function selectNutritionSource(
  query: NutritionSourceQuery,
  candidates: NutritionSourceCandidate[],
): NutritionSourceSelection {
  const { ranked, rejectedReasons } = rankCandidates(query, candidates);
  const selected = ranked[0]?.candidate ?? null;

  if (!selected) {
    return {
      candidate: null,
      quality: "needs_review",
      confidence: 0.2,
      isEstimate: false,
      reviewRequired: true,
      reasons: Array.from(new Set([...rejectedReasons, "no_candidate_available"])),
      source: {
        type: "none",
        name: null,
        version: null,
        reviewedAt: null,
      },
    };
  }

  const classified = classifySelection(query, selected);
  const unitCompatible = hasCompatibleUnit(query, selected);
  const reasons = Array.from(new Set([
    ...rejectedReasons,
    ...classified.reasons,
    ...(unitCompatible ? [] : ["unit_or_portion_uncertain" as const]),
  ]));
  const isEstimate = isEstimateCandidate(selected) || classified.quality === "estimated";
  const reviewRequired = classified.quality !== "exact" || reasons.includes("unit_or_portion_uncertain");

  return {
    candidate: selected,
    quality: classified.quality,
    confidence: calculateConfidence(selected, classified.quality, unitCompatible),
    isEstimate,
    reviewRequired,
    reasons,
    source: {
      type: selected.sourceType,
      name: selected.sourceName ?? selected.name,
      version: selected.sourceVersion ?? null,
      reviewedAt: selected.reviewedAt ?? null,
    },
  };
}
