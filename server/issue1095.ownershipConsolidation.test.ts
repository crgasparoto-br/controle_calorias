import { describe, expect, it } from "vitest";
import {
  isCommercialProductIdentityCompatible,
  isPersistedProductIdentityCompatible,
} from "./commercialProductIdentity";
import { resolveStructuredCommercialIdentity } from "./commercialFoodIdentityPreflight";
import { materializeResolvedCommercialMeal } from "./resolvedCommercialMealMaterialization";
import { buildMealSemanticContract } from "./mealSemanticContract";
import type { CatalogFood } from "./nutritionEngineTypes";

const verifiedAt = new Date("2026-09-16T00:00:00.000Z");

function pancoFood(): CatalogFood {
  return {
    slug: "pao-de-forma-panco-premium",
    name: "Pão de Forma Panco Premium",
    aliases: ["Pão de Forma Panco Premium"],
    servingLabel: "2 fatias (50 g)",
    gramsPerServing: 50,
    calories: 127,
    protein: 4,
    carbs: 24,
    fat: 2,
    brandName: "Panco",
    productVariant: "premium",
    isBrandedProduct: true,
    researchIdentityKey: "verified:panco-premium",
    sourceUrls: ["https://example.test/panco-premium"],
    sourceEvidence: "Pão de Forma Panco Premium: 2 fatias correspondem a 50 g.",
    sourceVerifiedAt: verifiedAt,
    sourceConfidence: 0.96,
  };
}

describe("issue #1095 — ownership consolidation", () => {
  it("reutiliza a comparação comum sem misturar os guards de candidato e identidade persistida", () => {
    const accepted = {
      foodName: "1 fatia de pão de forma Panco Premium",
      matchedProductName: "Pão de Forma Panco Premium",
      brandName: "Panco",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
    };
    const conflictingVariant = {
      ...accepted,
      matchedProductName: "Pão de Forma Panco Integral",
    };

    expect(isPersistedProductIdentityCompatible(accepted)).toBe(true);
    expect(isCommercialProductIdentityCompatible(accepted)).toBe(true);
    expect(isPersistedProductIdentityCompatible(conflictingVariant)).toBe(false);
    expect(isCommercialProductIdentityCompatible(conflictingVariant)).toBe(false);
    expect(isCommercialProductIdentityCompatible({
      ...accepted,
      foodName: "Pão de forma Panco",
    })).toBe(false);

    const persistedWithDescriptiveSuffix = {
      ...accepted,
      matchedProductName: "Pão de Forma Panco Premium Especial",
    };
    expect(isPersistedProductIdentityCompatible(persistedWithDescriptiveSuffix)).toBe(true);
    expect(isCommercialProductIdentityCompatible(persistedWithDescriptiveSuffix)).toBe(false);
  });

  it("resolve a identidade textual estruturada sem executar o pipeline geral", () => {
    expect(resolveStructuredCommercialIdentity({
      segment: "2 fatias de pão de forma Panco",
      foodName: "pão de forma Panco",
      brand: null,
    })).toEqual({ brand: "Panco" });

    expect(resolveStructuredCommercialIdentity({
      segment: "2 fatias de pão de forma integral",
      foodName: "pão de forma integral",
      brand: null,
    })).toMatchObject({
      brand: null,
      identityClarification: {
        context: { clarificationReason: "commercial_identity_unverified" },
      },
    });
  });

  it("materializa o mesmo CatalogFood e preserva evidência original e gramas derivados", () => {
    const food = pancoFood();
    const processed = materializeResolvedCommercialMeal({
      resolved: {
        segmentIndex: 0,
        request: {
          segment: "1 fatia de pão de forma Panco Premium",
          foodName: "pão de forma Panco Premium",
          brand: "Panco",
          count: 1,
          requestedUnit: "fatia",
        },
        resolution: {
          kind: "researched_exact",
          grams: 25,
          requestedQuantity: 1,
          requestedUnit: "fatia",
          sourceUrls: ["https://measure.example/panco-premium"],
          evidence: "1 fatia corresponde a 25 g.",
          referenceCount: 1,
        },
        commercialFood: food,
      },
      occurredAt: verifiedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(processed.sourceText).toBe("1 fatia de pão de forma Panco Premium");
    expect(processed.items[0]).toEqual(expect.objectContaining({
      brand: "Panco",
      quantity: 1,
      unit: "fatia",
      estimatedGrams: 25,
      calories: 63.5,
      protein: 2,
      carbs: 12,
      fat: 1,
      resolution: expect.objectContaining({
        productVariant: "premium",
        nutritionOrigin: "web_research",
        nutritionVerified: true,
        sourceUrls: ["https://example.test/panco-premium"],
        sourceEvidence: "Pão de Forma Panco Premium: 2 fatias correspondem a 50 g.",
        sourceVerifiedAt: verifiedAt,
        measureResolution: expect.objectContaining({
          kind: "researched_exact",
          grams: 25,
          requestedQuantity: 1,
          requestedUnit: "fatia",
          verified: true,
        }),
      }),
    }));
    expect(processed.semanticContract).toMatchObject({
      originalText: "1 fatia de pão de forma Panco Premium",
      items: [expect.objectContaining({
        quantity: 1,
        unit: "fatia",
        estimatedGrams: 25,
        brand: "Panco",
        productVariant: "premium",
        needsClarification: false,
        evidence: expect.objectContaining({
          nutrition: expect.objectContaining({
            value: expect.objectContaining({
              calories: 63.5,
              protein: 2,
              carbs: 12,
              fat: 1,
              sourceUrls: ["https://example.test/panco-premium"],
              sourceEvidence: "Pão de Forma Panco Premium: 2 fatias correspondem a 50 g.",
              sourceVerifiedAt: verifiedAt.toISOString(),
            }),
          }),
        }),
      })],
    });

    const rehydratedItem = structuredClone(processed.items[0]);
    rehydratedItem.resolution = {
      ...rehydratedItem.resolution,
      sourceVerifiedAt: verifiedAt.toISOString(),
    };
    const rehydratedContract = buildMealSemanticContract({
      processingInput: { text: processed.sourceText },
      sourceText: processed.sourceText,
      items: [rehydratedItem],
    });
    expect(rehydratedContract.items[0]?.evidence.nutrition.value.sourceVerifiedAt)
      .toBe(verifiedAt.toISOString());
  });
});
