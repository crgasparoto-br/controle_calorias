import { describe, expect, it } from "vitest";
import { extractExplicitSugarQuantity } from "./coffeeSugarNutrition";
import { isCoffeeWithAddedSugar } from "./foodSemanticCompatibility";

describe("unidades explícitas de açúcar", () => {
  it("aceita a abreviação gr de ponta a ponta", () => {
    expect(extractExplicitSugarQuantity("café com 5 gr de açúcar")).toEqual(
      expect.objectContaining({ grams: 5, unit: "g" }),
    );
    expect(isCoffeeWithAddedSugar("café com 5 gr de açúcar")).toBe(true);
  });
});
