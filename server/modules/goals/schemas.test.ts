import { describe, expect, it } from "vitest";
import { goalSchema } from "./schemas";

const validGoalInput = {
  defaultGoal: {
    calories: 2200,
    proteinGrams: 160,
    carbsGrams: 240,
    fatGrams: 70,
  },
  exceptions: [],
};

describe("goalSchema", () => {
  it("aceita data de início explícita para versionar a meta geral", () => {
    const parsed = goalSchema.parse({
      ...validGoalInput,
      startDate: "2026-06-12",
    });

    expect(parsed.startDate).toBe("2026-06-12");
  });

  it("mantém compatibilidade quando a data de início não é enviada", () => {
    const parsed = goalSchema.parse(validGoalInput);

    expect(parsed.startDate).toBeUndefined();
  });

  it("rejeita data de início fora do formato esperado", () => {
    expect(() => goalSchema.parse({
      ...validGoalInput,
      startDate: "12/06/2026",
    })).toThrow("AAAA-MM-DD");
  });
});
