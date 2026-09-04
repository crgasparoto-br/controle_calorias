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
    matchedFoodName: "Presunto cozido Marca A",
    foodTypeName: "presunto cozido",
    brandName: "Marca A",
    measureUnit: "fatia",
    measureQuantity: 1,
    grams: 18,
    referenceKind: "same_food_type",
    describesTypicalMeasure: false,
    sourceUrl: "https://example.com/presunto-a",
    evidence: "1 fatia de presunto cozido Marca A pesa 18 g.",
    ...input,
  };
}

function searchedResponse(
  references: unknown[],
  sources?: Array<{ url: string; title?: string; supportingText?: string[] }>,
) {
  const linkedSources = sources ?? (references as Array<{ sourceUrl: string; evidence: string }>).map(item => ({
    url: item.sourceUrl,
    title: "Referência de presunto cozido",
    supportingText: [item.evidence],
  }));
  return {
    id: "resp-1043",
    outputText: JSON.stringify({ found: true, references }),
    webSearch: { executed: true, searchCount: 1, sources: linkedSources },
    raw: {},
  };
}

const input = {
  userId: 71,
  foodName: "Presunto cozido",
  quantity: 3,
  unit: "fatia",
};

describe("resolveHouseholdMeasure (#1043)", () => {
  it("usa uma única referência compatível como estimativa contextual e persiste a procedência", async () => {
    const runtime = baseRuntime();
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([reference()]) as any);

    const result = await resolveHouseholdMeasure(input, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "contextual_estimate",
      grams: 54,
      requestedQuantity: 3,
      requestedUnit: "fatia",
      sourceUrls: ["https://example.com/presunto-a"],
      referenceCount: 1,
    }));
    expect(runtime.persistHouseholdMeasureResolution).toHaveBeenCalledWith(expect.objectContaining({
      userId: 71,
      foodName: "Presunto cozido",
      quantity: 3,
      unit: "fatia",
      kind: "contextual_estimate",
      grams: 54,
    }));
  });

  it("mantém clarificação quando a referência é ampla ou semanticamente incompatível", async () => {
    const runtime = baseRuntime();
    const broad = reference({
      matchedFoodName: "Embutido fatiado",
      foodTypeName: "embutido",
      brandName: "",
      sourceUrl: "https://example.com/embutido",
      evidence: "1 fatia de embutido pesa 18 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([broad]) as any);

    expect(await resolveHouseholdMeasure(input, runtime as any)).toBeNull();
    expect(runtime.persistHouseholdMeasureResolution).not.toHaveBeenCalled();
  });

  it("não transforma medida fisicamente ambígua em estimativa contextual", async () => {
    const runtime = baseRuntime();
    const ambiguous = reference({
      measureUnit: "pedaço",
      sourceUrl: "https://example.com/pedaco",
      evidence: "1 pedaço de presunto cozido Marca A pesa 18 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([ambiguous]) as any);

    const result = await resolveHouseholdMeasure({ ...input, quantity: 1, unit: "pedaço" }, runtime as any);

    expect(result).toBeNull();
  });

  it("rejeita evidência que não sustenta a relação quantidade-unidade-gramas", async () => {
    const runtime = baseRuntime();
    const unsupported = reference({ evidence: "Presunto cozido Marca A disponível em fatias." });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([unsupported]) as any);

    expect(await resolveHouseholdMeasure(input, runtime as any)).toBeNull();
  });

  it("mantém média usual para duas referências independentes e coerentes", async () => {
    const runtime = baseRuntime();
    const second = reference({
      matchedFoodName: "Presunto cozido Marca B",
      brandName: "Marca B",
      grams: 20,
      sourceUrl: "https://example.org/presunto-b",
      evidence: "1 fatia de presunto cozido Marca B pesa 20 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([reference(), second]) as any);

    expect(await resolveHouseholdMeasure(input, runtime as any)).toEqual(expect.objectContaining({
      kind: "usual_average",
      grams: 57,
      referenceCount: 2,
    }));
  });

  it("não escolhe arbitrariamente entre referências verificadas conflitantes", async () => {
    const runtime = baseRuntime();
    const second = reference({
      matchedFoodName: "Presunto cozido Marca B",
      brandName: "Marca B",
      grams: 42,
      sourceUrl: "https://example.org/presunto-b",
      evidence: "1 fatia de presunto cozido Marca B pesa 42 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([reference(), second]) as any);

    expect(await resolveHouseholdMeasure(input, runtime as any)).toBeNull();
  });

  it("não escolhe arbitrariamente entre referências exact_product conflitantes do mesmo produto", async () => {
    const runtime = baseRuntime();
    const exactInput = {
      userId: 71,
      foodName: "Presunto cozido Sadia",
      brand: "Sadia",
      quantity: 1,
      unit: "fatia",
    };
    const first = reference({
      matchedFoodName: "Presunto cozido Sadia",
      foodTypeName: "presunto cozido",
      brandName: "Sadia",
      grams: 18,
      referenceKind: "exact_product",
      sourceUrl: "https://example.com/presunto-sadia-a",
      evidence: "Presunto cozido Sadia: 1 fatia corresponde a 18 g.",
    });
    const second = reference({
      matchedFoodName: "Presunto cozido Sadia",
      foodTypeName: "presunto cozido",
      brandName: "Sadia",
      grams: 42,
      referenceKind: "exact_product",
      sourceUrl: "https://example.org/presunto-sadia-b",
      evidence: "Presunto cozido Sadia: 1 fatia corresponde a 42 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([first, second]) as any);

    expect(await resolveHouseholdMeasure(exactInput, runtime as any)).toBeNull();
    expect(runtime.persistHouseholdMeasureResolution).not.toHaveBeenCalled();
  });

  it("preserva researched_exact quando múltiplas referências exact_product são coerentes", async () => {
    const runtime = baseRuntime();
    const exactInput = {
      userId: 71,
      foodName: "Presunto cozido Sadia",
      brand: "Sadia",
      quantity: 1,
      unit: "fatia",
    };
    const first = reference({
      matchedFoodName: "Presunto cozido Sadia",
      foodTypeName: "presunto cozido",
      brandName: "Sadia",
      grams: 18,
      referenceKind: "exact_product",
      sourceUrl: "https://example.com/presunto-sadia-a",
      evidence: "Presunto cozido Sadia: 1 fatia corresponde a 18 g.",
    });
    const second = reference({
      matchedFoodName: "Presunto cozido Sadia",
      foodTypeName: "presunto cozido",
      brandName: "Sadia",
      grams: 20,
      referenceKind: "exact_product",
      sourceUrl: "https://example.org/presunto-sadia-b",
      evidence: "Presunto cozido Sadia: 1 fatia corresponde a 20 g.",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse([first, second]) as any);

    expect(await resolveHouseholdMeasure(exactInput, runtime as any)).toEqual(expect.objectContaining({
      kind: "researched_exact",
      grams: 18,
      sourceUrls: ["https://example.com/presunto-sadia-a"],
      referenceCount: 1,
    }));
  });

  it("reutiliza resolução persistida após restart sem nova pesquisa e preserva procedência", async () => {
    const runtime = baseRuntime();
    runtime.loadPersistedHouseholdMeasureResolution.mockResolvedValueOnce({
      version: 1,
      kind: "contextual_estimate",
      foodName: "Presunto cozido",
      normalizedFoodName: "presunto cozido",
      brand: null,
      normalizedBrand: "",
      unit: "fatia",
      measureQuantity: 1,
      grams: 18,
      evidence: "1 fatia de presunto cozido pesa 18 g.",
      sourceUrls: ["https://example.com/presunto"],
      referenceCount: 1,
      verifiedAt: "2026-09-01T12:00:00.000Z",
      expiresAt: "2026-10-01T12:00:00.000Z",
    });

    const result = await resolveHouseholdMeasure(input, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "contextual_estimate",
      grams: 54,
      evidence: "1 fatia de presunto cozido pesa 18 g.",
      sourceUrls: ["https://example.com/presunto"],
    }));
    expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();
  });

  it("preserva a precedência pesquisado exato > aprendizado > média > contextual", async () => {
    const runtime = baseRuntime();
    runtime.loadPersistedHouseholdMeasureResolution.mockImplementation(async (_value: unknown, kinds: string[]) => ({
      version: 1,
      kind: kinds[0],
      foodName: "Presunto cozido",
      normalizedFoodName: "presunto cozido",
      brand: null,
      normalizedBrand: "",
      unit: "fatia",
      measureQuantity: 1,
      grams: 17,
      evidence: "medida específica",
      sourceUrls: ["https://example.com/exact"],
      referenceCount: 1,
      verifiedAt: "2026-09-01T12:00:00.000Z",
      expiresAt: "2026-10-01T12:00:00.000Z",
    } as any));

    const result = await resolveHouseholdMeasure(input, runtime as any);

    expect(runtime.loadPersistedHouseholdMeasureResolution).toHaveBeenCalledWith(expect.objectContaining({ userId: 71 }), [
      "researched_exact",
      "user_learned",
      "usual_average",
      "contextual_estimate",
    ]);
    expect(result).toEqual(expect.objectContaining({ kind: "researched_exact", grams: 51 }));
  });

  it("massa explícita interrompe a resolução antes de persistência ou pesquisa", async () => {
    const runtime = baseRuntime();

    expect(await resolveHouseholdMeasure({ ...input, quantity: 72, unit: "g" }, runtime as any)).toBeNull();
    expect(runtime.loadPersistedHouseholdMeasureResolution).not.toHaveBeenCalled();
    expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();
  });
});
