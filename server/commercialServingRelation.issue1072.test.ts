import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood, LlmItem } from "./nutritionEngineTypes";

const resolveCapabilityConfigMock = vi.fn();
const executeResolvedCapabilityMock = vi.fn();
const createTextResponseMock = vi.fn();

vi.mock("./_core/ai/configResolver", () => ({
  resolveCapabilityConfig: (...args: unknown[]) => resolveCapabilityConfigMock(...args),
}));
vi.mock("./_core/ai/capabilityExecutor", () => ({
  executeResolvedCapability: (...args: unknown[]) => executeResolvedCapabilityMock(...args),
}));

const READY_POLICY = {
  state: "ready" as const,
  primary: { provider: "openai" as const, model: "gpt-4.1-mini" },
  fallback: { effectivelyEnabled: false },
  timeoutMs: 8000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

const DISABLED_POLICY = {
  ...READY_POLICY,
  state: "disabled" as const,
  primary: null,
};

const {
  isCommercialProductIdentityCompatible,
} = await import("./commercialProductIdentity");
const { findBrandedNutritionByWebSearch } = await import("./brandedNutritionSearch");
const { resolveHouseholdMeasure } = await import("./householdMeasureResolution");
const { buildItemFromCatalog } = await import("./mealItemBuilders");

function installNutritionExecution(input: {
  matchedProductName?: string;
  brandName?: string;
  servingLabel?: string;
  gramsPerServing?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  sourceUrl?: string;
  sourceText?: string;
}) {
  const matchedProductName = input.matchedProductName ?? "Pão de Forma Panco Premium";
  const brandName = input.brandName ?? "Panco";
  const servingLabel = input.servingLabel ?? "2 fatias (50 g)";
  const gramsPerServing = input.gramsPerServing ?? 50;
  const calories = input.calories ?? 127;
  const protein = input.protein ?? 4;
  const carbs = input.carbs ?? 24;
  const fat = input.fat ?? 2;
  const sourceUrl = input.sourceUrl ?? "https://fabricante.example/panco-premium";
  const sourceText = input.sourceText ??
    `${matchedProductName}. Porção de ${gramsPerServing} g (2 fatias): ${calories} kcal, proteínas ${protein} g, carboidratos ${carbs} g, gorduras totais ${fat} g.`;

  createTextResponseMock.mockResolvedValueOnce({
    id: "resp-1072",
    outputText: JSON.stringify({
      found: true,
      matchedProductName,
      brandName,
      servingLabel,
      gramsPerServing,
      calories,
      protein,
      carbs,
      fat,
      confidence: 0.96,
      sourceUrl,
      evidence: "Resumo estruturado do provider.",
    }),
    webSearch: {
      executed: true,
      sources: [{
        url: sourceUrl,
        title: matchedProductName,
        supportingText: [sourceText],
      }],
    },
  });
  executeResolvedCapabilityMock.mockImplementationOnce(
    async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => ({
      value: await operation({
        signal: new AbortController().signal,
        source: "primary",
        attempt: 1,
        timeoutMs: 8000,
        provider: {
          createTextResponse: (request: unknown) => createTextResponseMock(request),
        },
        providerId: "openai",
        model: "gpt-4.1-mini",
      }),
      source: "primary",
      attempts: 1,
      usedFallback: false,
    }),
  );
}

async function researchedFood(query: string, input: Parameters<typeof installNutritionExecution>[0] = {}) {
  installNutritionExecution(input);
  const food = await findBrandedNutritionByWebSearch(query);
  if (!food) throw new Error(`Expected researched food for ${query}`);
  return {
    ...food,
    // Production adds a research identity either when persistence succeeds or
    // while preserving live web-research provenance before household resolution.
    researchIdentityKey: food.researchIdentityKey ?? `nutrition-research-live:${food.slug}`,
  } satisfies CatalogFood;
}

function baseMeasureRuntime(options: {
  policy?: typeof READY_POLICY | typeof DISABLED_POLICY;
  response?: unknown;
} = {}) {
  const policy = options.policy ?? DISABLED_POLICY;
  return {
    searchGlobalFoodCatalog: vi.fn(async () => []),
    getGlobalFoodCatalogItem: vi.fn(),
    convertFoodPortionToGrams: vi.fn(),
    resolveCapabilityConfig: vi.fn(() => policy),
    executeResolvedCapability: vi.fn(async (_resolved: unknown, operation: (attempt: unknown) => Promise<unknown>) => ({
      value: await operation({
        signal: new AbortController().signal,
        source: "primary",
        attempt: 1,
        timeoutMs: 8000,
        provider: { id: "openai" },
        providerId: "openai",
        model: "gpt-4.1-mini",
      }),
      source: "primary",
      attempts: 1,
      usedFallback: false,
    })),
    createDomainTextResponse: vi.fn(async () => options.response),
    loadPersistedHouseholdMeasureResolution: vi.fn(async () => null),
    persistHouseholdMeasureResolution: vi.fn(async () => true),
  };
}

function exactMeasureResponse(input: {
  matchedFoodName?: string;
  brandName?: string;
  measureQuantity?: number;
  grams?: number;
  sourceUrl?: string;
}) {
  const matchedFoodName = input.matchedFoodName ?? "Pão de Forma Panco Premium";
  const brandName = input.brandName ?? "Panco";
  const measureQuantity = input.measureQuantity ?? 2;
  const grams = input.grams ?? 50;
  const sourceUrl = input.sourceUrl ?? "https://medidas.example/panco-premium";
  const evidence = `${matchedFoodName}: ${measureQuantity} fatias correspondem a ${grams} g.`;
  return {
    id: "measure-1072",
    outputText: JSON.stringify({
      found: true,
      references: [{
        matchedFoodName,
        foodTypeName: "pão de forma",
        brandName,
        measureUnit: "fatia",
        measureQuantity,
        grams,
        referenceKind: "exact_product",
        describesTypicalMeasure: false,
        sourceUrl,
        evidence,
      }],
    }),
    webSearch: {
      executed: true,
      sources: [{
        url: sourceUrl,
        title: matchedFoodName,
        supportingText: [evidence],
      }],
    },
  };
}

function llmItem(foodName: string, grams: number, quantity: number): LlmItem {
  return {
    foodName,
    brand: "Panco",
    quantity,
    unit: "fatia",
    portionText: `${quantity} ${quantity === 1 ? "fatia" : "fatias"}`,
    servings: 1,
    estimatedGrams: grams,
    estimatedCalories: 0,
    estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
    confidence: 0.95,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
});

describe("#1072 — identidade comercial e medida física são contratos separados", () => {
  it("aceita 1 fatia sem exigir que a consulta repita a gramatura da porção pesquisada", async () => {
    installNutritionExecution({});
    await expect(findBrandedNutritionByWebSearch("1 fatia de pão de forma Panco Premium"))
      .resolves.toEqual(expect.objectContaining({
        name: "Pão de Forma Panco Premium",
        servingLabel: "2 fatias (50 g)",
        gramsPerServing: 50,
      }));
  });

  it("aceita massa explicitamente proporcional quando a unidade contável também está presente", () => {
    expect(isCommercialProductIdentityCompatible({
      foodName: "1 fatia (25 g) de pão de forma Panco Premium",
      matchedProductName: "Pão de Forma Panco Premium",
      brandName: "Panco",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
    })).toBe(true);
  });

  it("rejeita massa contraditória mesmo com unidade contável compatível", () => {
    expect(isCommercialProductIdentityCompatible({
      foodName: "1 fatia (30 g) de pão de forma Panco Premium",
      matchedProductName: "Pão de Forma Panco Premium",
      brandName: "Panco",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
    })).toBe(false);
  });

  it("mantém a consulta somente por massa restritiva", () => {
    expect(isCommercialProductIdentityCompatible({
      foodName: "25 g de pão de forma Panco Premium",
      matchedProductName: "Pão de Forma Panco Premium",
      brandName: "Panco",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
    })).toBe(false);
  });

  it("não relaxa marca ou variante", () => {
    expect(isCommercialProductIdentityCompatible({
      foodName: "1 fatia de pão de forma Panco Premium",
      matchedProductName: "Pão de Forma Panco Integral",
      brandName: "Panco",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
    })).toBe(false);
    expect(isCommercialProductIdentityCompatible({
      foodName: "1 fatia de pão de forma Panco Premium",
      matchedProductName: "Pão de Forma Wickbold Premium",
      brandName: "Wickbold",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
    })).toBe(false);
  });
});

describe("#1072 — relação quantidade/unidade/gramas precisa ser comprovada pela fonte", () => {
  it.each([
    [1, 25, 63.5, 2, 12, 1],
    [2, 50, 127, 4, 24, 2],
    [3, 75, 190.5, 6, 36, 3],
  ])(
    "%i fatia(s) de Panco Premium escala gramatura e macros exatamente uma vez",
    async (quantity, expectedGrams, calories, protein, carbs, fat) => {
      const food = await researchedFood(`${quantity} fatia de pão de forma Panco Premium`);
      const runtime = baseMeasureRuntime();
      const result = await resolveHouseholdMeasure({
        userId: 1072,
        foodName: "pão de forma Panco Premium",
        brand: "Panco",
        quantity,
        unit: "fatia",
        commercialFood: food,
      }, runtime as any);

      expect(result).toEqual(expect.objectContaining({
        kind: "researched_exact",
        grams: expectedGrams,
        requestedQuantity: quantity,
        requestedUnit: "fatia",
      }));
      expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();

      const item = buildItemFromCatalog(
        food,
        llmItem("pão de forma Panco Premium", expectedGrams, quantity),
      );
      expect(item).toEqual(expect.objectContaining({
        estimatedGrams: expectedGrams,
        calories,
        protein,
        carbs,
        fat,
      }));
    },
  );

  it("não usa servingLabel estruturado como prova quando a fonte só comprova 50 g", async () => {
    const food = await researchedFood("1 fatia de pão de forma Panco Premium", {
      sourceText: "Pão de Forma Panco Premium. Porção de 50 g: 127 kcal, proteínas 4 g, carboidratos 24 g, gorduras totais 2 g.",
    });
    const runtime = baseMeasureRuntime();

    await expect(resolveHouseholdMeasure({
      userId: 1072,
      foodName: "pão de forma Panco Premium",
      brand: "Panco",
      quantity: 1,
      unit: "fatia",
      commercialFood: food,
    }, runtime as any)).resolves.toBeNull();
  });

  it("mantém fail-closed sem pesquisar novamente quando a fonte nutricional não prova a relação em fatias", async () => {
    const food = await researchedFood("1 fatia de pão de forma Panco Premium", {
      sourceUrl: "https://nutricao.example/panco-premium",
      sourceText: "Pão de Forma Panco Premium. Porção de 50 g: 127 kcal, proteínas 4 g, carboidratos 24 g, gorduras totais 2 g.",
    });
    const runtime = baseMeasureRuntime({
      policy: READY_POLICY,
      response: exactMeasureResponse({ sourceUrl: "https://medidas.example/panco-premium" }),
    });

    await expect(resolveHouseholdMeasure({
      userId: 1072,
      foodName: "pão de forma Panco Premium",
      brand: "Panco",
      quantity: 1,
      unit: "fatia",
      commercialFood: food,
    }, runtime as any)).resolves.toBeNull();
    expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();
    expect(food.sourceUrls).toEqual(["https://nutricao.example/panco-premium"]);
  });

  it("rejeita uma pesquisa de medida exata que volta com outra variante", async () => {
    const food = await researchedFood("1 fatia de pão de forma Panco Premium", {
      sourceText: "Pão de Forma Panco Premium. Porção de 50 g: 127 kcal, proteínas 4 g, carboidratos 24 g, gorduras totais 2 g.",
    });
    const runtime = baseMeasureRuntime({
      policy: READY_POLICY,
      response: exactMeasureResponse({
        matchedFoodName: "Pão de Forma Panco Integral",
        sourceUrl: "https://medidas.example/panco-integral",
      }),
    });

    await expect(resolveHouseholdMeasure({
      userId: 1072,
      foodName: "pão de forma Panco Premium",
      brand: "Panco",
      quantity: 1,
      unit: "fatia",
      commercialFood: food,
    }, runtime as any)).resolves.toBeNull();
  });

  it("cache pesquisado não transforma relação não comprovada em porção canônica", async () => {
    const food = await researchedFood("2 fatias de pão de forma Panco Premium", {
      sourceText: "Pão de Forma Panco Premium. Porção de 50 g: 127 kcal, proteínas 4 g, carboidratos 24 g, gorduras totais 2 g.",
    });
    const cached = {
      ...food,
      researchIdentityKey: "nutrition-research-v1:cached-panco-premium",
    };
    const runtime = baseMeasureRuntime();

    await expect(resolveHouseholdMeasure({
      userId: 1072,
      foodName: "pão de forma Panco Premium",
      brand: "Panco",
      quantity: 2,
      unit: "fatia",
      commercialFood: cached,
    }, runtime as any)).resolves.toBeNull();
  });

  it("mantém fail-closed sem emitir uma segunda pesquisa quando a relação não foi comprovada", async () => {
    const food = await researchedFood("1 fatia de pão de forma Panco Premium", {
      sourceText: "Pão de Forma Panco Premium. Porção de 50 g: 127 kcal, proteínas 4 g, carboidratos 24 g, gorduras totais 2 g.",
    });
    const runtime = baseMeasureRuntime({ policy: DISABLED_POLICY });

    await expect(resolveHouseholdMeasure({
      userId: 1072,
      foodName: "pão de forma Panco Premium",
      brand: "Panco",
      quantity: 1,
      unit: "fatia",
      commercialFood: food,
    }, runtime as any)).resolves.toBeNull();
    expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();
  });

  it("aplica a mesma regra a outra marca de pão", async () => {
    const food = await researchedFood("3 fatias de pão de forma Wickbold Integral", {
      matchedProductName: "Pão de Forma Wickbold Integral",
      brandName: "Wickbold",
      servingLabel: "2 fatias (56 g)",
      gramsPerServing: 56,
      calories: 132,
      protein: 5,
      carbs: 22,
      fat: 2.2,
      sourceUrl: "https://fabricante.example/wickbold-integral",
      sourceText: "Pão de Forma Wickbold Integral. Porção de 56 g (2 fatias): 132 kcal, proteínas 5 g, carboidratos 22 g, gorduras totais 2,2 g.",
    });
    const runtime = baseMeasureRuntime();

    await expect(resolveHouseholdMeasure({
      userId: 1072,
      foodName: "pão de forma Wickbold Integral",
      brand: "Wickbold",
      quantity: 3,
      unit: "fatia",
      commercialFood: food,
    }, runtime as any)).resolves.toEqual(expect.objectContaining({ grams: 84 }));
  });

  it("aplica a mesma regra a produto contável que não é pão", async () => {
    const food = await researchedFood("2 unidades de queijo Polenghi Light", {
      matchedProductName: "Queijo Polenghi Light",
      brandName: "Polenghi",
      servingLabel: "1 unidade (20 g)",
      gramsPerServing: 20,
      calories: 62,
      protein: 4,
      carbs: 1,
      fat: 5,
      sourceUrl: "https://fabricante.example/polenghi-light",
      sourceText: "Queijo Polenghi Light. Porção de 20 g (1 unidade): 62 kcal, proteínas 4 g, carboidratos 1 g, gorduras totais 5 g.",
    });
    const runtime = baseMeasureRuntime();

    await expect(resolveHouseholdMeasure({
      userId: 1072,
      foodName: "queijo Polenghi Light",
      brand: "Polenghi",
      quantity: 2,
      unit: "un",
      commercialFood: food,
    }, runtime as any)).resolves.toEqual(expect.objectContaining({
      grams: 40,
      requestedUnit: "unidade",
    }));
  });
});
