import { findCatalogFood } from "./catalogMatching";
import { extractCommercialVariant } from "./commercialProductIdentity";
import { MealInferenceError, processMealInput } from "./nutritionEngine";

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
  request: CommercialIdentityPreflightRequest,
) {
  if (/\bcom\b/i.test(request.foodName)) return null;

  const productVariant = extractCommercialVariant(request.foodName);
  if (!productVariant) return null;

  const variantTokens = productVariant.split(/\s+/).filter(Boolean);
  if (variantTokens.some(token => GENERIC_ZERO_COMMERCIAL_VARIANTS.has(token))) {
    return null;
  }

  const local = findCatalogFood(request.foodName);
  const localVariant = local ? extractCommercialVariant(local.name) : null;
  if (localVariant) {
    const localVariantTokens = new Set(localVariant.split(/\s+/).filter(Boolean));
    if (variantTokens.every(token => localVariantTokens.has(token))) return null;
  }

  return productVariant;
}

function buildUnverifiedCommercialIdentityClarification(
  request: CommercialIdentityPreflightRequest,
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
 * Shared commercial identity preflight for countable WhatsApp producers.
 * It reuses the canonical nutrition processor and its clarification taxonomy
 * before any generic household-measure fallback is allowed to run.
 */
export async function recoverCanonicalCommercialIdentity(
  request: CommercialIdentityPreflightRequest,
  runtime: { processMealInput: typeof processMealInput } = { processMealInput },
): Promise<CanonicalCommercialIdentityPreflight> {
  if (request.brand) return { brand: request.brand };

  try {
    const processed = await runtime.processMealInput({ text: request.segment });
    if (processed.items.length !== 1) return { brand: null };
    const brand = processed.items[0].brand?.trim() || null;
    if (brand) return { brand };
    if (inferUnverifiedCommercialVariant(request)) {
      return buildUnverifiedCommercialIdentityClarification(request);
    }
    return { brand: null };
  } catch (error) {
    if (
      !(error instanceof MealInferenceError)
      || !error.context?.clarificationReason
    ) {
      return { brand: null };
    }

    return {
      brand: error.context.brand?.trim() || null,
      identityClarification: {
        message: error.message,
        context: error.context,
      },
    };
  }
}
