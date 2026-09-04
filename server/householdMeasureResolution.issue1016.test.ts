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

function searchedResponse(
  references: unknown[],
  sources?: Array<{ url: string; title?: string; supportingText?: string[] }>,
) {
  const linkedSources = sources ?? (references as Array<{ sourceUrl: string; evidence: string }>).map(reference => ({
    url: reference.sourceUrl,
    title: "Fonte de medida caseira",
    supportingText: [reference.evidence],
  }));
  return {
    id: "resp-1016",
    outputText: JSON.stringify({ found: true, references }),
    webSearch: { executed: true, searchCount: 1, sources: linkedSources },
    raw: {},
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

describe("resolveHouseholdMeasure (#1016)", () => {
  it("prioriza food_portions canônico e não abre pesquisa externa", async () => {
    const runtime = baseRuntime();
    runtime.searchGlobalFoodCatalog.mockResolvedValueOnce([{
      id: 41,
      name: "Presunto cozido Sadia",
      brandName: "Sadia",
    }] as any);
    runtime.getGlobalFoodCatalogItem.mockResolvedValueOnce({
      id: 41,
      name: "Presunto cozido Sadia",
      brandName: "Sadia",
      portions: [{ id: 7, label: "1 fatia", unit: "fatia", quantity: 1, grams: 18 }],
    } as any);
    runtime.convertFoodPortionToGrams.mockResolvedValueOnce({ grams: 36 } as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Presunto cozido Sadia",
      brand: "Sadia",
      quantity: 2,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "canonical_portion",
      grams: 36,
      requestedQuantity: 2,
      requestedUnit: "fatia",
    }));
    expect(runtime.convertFoodPortionToGrams).toHaveBeenCalledWith(7, {
      foodId: 41,
      portionId: 7,
      quantity: 2,
    });
    expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();
  });

  it("aceita referência pesquisada exata somente com produto/marca e evidência verificáveis", async () => {
    const runtime = baseRuntime();
    const exact = reference({
      matchedFoodName: "Presunto cozido Sadia",
      foodTypeName: "presunto cozido",
      brandName: "Sadia",
      grams: 17,
      referenceKind: "exact_product",
      sourceUrl: "https://example.com/presunto-sadia",
      evidence: "Presunto cozido Sadia: 1 fatia corresponde a 17 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([exact]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Presunto cozido Sadia",
      brand: "Sadia",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "researched_exact",
      grams: 17,
      sourceUrls: ["https://example.com/presunto-sadia"],
      referenceCount: 1,
    }));
  });

  it("escala referência exata quando a própria fonte declara múltiplas medidas", async () => {
    const runtime = baseRuntime();
    const exact = reference({
      matchedFoodName: "Presunto cozido Sadia",
      foodTypeName: "presunto cozido",
      brandName: "Sadia",
      measureQuantity: 2,
      grams: 34,
      referenceKind: "exact_product",
      sourceUrl: "https://example.com/presunto-sadia-2-fatias",
      evidence: "Presunto cozido Sadia: 2 fatias correspondem a 34 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([exact]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Presunto cozido Sadia",
      brand: "Sadia",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "researched_exact",
      grams: 17,
      referenceCount: 1,
    }));
  });

  it("rejeita quantidade estruturada que não corresponde à relação física publicada pela fonte", async () => {
    const runtime = baseRuntime();
    const tampered = reference({
      matchedFoodName: "Presunto cozido Sadia",
      foodTypeName: "presunto cozido",
      brandName: "Sadia",
      measureQuantity: 1,
      grams: 40,
      referenceKind: "exact_product",
      sourceUrl: "https://example.com/presunto-relacao",
      evidence: "1 fatia de presunto cozido Sadia corresponde a 40 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([tampered], [{
      url: "https://example.com/presunto-relacao",
      title: "Tabela de porções",
      supportingText: ["2 fatias de presunto cozido Sadia correspondem a 40 g."],
    }]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Presunto cozido Sadia",
      brand: "Sadia",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("rejeita unidade estruturada que não é a mesma unidade sustentada pela fonte", async () => {
    const runtime = baseRuntime();
    const tampered = reference({
      describesTypicalMeasure: true,
      evidence: "1 fatia de queijo mussarela pesa em média 20 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([tampered], [{
      url: "https://example.com/mussarela-a",
      title: "Tabela de porções",
      supportingText: ["1 unidade de queijo mussarela pesa em média 20 g."],
    }]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("rejeita uma referência marcada como exata quando pertence a outra marca", async () => {
    const runtime = baseRuntime();
    const wrongBrand = reference({
      matchedFoodName: "Presunto cozido Perdigão",
      foodTypeName: "presunto cozido",
      brandName: "Perdigão",
      grams: 17,
      referenceKind: "exact_product",
      sourceUrl: "https://example.com/presunto-perdigao",
      evidence: "Presunto cozido Perdigão: 1 fatia corresponde a 17 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([wrongBrand]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Presunto cozido Sadia",
      brand: "Sadia",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("aceita uma fonte que declara explicitamente a medida típica do mesmo tipo de alimento", async () => {
    const runtime = baseRuntime();
    const typical = reference({
      describesTypicalMeasure: true,
      grams: 20,
      evidence: "Uma fatia típica de queijo mussarela pesa em média 20 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([typical]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 2,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "usual_average",
      grams: 40,
      referenceCount: 1,
    }));
  });

  it.each(["mussarela", "muçarela", "mozarela"])(
    "normaliza a grafia %s sem ampliar a categoria para queijo genérico",
    async spelling => {
      const runtime = baseRuntime();
      const typical = reference({
        describesTypicalMeasure: true,
        grams: 20,
        evidence: "Uma fatia típica de queijo mussarela pesa em média 20 g.",
      });
      runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([typical]) as any);

      const result = await resolveHouseholdMeasure({
        userId: 7,
        foodName: `Queijo ${spelling}`,
        quantity: 1,
        unit: "fatia",
      }, runtime as any);

      expect(result).toEqual(expect.objectContaining({
        kind: "usual_average",
        grams: 20,
      }));
    },
  );

  it("rejeita categoria ampla de queijo quando o alimento específico é mussarela", async () => {
    const runtime = baseRuntime();
    const genericCheese = reference({
      matchedFoodName: "Queijo fatiado",
      foodTypeName: "queijo",
      brandName: "",
      grams: 25,
      describesTypicalMeasure: true,
      sourceUrl: "https://example.com/queijo-generico",
      evidence: "Uma fatia típica de queijo pesa 25 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([genericCheese]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("calcula média usual somente com referências coerentes do mesmo tipo e medida", async () => {
    const runtime = baseRuntime();
    const first = reference({ grams: 20 });
    const second = reference({
      matchedFoodName: "Mussarela Marca B",
      brandName: "Marca B",
      grams: 22,
      sourceUrl: "https://example.org/mussarela-b",
      evidence: "1 fatia de mussarela Marca B pesa 22 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([first, second]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "usual_average",
      grams: 21,
      referenceCount: 2,
    }));
  });

  it("não conta a mesma URL normalizada duas vezes para fabricar base multi-fonte, mas permite estimativa contextual da fonte única válida", async () => {
    const runtime = baseRuntime();
    const first = reference({ grams: 20 });
    const duplicate = reference({
      matchedFoodName: "Mussarela Marca B",
      brandName: "Marca B",
      sourceUrl: "https://example.com/mussarela-a/#porcao",
      evidence: "1 fatia de mussarela Marca B pesa 20 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([first, duplicate], [{
      url: "https://example.com/mussarela-a/",
      title: "Fonte de medida caseira",
      supportingText: [
        "1 fatia de queijo mussarela pesa 20 g.",
        "1 fatia de mussarela Marca B pesa 20 g.",
      ],
    }]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "contextual_estimate",
      grams: 20,
      referenceCount: 1,
    }));
  });

  it("não fabrica média quando referências compatíveis divergem materialmente", async () => {
    const runtime = baseRuntime();
    const first = reference({ grams: 15, evidence: "1 fatia de mussarela pesa 15 g." });
    const second = reference({
      grams: 40,
      sourceUrl: "https://example.org/mussarela-b",
      evidence: "1 fatia de mussarela pesa 40 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([first, second]) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("não aceita saída do provedor sem web_search realmente executado e fonte vinculada", async () => {
    const runtime = baseRuntime();
    const typical = reference({ describesTypicalMeasure: true });
    runtime.createDomainTextResponse.mockResolvedValueOnce({
      ...searchedResponse([typical]),
      webSearch: { executed: false, sources: [] },
    } as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });
});
