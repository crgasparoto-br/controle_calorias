import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const removeMealMock = vi.fn();
const updateMealMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  removeMeal: removeMealMock,
  updateMeal: updateMealMock,
}));

const { executeWhatsappDeleteIntent } = await import("./deleteIntent");

const baseMeal = {
  id: 991,
  mealLabel: "Jantar",
  occurredAt: "2026-07-11T22:00:00.000Z",
  notes: null,
  items: [
    { foodName: "Chocolate ao leite", canonicalName: "Chocolate", portionText: "15 g", servings: 1, estimatedGrams: 15, calories: 80, protein: 1, carbs: 10, fat: 4, confidence: 0.9, source: "catalog" },
    { foodName: "Chocolate amargo", canonicalName: "Chocolate", portionText: "15 g", servings: 1, estimatedGrams: 15, calories: 70, protein: 1, carbs: 8, fat: 4, confidence: 0.9, source: "catalog" },
  ],
};

describe("deleteIntent seleção persistente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMealsMock.mockResolvedValue([structuredClone(baseMeal)]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ ...baseMeal, ...input }));
  });

  it("executa excluir chocolate -> o segundo -> sim uma única vez", async () => {
    const userId = 876543;
    const ambiguous = await executeWhatsappDeleteIntent(userId, { text: "excluir chocolate" });
    expect(ambiguous?.action).toBe("clarification_needed");
    expect(ambiguous?.reply).toContain("2. Chocolate amargo");
    expect(updateMealMock).not.toHaveBeenCalled();

    const selection = await executeWhatsappDeleteIntent(userId, { text: "o segundo" });
    expect(selection?.action).toBe("clarification_needed");
    expect(selection?.reply).toContain("Chocolate amargo");
    expect(updateMealMock).not.toHaveBeenCalled();

    const confirmation = await executeWhatsappDeleteIntent(userId, { text: "sim" });
    expect(confirmation?.action).toBe("meal_item_deleted");
    expect(updateMealMock).toHaveBeenCalledTimes(1);
    expect(updateMealMock.mock.calls[0][1].items).toHaveLength(1);
    expect(updateMealMock.mock.calls[0][1].items[0].foodName).toBe("Chocolate ao leite");

    const redelivery = await executeWhatsappDeleteIntent(userId, { text: "sim" });
    expect(redelivery).toBeNull();
    expect(updateMealMock).toHaveBeenCalledTimes(1);
  });
});
