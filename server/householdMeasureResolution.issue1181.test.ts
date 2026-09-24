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
    loadPersistedHouseholdMeasureResolution: vi.fn(async () => null),
    persistHouseholdMeasureResolution: vi.fn(async () => true),
  };
}

function reference(input: Partial<Record<string, unknown>> = {}) {
  return {
    matchedFoodName: "Pêra",
    foodTypeName: "pêra",
    brandName: "",
    measureUnit: "unidade",
    measureQuantity: 1,
    grams: 150,
    referenceKind: "same_food_type",
    describesTypicalMeasure: false,
    sourceUrl: "https://example.test/pera-a",
    evidence: "1 unidade de pêra pesa 150 g.",
    ...input,
  };
}

function searchedResponse(references: unknown[]) {
  return {
    id: "resp-1181",
    outputText: JSON.stringify({ found: true, references }),
    webSearch: {
      executed: true,
      searchCount: 1,
      sources: (references as Array<{ sourceUrl: string; evidence: string }>).map(item => ({
        url: item.sourceUrl,
        title: "Referência de pêra",
        supportingText: [item.evidence],
      })),
    },
    raw: {},
  };
}

const input = {
  userId: 1181,
  foodName: "pêra packans",
  quantity: 1,
  unit: "unidade",
};

describe("resolveHouseholdMeasure (#1181)", () => {
  it("usa uma referência same_food_type como estimativa contextual sem substituir a identidade", async () => {
    const runtime = baseRuntime();
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([reference()]));

    await expect(resolveHouseholdMeasure(input, runtime as any)).resolves.toEqual(expect.objectContaining({
      kind: "contextual_estimate",
      grams: 150,
      requestedQuantity: 1,
      requestedUnit: "unidade",
      sourceUrls: ["https://example.test/pera-a"],
    }));
  });

  it("prefere a referência específica verificável da variedade à média genérica", async () => {
    const runtime = baseRuntime();
    const specific = reference({
      matchedFoodName: "Pêra Packans",
      foodTypeName: "pêra",
      grams: 175,
      referenceKind: "exact_product",
      sourceUrl: "https://example.test/pera-packans",
      evidence: "1 unidade de pêra Packans pesa 175 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([
      specific,
      reference(),
    ]));

    await expect(resolveHouseholdMeasure(input, runtime as any)).resolves.toEqual(expect.objectContaining({
      kind: "researched_exact",
      grams: 175,
      sourceUrls: ["https://example.test/pera-packans"],
    }));
  });

  it("produz usual_average para duas referências coerentes", async () => {
    const runtime = baseRuntime();
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([
      reference(),
      reference({
        grams: 160,
        sourceUrl: "https://example.test/pera-b",
        evidence: "1 unidade de pêra pesa 160 g.",
      }),
    ]));

    await expect(resolveHouseholdMeasure(input, runtime as any)).resolves.toEqual(expect.objectContaining({
      kind: "usual_average",
      grams: 155,
      referenceCount: 2,
    }));
  });

  it("mantém clarificação quando referências da mesma fruta divergem materialmente", async () => {
    const runtime = baseRuntime();
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([
      reference(),
      reference({
        grams: 280,
        sourceUrl: "https://example.test/pera-b",
        evidence: "1 unidade de pêra pesa 280 g.",
      }),
    ]));

    await expect(resolveHouseholdMeasure(input, runtime as any)).resolves.toBeNull();
    expect(runtime.persistHouseholdMeasureResolution).not.toHaveBeenCalled();
  });

  it("não estima medida estruturalmente ambígua como pedaço", async () => {
    const runtime = baseRuntime();
    const ambiguousInput = { ...input, unit: "pedaço" };
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([reference({
      measureUnit: "pedaço",
      sourceUrl: "https://example.test/pera-pedaco",
      evidence: "1 pedaço de pêra pesa 75 g.",
    })]));

    await expect(resolveHouseholdMeasure(ambiguousInput, runtime as any)).resolves.toBeNull();
  });
});
