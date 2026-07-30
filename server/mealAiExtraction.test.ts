import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "./_core/aiProvider";

const openAiCreateTextResponse = vi.hoisted(() => vi.fn());
const geminiCreateTextResponse = vi.hoisted(() => vi.fn());

vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: (provider: "openai" | "gemini" | "openai-compatible") => ({
    createTextResponse: provider === "gemini" ? geminiCreateTextResponse : openAiCreateTextResponse,
  }) as unknown as AiProvider,
}));

import { extractWithAi } from "./mealAiExtraction";

function validExtraction(overrides: Record<string, unknown> = {}) {
  return {
    mealLabel: "Almoço",
    confidence: 0.9,
    reasoning: "Itens identificados.",
    items: [{
      foodName: "arroz",
      brand: null,
      quantity: 100,
      unit: "g",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      estimatedCalories: 130,
      estimatedMacros: { protein: 2.7, carbs: 28, fat: 0.3 },
      confidence: 0.9,
      foodClassification: {
        processingLevel: "natural_or_minimally_processed",
        isFruit: false,
        isVegetable: false,
        fiberGrams: 0.4,
      },
    }],
    ...overrides,
  };
}

const ORIGINAL_ENV = { ...process.env };

function resetAiEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AI_MEAL_TEXT_") || key.startsWith("AI_MEAL_VISION_")) delete process.env[key];
  }
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.AI_VISION_PROVIDER;
  delete process.env.GEMINI_MODEL;
}

describe("meal extraction capabilities", () => {
  beforeEach(() => {
    openAiCreateTextResponse.mockReset();
    geminiCreateTextResponse.mockReset();
    resetAiEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("binds MEAL_TEXT to its resolved provider and model", async () => {
    process.env.AI_MEAL_TEXT_PROVIDER = "openai";
    process.env.AI_MEAL_TEXT_MODEL = "gpt-meal-text";
    openAiCreateTextResponse.mockResolvedValue({ id: "o1", outputText: JSON.stringify(validExtraction()), raw: {} });

    const result = await extractWithAi({ text: "100 g de arroz" });

    expect(result?.items[0]?.foodName).toBe("arroz");
    expect(openAiCreateTextResponse.mock.calls[0][0].model).toBe("gpt-meal-text");
    expect(geminiCreateTextResponse).not.toHaveBeenCalled();
  });

  it("binds MEAL_VISION independently to Gemini and preserves inline image input", async () => {
    process.env.AI_MEAL_TEXT_PROVIDER = "openai";
    process.env.AI_MEAL_TEXT_MODEL = "must-not-leak";
    process.env.AI_MEAL_VISION_PROVIDER = "gemini";
    process.env.AI_MEAL_VISION_MODEL = "gemini-meal-vision";
    geminiCreateTextResponse.mockResolvedValue({ id: "g1", outputText: JSON.stringify(validExtraction()), raw: {} });

    await extractWithAi({ text: "prato", imageUrl: "data:image/jpeg;base64,AAAA" });

    const request = geminiCreateTextResponse.mock.calls[0][0];
    expect(request.model).toBe("gemini-meal-vision");
    expect(request.input[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "input_image", image_url: "data:image/jpeg;base64,AAAA" }),
    ]));
    expect(openAiCreateTextResponse).not.toHaveBeenCalled();
  });

  it("treats a valid items: [] result as functional without retry or fallback", async () => {
    process.env.AI_MEAL_TEXT_MAX_ATTEMPTS = "3";
    process.env.AI_MEAL_TEXT_FALLBACK_ENABLED = "true";
    process.env.AI_MEAL_TEXT_FALLBACK_PROVIDER = "gemini";
    process.env.AI_MEAL_TEXT_FALLBACK_MODEL = "gemini-fallback";
    process.env.AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED = "true";
    openAiCreateTextResponse.mockResolvedValue({
      id: "empty",
      outputText: JSON.stringify(validExtraction({ items: [], confidence: 0.2 })),
      raw: {},
    });

    const result = await extractWithAi({ text: "oi" });

    expect(result?.items).toEqual([]);
    expect(openAiCreateTextResponse).toHaveBeenCalledTimes(1);
    expect(geminiCreateTextResponse).not.toHaveBeenCalled();
  });

  it("retries invalid JSON and uses at most one configured fallback", async () => {
    process.env.AI_MEAL_TEXT_MAX_ATTEMPTS = "2";
    process.env.AI_MEAL_TEXT_FALLBACK_ENABLED = "true";
    process.env.AI_MEAL_TEXT_FALLBACK_PROVIDER = "gemini";
    process.env.AI_MEAL_TEXT_FALLBACK_MODEL = "gemini-fallback";
    process.env.AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED = "true";
    openAiCreateTextResponse.mockResolvedValue({ id: "bad", outputText: "not-json", raw: {} });
    geminiCreateTextResponse.mockResolvedValue({ id: "good", outputText: JSON.stringify(validExtraction()), raw: {} });

    const result = await extractWithAi({ text: "arroz" });

    expect(result?.items).toHaveLength(1);
    expect(openAiCreateTextResponse).toHaveBeenCalledTimes(2);
    expect(geminiCreateTextResponse).toHaveBeenCalledTimes(1);
  });

  it("does not retry or fall back on authentication failures", async () => {
    process.env.AI_MEAL_TEXT_MAX_ATTEMPTS = "3";
    process.env.AI_MEAL_TEXT_FALLBACK_ENABLED = "true";
    process.env.AI_MEAL_TEXT_FALLBACK_PROVIDER = "gemini";
    process.env.AI_MEAL_TEXT_FALLBACK_MODEL = "gemini-fallback";
    process.env.AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED = "true";
    openAiCreateTextResponse.mockRejectedValue(Object.assign(new Error("invalid API key"), { status: 401 }));

    await expect(extractWithAi({ text: "arroz" })).resolves.toBeNull();
    expect(openAiCreateTextResponse).toHaveBeenCalledTimes(1);
    expect(geminiCreateTextResponse).not.toHaveBeenCalled();
  });
});
