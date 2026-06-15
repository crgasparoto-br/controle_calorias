import {
  selectNutritionSource,
  type NutritionSourceCandidate,
  type NutritionSourceQuery,
  type NutritionSourceSelection,
  type NutritionSourceType,
} from "./nutritionSourceSelection";

export type OnlineNutritionSourceOriginType =
  | "manufacturer"
  | "official_label"
  | "curated_database"
  | "trusted_retailer"
  | "community_database"
  | "unknown";

export type OnlineNutritionSourceRequestReason =
  | "brand_present"
  | "critical_variation_present"
  | "packaging_or_unit_present"
  | "brand_or_product_missing";

export type OnlineNutritionSourceEvaluationReason =
  | "source_allowed"
  | "source_without_traceable_url"
  | "source_type_not_allowed"
  | "specific_source_match"
  | "trusted_retailer_requires_review"
  | "community_source_requires_review"
  | "candidate_mismatch"
  | "portion_safely_convertible"
  | "portion_not_safely_convertible"
  | "online_lookup_not_needed"
  | "no_online_candidate_available";

export type OnlineNutritionSourceEvaluationStatus = "accepted" | "needs_review" | "rejected" | "fallback_safe";

export type OnlineNutritionServing = {
  quantity: number;
  unit: string;
  text?: string | null;
};

export type OnlineNutritionFacts = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type OnlineNutritionSourceCandidate = {
  id: string;
  name: string;
  brandName?: string | null;
  variation?: string | null;
  originType: OnlineNutritionSourceOriginType;
  sourceName: string;
  sourceUrl?: string | null;
  sourceVersion?: string | null;
  queriedAt: string;
  confidence?: number | null;
  serving: OnlineNutritionServing;
  nutritionPerServing: OnlineNutritionFacts;
  aliases?: string[];
};

export type OnlineNutritionSourceRequest = {
  shouldRequest: boolean;
  reasons: OnlineNutritionSourceRequestReason[];
};

export type OnlineNutritionSourceEvaluation = {
  status: OnlineNutritionSourceEvaluationStatus;
  candidate: OnlineNutritionSourceCandidate | null;
  selection: NutritionSourceSelection | null;
  reasons: OnlineNutritionSourceEvaluationReason[];
};

const CRITICAL_VARIATIONS = ["zero", "sem acucar", "diet", "light", "integral", "desnatado", "tradicional"];
const PACKAGING_UNITS = ["lata", "garrafa", "caixa", "pacote", "barra", "unidade", "ml", "g"];

const ONLINE_SOURCE_TYPE_BY_ORIGIN: Record<OnlineNutritionSourceOriginType, NutritionSourceType | null> = {
  manufacturer: "manufacturer_label",
  official_label: "manufacturer_label",
  curated_database: "curated_catalog",
  trusted_retailer: "trusted_retailer",
  community_database: "community_database",
  unknown: null,
};

function normalizeText(value: string | null | undefined) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim() ?? "";
}

function hasAnyTerm(text: string, terms: string[]) {
  return terms.some(term => text.includes(term));
}

function isMetricUnit(unit: string) {
  return ["g", "kg", "mg", "ml", "l"].includes(normalizeText(unit));
}

function isSameMeasurementFamily(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  const mass = new Set(["g", "kg", "mg"]);
  const volume = new Set(["ml", "l"]);
  return (mass.has(normalizedLeft) && mass.has(normalizedRight)) || (volume.has(normalizedLeft) && volume.has(normalizedRight));
}

function isPortionSafelyConvertible(query: NutritionSourceQuery, candidate: OnlineNutritionSourceCandidate) {
  const queryUnit = normalizeText(query.unit);
  const servingUnit = normalizeText(candidate.serving.unit);

  if (!queryUnit || queryUnit === "porcao") return true;
  if (!servingUnit || queryUnit === servingUnit) return true;
  if (isMetricUnit(queryUnit) && isMetricUnit(servingUnit)) return isSameMeasurementFamily(queryUnit, servingUnit);

  return false;
}

function toNutritionSourceCandidate(candidate: OnlineNutritionSourceCandidate, sourceType: NutritionSourceType): NutritionSourceCandidate {
  return {
    id: candidate.id,
    name: candidate.name,
    brandName: candidate.brandName,
    sourceType,
    sourceName: candidate.sourceName,
    sourceVersion: candidate.sourceVersion ?? null,
    confidence: candidate.confidence,
    servingUnit: candidate.serving.unit,
    aliases: candidate.aliases,
  };
}

function isTraceableUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function shouldRequestOnlineNutritionSource(query: NutritionSourceQuery): OnlineNutritionSourceRequest {
  const text = normalizeText(`${query.foodName} ${query.variation ?? ""} ${query.unit ?? ""}`);
  const hasBrand = Boolean(normalizeText(query.brandName));
  const hasProduct = Boolean(normalizeText(query.foodName));
  const reasons: OnlineNutritionSourceRequestReason[] = [];

  if (!hasBrand || !hasProduct) reasons.push("brand_or_product_missing");
  if (hasBrand) reasons.push("brand_present");
  if (hasAnyTerm(text, CRITICAL_VARIATIONS)) reasons.push("critical_variation_present");
  if (hasAnyTerm(text, PACKAGING_UNITS)) reasons.push("packaging_or_unit_present");

  return {
    shouldRequest: hasBrand && hasProduct && (reasons.includes("critical_variation_present") || reasons.includes("packaging_or_unit_present")),
    reasons,
  };
}

export function evaluateOnlineNutritionSourceCandidate(
  query: NutritionSourceQuery,
  candidate: OnlineNutritionSourceCandidate,
): OnlineNutritionSourceEvaluation {
  const request = shouldRequestOnlineNutritionSource(query);
  if (!request.shouldRequest) {
    return {
      status: "fallback_safe",
      candidate: null,
      selection: null,
      reasons: ["online_lookup_not_needed"],
    };
  }

  const sourceType = ONLINE_SOURCE_TYPE_BY_ORIGIN[candidate.originType];
  if (!sourceType) {
    return {
      status: "rejected",
      candidate,
      selection: null,
      reasons: ["source_type_not_allowed"],
    };
  }

  if (!isTraceableUrl(candidate.sourceUrl)) {
    return {
      status: "rejected",
      candidate,
      selection: null,
      reasons: ["source_without_traceable_url"],
    };
  }

  const selection = selectNutritionSource(query, [toNutritionSourceCandidate(candidate, sourceType)]);
  const portionConvertible = isPortionSafelyConvertible(query, candidate);
  const reasons: OnlineNutritionSourceEvaluationReason[] = [
    "source_allowed",
    ...(portionConvertible ? ["portion_safely_convertible" as const] : ["portion_not_safely_convertible" as const]),
  ];

  if (!selection.candidate) {
    return {
      status: "rejected",
      candidate,
      selection,
      reasons: [...reasons, "candidate_mismatch"],
    };
  }

  if (candidate.originType === "community_database") {
    return {
      status: "needs_review",
      candidate,
      selection,
      reasons: [...reasons, "community_source_requires_review"],
    };
  }

  if (candidate.originType === "trusted_retailer") {
    return {
      status: "needs_review",
      candidate,
      selection,
      reasons: [...reasons, "trusted_retailer_requires_review"],
    };
  }

  if (!portionConvertible) {
    return {
      status: "needs_review",
      candidate,
      selection,
      reasons,
    };
  }

  if (selection.quality === "exact" && !selection.reviewRequired) {
    return {
      status: "accepted",
      candidate,
      selection,
      reasons: [...reasons, "specific_source_match"],
    };
  }

  return {
    status: "needs_review",
    candidate,
    selection,
    reasons,
  };
}

export function selectOnlineNutritionSourceCandidate(
  query: NutritionSourceQuery,
  candidates: OnlineNutritionSourceCandidate[],
): OnlineNutritionSourceEvaluation {
  const request = shouldRequestOnlineNutritionSource(query);
  if (!request.shouldRequest) {
    return {
      status: "fallback_safe",
      candidate: null,
      selection: null,
      reasons: ["online_lookup_not_needed"],
    };
  }

  if (!candidates.length) {
    return {
      status: "fallback_safe",
      candidate: null,
      selection: null,
      reasons: ["no_online_candidate_available"],
    };
  }

  const evaluated = candidates.map(candidate => evaluateOnlineNutritionSourceCandidate(query, candidate));
  const accepted = evaluated.filter(result => result.status === "accepted");
  if (accepted.length) {
    return accepted.sort((left, right) => (right.selection?.confidence ?? 0) - (left.selection?.confidence ?? 0))[0];
  }

  const reviewable = evaluated.filter(result => result.status === "needs_review");
  if (reviewable.length) {
    return reviewable.sort((left, right) => (right.selection?.confidence ?? 0) - (left.selection?.confidence ?? 0))[0];
  }

  return {
    status: "fallback_safe",
    candidate: null,
    selection: null,
    reasons: ["no_online_candidate_available"],
  };
}
