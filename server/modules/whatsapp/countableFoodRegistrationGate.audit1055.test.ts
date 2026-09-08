import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood } from "../../nutritionEngineTypes";

const boundary = vi.hoisted(() => ({
  catalog: [] as CatalogFood[],
  search: vi.fn(),
  extraction: vi.fn(),
  measureSearch: vi.fn(),
  quantityClarification: vi.fn(),
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
vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappConfirmedTextMealQuantityClarification: (...args: unknown[]) =>
    boundary.quantityClarification(...args),
}));
vi.mock("./mealIntentRegistrationDetailsInteraction", () => ({
  createWhatsappMealIntentRegistrationDetailsInteraction: async (input: any) => ({
    handled: true,
    action: "clarification_needed",
    reply: input.prompt,
    data: input.countableContext.clarification,
  }),
}));

import { prepareWhatsappCountableFoodRegistration } from "./countableFoodRegistrationGate";
import { detectKnownBrand } from "../../foodBrandDetection";

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

beforeEach(() => {
  vi.clearAllMocks();
  boundary.catalog = [genericBread];
  boundary.search.mockRejectedValue(new Error("search unavailable"));
  boundary.extraction.mockRejectedValue(new Error("extraction unavailable"));
  boundary.measureSearch.mockRejectedValue(new Error("measure unavailable"));
  boundary.quantityClarification.mockRejectedValue(new Error("weight clarification must not run"));
});

describe("audit #1055 — falha da extração antes da identidade", () => {
  it("preserva marca fora da allowlist e não degrada para pergunta de peso", async () => {
    const brand = "Seven Boys";
    expect(detectKnownBrand(`pão de forma ${brand}`)).toBeNull();

    const result = await prepareWhatsappCountableFoodRegistration({
      userId: 105506,
      text: `2 fatias de pão de forma ${brand}`,
      receivedAt: new Date("2026-09-08T12:00:00Z"),
    });

    expect(result).toMatchObject({
      kind: "clarification",
      result: {
        action: "clarification_needed",
        data: {
          brand,
          clarificationReason: "brand_variant_unresolved",
        },
      },
    });
    if (result.kind !== "clarification") throw new Error("Missing clarification");
    expect(result.result.reply).toMatch(/Seven Boys/);
    expect(result.result.reply).not.toMatch(/Informe somente o peso/);
    expect(boundary.search).not.toHaveBeenCalled();
    expect(boundary.measureSearch).not.toHaveBeenCalled();
    expect(boundary.quantityClarification).not.toHaveBeenCalled();
  });
});
