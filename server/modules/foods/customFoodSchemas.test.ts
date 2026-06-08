import { describe, expect, it } from "vitest";
import { customFoodSchema, deleteCustomFoodSchema, updateCustomFoodSchema } from "./schemas";

const validCustomFood = {
  name: "Iogurte caseiro",
  brandName: "Minha cozinha",
  category: "laticinios",
  description: "Receita cadastrada pelo usuario.",
  caloriesKcalPer100g: 72,
  proteinGramsPer100g: 4.2,
  carbsGramsPer100g: 6.1,
  fatGramsPer100g: 3.4,
  fiberGramsPer100g: 0,
  sugarGramsPer100g: 5.8,
  sodiumMgPer100g: 48,
  aliases: ["iogurte natural caseiro"],
  portions: [
    {
      label: "1 pote",
      unit: "serving",
      quantity: 1,
      grams: 170,
      isDefault: true,
    },
  ],
};

describe("custom food schemas", () => {
  it("accepts a custom food with nutrients per 100g and portions", () => {
    const parsed = customFoodSchema.parse(validCustomFood);

    expect(parsed.name).toBe("Iogurte caseiro");
    expect(parsed.aliases).toHaveLength(1);
    expect(parsed.portions[0].grams).toBe(170);
  });

  it("rejects negative nutrient values", () => {
    expect(() => customFoodSchema.parse({
      ...validCustomFood,
      caloriesKcalPer100g: -1,
    })).toThrow();
  });

  it("requires an owned food id for custom food update and deletion", () => {
    expect(updateCustomFoodSchema.parse({ ...validCustomFood, foodId: 42 }).foodId).toBe(42);
    expect(deleteCustomFoodSchema.parse({ foodId: 42 }).foodId).toBe(42);
    expect(() => deleteCustomFoodSchema.parse({ foodId: 0 })).toThrow();
  });
});
