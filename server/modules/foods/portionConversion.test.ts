import { describe, expect, it } from "vitest";
import { calculatePortionGrams } from "./service";

describe("calculatePortionGrams", () => {
  it("converts one household measure to grams", () => {
    expect(calculatePortionGrams({ portionGrams: 25, portionQuantity: 1, requestedQuantity: 1 })).toBe(25);
  });

  it("scales grams by requested quantity", () => {
    expect(calculatePortionGrams({ portionGrams: 100, portionQuantity: 1, requestedQuantity: 1.5 })).toBe(150);
  });

  it("handles portion rows where the base quantity is greater than one", () => {
    expect(calculatePortionGrams({ portionGrams: 240, portionQuantity: 2, requestedQuantity: 0.5 })).toBe(60);
  });

  it("rounds converted grams to two decimals", () => {
    expect(calculatePortionGrams({ portionGrams: 100, portionQuantity: 3, requestedQuantity: 1 })).toBe(33.33);
  });
});
