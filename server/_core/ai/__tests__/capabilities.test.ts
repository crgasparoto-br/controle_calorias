import { describe, expect, it } from "vitest";
import { AI_CAPABILITIES, AI_CAPABILITY_REGISTRY, getCapabilityDefinition } from "../capabilities";

describe("AI capability registry", () => {
  it("contains every capability required by issue #921", () => {
    expect([...AI_CAPABILITIES].sort()).toEqual([
      "EMBEDDING",
      "FOOD_CLASSIFICATION",
      "IMAGE_ANNOTATION",
      "MEAL_TEXT",
      "MEAL_VISION",
      "NUTRITION_SEARCH",
      "QUESTION",
      "TRANSCRIPTION",
      "WHATSAPP_INTENT",
    ].sort());
  });

  it("declares required operations for every capability", () => {
    for (const id of AI_CAPABILITIES) {
      expect(getCapabilityDefinition(id).requiredOperations.length).toBeGreaterThan(0);
    }
  });

  it("derives QUESTION requirements from the real WhatsApp consumer", () => {
    expect(AI_CAPABILITY_REGISTRY.QUESTION.requiredOperations).toEqual([
      "text",
      "web_search",
    ]);
  });

  it("keeps nutrition search separate from embeddings", () => {
    expect(AI_CAPABILITY_REGISTRY.NUTRITION_SEARCH.requiredOperations).toEqual([
      "text",
      "structured_output",
      "web_search",
    ]);
    expect(AI_CAPABILITY_REGISTRY.EMBEDDING.requiredOperations).toEqual(["embeddings"]);
  });

  it("recognizes the existing legacy embedding consumer", () => {
    expect(AI_CAPABILITY_REGISTRY.EMBEDDING.hasConsumer).toBe(true);
  });

  it("marks FOOD_CLASSIFICATION as reserved with no independent consumer", () => {
    expect(AI_CAPABILITY_REGISTRY.FOOD_CLASSIFICATION.hasConsumer).toBe(false);
  });
});
