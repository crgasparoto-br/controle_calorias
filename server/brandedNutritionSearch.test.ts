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

  it("mantém macros distintos para variantes diferentes da mesma marca", async () => {
    const premiumEvidence = "2 fatias (50 g): 125 kcal, 3,9 g proteínas, 24 g carboidratos e 1,5 g gorduras.";
    installExecution(providerResult({
      matchedProductName: "Pão de Forma Panco Premium",
      brandName: "Panco",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
      calories: 125,
      protein: 3.9,
      carbs: 24,
      fat: 1.5,
      sourceUrl: "https://panco.example/premium",
      evidence: premiumEvidence,
    }), {
      url: "https://panco.example/premium",
      title: "Pão de Forma Panco Premium",
      supportingText: [premiumEvidence],
    });
    const premium = await findBrandedNutritionByWebSearch("Pão de Forma Panco Premium 50g");

    const integralEvidence = "2 fatias (50 g): 137 kcal, 5,5 g proteínas, 21 g carboidratos e 1,7 g gorduras.";
    installExecution(providerResult({
      matchedProductName: "Pão de Forma Panco Integral",
      brandName: "Panco",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
      calories: 137,
      protein: 5.5,
      carbs: 21,
      fat: 1.7,
      sourceUrl: "https://panco.example/integral",
      evidence: integralEvidence,
    }), {
      url: "https://panco.example/integral",
      title: "Pão de Forma Panco Integral",
      supportingText: [integralEvidence],
    });
    const integral = await findBrandedNutritionByWebSearch("Pão de Forma Panco Integral 50g");

    expect(premium).toEqual(expect.objectContaining({
      brandName: "Panco",
      calories: 125,
      protein: 3.9,
      variants: ["Pão de Forma Panco Premium"],
    }));
    expect(integral).toEqual(expect.objectContaining({
      brandName: "Panco",
      calories: 137,
      protein: 5.5,
      variants: ["Pão de Forma Panco Integral"],
    }));
    expect(premium?.calories).not.toBe(integral?.calories);
  });

  it("rejects a different product variant from the same brand", async () => {
    installExecution(providerResult({
      matchedProductName: "Cerveja Zero Marca Aurora Tradicional 330 ml",
    }));

    await expect(findBrandedNutritionByWebSearch("Cerveja Zero Marca Aurora Original 330 ml"))
      .resolves.toBeNull();
  });

  it("rejects grounding from another brand even when structured fields are coherent", async () => {
    installExecution(providerResult(), {
      url: "https://fabricante.example/marca-eclipse/cerveja-zero-330ml",
      title: "Cerveja Zero Marca Eclipse 330 ml",
      supportingText: ["Marca Eclipse Cerveja Zero 330 ml: 100 kcal, 1 g proteínas, 8 g carboidratos e 0 g gorduras."],
    });
    await expect(findBrandedNutritionByWebSearch("Cerveja Zero Marca Aurora 330 ml")).resolves.toBeNull();
  });

  it("reutiliza resultado persistido sem chamar o provider", async () => {
    const cached = {
      slug: "web-nutrition-panco-premium",
      name: "Pão de Forma Panco Premium",
      aliases: ["Panco Premium"],
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
      calories: 125,
      protein: 3.9,
      carbs: 24,
      fat: 1.5,
      brandName: "Panco",
      productVariant: "premium",
      variants: ["Pão de Forma Panco Premium"],
      sourceUrls: ["https://panco.example/premium"],
      sourceEvidence: "2 fatias (50 g): 125 kcal.",
      sourceVerifiedAt: new Date("2026-09-05T12:00:00.000Z"),
      sourceConfidence: 0.95,
      isBrandedProduct: true,
    };
    const findByIdentity = vi.fn(async () => cached);
    const runtime = {
      resolveCapabilityConfig: resolveCapabilityConfigMock,
      executeResolvedCapability: executeResolvedCapabilityMock,
      persistence: { findByIdentity, save: vi.fn() },
    };

    const result = await findBrandedNutritionByWebSearch("Pão de Forma Panco Premium 50g", runtime);

    expect(result).toBe(cached);
    expect(findByIdentity).toHaveBeenCalledWith("Pão de Forma Panco Premium 50g");
    expect(executeResolvedCapabilityMock).not.toHaveBeenCalled();
  });

  it("salva somente o resultado validado com fonte e evidência", async () => {
    installExecution(providerResult({
      matchedProductName: "Pão de Forma Panco Premium",
      brandName: "Panco",
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
      calories: 125,
      protein: 3.9,
      carbs: 24,
      fat: 1.5,
      sourceUrl: "https://panco.example/premium",
      evidence: "2 fatias (50 g): 125 kcal, 3,9 g proteínas, 24 g carboidratos e 1,5 g gorduras.",
    }), {
      url: "https://panco.example/premium",
      title: "Pão de Forma Panco Premium",
      supportingText: ["2 fatias (50 g): 125 kcal, 3,9 g proteínas, 24 g carboidratos e 1,5 g gorduras."],
    });
    const save = vi.fn(async (_foodName: string, food: unknown) => food);
    const runtime = {
      resolveCapabilityConfig: resolveCapabilityConfigMock,
      executeResolvedCapability: executeResolvedCapabilityMock,
      persistence: { findByIdentity: vi.fn(async () => null), save },
    };

    await findBrandedNutritionByWebSearch("Pão de Forma Panco Premium 50g", runtime);

    expect(save).toHaveBeenCalledWith(
      "Pão de Forma Panco Premium 50g",
      expect.objectContaining({
        brandName: "Panco",
        productVariant: "premium",
        sourceUrls: ["https://panco.example/premium"],
        sourceEvidence: expect.stringContaining("125 kcal"),
      }),
    );
  });
});
