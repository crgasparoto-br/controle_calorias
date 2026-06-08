import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logInferenceEvent: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

const meal = {
  id: 456,
  userId: 123,
  source: "whatsapp" as const,
  mealLabel: "Jantar",
  status: "confirmed" as const,
  occurredAt: Date.now(),
  notes: undefined,
  sourceText: "300g amendoim japonês",
  confidence: 0.9,
  items: [
    {
      foodName: "Amendoim japonês",
      canonicalName: "Amendoim japonês",
      portionText: "300 g",
      quantity: 300,
      unit: "g",
      servings: 1,
      estimatedGrams: 300,
      calories: 450,
      protein: 15,
      carbs: 40,
      fat: 25,
      confidence: 0.9,
      source: "heuristic" as const,
    },
  ],
  media: [],
  createdAt: Date.now(),
  totals: {
    calories: 450,
    protein: 15,
    carbs: 40,
    fat: 25,
  },
};

describe("quickEdit service", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    process.env.QUICK_EDIT_BASE_URL = "https://app.example.com";
    const service = await import("./service");
    service.__resetQuickEditTokensForTests();
  });

  it("gera link opaco sem expor ids internos", async () => {
    const { createQuickEditLinkForMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });

    expect(link.url).toMatch(/^https:\/\/app\.example\.com\/quick-edit\//);
    expect(link.url).not.toContain("123");
    expect(link.url).not.toContain("456");
    expect(link.token.length).toBeGreaterThanOrEqual(32);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("carrega apenas a refeição vinculada ao token válido", async () => {
    const { createQuickEditLinkForMeal, getQuickEditMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    listMealsMock.mockResolvedValue([meal, { ...meal, id: 999 }]);

    await expect(getQuickEditMeal(link.token)).resolves.toMatchObject({
      meal: expect.objectContaining({ id: 456, mealLabel: "Jantar" }),
    });
  });

  it("rejeita token expirado", async () => {
    const { createQuickEditLinkForMeal, getQuickEditMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456, expiresInMs: 1 });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 2_000));

    await expect(getQuickEditMeal(link.token)).rejects.toThrow("Link de edição inválido ou expirado.");
  });

  it("atualiza a refeição vinculada ao token sem aceitar mealId externo", async () => {
    const { createQuickEditLinkForMeal, updateQuickEditMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    updateMealMock.mockResolvedValue({ ...meal, mealLabel: "Jantar ajustado" });

    await updateQuickEditMeal(link.token, {
      mealLabel: "Jantar ajustado",
      occurredAt: new Date().toISOString(),
      items: meal.items,
    });

    expect(updateMealMock).toHaveBeenCalledWith(123, expect.objectContaining({
      mealId: 456,
      mealLabel: "Jantar ajustado",
    }));
  });
});
