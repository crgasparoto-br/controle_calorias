import { describe, expect, it, vi } from "vitest";

const { createTextResponseMock, embeddingsCreateMock } = vi.hoisted(() => ({
  createTextResponseMock: vi.fn(),
  embeddingsCreateMock: vi.fn(),
}));

vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
    createEmbeddings: (request: unknown) => embeddingsCreateMock(request),
  }),
}));

vi.mock("./catalogRuntime", async () => {
  const { FOOD_CATALOG_REFERENCE } = await import("./foodCatalogReference");
  return { getCatalogCache: () => FOOD_CATALOG_REFERENCE };
});

describe("issue 923 focused diagnostic", () => {
  it("reports direct nutrition capability behavior", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("AI_NUTRITION_SEARCH_PROVIDER", "openai");
    vi.stubEnv("AI_NUTRITION_SEARCH_MODEL", "gpt-4.1-mini");
    vi.stubEnv("AI_NUTRITION_SEARCH_MAX_ATTEMPTS", "1");
    vi.stubEnv("AI_NUTRITION_SEARCH_FALLBACK_ENABLED", "false");
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("AI_EMBEDDING_MODEL", "text-embedding-3-small");
    vi.stubEnv("AI_EMBEDDING_MAX_ATTEMPTS", "1");
    vi.stubEnv("AI_EMBEDDING_FALLBACK_ENABLED", "false");

    createTextResponseMock.mockResolvedValue({
      id: "diag",
      outputText: JSON.stringify({
        found: true,
        matchedProductName: "Trento Chocolate Branco Dark 32 g",
        brandName: "Peccin",
        servingLabel: "1 unidade 32 g",
        gramsPerServing: 32,
        calories: 128,
        protein: 2.1,
        carbs: 19,
        fat: 5.2,
        confidence: 0.86,
        sourceUrl: "https://example.test/trento-nutrition",
        evidence: "Fonte informa tabela nutricional por unidade de 32 g.",
      }),
      webSearch: {
        executed: true,
        queries: ["Trento nutrition"],
        sources: [{ url: "https://example.test/trento-nutrition" }],
      },
      raw: {},
    });
    embeddingsCreateMock.mockResolvedValue({ embeddings: [], raw: {} });

    const { resolveCapabilityConfig } = await import("./_core/ai/configResolver");
    const { findPackagedSnackByWebSearch, findCatalogFoodSemantic } = await import("./catalogSemanticSearch");
    const nutritionPolicy = resolveCapabilityConfig("NUTRITION_SEARCH");
    const web = await findPackagedSnackByWebSearch("Trento", "chocolate");
    const callsAfterWeb = createTextResponseMock.mock.calls.length;
    const semantic = await findCatalogFoodSemantic("Trento");

    expect.fail(JSON.stringify({
      nutritionPolicy,
      web,
      callsAfterWeb,
      semantic,
      callsAfterSemantic: createTextResponseMock.mock.calls.length,
      embeddingCalls: embeddingsCreateMock.mock.calls.length,
    }));
  });
});
