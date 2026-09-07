import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function providerResult(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    found: true,
    matchedProductName: "Pão de Forma Panco Premium",
    brandName: "Panco",
    servingLabel: "1 porção (5 g)",
    gramsPerServing: 5,
    calories: 20,
    protein: 0,
    carbs: 5,
    fat: 0,
    confidence: 0.95,
    sourceUrl: "https://panco.example/premium-5g",
    evidence: "Porção 5 g: 20 kcal, 0 g proteínas, 5 g carboidratos e 0 g gorduras.",
    ...overrides,
  });
}

function installExecution(
  outputText: string,
  supportingText: string[],
  title = "Pão de Forma Panco Premium",
) {
  createTextResponseMock.mockResolvedValue({
    id: "resp-serving-evidence",
    outputText,
    webSearch: {
      executed: true,
      sources: [{
        url: "https://panco.example/premium-5g",
        title,
        supportingText,
      }],
    },
  });
  executeResolvedCapabilityMock.mockImplementation(async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => {
    const value = await operation({
      signal: new AbortController().signal,
      source: "primary",
      attempt: 1,
      timeoutMs: 8000,
      provider: { createTextResponse: (request: unknown) => createTextResponseMock(request) },
      providerId: "openai",
      model: "gpt-4.1-mini",
    });
    return { value, source: "primary", attempts: 1, usedFallback: false };
  });
}

const { findBrandedNutritionByWebSearch } = await import("./brandedNutritionSearch");

describe("issue 1051 contextual serving evidence", () => {
  beforeEach(() => {
    resolveCapabilityConfigMock.mockReset();
    executeResolvedCapabilityMock.mockReset();
    createTextResponseMock.mockReset();
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
  });

  afterEach(() => vi.restoreAllMocks());

  it("rejects a macro amount that only happens to equal gramsPerServing", async () => {
    installExecution(providerResult(), [
      "Pão de Forma Panco Premium: 20 kcal, 0 g proteínas, 5 g carboidratos e 0 g gorduras.",
    ]);

    await expect(findBrandedNutritionByWebSearch("Pão de Forma Panco Premium 5g"))
      .resolves.toBeNull();
  });

  it("accepts the same nutrition values when the source explicitly proves the serving size", async () => {
    installExecution(providerResult(), [
      "Porção: 5 g. Pão de Forma Panco Premium: 20 kcal, 0 g proteínas, 5 g carboidratos e 0 g gorduras.",
    ]);

    await expect(findBrandedNutritionByWebSearch("Pão de Forma Panco Premium 5g"))
      .resolves.toEqual(expect.objectContaining({
        brandName: "Panco",
        gramsPerServing: 5,
        calories: 20,
        carbs: 5,
      }));
  });

  it("rejects package weight in the source title as proof of a larger serving", async () => {
    installExecution(
      providerResult({
        matchedProductName: "Pão de Forma Panco Premium 500 g",
        servingLabel: "1 porção (500 g)",
        gramsPerServing: 500,
        calories: 120,
        protein: 4,
        carbs: 22,
        fat: 2,
      }),
      [
        "Porção: 50 g. Pão de Forma Panco Premium: 120 kcal, 4 g proteínas, 22 g carboidratos e 2 g gorduras.",
      ],
      "Pão de Forma Panco Premium 500 g",
    );

    await expect(findBrandedNutritionByWebSearch("Pão de Forma Panco Premium"))
      .resolves.toBeNull();
  });

  it("accepts the serving stated in source evidence even when the title carries package weight", async () => {
    installExecution(
      providerResult({
        matchedProductName: "Pão de Forma Panco Premium 500 g",
        servingLabel: "1 porção (50 g)",
        gramsPerServing: 50,
        calories: 120,
        protein: 4,
        carbs: 22,
        fat: 2,
      }),
      [
        "Porção: 50 g. Pão de Forma Panco Premium: 120 kcal, 4 g proteínas, 22 g carboidratos e 2 g gorduras.",
      ],
      "Pão de Forma Panco Premium 500 g",
    );

    await expect(findBrandedNutritionByWebSearch("Pão de Forma Panco Premium"))
      .resolves.toEqual(expect.objectContaining({
        brandName: "Panco",
        gramsPerServing: 50,
        calories: 120,
        carbs: 22,
      }));
  });
});
