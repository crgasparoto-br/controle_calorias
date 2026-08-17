import { describe, expect, it } from "vitest";
import {
  activityEntryInputSchema,
  foodInputSchema,
  mealInputSchema,
  recipeInputSchema,
  userRestrictionInputSchema,
  weightEntryInputSchema,
} from "@shared/nutritionModelSchemas";

describe("nutrition model schemas", () => {
  it("valida alimento genérico, alimento de marca e itens de refeição com macros", () => {
    const genericFood = foodInputSchema.parse({
      slug: "arroz-branco-cozido",
      name: "Arroz branco cozido",
      foodType: "generic",
      servingLabel: "100 g",
      gramsPerServing: 100,
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
      fiber: 1.6,
      isFruit: false,
      isVegetable: false,
      isUltraProcessed: false,
    });

    const brandedFood = foodInputSchema.parse({
      slug: "iogurte-natural-marca-exemplo",
      name: "Iogurte natural",
      brandId: 1,
      foodType: "branded",
      barcode: "7891000000000",
      dataSource: "label",
      servingLabel: "1 pote",
      gramsPerServing: 170,
      calories: 110,
      protein: 8,
      carbs: 12,
      fat: 3,
    });

    const meal = mealInputSchema.parse({
      mealLabel: "Almoço",
      occurredAt: "2026-05-05T12:00:00.000Z",
      items: [
        {
          foodCatalogId: 1,
          itemType: "food",
          foodName: genericFood.name,
          canonicalName: genericFood.name,
          portionText: "150 g",
          quantity: 150,
          unit: "g",
          servings: 1.5,
          estimatedGrams: 150,
          calories: 195,
          protein: 4.1,
          carbs: 42,
          fat: 0.5,
        },
        {
          foodCatalogId: 2,
          itemType: "food",
          foodName: brandedFood.name,
          canonicalName: brandedFood.name,
          portionText: "1 pote",
          calories: brandedFood.calories,
          protein: brandedFood.protein,
          carbs: brandedFood.carbs,
          fat: brandedFood.fat,
        },
      ],
    });

    expect(meal.items).toHaveLength(2);
    expect(genericFood.fiber).toBe(1.6);
    expect(genericFood.isUltraProcessed).toBe(false);
    expect(meal.items.reduce((total, item) => total + item.calories, 0)).toBe(305);
  });

  it("valida receita, peso, atividade e restrições alimentares", () => {
    const recipe = recipeInputSchema.parse({
      name: "Omelete simples",
      servings: 2,
      totalGrams: 240,
      items: [
        {
          foodCatalogId: 10,
          quantity: 2,
          unit: "un",
          grams: 100,
          calories: 144,
          protein: 12.6,
          carbs: 0.8,
          fat: 9.6,
        },
      ],
    });

    const weight = weightEntryInputSchema.parse({ weightKg: 82.4 });
    const activity = activityEntryInputSchema.parse({
      activityType: "Caminhada",
      durationMinutes: 35,
      caloriesBurned: 160,
    });
    const restriction = userRestrictionInputSchema.parse({
      restrictionType: "allergy",
      label: "Amendoim",
      severity: "strict",
    });

    expect(recipe.items[0]?.protein).toBe(12.6);
    expect(weight.weightKg).toBe(82.4);
    expect(activity.durationMinutes).toBe(35);
    expect(restriction.severity).toBe("strict");
  });

  it("rejeita item de receita sem referência de receita", () => {
    expect(() => mealInputSchema.parse({
      mealLabel: "Jantar",
      occurredAt: "2026-05-05T20:00:00.000Z",
      items: [
        {
          itemType: "recipe",
          foodName: "Sopa caseira",
          canonicalName: "Sopa caseira",
          portionText: "1 prato",
          calories: 280,
          protein: 18,
          carbs: 30,
          fat: 10,
        },
      ],
    })).toThrow("Itens de receita precisam referenciar uma receita");
  });
});
