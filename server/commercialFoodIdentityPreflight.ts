import {
  findCatalogFood,
  findNaturalProduceCatalogFood,
  inferUnresolvedCommercialIdentityHint,
} from "./catalogMatching";
import { extractCommercialVariant } from "./commercialProductIdentity";
import { detectKnownBrand } from "./foodBrandDetection";
import type { MealInferenceError } from "./nutritionEngine";

const GENERIC_ZERO_COMMERCIAL_VARIANTS = new Set(["zero", "diet"]);

export type CommercialIdentityPreflightRequest = {
  segment: string;
  foodName: string;
  brand: string | null;
};

export type CommercialIdentityClarification = {
  message: string;
  context: NonNullable<MealInferenceError["context"]>;
};

export type CanonicalCommercialIdentityPreflight = {
  brand: string | null;
  identityClarification?: CommercialIdentityClarification;
};

function inferUnverifiedCommercialVariant(
  request: CommercialIdentityPreflightRequest
) {
  if (/\bcom\b/i.test(request.foodName)) return null;

  const productVariant = extractCommercialVariant(request.foodName);
  if (!productVariant) return null;

  const variantTokens = productVariant.split(/\s+/).filter(Boolean);
  if (
    variantTokens.some(token => GENERIC_ZERO_COMMERCIAL_VARIANTS.has(token))
  ) {
    return null;
  }

  const local = findCatalogFood(request.foodName);
  const localVariant = local ? extractCommercialVariant(local.name) : null;
  if (localVariant) {
    const localVariantTokens = new Set(
      localVariant.split(/\s+/).filter(Boolean)
    );
    if (variantTokens.every(token => localVariantTokens.has(token)))
      return null;
  }

  return productVariant;
}

function buildUnverifiedCommercialIdentityClarification(
  request: CommercialIdentityPreflightRequest
): CanonicalCommercialIdentityPreflight {
  const identity = request.foodName.trim();
  return {
    brand: null,
    identityClarification: {
      message: `Não consegui comprovar a identidade comercial exata de ${identity}. Confirme a variante ou envie um rótulo legível antes de registrar os nutrientes.`,
      context: {
        originalText: request.segment,
        foodName: identity,
        brand: null,
        clarificationReason: "commercial_identity_unverified",
        alternatives: [],
      },
    },
  };
}

/**
 * Resolve somente fatos de identidade já presentes no segmento.
 *
 * A função histórica continua exportada para consumidores antigos, mas deixou
 * de chamar processMealInput. O canal não precisa executar o pipeline geral
 * para redescobrir marca/variante: marcas conhecidas e a heurística de
 * identidade comercial compartilham a mesma evidência textual estruturada.
 */
export function resolveStructuredCommercialIdentity(
  request: CommercialIdentityPreflightRequest
): CanonicalCommercialIdentityPreflight {
  if (request.brand) return { brand: request.brand };

  const knownBrand = detectKnownBrand(request.foodName);
  if (knownBrand) return { brand: knownBrand };

  if (findNaturalProduceCatalogFood(request.foodName)) return { brand: null };

  const hint = inferUnresolvedCommercialIdentityHint(request.foodName);
  if (hint?.brand) return { brand: hint.brand };

  if (inferUnverifiedCommercialVariant(request)) {
    return buildUnverifiedCommercialIdentityClarification(request);
  }

  return { brand: null };
}

/**
 * @deprecated Compatibilidade para integrações externas legadas.
 *
 * O fluxo produtivo de adição canônica usa
 * `resolveStructuredCommercialIdentity` diretamente. Este adaptador permanece
 * exportado somente para consumidores externos que ainda dependem da
 * assinatura assíncrona; ele pode ser removido quando a busca de consumidores
 * fora deste repositório confirmar zero usos. O segundo parâmetro é aceito
 * deliberadamente como legado, mas não é consultado nem reabre o pipeline.
 */
export async function recoverCanonicalCommercialIdentity(
  request: CommercialIdentityPreflightRequest,
  _legacyRuntime?: unknown,
): Promise<CanonicalCommercialIdentityPreflight> {
  return resolveStructuredCommercialIdentity(request);
}

export type { MealInferenceError } from "./nutritionEngine";
