import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveCapabilityConfigMock = vi.fn();
const executeResolvedCapabilityMock = vi.fn();
const createTextResponseMock = vi.fn();
const createEmbeddingsMock = vi.fn();

vi.mock("./_core/ai/configResolver", () => ({
  resolveCapabilityConfig: (...args: unknown[]) => resolveCapabilityConfigMock(...args),
}));

vi.mock("./_core/ai/capabilityExecutor", () => ({
  executeResolvedCapability: (...args: unknown[]) => executeResolvedCapabilityMock(...args),
}));

vi.mock("./_core/openaiClient", () => ({
  isOpenAiConfigured: vi.fn(() => false),
  createOpenAiClient: vi.fn(),
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
  state: "disabled" as const,
  primary: null,
  fallback: { effectivelyEnabled: false },
  timeoutMs: 8000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

function mockExecuteWithOutput(outputText: string) {
  executeResolvedCapabilityMock.mockImplementation(async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => {
    const value = await operation({
      signal: new AbortController().signal,
      source: "primary",
      attempt: 1,
      timeoutMs: 8000,
      provider: {
        createTextResponse: async (request: unknown) => {
          const response = await createTextResponseMock(request);
          return {
            id: "resp-test",
            outputText: response?.outputText ?? outputText,
            raw: response,
          };
        },
      },
      providerId: "openai",
      model: "gpt-4.1-mini",
    });
    return { value, source: "primary", attempts: 1, usedFallback: false };
  });
}

const READY_EMBEDDING_POLICY = {
  state: "ready" as const,
  primary: { provider: "openai" as const, model: "text-embedding-3-small" },
  fallback: { effectivelyEnabled: false },
  timeoutMs: 8000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

const DISABLED_EMBEDDING_POLICY = {
  state: "disabled" as const,
  primary: null,
  fallback: { effectivelyEnabled: false },
  timeoutMs: 8000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

/**
 * Wires executeResolvedCapability to call the operation with a provider whose
 * createEmbeddings delegates to createEmbeddingsMock, mirroring the real
 * AiProvider.createEmbeddings(request, options) contract.
 */
function mockExecuteEmbeddings() {
  executeResolvedCapabilityMock.mockImplementation(async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => {
    const value = await operation({
      signal: new AbortController().signal,
      source: "primary",
      attempt: 1,
      timeoutMs: 8000,
      provider: {
        createEmbeddings: async (request: unknown) => {
          const embeddings = await createEmbeddingsMock(request);
          return { embeddings, raw: {} };
        },
        createTextResponse: async () => {
          throw new Error("createTextResponse must not be used by the EMBEDDING capability path");
        },
      },
      providerId: "openai",
      model: "text-embedding-3-small",
    });
    return { value, source: "primary", attempts: 1, usedFallback: false };
  });
}

const { findPackagedSnackByWebSearch, findCatalogFoodSemantic, resetEmbeddingCache } = await import("./catalogSemanticSearch");

describe("findCatalogFoodSemantic — NUTRITION_SEARCH web fallback (packaged snacks)", () => {
  beforeEach(() => {
    resolveCapabilityConfigMock.mockReset();
    executeResolvedCapabilityMock.mockReset();
    createTextResponseMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a verifiable source with high confidence and compatible semantic guard", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Tabela nutricional oficial do fabricante.",
    }));

    const result = await findPackagedSnackByWebSearch("kit kat", "chocolate");

    expect(result).not.toBeNull();
    expect(result?.name).toContain("KitKat");
    expect(result?.calories).toBe(218);
    expect(executeResolvedCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("returns null (without fabricating data) when confidence is below the threshold", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate genérico",
      brandName: "",
      servingLabel: "1 unidade",
      gramsPerServing: 40,
      calories: 210,
      protein: 2,
      carbs: 23,
      fat: 12,
      confidence: 0.4,
      sourceUrl: "",
      evidence: "estimativa aproximada",
    }));

    const result = await findPackagedSnackByWebSearch("chocolate misterioso xyz", "chocolate");

    expect(result).toBeNull();
  });

  it("returns null when the semantic compatibility guard rejects an ambiguous flavor/complement match", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Café com leite condensado",
      brandName: "Outra Marca",
      servingLabel: "1 xícara",
      gramsPerServing: 130,
      calories: 90,
      protein: 2,
      carbs: 14,
      fat: 2,
      confidence: 0.95,
      sourceUrl: "https://example.com/produto",
      evidence: "tabela do fabricante",
    }));

    // Query explicitly asks for sugar-free coffee (canonical qualifier); the
    // returned product name carries an incompatible complement (leite
    // condensado), so the semantic guard must reject the canonical match even
    // though the raw food name is trivially present among its own aliases.
    const result = await findPackagedSnackByWebSearch("café sem açúcar", "cookie");

    expect(result).toBeNull();
  });

  it("returns null immediately without calling the network when the capability is disabled", async () => {
    resolveCapabilityConfigMock.mockReturnValue(DISABLED_POLICY);

    const result = await findPackagedSnackByWebSearch("bombom sonho de valsa", "chocolate");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).not.toHaveBeenCalled();
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("treats a functional result without a valid match as a normal return (no retry storm, single provider call)", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: false,
      matchedProductName: "",
      brandName: "",
      servingLabel: "",
      gramsPerServing: 0,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0,
      sourceUrl: "",
      evidence: "",
    }));

    const result = await findPackagedSnackByWebSearch("wafer trufa desconhecida", "chocolate");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).toHaveBeenCalledTimes(1);
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
  });
});

describe("findCatalogFoodSemantic — EMBEDDING capability (catalog embedding search)", () => {
  beforeEach(() => {
    resolveCapabilityConfigMock.mockReset();
    executeResolvedCapabilityMock.mockReset();
    createTextResponseMock.mockReset();
    createEmbeddingsMock.mockReset();
    resetEmbeddingCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetEmbeddingCache();
  });

  it("returns a catalog match when the EMBEDDING capability is available", async () => {
    const { getCatalogCache } = await import("./catalogRuntime");
    const catalog = getCatalogCache();
    const targetIndex = catalog.findIndex(food => food.slug === "agua");
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    resolveCapabilityConfigMock.mockImplementation((capability: string) =>
      capability === "EMBEDDING" ? READY_EMBEDDING_POLICY : DISABLED_EMBEDDING_POLICY,
    );
    mockExecuteEmbeddings();

    createEmbeddingsMock.mockImplementation(async (request: { input: string[] }) => {
      if (request.input.length > 1) {
        // Building the full catalog cache: give the target entry a
        // distinguishing vector, everything else orthogonal to it.
        return catalog.map((_, i) => (i === targetIndex ? [1, 0] : [0, 1]));
      }
      // Single query embedding call: aligned with the target vector.
      return [[1, 0]];
    });

    const result = await findCatalogFoodSemantic("agua");

    expect(result?.slug).toBe("agua");
    expect(createEmbeddingsMock).toHaveBeenCalled();
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("degrades to null (textual/canonical fallback upstream) without calling the network when EMBEDDING is disabled", async () => {
    resolveCapabilityConfigMock.mockReturnValue(DISABLED_EMBEDDING_POLICY);

    const result = await findCatalogFoodSemantic("agua");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).not.toHaveBeenCalled();
    expect(createEmbeddingsMock).not.toHaveBeenCalled();
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("never substitutes a text-generation model for missing embeddings", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_EMBEDDING_POLICY);
    mockExecuteEmbeddings();
    createEmbeddingsMock.mockResolvedValue([]);

    const result = await findCatalogFoodSemantic("um alimento sem correspondencia plausivel xyz");

    expect(result).toBeNull();
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});
