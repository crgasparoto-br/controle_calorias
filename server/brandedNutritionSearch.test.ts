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
    matchedProductName: "Cerveja Zero Marca Aurora 330 ml",
    brandName: "Marca Aurora",
    servingLabel: "1 garrafa (330 ml)",
    gramsPerServing: 330,
    calories: 100,
    protein: 1,
    carbs: 8,
    fat: 0,
    confidence: 0.95,
    sourceUrl: "https://fabricante.example/marca-aurora/cerveja-zero-330ml",
    evidence: "330 ml: 100 kcal, 1 g proteínas, 8 g carboidratos e 0 g gorduras.",
    ...overrides,
  });
}

function installExecution(outputText: string, sourceOverrides: Record<string, unknown> = {}) {
  createTextResponseMock.mockResolvedValue({
    id: "resp-test",
    outputText,
    webSearch: {
      executed: true,
      sources: [{
        url: "https://fabricante.example/marca-aurora/cerveja-zero-330ml",
        title: "Cerveja Zero Marca Aurora 330 ml",
        supportingText: ["Marca Aurora Cerveja Zero 330 ml: 100 kcal, 1 g proteínas, 8 g carboidratos e 0 g gorduras."],
        ...sourceOverrides,
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

describe("branded nutrition evidence consistency", () => {
  beforeEach(() => {
    resolveCapabilityConfigMock.mockReset();
    executeResolvedCapabilityMock.mockReset();
    createTextResponseMock.mockReset();
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
  });
  afterEach(() => vi.restoreAllMocks());

  it("accepts coherent product, brand, portion and grounding", async () => {
    installExecution(providerResult());
    await expect(findBrandedNutritionByWebSearch("Cerveja Zero Marca Aurora 330 ml"))
      .resolves.toEqual(expect.objectContaining({ brandName: "Marca Aurora", gramsPerServing: 330, calories: 100 }));
  });

  it("rejects a contradictory structured brand even when matchedProductName echoes the requested brand", async () => {
    installExecution(providerResult({ brandName: "Marca Eclipse" }));
    await expect(findBrandedNutritionByWebSearch("Cerveja Zero Marca Aurora 330 ml")).resolves.toBeNull();
  });

  it("rejects a contradictory serving label even when matchedProductName echoes 330 ml", async () => {
    installExecution(providerResult({ servingLabel: "1 garrafa (500 ml)", gramsPerServing: 500 }));
    await expect(findBrandedNutritionByWebSearch("Cerveja Zero Marca Aurora 330 ml")).resolves.toBeNull();
  });

  it("rejects contradictory gramsPerServing independently from the visible serving label", async () => {
    installExecution(providerResult({ gramsPerServing: 500 }));
    await expect(findBrandedNutritionByWebSearch("Cerveja Zero Marca Aurora 330 ml")).resolves.toBeNull();
  });

  it("rejects grounding from another brand even when structured fields are coherent", async () => {
    installExecution(providerResult(), {
      url: "https://fabricante.example/marca-eclipse/cerveja-zero-330ml",
      title: "Cerveja Zero Marca Eclipse 330 ml",
      supportingText: ["Marca Eclipse Cerveja Zero 330 ml: 100 kcal, 1 g proteínas, 8 g carboidratos e 0 g gorduras."],
    });
    await expect(findBrandedNutritionByWebSearch("Cerveja Zero Marca Aurora 330 ml")).resolves.toBeNull();
  });
});
