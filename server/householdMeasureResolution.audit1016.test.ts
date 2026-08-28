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

function reference(input: Partial<Record<string, unknown>> = {}) {
  return {
    matchedFoodName: "Queijo mussarela",
    foodTypeName: "mussarela",
    brandName: "Marca A",
    measureUnit: "fatia",
    measureQuantity: 1,
    grams: 20,
    referenceKind: "same_food_type",
    describesTypicalMeasure: false,
    sourceUrl: "https://example.com/mussarela-a",
    evidence: "1 fatia de queijo mussarela pesa 20 g.",
    ...input,
  };
}

function searchedResponse(
  references: unknown[],
  sources?: Array<{ url: string; title?: string; supportingText?: string[] }>,
) {
  const linkedSources = sources ?? (references as Array<{ sourceUrl: string; evidence: string }>).map(item => ({
    url: item.sourceUrl,
    title: "Fonte de medida caseira",
    supportingText: [item.evidence],
  }));
  return {
    id: "resp-audit-1016",
    outputText: JSON.stringify({ found: true, references }),
    webSearch: { executed: true, searchCount: 1, sources: linkedSources },
    raw: {},
  };
}

describe("resolveHouseholdMeasure — remediação da auditoria independente #1016", () => {
  it("A-001 rejeita food_portions de alimento diferente mesmo quando a marca coincide", async () => {
    const runtime = baseRuntime();
    runtime.searchGlobalFoodCatalog.mockResolvedValueOnce([{
      id: 77,
      name: "Queijo mussarela Sadia",
      brandName: "Sadia",
    }] as any);
    runtime.resolveCapabilityConfig.mockReturnValue({ state: "disabled", primary: null, fallbacks: [] } as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Presunto cozido",
      brand: "Sadia",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
    expect(runtime.getGlobalFoodCatalogItem).not.toHaveBeenCalled();
    expect(runtime.convertFoodPortionToGrams).not.toHaveBeenCalled();
  });

  it.each([
    {
      requestedFood: "Presunto cozido",
      brand: "Sadia",
      matchedFoodName: "Queijo mussarela Sadia",
      foodTypeName: "mussarela",
      evidence: "Queijo mussarela Sadia: 1 fatia corresponde a 17 g.",
    },
    {
      requestedFood: "Requeijão Catupiry Light",
      brand: "Catupiry",
      matchedFoodName: "Queijo prato Catupiry Light",
      foodTypeName: "queijo prato",
      evidence: "Queijo prato Catupiry Light: 1 fatia corresponde a 17 g.",
    },
  ])("A-001 rejeita referência exata de outro alimento: $requestedFood", async scenario => {
    const runtime = baseRuntime();
    const unrelated = reference({
      matchedFoodName: scenario.matchedFoodName,
      foodTypeName: scenario.foodTypeName,
      brandName: scenario.brand,
      grams: 17,
      referenceKind: "exact_product",
      sourceUrl: "https://example.com/referencia-incorreta",
      evidence: scenario.evidence,
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([unrelated]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: scenario.requestedFood,
      brand: scenario.brand,
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("A-001 exige que a fonte vinculada também identifique o mesmo alimento", async () => {
    const runtime = baseRuntime();
    const metadataClaimsHam = reference({
      matchedFoodName: "Presunto cozido Sadia",
      foodTypeName: "presunto cozido",
      brandName: "Sadia",
      grams: 17,
      referenceKind: "exact_product",
      sourceUrl: "https://example.com/fonte-divergente",
      evidence: "Presunto cozido Sadia: 1 fatia corresponde a 17 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([metadataClaimsHam], [{
      url: "https://example.com/fonte-divergente",
      title: "Tabela de porções",
      supportingText: ["Queijo mussarela Sadia: 1 fatia corresponde a 17 g."],
    }]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Presunto cozido",
      brand: "Sadia",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("A-002 rejeita flag typical quando a fonte só informa uma porção específica", async () => {
    const runtime = baseRuntime();
    const falselyTypical = reference({
      describesTypicalMeasure: true,
      evidence: "1 fatia de queijo mussarela pesa 20 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([falselyTypical]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("A-002 rejeita typical inventado na evidência estruturada quando a fonte vinculada não o declara", async () => {
    const runtime = baseRuntime();
    const falselyTypical = reference({
      describesTypicalMeasure: true,
      evidence: "Uma fatia típica de queijo mussarela pesa em média 20 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([falselyTypical], [{
      url: "https://example.com/mussarela-a",
      title: "Tabela de porções",
      supportingText: ["1 fatia de queijo mussarela pesa 20 g."],
    }]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("preserva o caminho positivo quando a própria fonte declara medida típica", async () => {
    const runtime = baseRuntime();
    const typical = reference({
      describesTypicalMeasure: true,
      evidence: "Uma fatia típica de queijo mussarela pesa em média 20 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([typical]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo muçarela",
      quantity: 2,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "usual_average",
      grams: 40,
      referenceCount: 1,
    }));
  });
});
