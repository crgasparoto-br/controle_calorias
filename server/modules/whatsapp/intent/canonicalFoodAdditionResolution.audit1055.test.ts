import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood } from "../../../nutritionEngineTypes";

const boundary = vi.hoisted(() => ({
  catalog: [] as CatalogFood[],
  search: vi.fn(),
  extraction: vi.fn(),
  measureSearch: vi.fn(),
}));

vi.mock("../../../catalogRuntime", () => ({
  getCatalogCache: () => boundary.catalog,
}));
vi.mock("../../../catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => boundary.search(...args),
}));
vi.mock("../../../mealAiExtraction", () => ({
  extractWithAi: (...args: unknown[]) => boundary.extraction(...args),
}));
vi.mock("../../../_core/ai/domainTextResponse", () => ({
  createDomainTextResponse: (...args: unknown[]) => boundary.measureSearch(...args),
}));
vi.mock("../../../db", () => ({
  getDb: async () => null,
  logPersistenceWarning: vi.fn(),
  getHabitSnapshots: async () => [],
}));
vi.mock("../../foods/service", () => ({
  searchGlobalFoodCatalog: async () => [],
  getGlobalFoodCatalogItem: vi.fn(),
  convertFoodPortionToGrams: vi.fn(),
}));

import { detectKnownBrand } from "../../../foodBrandDetection";
import { resolveCanonicalFoodAdditionItems } from "./canonicalFoodAdditionResolution";

const now = new Date("2026-09-09T10:00:00Z");

const genericBread: CatalogFood = {
  slug: "pao-de-forma",
  name: "Pão de forma",
  aliases: ["Pão de forma"],
  brandName: "",
  isBrandedProduct: false,
  servingLabel: "2 fatias (50 g)",
  gramsPerServing: 50,
  calories: 127,
  protein: 4,
  carbs: 24,
  fat: 2,
};

function brandedBread(brand: string): CatalogFood {
  const name = `Pão de forma ${brand}`;
  return {
    ...genericBread,
    slug: `pao-de-forma-${brand.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    aliases: [name],
    brandName: brand,
    isBrandedProduct: true,
    researchIdentityKey: `verified:${name}`,
    sourceUrls: [`https://example.test/${encodeURIComponent(name)}`],
    sourceEvidence: "Porção verificada: 2 fatias (50 g).",
    sourceVerifiedAt: now,
    sourceConfidence: 0.95,
  };
}

function extractionFor(brand: string) {
  return {
    mealLabel: "Café da manhã",
    confidence: 0.95,
    reasoning: "Marca explícita preservada pelo pipeline canônico.",
    items: [{
      foodName: "pão de forma",
      brand,
      quantity: 2,
      unit: "fatia",
      portionText: `2 fatias de pão de forma ${brand}`,
      servings: 1,
      estimatedGrams: 0,
      estimatedCalories: 0,
      estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
      confidence: 0.95,
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.catalog = [genericBread];
  boundary.search.mockResolvedValue(null);
  boundary.measureSearch.mockRejectedValue(new Error("measure search must not win"));
});

describe("audit #1055 — propagação da precedência para adição em refeição", () => {
  it("recupera marca fora da allowlist antes de qualquer porção genérica", async () => {
    const brand = "Seven Boys";
    expect(detectKnownBrand(`pão de forma ${brand}`)).toBeNull();
    boundary.extraction.mockResolvedValue(extractionFor(brand));
    boundary.search.mockResolvedValue(brandedBread(brand));

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 105507,
      addition: {
        mealLabel: "Café da manhã",
        date: now,
        items: [{
          foodName: `pão de forma ${brand}`,
          brand: null,
          quantity: 2,
          unit: "fatia",
        }],
      },
      occurredAt: now,
      timeZone: "America/Sao_Paulo",
    });

    expect(result).toMatchObject({
      kind: "items",
      items: [{
        brand,
        estimatedGrams: 50,
        quantityResolution: {
          kind: "researched_exact",
          grams: 50,
        },
      }],
    });
    expect(boundary.search).toHaveBeenCalled();
    expect(boundary.measureSearch).not.toHaveBeenCalled();
  });

  it("provider indisponível mantém a identidade pendente e não pergunta peso", async () => {
    const brand = "Seven Boys";
    expect(detectKnownBrand(`pão de forma ${brand}`)).toBeNull();
    boundary.extraction.mockResolvedValue(extractionFor(brand));
    boundary.search.mockRejectedValue(new Error("search unavailable"));

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 105508,
      addition: {
        mealLabel: "Café da manhã",
        date: now,
        items: [{
          foodName: `pão de forma ${brand}`,
          brand: null,
          quantity: 2,
          unit: "fatia",
        }],
      },
      occurredAt: now,
      timeZone: "America/Sao_Paulo",
    });

    expect(result).toMatchObject({
      kind: "identity_clarification",
      itemIndex: 0,
      context: {
        brand,
        clarificationReason: "brand_variant_unresolved",
      },
    });
    expect(boundary.measureSearch).not.toHaveBeenCalled();
  });
});
