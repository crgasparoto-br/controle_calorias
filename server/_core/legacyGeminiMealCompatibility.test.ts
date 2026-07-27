import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWithAi } from "../mealAiExtraction";
import { resetAiProviderFactory, setAiProviderFactory } from "./aiProvider";
import { GeminiProvider } from "./geminiProvider";

const generateContentMock = vi.fn();

vi.mock("@google/genai", async () => {
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: { generateContent: generateContentMock },
    })),
  };
});

function mockMealResponse() {
  generateContentMock.mockResolvedValue({
    text: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.9,
      reasoning: "banana identificada na entrada",
      items: [{
        foodName: "banana",
        brand: null,
        quantity: 1,
        unit: "unidade",
        portionText: "1 unidade",
        servings: 1,
        estimatedGrams: 100,
        estimatedCalories: 89,
        estimatedMacros: { protein: 1.1, carbs: 23, fat: 0.3 },
        confidence: 0.9,
        foodClassification: {
          processingLevel: "natural_or_minimally_processed",
          isFruit: true,
          isVegetable: false,
          fiberGrams: 2.6,
        },
      }],
    }),
  });
}

describe("legacy meal consumer remains compatible with Gemini after SDK migration", () => {
  afterEach(() => {
    generateContentMock.mockReset();
    resetAiProviderFactory();
    delete process.env.AI_VISION_PROVIDER;
    delete process.env.GEMINI_MODEL;
  });

  it("executes mealAiExtraction with its real schema, including additionalProperties and nullable brand", async () => {
    process.env.AI_VISION_PROVIDER = "gemini";
    process.env.GEMINI_MODEL = "gemini-legacy-custom";
    setAiProviderFactory(() => new GeminiProvider("fake-key"));
    mockMealResponse();

    const result = await extractWithAi({
      text: "1 banana",
      occurredAt: new Date("2026-07-27T15:00:00-03:00"),
      timeZone: "America/Sao_Paulo",
    });

    expect(result?.items[0]?.foodName).toBe("banana");
    const request = generateContentMock.mock.calls[0][0];
    expect(request.model).toBe("gemini-legacy-custom");
    expect(request.config.responseJsonSchema.additionalProperties).toBe(false);
    expect(request.config.responseJsonSchema.properties.items.items.properties.brand.type).toEqual([
      "string",
      "null",
    ]);
  });

  it("passes the real inline WhatsApp image format through mealAiExtraction to Gemini", async () => {
    process.env.AI_VISION_PROVIDER = "gemini";
    process.env.GEMINI_MODEL = "gemini-legacy-custom";
    setAiProviderFactory(() => new GeminiProvider("fake-key"));
    mockMealResponse();

    const result = await extractWithAi({
      text: "1 banana",
      imageUrl: "data:image/jpeg;base64,AAAA",
      occurredAt: new Date("2026-07-27T15:00:00-03:00"),
      timeZone: "America/Sao_Paulo",
    });

    expect(result?.items[0]?.foodName).toBe("banana");
    const request = generateContentMock.mock.calls[0][0];
    expect(request.contents[0].parts).toEqual(expect.arrayContaining([
      { inlineData: { mimeType: "image/jpeg", data: "AAAA" } },
    ]));
    expect(request.config.responseJsonSchema.additionalProperties).toBe(false);
  });
});
