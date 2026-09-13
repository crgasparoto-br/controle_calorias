import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood } from "../../nutritionEngineTypes";

const boundary = vi.hoisted(() => ({
  catalog: [] as CatalogFood[],
  search: vi.fn(),
  extraction: vi.fn(),
  measureSearch: vi.fn(),
}));

vi.mock("../../catalogRuntime", () => ({
  getCatalogCache: () => boundary.catalog,
}));
vi.mock("../../catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => boundary.search(...args),
}));
vi.mock("../../mealAiExtraction", () => ({
  extractWithAi: (...args: unknown[]) => boundary.extraction(...args),
}));
vi.mock("../../_core/ai/domainTextResponse", () => ({
  createDomainTextResponse: (...args: unknown[]) => boundary.measureSearch(...args),
}));
vi.mock("../../db", () => ({
  getDb: async () => null,
  logPersistenceWarning: vi.fn(),
  getHabitSnapshots: async () => [],
}));
vi.mock("../foods/service", () => ({
  searchGlobalFoodCatalog: async () => [],
  getGlobalFoodCatalogItem: vi.fn(),
  convertFoodPortionToGrams: vi.fn(),
}));

import { prepareWhatsappCountableFoodRegistration } from "./countableFoodRegistrationGate";
import { detectKnownBrand } from "../../foodBrandDetection";
import { parseFoodText, splitFoodTextSegments } from "../../mealTextParsing";

const now = new Date("2026-09-13T15:00:00.000Z");

function catalogFood(input: {
  name: string;
  servingLabel: string;
  gramsPerServing: number;
  brandName?: string | null;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}): CatalogFood {
  const brandName = input.brandName ?? null;
  return {
    slug: input.name.toLowerCase().replace(/\s+/g, "-"),
    name: input.name,
    aliases: [input.name],
    servingLabel: input.servingLabel,
    gramsPerServing: input.gramsPerServing,
    calories: input.calories ?? 100,
    protein: input.protein ?? 5,
    carbs: input.carbs ?? 10,
    fat: input.fat ?? 3,
    brandName,
    isBrandedProduct: Boolean(brandName),
    ...(brandName ? {
      productVariant: input.name.toLowerCase().includes("premium") ? "premium" : null,
      variants: [input.name],
      researchIdentityKey: `nutrition-research-v1:${input.name}`,
      sourceUrls: [`https://fabricante.example/${encodeURIComponent(input.name)}`],
      sourceEvidence: `${input.name}. Porção de ${input.gramsPerServing} g (${input.servingLabel.replace(/\s*\([^)]*\)\s*$/, "")}): ${input.calories ?? 100} kcal, proteínas ${input.protein ?? 5} g, carboidratos ${input.carbs ?? 10} g, gorduras totais ${input.fat ?? 3} g.`,
      sourceVerifiedAt: now,
      sourceConfidence: 0.96,
    } : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.catalog = [
    catalogFood({
      name: "Pão de Forma Panco Premium",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
      brandName: "Panco",
      calories: 127,
      protein: 4,
      carbs: 24,
      fat: 2,
    }),
    catalogFood({
      name: "Presunto",
      servingLabel: "1 fatia",
      gramsPerServing: 30,
    }),
    catalogFood({
      name: "Mussarela",
      servingLabel: "1 fatia",
      gramsPerServing: 40,
    }),
  ];
  boundary.search.mockResolvedValue(null);
  boundary.measureSearch.mockRejectedValue(new Error("measure search should not be needed"));
  boundary.extraction.mockImplementation(async ({ text }) => ({
    mealLabel: "Café da manhã",
    confidence: 0.95,
    reasoning: "Extração determinística no boundary externo.",
    items: splitFoodTextSegments(text).map(segment => {
      const parsed = parseFoodText(segment);
      return {
        ...parsed,
        brand: detectKnownBrand(parsed.foodName),
        portionText: parsed.portionText ?? segment,
        servings: 1,
        estimatedGrams: parsed.estimatedGrams ?? 0,
        estimatedCalories: 0,
        estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
        confidence: 0.95,
      };
    }),
  }));
});

describe("#1072 — caminho real do gate contável do WhatsApp", () => {
  it("resolve o cenário multi-item com 1 fatia Panco Premium sem clarificação indevida", async () => {
    const text = "50ml leite integral, 1 fatia de pão de forma panco Premium, 35g de requeijão catupiry, 1 fatia de presunto, 1 fatia de mussarela";

    const result = await prepareWhatsappCountableFoodRegistration({
      userId: 1072,
      text,
      originalText: text,
      receivedAt: now,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toMatchObject({
      kind: "ready",
      resolutions: expect.arrayContaining([
        expect.objectContaining({
          request: expect.objectContaining({
            foodName: expect.stringMatching(/pão de forma panco Premium/i),
            brand: "Panco",
            count: 1,
            requestedUnit: "fatia",
          }),
          resolution: expect.objectContaining({
            kind: "researched_exact",
            grams: 25,
          }),
        }),
      ]),
    });
    expect(result.kind === "ready" && result.registrationText).toContain(
      "25 g de pão de forma panco Premium",
    );
    expect(boundary.measureSearch).not.toHaveBeenCalled();
  });
});
