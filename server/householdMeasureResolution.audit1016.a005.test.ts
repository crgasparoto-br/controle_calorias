import { describe, expect, it, vi } from "vitest";
import { resolveHouseholdMeasure } from "./householdMeasureResolution";

function baseRuntime() {
  return {
    searchGlobalFoodCatalog: vi.fn(async () => []),
    getGlobalFoodCatalogItem: vi.fn(),
    convertFoodPortionToGrams: vi.fn(),
    resolveCapabilityConfig: vi.fn(() => ({
      state: "enabled",
      primary: { provider: "openai", model: "test" },
      fallbacks: [],
    })),
    executeResolvedCapability: vi.fn(async (_policy: unknown, execute: (attempt: any) => Promise<any>) => ({
      value: await execute({ provider: { id: "openai" }, model: "test", signal: undefined }),
      provider: "openai",
      model: "test",
    })),
    createDomainTextResponse: vi.fn(),
  };
}

type Scenario = {
  foodName: string;
  foodTypeName: string;
  unit: string;
  grams: number;
  wrongRelation: string;
};

function exactReference(scenario: Scenario) {
  return {
    matchedFoodName: scenario.foodName,
    foodTypeName: scenario.foodTypeName,
    brandName: "",
    measureUnit: scenario.unit,
    measureQuantity: 1,
    grams: scenario.grams,
    referenceKind: "exact_product",
    describesTypicalMeasure: false,
    sourceUrl: "https://example.com/mixed-food-page",
    evidence: `${scenario.foodName}. ${scenario.wrongRelation}`,
  };
}

function searchedResponse(reference: ReturnType<typeof exactReference>, supportingText: string[], title = "Tabela de medidas") {
  return {
    id: "resp-audit-1016-a005",
    outputText: JSON.stringify({ found: true, references: [reference] }),
    webSearch: {
      executed: true,
      searchCount: 1,
      sources: [{ url: reference.sourceUrl, title, supportingText }],
    },
    raw: {},
  };
}

describe("resolveHouseholdMeasure — A-005 vínculo alimento + relação física no mesmo contexto", () => {
  it.each([
    {
      foodName: "Queijo mussarela",
      foodTypeName: "mussarela",
      unit: "fatia",
      grams: 20,
      wrongRelation: "Presunto cozido: 1 fatia pesa 20 g",
    },
    {
      foodName: "Requeijão cremoso",
      foodTypeName: "requeijão cremoso",
      unit: "colher de sopa",
      grams: 15,
      wrongRelation: "Manteiga: 1 colher de sopa pesa 15 g",
    },
    {
      foodName: "Iogurte natural",
      foodTypeName: "iogurte natural",
      unit: "unidade",
      grams: 170,
      wrongRelation: "Sobremesa láctea: 1 unidade pesa 170 g",
    },
  ])("rejeita relação de outro alimento mesmo quando a mesma fonte também menciona $foodName", async scenario => {
    const runtime = baseRuntime();
    const reference = exactReference(scenario);
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse(reference, [
      `${scenario.foodName}.`,
      `${scenario.wrongRelation}.`,
    ]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: scenario.foodName,
      quantity: 1,
      unit: scenario.unit,
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("rejeita média usual cuja típica pertence a outro alimento no mesmo resultado de busca", async () => {
    const runtime = baseRuntime();
    const reference = {
      ...exactReference({
        foodName: "Queijo mussarela",
        foodTypeName: "mussarela",
        unit: "fatia",
        grams: 24,
        wrongRelation: "Presunto cozido: 1 fatia pesa em média 24 g",
      }),
      referenceKind: "same_food_type",
      describesTypicalMeasure: true,
      evidence: "Queijo mussarela. Presunto cozido: 1 fatia pesa em média 24 g.",
    };
    runtime.createDomainTextResponse.mockResolvedValueOnce({
      ...searchedResponse(reference as any, [
        "Queijo mussarela.",
        "Presunto cozido: 1 fatia pesa em média 24 g.",
      ]),
    } as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("aceita snippet neutro quando o título da própria fonte fornece a identidade exata", async () => {
    const runtime = baseRuntime();
    const reference = exactReference({
      foodName: "Queijo mussarela",
      foodTypeName: "mussarela",
      unit: "fatia",
      grams: 18,
      wrongRelation: "1 fatia pesa 18 g",
    });
    reference.evidence = "Queijo mussarela: 1 fatia pesa 18 g.";
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse(
      reference,
      ["1 fatia pesa 18 g."],
      "Queijo mussarela",
    ) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 2,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "researched_exact",
      grams: 36,
    }));
  });
});
