import { beforeEach, describe, expect, it, vi } from "vitest";

const { logInferenceEventMock } = vi.hoisted(() => ({
  logInferenceEventMock: vi.fn(),
}));

vi.mock("./db", () => ({
  logInferenceEvent: logInferenceEventMock,
}));

import { logMealInferenceFallback } from "./mealInferenceFallbackTelemetry";

describe("meal inference fallback telemetry issue #982", () => {
  beforeEach(() => {
    logInferenceEventMock.mockReset();
  });

  it("reutiliza logInferenceEvent com metadados de baixa cardinalidade", () => {
    logMealInferenceFallback("generic_nutrition_fallback", 2);

    expect(logInferenceEventMock).toHaveBeenCalledTimes(1);
    const event = logInferenceEventMock.mock.calls[0][0];
    expect(event).toEqual(expect.objectContaining({
      origin: "admin",
      status: "warning",
      eventType: "meal.inference_fallback",
    }));

    const detail = JSON.parse(event.detail);
    expect(detail).toEqual({
      schemaVersion: 1,
      reason: "generic_nutrition_fallback",
      stage: "nutrition_estimation",
      count: 2,
    });
    expect(Object.keys(detail).sort()).toEqual(["count", "reason", "schemaVersion", "stage"]);
    expect(event.detail).not.toMatch(/sourceText|transcript|prompt|foodName|imageUrl|audioUrl|reasoning|raw/i);
  });

  it("não altera o fluxo funcional quando o sink falha", () => {
    logInferenceEventMock.mockImplementation(() => {
      throw new Error("sink unavailable");
    });

    expect(() => logMealInferenceFallback("catalog_miss", 1)).not.toThrow();
  });
});
