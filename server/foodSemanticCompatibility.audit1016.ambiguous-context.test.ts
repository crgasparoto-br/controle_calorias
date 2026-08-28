import { describe, expect, it, vi } from "vitest";
import { isFoodIdentitySemanticallyCompatible } from "./foodSemanticCompatibility";
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

function exactReference(foodName: string, foodTypeName: string, unit: string, grams: number) {
  return {
    matchedFoodName: foodName,
    foodTypeName,
    brandName: "",
    measureUnit: unit,
    measureQuantity: 1,
    grams,
    referenceKind: "exact_product",
    describesTypicalMeasure: false,
    sourceUrl: "https://example.com/ambiguous-food-page",
    evidence: `${foodName}: 1 ${unit} pesa ${grams} g.`,
  };
}

function searchedResponse(reference: ReturnType<typeof exactReference>, title: string, supportingText: string[]) {
  return {
    id: "resp-audit-1016-ambiguous-context",
    outputText: JSON.stringify({ found: true, references: [reference] }),
    webSearch: {
      executed: true,
      searchCount: 1,
      sources: [{ url: reference.sourceUrl, title, supportingText }],
    },
    raw: {},
  };
}

describe("food identity context — competing identities", () => {
  it.each([
    ["Queijo mussarela", "Queijo mussarela e presunto; 1 fatia pesa 18 g"],
    ["Requeijão cremoso", "Requeijão cremoso / manteiga; 1 colher de sopa pesa 15 g"],
    ["Iogurte natural", "Iogurte natural | sobremesa láctea; 1 unidade pesa 170 g"],
  ])("rejeita contexto segmentado que também identifica outro alimento: %s", (requested, candidate) => {
    expect(isFoodIdentitySemanticallyCompatible(requested, [candidate])).toBe(false);
  });

  it("preserva contexto descritivo sem identidade alimentar concorrente", () => {
    expect(isFoodIdentitySemanticallyCompatible(
      "Queijo mussarela",
      ["Tabela de medidas e porções de queijo mussarela; 1 fatia pesa 18 g"],
    )).toBe(true);
  });
});

describe("resolveHouseholdMeasure — relação neutra não herda título multi-alimento", () => {
  it("rejeita relação exata quando o título enumera mussarela e presunto", async () => {
    const runtime = baseRuntime();
    const reference = exactReference("Queijo mussarela", "mussarela", "fatia", 18);
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse(
      reference,
      "Queijo mussarela e presunto",
      ["1 fatia pesa 18 g."],
    ) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 1,
      unit: "fatia",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("rejeita relação exata irmã quando o título usa barra para separar alimentos", async () => {
    const runtime = baseRuntime();
    const reference = exactReference("Requeijão cremoso", "requeijão cremoso", "colher de sopa", 15);
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse(
      reference,
      "Requeijão cremoso / manteiga",
      ["1 colher de sopa pesa 15 g."],
    ) as any);

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Requeijão cremoso",
      quantity: 1,
      unit: "colher de sopa",
    }, runtime as any);

    expect(result).toBeNull();
  });

  it("mantém válido um título descritivo que contém somente a identidade solicitada", async () => {
    const runtime = baseRuntime();
    const reference = exactReference("Queijo mussarela", "mussarela", "fatia", 18);
    runtime.createDomainTextResponse.mockResolvedValueOnce(searchedResponse(
      reference,
      "Tabela de medidas e porções de queijo mussarela",
      ["1 fatia pesa 18 g."],
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
