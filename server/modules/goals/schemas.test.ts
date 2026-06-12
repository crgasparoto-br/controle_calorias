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

const validException = {
  weekday: 0,
  durationType: "always" as const,
  calories: 2400,
  proteinGrams: 170,
  carbsGrams: 260,
  fatGrams: 75,
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

  it("aceita data de início explícita para exceções de meta", () => {
    const parsed = goalSchema.parse({
      ...validGoalInput,
      exceptions: [{ ...validException, startDate: "2026-06-15" }],
    });

    expect(parsed.exceptions[0].startDate).toBe("2026-06-15");
  });

  it("rejeita data de início inválida em exceções", () => {
    expect(() => goalSchema.parse({
      ...validGoalInput,
      exceptions: [{ ...validException, startDate: "15/06/2026" }],
    })).toThrow("AAAA-MM-DD");
  });

  it("rejeita duas exceções para o mesmo dia e mesma data de início", () => {
    expect(() => goalSchema.parse({
      ...validGoalInput,
      exceptions: [
        { ...validException, startDate: "2026-06-15" },
        { ...validException, calories: 2500, startDate: "2026-06-15" },
      ],
    })).toThrow("mesmo dia da semana e data de início");
  });

  it("aceita duas versões de exceção do mesmo dia quando começam em datas diferentes", () => {
    const parsed = goalSchema.parse({
      ...validGoalInput,
      exceptions: [
        { ...validException, startDate: "2026-06-15" },
        { ...validException, calories: 2500, startDate: "2026-06-22" },
      ],
    });

    expect(parsed.exceptions).toHaveLength(2);
  });
});
