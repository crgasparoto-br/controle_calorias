import { describe, expect, it, vi } from "vitest";
import { COUNTABLE_FOOD_REGISTRATION_PARITY_CASES } from "./testFixtures/countableFoodRegistrationParityCases";

const requestClarification = vi.fn(() => {
  throw new Error("A matriz positiva da issue #1047 não deve solicitar esclarecimento.");
});

vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappConfirmedTextMealQuantityClarification: requestClarification,
}));

const { prepareWhatsappCountableFoodRegistration } = await import("./countableFoodRegistrationGate");

describe("issue #1047 — integração real do countable gate", () => {
  it.each(COUNTABLE_FOOD_REGISTRATION_PARITY_CASES)(
    "resolve $id pelo gate real antes da decisão contextual",
    async testCase => {
      const result = await prepareWhatsappCountableFoodRegistration({
        userId: 42,
        text: testCase.input,
        originalText: testCase.input,
      });

      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") return;

      expect(result.registrationText).toBe(testCase.registrationText);
      expect(result.resolutions).toHaveLength(testCase.items.length);
      expect(result.resolutions).toEqual(testCase.items.map((item, segmentIndex) => ({
        segmentIndex,
        request: {
          segment: item.segment,
          foodName: item.foodName,
          count: item.count,
          requestedUnit: "un",
        },
        resolution: {
          kind: "canonical_portion",
          grams: item.grams,
        },
      })));
      expect(requestClarification).not.toHaveBeenCalled();
    },
  );
});
