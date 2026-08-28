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

function exactReference(input: {
  foodName: string;
  foodTypeName: string;
  unit: string;
  grams: number;
  sourceUrl: string;
  evidence: string;
}) {
  return {
    matchedFoodName: input.foodName,
    foodTypeName: input.foodTypeName,
    brandName: "",
    measureUnit: input.unit,
    measureQuantity: 1,
    grams: input.grams,
    referenceKind: "exact_product",
    describesTypicalMeasure: false,
    sourceUrl: input.sourceUrl,
    evidence: input.evidence,
  };
}

function searchedResponse(reference: ReturnType<typeof exactReference>) {
  return {
    id: "resp-audit-1016-a003",
    outputText: JSON.stringify({ found: true, references: [reference] }),
    webSearch: {
      executed: true,
      searchCount: 1,
      sources: [{
        url: reference.sourceUrl,
        title: "Fonte da medida",
        supportingText: [reference.evidence],
      }],
    },
    raw: {},
  };
}

describe("resolveHouseholdMeasure — A-003 relação física entre medida e gramas", () => {
  it.each([
    {
      foodName: "Queijo mussarela",
      foodTypeName: "mussarela",
      unit: "fatia",
      evidence: "Queijo mussarela. Porção: 1 fatia. Informação nutricional declarada por 100 g.",
    },
    {
      foodName: "Iogurte natural",
      foodTypeName: "iogurte natural",
      unit: "unidade",
      evidence: "Iogurte natural. Porção: 1 unidade. Valores nutricionais por 100 g.",
    },
    {
      foodName: "Requeijão cremoso",
      foodTypeName: "requeijão cremoso",
      unit: "colher de sopa",
      evidence: "Requeijão cremoso. Porção: 1 colher de sopa. Tabela nutricional a cada 100 g.",
    },
  ])("rejeita base nutricional de 100 g como peso de $unit", async scenario => {
    const runtime = baseRuntime();
    const reference = exactReference({
      ...scenario,
      grams: 100,
      sourceUrl: `https://example.com/${scenario.unit.replace(/\s+/g, "-")}`,
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse(reference) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: scenario.foodName,
      quantity: 1,
      unit: scenario.unit,
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("aceita peso explícito da fatia mesmo quando a mesma fonte também publica nutrientes por 100 g", async () => {
    const runtime = baseRuntime();
    const reference = exactReference({
      foodName: "Queijo mussarela",
      foodTypeName: "mussarela",
      unit: "fatia",
      grams: 18,
      sourceUrl: "https://example.com/mussarela-explicita",
      evidence: "Queijo mussarela. 1 fatia pesa 18 g. Informação nutricional declarada por 100 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse(reference) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "researched_exact",
      grams: 18,
      referenceCount: 1,
    }));
  });

  it("aceita gramatura parentética vinculada à medida e ignora a base nutricional de 100 g", async () => {
    const runtime = baseRuntime();
    const reference = exactReference({
      foodName: "Requeijão cremoso",
      foodTypeName: "requeijão cremoso",
      unit: "colher de sopa",
      grams: 15,
      sourceUrl: "https://example.com/requeijao-parenteses",
      evidence: "Requeijão cremoso. Porção: 1 colher de sopa (15 g). Tabela nutricional por 100 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse(reference) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Requeijão cremoso",
      quantity: 2,
      unit: "colher de sopa",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "researched_exact",
      grams: 30,
      referenceCount: 1,
    }));
  });
});
