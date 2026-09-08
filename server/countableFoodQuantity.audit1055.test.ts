import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood } from "./nutritionEngineTypes";

const boundary = vi.hoisted(() => ({
  catalog: [] as CatalogFood[],
  search: vi.fn(),
  extraction: vi.fn(),
  measureSearch: vi.fn(),
}));

vi.mock("./catalogRuntime", () => ({
  getCatalogCache: () => boundary.catalog,
}));
vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => boundary.search(...args),
}));
vi.mock("./mealAiExtraction", () => ({
  extractWithAi: (...args: unknown[]) => boundary.extraction(...args),
}));
vi.mock("./_core/ai/domainTextResponse", () => ({
  createDomainTextResponse: (...args: unknown[]) =>
    boundary.measureSearch(...args),
}));
vi.mock("./db", () => ({
  getDb: async () => null,
  logPersistenceWarning: vi.fn(),
  getHabitSnapshots: async () => [],
}));
vi.mock("./modules/foods/service", () => ({
  searchGlobalFoodCatalog: async () => [],
  getGlobalFoodCatalogItem: vi.fn(),
  convertFoodPortionToGrams: vi.fn(),
}));

import {
  prepareCountableFoodRegistrationResolved,
} from "./countableFoodQuantity";
import { detectKnownBrand } from "./foodBrandDetection";

const now = new Date("2026-09-08T12:00:00Z");

function reference(brand: string): CatalogFood {
  const name = `Pão de forma ${brand}`;
  return {
    slug: name,
    name,
    aliases: [name],
    brandName: brand,
    isBrandedProduct: true,
    servingLabel: "2 fatias (50 g)",
    gramsPerServing: 50,
    calories: 127,
    protein: 4,
    carbs: 24,
    fat: 2,
    researchIdentityKey: `verified:${name}`,
    sourceUrls: [`https://example.test/${encodeURIComponent(name)}`],
    sourceEvidence:
      "Porção de 50 g (2 fatias): 127 kcal, 4 g proteínas, 24 g carboidratos, 2 g gorduras.",
    sourceVerifiedAt: now,
    sourceConfidence: 0.95,
  };
}

function extractionFor(brand: string) {
  return {
    mealLabel: "Café da manhã",
    confidence: 0.95,
    reasoning: "Marca extraída do texto pelo pipeline canônico.",
    items: [
      {
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
      },
    ],
  };
}

beforeEach(() => {
  boundary.catalog = [];
  vi.clearAllMocks();
  boundary.search.mockResolvedValue(null);
  boundary.extraction.mockResolvedValue(null);
  boundary.measureSearch.mockRejectedValue(new Error("offline"));
});

