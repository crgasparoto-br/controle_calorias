import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWithAi } from "../mealAiExtraction";
import { interpretWhatsappMessageWithDiagnostics } from "../modules/whatsapp/intentInterpreter";
import type { WhatsappIntentContext } from "../modules/whatsapp/intentContext";

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

describe("Gemini capability consumers", () => {
  afterEach(() => {
    generateContentMock.mockReset();
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_MEAL_TEXT_PROVIDER;
    delete process.env.AI_MEAL_TEXT_MODEL;
    delete process.env.AI_MEAL_VISION_PROVIDER;
    delete process.env.AI_MEAL_VISION_MODEL;
    delete process.env.AI_WHATSAPP_INTENT_PROVIDER;
    delete process.env.AI_WHATSAPP_INTENT_MODEL;
  });

  it("executes MEAL_TEXT with its real schema on the canonical Gemini configuration", async () => {
    process.env.AI_MEAL_TEXT_PROVIDER = "gemini";
    process.env.AI_MEAL_TEXT_MODEL = "gemini-2.5-flash";
    process.env.GEMINI_API_KEY = "fake-key";
    mockMealResponse();

    const result = await extractWithAi({
      text: "1 banana",
      occurredAt: new Date("2026-07-27T15:00:00-03:00"),
      timeZone: "America/Sao_Paulo",
    });

    expect(result?.items[0]?.foodName).toBe("banana");
    const request = generateContentMock.mock.calls[0][0];
    expect(request.model).toBe("gemini-2.5-flash");
    expect(request.config.responseJsonSchema.additionalProperties).toBe(false);
    expect(request.config.responseJsonSchema.properties.items.items.properties.brand.type).toEqual([
      "string",
      "null",
    ]);
  });

  it("passes the real inline WhatsApp image format through MEAL_VISION to Gemini", async () => {
    process.env.AI_MEAL_VISION_PROVIDER = "gemini";
    process.env.AI_MEAL_VISION_MODEL = "gemini-2.5-flash";
    process.env.GEMINI_API_KEY = "fake-key";
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

  it("executes WHATSAPP_INTENT with its real schema on the canonical Gemini configuration", async () => {
    process.env.GEMINI_API_KEY = "fake-key";
    process.env.AI_WHATSAPP_INTENT_PROVIDER = "gemini";
    process.env.AI_WHATSAPP_INTENT_MODEL = "gemini-2.5-flash";
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        intent: "list_meal_records",
        confidence: 0.91,
        date: null,
        meal: null,
        items: [],
        sourceFood: null,
        targetFood: null,
        quantity: null,
        requiresConfirmation: false,
        clarificationQuestion: null,
        possibleIntents: [],
        reason: "Consulta de registros.",
      }),
    });
    const context: WhatsappIntentContext = {
      version: "whatsapp-intent-context/v1",
      nowIso: "2026-07-28T12:00:00.000Z",
      timezone: "America/Sao_Paulo",
      mealAliases: {},
      latestMeal: null,
      mealsToday: [],
      recentFoodNames: [],
      contextualMemories: [],
      pendingClarification: null,
    };

    const result = await interpretWhatsappMessageWithDiagnostics("registro", context);

    expect(result.source).toBe("llm");
    const request = generateContentMock.mock.calls[0][0];
    expect(request.model).toBe("gemini-2.5-flash");
    expect(request.config.responseJsonSchema.additionalProperties).toBe(false);
    expect(request.config.responseJsonSchema.properties.meal.anyOf).toHaveLength(2);
    expect(request.config.responseJsonSchema.properties.quantity.anyOf).toHaveLength(2);
  });
});
