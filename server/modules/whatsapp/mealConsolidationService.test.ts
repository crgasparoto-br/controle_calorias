import { describe, expect, it, vi } from "vitest";
import { consolidateWhatsAppMealAfterSave, type WhatsAppConsolidationSavedMeal } from "./mealConsolidationService";

function meal(input: Partial<WhatsAppConsolidationSavedMeal> & { id: number }): WhatsAppConsolidationSavedMeal {
  return {
    id: input.id,
    userId: input.userId ?? 123,
    source: input.source ?? "whatsapp",
    mealLabel: input.mealLabel ?? "Café da manhã",
    occurredAt: input.occurredAt ?? new Date("2026-06-04T10:00:00.000Z"),
    notes: input.notes,
    items: input.items ?? [],
  };
}

describe("consolidateWhatsAppMealAfterSave", () => {
  it("mantém a refeição recém-salva quando não há alvo", async () => {
    const savedMeal = meal({ id: 10, items: [] });
    const result = await consolidateWhatsAppMealAfterSave({
      listUserMeals: vi.fn(async () => [savedMeal]),
      updateUserMeal: vi.fn(),
      removeUserMeal: vi.fn(),
    }, savedMeal);

    expect(result).toEqual({ action: "created", meal: savedMeal });
  });

  it("adiciona itens na refeição existente e remove a transitória", async () => {
    const existingMeal = meal({
      id: 9,
      items: [{ foodName: "Pêra", canonicalName: "Pêra", portionText: "185 g", estimatedGrams: 185, servings: 1, calories: 105, protein: 0.7, carbs: 28, fat: 0.2, confidence: 0.9, source: "catalog" }],
    });
    const savedMeal = meal({
      id: 10,
      items: [{ foodName: "Banana", canonicalName: "Banana", portionText: "139 g", estimatedGrams: 139, servings: 1, calories: 125, protein: 1.5, carbs: 32.3, fat: 0.4, confidence: 0.9, source: "catalog" }],
    });
    const updateUserMeal = vi.fn(async input => meal({ id: input.mealId, items: input.items }));
    const removeUserMeal = vi.fn(async () => ({ success: true }));

    const result = await consolidateWhatsAppMealAfterSave({
      listUserMeals: vi.fn(async () => [savedMeal, existingMeal]),
      updateUserMeal,
      removeUserMeal,
    }, savedMeal);

    expect(result.action).toBe("updated");
    expect(result.action === "updated" ? result.meal.items.map(item => item.foodName) : []).toEqual(["Pêra", "Banana"]);
    expect(updateUserMeal).toHaveBeenCalledWith(expect.objectContaining({ mealId: 9, items: expect.arrayContaining(savedMeal.items) }));
    expect(removeUserMeal).toHaveBeenCalledWith(123, 10);
  });

  it("não atualiza quando existem múltiplas candidatas", async () => {
    const savedMeal = meal({ id: 10 });
    const updateUserMeal = vi.fn();
    const removeUserMeal = vi.fn();
    const result = await consolidateWhatsAppMealAfterSave({
      listUserMeals: vi.fn(async () => [
        savedMeal,
        meal({ id: 8, occurredAt: new Date("2026-06-04T09:00:00.000Z") }),
        meal({ id: 9, occurredAt: new Date("2026-06-04T09:30:00.000Z") }),
      ]),
      updateUserMeal,
      removeUserMeal,
    }, savedMeal);

    expect(result.action).toBe("ambiguous");
    expect(updateUserMeal).not.toHaveBeenCalled();
    expect(removeUserMeal).not.toHaveBeenCalled();
  });
});
