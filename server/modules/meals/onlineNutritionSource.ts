export type OnlineNutritionSourceType = "manufacturer" | "official_label" | "curated_database" | "trusted_retailer" | "aggregator" | "community";

export type OnlineNutritionLookupQuery = {
  text: string;
  productName: string;
  brandName?: string | null;
  variants?: string[];
  quantity?: number;
  unit?: string;
  hasExactInternalSource?: boolean;
};

export type OnlineNutritionCandidate = {
  productName: string;
  brandName?: string | null;
  variants?: string[];
  serving: {
    quantity: number;
    unit: string;
    grams?: number;
    milliliters?: number;
  };
  nutrition: {
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  source: {
    url: string;
    domain: string;
    type: OnlineNutritionSourceType;
    retrievedAt?: string;
  };
};

export type OnlineNutritionResolvedSource = {
  status: "exact" | "similar" | "ambiguous" | "not_found" | "unsafe_source" | "provider_error" | "skipped";
  candidate?: OnlineNutritionCandidate;
  confidence: number;
  reason: string;
  normalizedNutrition?: {
    servingText: string;
    factor: number;
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  alternatives?: OnlineNutritionCandidate[];
  errorCode?: string;
};

export type OnlineNutritionSearchProvider = {
  search: (query: OnlineNutritionLookupQuery) => Promise<OnlineNutritionCandidate[]>;
};

export const ALLOWED_ONLINE_NUTRITION_DOMAINS = [
  "nestle.com.br",
  "coca-cola.com",
  "wickbold.com.br",
  "panco.com.br",
  "molico.com.br",
  "polenghi.com.br",
  "taco.nepa.unicamp.br",
  "tbca.net.br",
] as const;

const SOURCE_TYPE_CONFIDENCE: Record<OnlineNutritionSourceType, number> = {
  manufacturer: 0.95,
  official_label: 0.93,
  curated_database: 0.9,
  trusted_retailer: 0.72,
  aggregator: 0.48,
  community: 0.35,
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value).split(" ").filter(token => token.length >= 3);
}

function normalizedUnit(value?: string) {
  const normalized = normalizeText(value ?? "");
  if (["g", "gr", "grama", "gramas"].includes(normalized)) return "g";
  if (["ml", "mililitro", "mililitros"].includes(normalized)) return "ml";
  if (["l", "litro", "litros"].includes(normalized)) return "l";
  if (["kg", "quilo", "quilos"].includes(normalized)) return "kg";
  return normalized;
}

function roundNutrition(value: number) {
  return Math.round(value * 100) / 100;
}

function isAllowedDomain(domain: string) {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return ALLOWED_ONLINE_NUTRITION_DOMAINS.some(allowed => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

export function shouldLookupOnlineNutritionSource(query: OnlineNutritionLookupQuery) {
  return Boolean(query.brandName?.trim() && !query.hasExactInternalSource);
}

function scoreCandidateSimilarity(query: OnlineNutritionLookupQuery, candidate: OnlineNutritionCandidate) {
  if (!isAllowedDomain(candidate.source.domain)) {
    return { score: 0, reason: "Fonte fora da allowlist." };
  }

  const queryBrand = normalizeText(query.brandName ?? "");
  const candidateBrand = normalizeText(candidate.brandName ?? "");
  if (queryBrand && candidateBrand && queryBrand !== candidateBrand) {
    return { score: 0.2, reason: "Marca diferente da informada." };
  }

  const productTokens = tokenize(query.productName);
  const candidateText = normalizeText(`${candidate.productName} ${candidate.variants?.join(" ") ?? ""}`);
  const matchedProductTokens = productTokens.filter(token => candidateText.includes(token)).length;
  const productScore = productTokens.length ? matchedProductTokens / productTokens.length : 0.5;

  const queryVariants = (query.variants ?? []).map(normalizeText).filter(Boolean);
  const candidateVariants = normalizeText(candidate.variants?.join(" ") ?? candidate.productName);
  const matchedVariants = queryVariants.filter(variant => candidateVariants.includes(variant)).length;
  const variationScore = queryVariants.length ? matchedVariants / queryVariants.length : 1;

  const sourceScore = SOURCE_TYPE_CONFIDENCE[candidate.source.type];
  const brandScore = queryBrand ? (candidateBrand === queryBrand ? 1 : 0.7) : 0.8;
  const score = roundNutrition((productScore * 0.45) + (variationScore * 0.25) + (brandScore * 0.15) + (sourceScore * 0.15));

  return {
    score,
    reason: `similaridade produto=${roundNutrition(productScore)}, variacao=${roundNutrition(variationScore)}, fonte=${sourceScore}`,
  };
}

function resolveQuantityFactor(query: OnlineNutritionLookupQuery, candidate: OnlineNutritionCandidate) {
  const quantity = query.quantity;
  const unit = normalizedUnit(query.unit);
  if (!quantity || !unit) {
    return { factor: 1, servingText: `${candidate.serving.quantity} ${candidate.serving.unit}` };
  }

  if (unit === "g" && candidate.serving.grams) {
    return { factor: quantity / candidate.serving.grams, servingText: `${quantity} g` };
  }
  if (unit === "kg" && candidate.serving.grams) {
    return { factor: (quantity * 1000) / candidate.serving.grams, servingText: `${quantity} kg` };
  }
  if (unit === "ml" && candidate.serving.milliliters) {
    return { factor: quantity / candidate.serving.milliliters, servingText: `${quantity} ml` };
  }
  if (unit === "l" && candidate.serving.milliliters) {
    return { factor: (quantity * 1000) / candidate.serving.milliliters, servingText: `${quantity} l` };
  }

  const candidateUnit = normalizedUnit(candidate.serving.unit);
  if (candidateUnit && candidateUnit === unit) {
    return { factor: quantity / candidate.serving.quantity, servingText: `${quantity} ${query.unit}` };
  }

  return null;
}

function normalizeNutrition(query: OnlineNutritionLookupQuery, candidate: OnlineNutritionCandidate) {
  const quantityFactor = resolveQuantityFactor(query, candidate);
  if (!quantityFactor) return undefined;
  const { factor, servingText } = quantityFactor;
  return {
    servingText,
    factor: roundNutrition(factor),
    caloriesKcal: roundNutrition(candidate.nutrition.caloriesKcal * factor),
    proteinG: roundNutrition(candidate.nutrition.proteinG * factor),
    carbsG: roundNutrition(candidate.nutrition.carbsG * factor),
    fatG: roundNutrition(candidate.nutrition.fatG * factor),
  };
}

export function selectOnlineNutritionCandidate(
  query: OnlineNutritionLookupQuery,
  candidates: OnlineNutritionCandidate[],
): OnlineNutritionResolvedSource {
  const allowedCandidates = candidates.filter(candidate => isAllowedDomain(candidate.source.domain));
  if (!allowedCandidates.length && candidates.length) {
    return {
      status: "unsafe_source",
      confidence: 0,
      reason: "Nenhuma fonte retornada esta na allowlist de fontes nutricionais online.",
    };
  }
  if (!allowedCandidates.length) {
    return { status: "not_found", confidence: 0, reason: "Nenhuma fonte nutricional online foi encontrada." };
  }

  const scored = allowedCandidates
    .map(candidate => ({ candidate, ...scoreCandidateSimilarity(query, candidate) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;

  if (!best || best.score < 0.7) {
    return {
      status: "not_found",
      confidence: best?.score ?? 0,
      reason: best?.reason ?? "Nenhum candidato atingiu confiança minima.",
      alternatives: allowedCandidates,
    };
  }

  if (second && Math.abs(best.score - second.score) < 0.08) {
    return {
      status: "ambiguous",
      confidence: best.score,
      reason: "Fontes candidatas ficaram muito proximas; precisa de revisao ou esclarecimento.",
      candidate: best.candidate,
      alternatives: [best.candidate, second.candidate],
    };
  }

  const normalizedNutrition = normalizeNutrition(query, best.candidate);
  if (!normalizedNutrition) {
    return {
      status: "similar",
      confidence: Math.min(best.score, 0.74),
      reason: "Fonte plausivel encontrada, mas a porcao informada nao e convertivel com seguranca.",
      candidate: best.candidate,
    };
  }

  return {
    status: best.score >= 0.86 ? "exact" : "similar",
    confidence: best.score,
    reason: best.reason,
    candidate: best.candidate,
    normalizedNutrition,
  };
}

export async function lookupOnlineNutritionSource(
  query: OnlineNutritionLookupQuery,
  provider?: OnlineNutritionSearchProvider,
): Promise<OnlineNutritionResolvedSource> {
  if (!shouldLookupOnlineNutritionSource(query)) {
    return { status: "skipped", confidence: 0, reason: "Busca online ignorada: sem marca ou fonte interna exata ja disponivel." };
  }
  if (!provider) {
    return { status: "not_found", confidence: 0, reason: "Nenhum provider de busca nutricional online configurado." };
  }

  try {
    const candidates = await provider.search(query);
    return selectOnlineNutritionCandidate(query, candidates);
  } catch (error) {
    return {
      status: "provider_error",
      confidence: 0,
      reason: "Provider de busca nutricional online falhou; usar fallback seguro da selecao de fonte.",
      errorCode: error instanceof Error ? error.message : "ONLINE_NUTRITION_PROVIDER_ERROR",
    };
  }
}