describe("audit #1055 — marca explícita fora da allowlist", () => {
  it("recupera a marca pelo pipeline canônico antes de resolver a medida", async () => {
    const brand = "Seven Boys";
    const product = reference(brand);
    expect(detectKnownBrand(`pão de forma ${brand}`)).toBeNull();
    boundary.catalog = [{
      ...reference(""),
      name: "Pão de forma",
      aliases: ["Pão de forma"],
      brandName: "",
      isBrandedProduct: false,
      researchIdentityKey: undefined,
      sourceUrls: [],
      sourceEvidence: null,
    }];
    boundary.extraction.mockResolvedValue(extractionFor(brand));
    boundary.search.mockResolvedValue(product);

    const result = await prepareCountableFoodRegistrationResolved(
      105500,
      `2 fatias de pão de forma ${brand}`
    );

    expect(result.pendingItems).toEqual([]);
    expect(result.registrationText).toBe(`50 g de pão de forma ${brand}`);
    expect(result.resolutions).toMatchObject([
      {
        request: { brand },
        resolution: {
          kind: "researched_exact",
          grams: 50,
          sourceUrls: product.sourceUrls,
        },
      },
    ]);
    expect(boundary.search).toHaveBeenCalled();
    expect(boundary.measureSearch).not.toHaveBeenCalled();
  });

  it("mantém fail-closed quando a pesquisa comercial falha após recuperar a marca", async () => {
    const brand = "Seven Boys";
    expect(detectKnownBrand(`pão de forma ${brand}`)).toBeNull();
    boundary.catalog = [{
      ...reference(""),
      name: "Pão de forma",
      aliases: ["Pão de forma"],
      brandName: "",
      isBrandedProduct: false,
      researchIdentityKey: undefined,
      sourceUrls: [],
      sourceEvidence: null,
    }];
    boundary.extraction.mockResolvedValue(extractionFor(brand));
    boundary.search.mockRejectedValue(new Error("search unavailable"));

    const result = await prepareCountableFoodRegistrationResolved(
      105501,
      `2 fatias de pão de forma ${brand}`
    );

    expect(result.resolutions).toEqual([]);
    expect(result.pendingItems).toHaveLength(1);
    expect(result.pendingItems[0]).toMatchObject({
      brand,
      identityClarification: {
        context: {
          brand,
          clarificationReason: "brand_variant_unresolved",
        },
      },
    });
    expect(boundary.measureSearch).not.toHaveBeenCalled();
  });

  it.each(["Seven Boys", "Pullman"])(
    "mantém %s como identidade pendente quando a extração canônica fica indisponível",
    async brand => {
      expect(detectKnownBrand(`pão de forma ${brand}`)).toBeNull();
      boundary.catalog = [{
        ...reference(""),
        name: "Pão de forma",
        aliases: ["Pão de forma"],
        brandName: "",
        isBrandedProduct: false,
        researchIdentityKey: undefined,
        sourceUrls: [],
        sourceEvidence: null,
      }];
      boundary.extraction.mockRejectedValue(new Error("extraction unavailable"));
      boundary.search.mockRejectedValue(new Error("search unavailable"));

      const result = await prepareCountableFoodRegistrationResolved(
        105503,
        `2 fatias de pão de forma ${brand}`
      );

      expect(result.resolutions).toEqual([]);
      expect(result.pendingItems).toHaveLength(1);
      expect(result.pendingItems[0]).toMatchObject({
        brand,
        identityClarification: {
          context: {
            brand,
            clarificationReason: "brand_variant_unresolved",
          },
        },
      });
      expect(boundary.search).not.toHaveBeenCalled();
      expect(boundary.measureSearch).not.toHaveBeenCalled();
    }
  );

  it("mantém qualificador comercial explícito pendente quando a extração falha", async () => {
    boundary.catalog = [{
      ...reference(""),
      name: "Pão de forma",
      aliases: ["Pão de forma"],
      brandName: "",
      isBrandedProduct: false,
      researchIdentityKey: undefined,
      sourceUrls: [],
      sourceEvidence: null,
    }];
    boundary.extraction.mockRejectedValue(new Error("extraction unavailable"));

    const result = await prepareCountableFoodRegistrationResolved(
      105504,
      "2 fatias de pão de forma integral"
    );

    expect(result.resolutions).toEqual([]);
    expect(result.pendingItems).toHaveLength(1);
    expect(result.pendingItems[0]).toMatchObject({
      brand: null,
      identityClarification: {
        context: {
          brand: null,
          clarificationReason: "commercial_identity_unverified",
        },
      },
    });
    expect(boundary.measureSearch).not.toHaveBeenCalled();
  });

  it("não promove complemento culinário genérico a marca quando a extração falha", async () => {
    boundary.catalog = [{
      ...reference(""),
      name: "Pão de forma",
      aliases: ["Pão de forma"],
      brandName: "",
      isBrandedProduct: false,
      researchIdentityKey: undefined,
      sourceUrls: [],
      sourceEvidence: null,
    }];
    boundary.extraction.mockRejectedValue(new Error("extraction unavailable"));

    const result = await prepareCountableFoodRegistrationResolved(
      105505,
      "2 fatias de pão de forma com manteiga"
    );

    expect(result.resolutions).toEqual([]);
    expect(result.pendingItems).toHaveLength(1);
    expect(result.pendingItems[0].brand).toBeNull();
    expect(result.pendingItems[0].identityClarification).toBeUndefined();
  });

  it("não altera o caminho de uma marca já reconhecida pela fonte existente", async () => {
    const brand = "Panco";
    const product = reference(brand);
    boundary.search.mockResolvedValue(product);

    const result = await prepareCountableFoodRegistrationResolved(
      105502,
      `2 fatias de pão de forma ${brand}`
    );

    expect(result.pendingItems).toEqual([]);
    expect(result.resolutions[0]?.request.brand).toBe(brand);
    expect(boundary.extraction).not.toHaveBeenCalled();
  });
});
