import { describe, expect, it, vi } from "vitest";
import { applySpoonDecisions, readSpoonDecisions } from "./mealSpoonQuantities";
import type { FoodQuantityResolution } from "./foodItemResolution";
import type { MealDraftItem } from "./nutritionEngineTypes";

function measured(grams: number): FoodQuantityResolution {
  return {
    kind: "researched_exact",
    grams,
    originalQuantity: 1,
    originalUnit: "colher de sopa",
    evidence: `1 colher de sopa = ${grams} g`,
    sourceUrls: ["https://example.org/portion"],
    referenceCount: 1,
    householdMeasure: {
      kind: "researched_exact",
      grams,
      requestedQuantity: 1,
      requestedUnit: "colher de sopa",
      evidence: `1 colher de sopa = ${grams} g`,
      sourceUrls: ["https://example.org/portion"],
      referenceCount: 1,
    },
  };
}

function heuristic(foodName: string): MealDraftItem {
  return {
    foodName,
    canonicalName: foodName,
    quantity: 1,
    unit: "colher de sopa",
    portionText: "1 colher de sopa",
    servings: 1,
    estimatedGrams: 100,
    calories: 150,
    protein: 6,
    carbs: 15,
    fat: 5,
    confidence: 0.35,
    source: "heuristic",
  };
}

describe("V1 spoon measure provenance and canonical precedence (#1339 A-001)", () => {
  it.each([
    ["1 colher de sopa de arroz", "arroz", 1, "colher de sopa", 25],
    ["2 colheres de sopa de requeijão cremoso", "requeijão cremoso", 2, "colher de sopa", 30],
    ["uma colher de chá de açúcar", "açúcar", 1, "colher de chá", 4],
  ] as const)("allows a verified canonical portion for %s", async (text, foodName, quantity, unit, grams) => {
    const resolveQuantity = vi.fn(async () => measured(grams));
    const [decision] = await readSpoonDecisions(text, 7, { resolveQuantity });
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, foodName, quantity, unit,
    }));
    expect(decision).toMatchObject({ foodName, quantity, unit, resolution: { grams } });
    const [resolved] = applySpoonDecisions([heuristic(foodName)], [decision])!;
    expect(resolved).toEqual(expect.objectContaining({
      quantity, unit, portionText: `${quantity} ${unit}`, estimatedGrams: grams,
      resolution: expect.objectContaining({
        measureResolution: expect.objectContaining({
          kind: "researched_exact", grams, requestedQuantity: quantity,
          requestedUnit: unit, referenceCount: 1,
        }),
      }),
    }));
    expect(resolved.calories).toBeGreaterThan(0);
  });

  it("does not seek tenant-scoped measures without authenticated user context", async () => {
    const resolveQuantity = vi.fn(async () => measured(25));
    const [decision] = await readSpoonDecisions("1 colher de sopa de arroz", undefined, { resolveQuantity });
    expect(resolveQuantity).not.toHaveBeenCalled();
    expect(decision.resolution).toBeNull();
    expect(applySpoonDecisions([heuristic("Arroz")], [decision])).toBeNull();
  });

  it("preserves an unverified nutrition estimate even when grams are verified", async () => {
    const foodName = "Alimento regional não catalogado";
    const [decision] = await readSpoonDecisions(`1 colher de sopa de ${foodName}`, 7, {
      resolveQuantity: vi.fn(async () => measured(20)),
    });
    const [item] = applySpoonDecisions([heuristic(foodName)], [decision])!;
    expect(item).toMatchObject({
      source: "heuristic", estimatedGrams: 20, calories: 30, protein: 1.2,
      resolution: {
        nutritionOrigin: "heuristic", nutritionVerified: false,
        measureResolution: { grams: 20, verified: true },
      },
    });
  });

  it("refuses ambiguous binding and does not transfer grams to a similar food", async () => {
    const [decision] = await readSpoonDecisions("1 colher de sopa de arroz", 7, {
      resolveQuantity: vi.fn(async () => measured(25)),
    });
    expect(applySpoonDecisions([heuristic("Arroz integral")], [decision])).toBeNull();
    expect(applySpoonDecisions([heuristic("Arroz"), heuristic("Arroz")], [decision])).toBeNull();
  });

  it("does not affect gram, volume or vague units", async () => {
    const resolveQuantity = vi.fn(async () => measured(25));
    const decisions = await readSpoonDecisions(
      "100 g de arroz e 500 ml de leite e duas colheradas de arroz", 7, { resolveQuantity },
    );
    expect(decisions).toEqual([]);
    expect(resolveQuantity).not.toHaveBeenCalled();
    const items = [heuristic("Arroz")];
    expect(applySpoonDecisions(items, [])).toBe(items);
  });

  it("ties each conversion to its own resolved item in a mixed meal", async () => {
    const resolveQuantity = vi.fn(async ({ foodName }) => measured(foodName === "arroz" ? 25 : 15));
    const decisions = await readSpoonDecisions(
      "1 colher de sopa de arroz e 1 colher de sopa de requeijão cremoso", 9,
      { resolveQuantity },
    );
    expect(decisions).toHaveLength(2);
    const items = applySpoonDecisions(
      [heuristic("Requeijão cremoso"), heuristic("Arroz")], decisions,
    );
    expect(items?.map(item => item.estimatedGrams)).toEqual([15, 25]);
  });
});
