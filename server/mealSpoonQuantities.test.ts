import { describe, expect, it, vi } from "vitest";
import { applySpoonDecisions, readSpoonDecisions } from "./mealSpoonQuantities";
import { splitFoodTextSegments } from "./mealTextParsing";
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

  it.each([
    "comi 1 colher de sopa de arroz",
    "hoje comi 1 colher de sopa de arroz",
    "nesta refeição eu comi 1 colher de sopa de arroz",
  ])("resolves a measured food after a registration preface without losing the source: %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(25));
    const [decision] = await readSpoonDecisions(text, 7, { resolveQuantity });
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, foodName: "arroz", quantity: 1, unit: "colher de sopa",
    }));
    expect(applySpoonDecisions([heuristic("Arroz")], [decision])).toEqual([
      expect.objectContaining({ estimatedGrams: 25, unit: "colher de sopa" }),
    ]);
  });

  it.each([
    "comi arroz com 1 colher de sopa de feijão",
    "1 colher de sopa de arroz com 1 colher de sopa de feijão",
    "comi 1 colher de sopa de arroz com 1 colher de chá de açúcar",
  ])("fails closed on an unbound or competing quantity: %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(25));
    const decisions = await readSpoonDecisions(text, 7, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each([
    ["café com 1 colher de chá de açúcar", 1, "colher de chá"],
    ["café com uma colher de chá de açúcar", 1, "colher de chá"],
    ["1 xícara de café com 2 colheres de sopa de açúcar", 2, "colher de sopa"],
  ] as const)("resolves the sugar component within coffee: %s", async (text, quantity, unit) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const [decision] = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity, unit,
    }));
    expect(decision).toEqual(expect.objectContaining({
      coffeeSugarSegment: text, resolution: expect.objectContaining({ grams: 8 }),
    }));
    // Coffee is constructed from the component measure, not as a spoon of coffee.
    expect(applySpoonDecisions([heuristic("Café com açúcar")], [decision])).toHaveLength(1);
  });

  it("never consults a personal sugar portion without a user or a valid sugar binding", async () => {
    const resolveQuantity = vi.fn(async () => measured(8));
    expect((await readSpoonDecisions("café com 1 colher de chá de açúcar", undefined, { resolveQuantity }))[0].resolution).toBeNull();
    expect((await readSpoonDecisions("café com uma colher de chá e outra colher de sopa de açúcar", 17, { resolveQuantity }))[0].resolution).toBeNull();
    expect(resolveQuantity).not.toHaveBeenCalled();
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

describe("PR #1339 independent audit remediation: spoken counts and coffee components", () => {
  it.each([
    ["comi uma colher de sopa de arroz", "arroz", 1, "colher de sopa"],
    ["hoje comi duas colheres de sopa de arroz", "arroz", 2, "colher de sopa"],
    ["ontem eu consumi uma colher de ch\u00e1 de mel", "mel", 1, "colher de ch\u00e1"],
  ] as const)("A-002: uses the authenticated quantity owner for %s", async (text, foodName, quantity, unit) => {
    const resolveQuantity = vi.fn(async () => measured(25));
    const decisions = await readSpoonDecisions(text, 7, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({
      foodName, quantity, unit, resolution: expect.objectContaining({ grams: 25 }),
    })]);
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, foodName, quantity, unit,
    }));
  });

  it("A-002: competing spoon bindings still fail closed", async () => {
    const resolveQuantity = vi.fn(async () => measured(25));
    const decisions = await readSpoonDecisions(
      "comi uma colher de sopa de arroz com uma colher de ch\u00e1 de mel", 7, { resolveQuantity },
    );
    expect(decisions).toEqual([expect.objectContaining({ resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each([
    ["caf\u00e9 sem a\u00e7\u00facar com 1 colher de sopa de leite", "leite", "colher de sopa"],
    ["caf\u00e9 com 5 g de a\u00e7\u00facar e 1 colher de sopa de leite", "leite", "colher de sopa"],
    ["caf\u00e9 com uma colher de sopa de mel", "mel", "colher de sopa"],
    ["caf\u00e9 com ado\u00e7ante e uma colher de ch\u00e1 de leite", "leite", "colher de ch\u00e1"],
  ] as const)("A-004: requests the real component, not a fake sugar spoon: %s", async (text, foodName, unit) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 7, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({
      foodName, unit, quantity: 0, resolution: null,
    })]);
    expect(decisions.some(decision => decision.coffeeSugarSegment)).toBe(false);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it("A-004: never estimates contradictory sugar or concurrent spoons", async () => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const contradiction = await readSpoonDecisions(
      "caf\u00e9 sem a\u00e7\u00facar com 1 colher de ch\u00e1 de a\u00e7\u00facar", 7, { resolveQuantity },
    );
    const competing = await readSpoonDecisions(
      "caf\u00e9 com 1 colher de ch\u00e1 de a\u00e7\u00facar e 1 colher de sopa de leite", 7, { resolveQuantity },
    );
    expect(contradiction[0].resolution).toBeNull();
    expect(competing[0].resolution).toBeNull();
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each([
    ["5 gramas", "cinco gramas"],
    ["1 pacote", "um pacote"],
    ["2 sachês", "dois sachês"],
    ["3 kg", "três quilos"],
    ["4 mg", "quatro miligramas"],
  ] as const)("A-005: blocks both numeric and written extra sugar amounts (%s / %s)", async (numeric, written) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    for (const extra of [numeric, written]) {
      const text = `café com uma colher de chá de açúcar e ${extra} de açúcar`;
      const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
      expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
      expect(decisions.some(decision => decision.coffeeSugarSegment)).toBe(false);
    }
    expect(resolveQuantity).not.toHaveBeenCalled();
  });
});

describe("PR #1339 A-006/A-007: scoped lookup boundary", () => {
  it.each([
    "café com 1/2 colher de chá de açúcar",
    "café com 3/4 colher de chá de açúcar",
    "café com 1+2 colheres de chá de açúcar",
    "café com -2 colheres de chá de açúcar",
    "café com 1 / 2 colher de chá de açúcar",
    "café com uma colher de chá de açúcar e cinco gramas adicionais de açúcar",
    "café com uma colher de chá de açúcar e 5 g extras de açúcar",
    "café com −2 colheres de chá de açúcar",
    "café com 3×2 colheres de chá de açúcar",
    "café com 1−2 colheres de chá de açúcar",
    "café com 1:2 colheres de chá de açúcar",
    "café com 1 : 2 colheres de chá de açúcar",
    "café com 3x2 colheres de chá de açúcar",
    "café com 1⁄2 colher de chá de açúcar",
    "café com 2·3 colheres de chá de açúcar",
    "café com 1—2 colheres de chá de açúcar",
    "café com 1÷2 colheres de chá de açúcar",
    "café com +2 colheres de chá de açúcar",
    "café com uma colher de chá de açúcar e um grama adicional de açúcar",
    "café com uma colher de chá de açúcar e 1 grama adicional de açúcar",
    "café com uma colher de chá de açúcar e 1 g adicional de açúcar",
    "café com uma colher de chá de açúcar e um sachê adicional de açúcar",
    "café com uma colher de chá de açúcar e 2 sachês adicionais de açúcar",
    "café com uma colher de chá de açúcar e 1 g extra de açúcar",
    "café com uma colher de chá de açúcar e dois gramas a mais de açúcar",
  ])("does not call scoped resolver for %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });
});

describe("PR #1339 A-007: segmenter retains qualified coffee complements", () => {
  it.each([
    "um grama adicional",
    "1 g adicional",
    "um sachê adicional",
    "dois gramas a mais",
  ])("keeps a concurrent sugar component in the same guarded segment: %s", extra => {
    expect(splitFoodTextSegments(
      `café com uma colher de chá de açúcar e ${extra} de açúcar`,
    )).toHaveLength(1);
  });

  it("does not rebind the measured milk complement as sugar", async () => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const text = "café com uma colher de chá de açúcar e um grama adicional de leite";
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "açúcar", quantity: 1 });
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
  });
});

describe("PR #1339 A-008: no tenant lookup for unknown or elided sugar measure", () => {
  it.each([
    "café com uma colher de chá de açúcar e 1 pitada de açúcar",
    "café com uma colher de chá de açúcar e cinco gramas adicionais",
    "café com uma colher de chá de açúcar e mais 5 g",
    "café com uma colher de chá de açúcar e 1 pitada",
    "café com uma colher de chá de açúcar e 5 g de leite e mais um pacote",
    "café com uma colher de chá de açúcar e meio sachê de açúcar",
    "café com uma colher de chá de açúcar e +3g a mais",
    "café com uma colher de chá de açúcar e 1/2 g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 sachê de açúcar",
    "café com uma colher de chá de açúcar e ½ g de açúcar",
    "café com uma colher de chá de açúcar e 1⁄2 g de açúcar",
    "café com uma colher de chá de açúcar e 1∕2 g de açúcar",
    "café com uma colher de chá de açúcar e 2½ g de açúcar",
    "café com uma colher de chá de açúcar e 1/2g de açúcar",
    "café com uma colher de chá de açúcar e +1/2g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 g adicionais",
    "café com uma colher de chá de açúcar e 1/2 g de açúcar.",
    "café com uma colher de chá de açúcar e 1/2 g",
  ])("fails closed on %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(decisions[0].coffeeSugarSegment).toBeUndefined();
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each([
    "café com uma colher de chá de açúcar e 2 g adicionais de leite",
    "café com uma colher de chá de açúcar e 1 pitada de sal",
    "café com uma colher de chá de açúcar e 1 pão",
    "café com uma colher de chá de açúcar e 1/2 g de leite",
    "café com uma colher de chá de açúcar e ½ g de leite",
    "café com uma colher de chá de açúcar e 1/2g de leite",
    "café com uma colher de chá de açúcar e 1/2 sachê de adoçante",
    "café com uma colher de chá de açúcar e 1/2 g de leite.",
  ])("does not falsely attribute a different ingredient to sugar: %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "açúcar", quantity: 1 });
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
  });
});
