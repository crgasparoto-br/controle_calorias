import { describe, expect, it } from "vitest";
import { AI_CAPABILITIES, AI_CAPABILITY_REGISTRY, getCapabilityDefinition } from "../capabilities";

describe("AI capability registry", () => {
  it("contains all capabilities required by issue #921, including QUESTION and EMBEDDING", () => {
    const expected = [
      "MEAL_TEXT",
      "MEAL_VISION",
      "WHATSAPP_INTENT",
      "QUESTION",
      "NUTRITION_SEARCH",
      "EMBEDDING",
      "TRANSCRIPTION",
      "IMAGE_ANNOTATION",
      "FOOD_CLASSIFICATION",
    ];
    expect([...AI_CAPABILITIES].sort()).toEqual([...expected].sort());
  });

  it("declares required operations for every capability", () => {
    for (const id of AI_CAPABILITIES) {
      const def = getCapabilityDefinition(id);
      expect(def.requiredOperations.length).toBeGreaterThan(0);
    }
  });

  it("marks FOOD_CLASSIFICATION as reserved with no consumer yet (#922)", () => {
    expect(AI_CAPABILITY_REGISTRY.FOOD_CLASSIFICATION.hasConsumer).toBe(false);
  });
});
