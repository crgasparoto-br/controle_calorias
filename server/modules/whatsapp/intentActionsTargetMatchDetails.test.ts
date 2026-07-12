import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const createWaterLogMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();

vi.mock("../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db")>();
  return {
    ...actual,
    getUserNutritionGoal: getUserNutritionGoalMock,
  };
});

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

vi.mock("../water/service", () => ({
  createWaterLog: createWaterLogMock,
}));

const { executeWhatsappTextIntent } = await import("./intentActions");

function item(foodName: string, estimatedGrams: number) {
  return {
    foodName,
    canonicalName: foodName,
    brand: null,
    portionText: `${estimatedGrams} g`,
    servings: 1,
    estimatedGrams,
    quantity: estimatedGrams,
    unit: "g",
    calories: estimatedGrams,
    protein: 1,
    carbs: 1,
    fat: 1,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

describe("executeWhatsappTextIntent target matching details", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createWaterLogMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
  });

  it("registra alvo, item escolhido, escopo e ausencia de ambiguidade em ajuste de gramas", async () => {
    listMealsMock.mockResolvedValue([{
      id: 81,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [item("Queijo Minas Padrao Fatiado", 80)],
    }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Diminuir 20g do queijo Minas",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result?.detail).toContain('Matches: alvo "queijo minas" -> "Queijo Minas Padrao Fatiado"');
    expect(result?.detail).toContain("Escopo da busca: na última refeição");
    expect(result?.detail).toContain("Ambiguidade: não");
  });

  it("registra ambiguidade em ajuste de gramas quando existem varios candidatos", async () => {
    listMealsMock.mockResolvedValue([{
      id: 82,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [
        item("Queijo Minas Padrao Fatiado", 80),
        item("Queijo mussarela", 70),
      ],
    }]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Aumentar 20g do queijo",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result?.detail).toContain("Alvo usado: queijo");
    expect(result?.detail).toContain("Escopo da busca: última refeição");
    expect(result?.detail).toContain("Ambiguidade: sim");
  });

  it("registra escopo do dia quando ajuste encontra alvo fora da ultima refeicao", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 83,
        userId: 42,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-09T21:00:00.000Z").getTime(),
        notes: null,
        items: [item("Pao frances", 50)],
      },
      {
        id: 84,
        userId: 42,
        mealLabel: "Almoco",
        occurredAt: new Date("2026-06-09T15:00:00.000Z").getTime(),
        notes: null,
        items: [item("Queijo Minas Padrao Fatiado", 80)],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 20g ao queijo Minas",
      receivedAt: new Date("2026-06-09T21:30:00.000Z"),
    });

    expect(result?.detail).toContain('Matches: alvo "queijo minas" -> "Queijo Minas Padrao Fatiado"');
    expect(result?.detail).toContain("Escopo da busca: nas refeições do dia");
  });

  it("registra matches aplicados e pendencias em ajuste multiplo parcial", async () => {
    listMealsMock.mockResolvedValue([{
      id: 85,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [
        item("Banana prata", 100),
        item("Queijo Minas Padrao Fatiado", 80),
        item("Queijo mussarela", 70),
      ],
    }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Diminuir 10g da banana e 10g do queijo",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result?.detail).toContain('Matches: alvo "banana" -> "Banana prata"');
    expect(result?.detail).toContain('Alvos ambíguos: alvo "queijo"');
    expect(result?.detail).toContain("Ambiguidade: sim");
  });

  it("registra alvo e item escolhido em troca de alimento", async () => {
    listMealsMock.mockResolvedValue([{
      id: 86,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [item("Queijo Minas Padrao Fatiado", 80)],
    }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, {
      text: "não é queijo minas é ricota",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result?.detail).toContain('Matches: alvo "queijo minas" -> "Queijo Minas Padrao Fatiado"');
    expect(result?.detail).toContain("Escopo da busca: na última refeição");
    expect(result?.detail).toContain("Ambiguidade: não");
  });

  it("registra ambiguidade em troca de alimento quando existem varios candidatos", async () => {
    listMealsMock.mockResolvedValue([{
      id: 87,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [
        item("Queijo Minas Padrao Fatiado", 80),
        item("Queijo mussarela", 70),
      ],
    }]);

    const result = await executeWhatsappTextIntent(42, {
      text: "não é queijo é ricota",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result?.detail).toContain("Alvo usado: queijo");
    expect(result?.detail).toContain("Escopo da busca: última refeição");
    expect(result?.detail).toContain("Ambiguidade: sim");
  });

  it("registra matches aplicados e pendencias em troca multipla parcial", async () => {
    listMealsMock.mockResolvedValue([{
      id: 88,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [
        item("Banana prata", 100),
        item("Queijo Minas Padrao Fatiado", 80),
        item("Queijo mussarela", 70),
      ],
    }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, {
      text: "não é banana é pera e não é queijo é ricota",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result?.detail).toContain('Matches: alvo "banana" -> "Banana prata"');
    expect(result?.detail).toContain('Alvos ambíguos: alvo "queijo"');
    expect(result?.detail).toContain("Ambiguidade: sim");
  });
});
