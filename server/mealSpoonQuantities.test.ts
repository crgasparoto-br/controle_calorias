import {
  A133914_DISTINCT_FOOD_SUGAR_POSITIVE,
  A133914_OTHER_FOOD_SUGAR_ONLY,
  A133914_SUGAR_SCOPE_NEGATIVE,
  A133913_INDEPENDENT_NEGATION_POSITIVE,
  A133913_COFFEE_NEGATION_NEGATIVE,
  A1339_133908_NEGATIVE,
  A1339_133911_NEGATIVE,
  A1339_133912_POSITIVE,
  A1339_133909_POSITIVE,
  A1339_NEW03_AUDIT_NEGATIVE,
  A1339_133905_NEGATIVE,
  A1339_133906_NEGATIVE,
  A1339_133906_POSITIVE,
  A1339_133907_NEGATIVE,
  A1339_133907_POSITIVE,
  A1339_133905_POSITIVE,
  A1339_NEW03_AUDIT_POSITIVE,
  A1339_NEW03_METAMORPHIC_NEGATIVE,
  A1339_NEW03_METAMORPHIC_POSITIVE,
} from "./coffeeSugarNutrition.spoonQuantityRemediation.fixture";
import { describe, expect, it, vi } from "vitest";
import { applySpoonDecisions, readSpoonDecisions } from "./mealSpoonQuantities";
import { splitFoodTextSegments } from "./mealTextParsing";
import type { FoodQuantityResolution, resolveCanonicalFoodQuantity } from "./foodItemResolution";
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

  it("A-004: contradictory sugar remains unresolved without any personal lookup", async () => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(
      "café sem açúcar com 1 colher de chá de açúcar", 7, { resolveQuantity },
    );
    expect(decisions).toEqual([expect.objectContaining({ resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it("A-004: a separately bound milk spoon does not compete with the sugar spoon", async () => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(
      "café com 1 colher de chá de açúcar e 1 colher de sopa de leite", 7, { resolveQuantity },
    );
    expect(decisions).toEqual([expect.objectContaining({
      foodName: "açúcar",
      quantity: 1,
      unit: "colher de chá",
      resolution: expect.objectContaining({ grams: 8 }),
    })]);
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
  });

  it.each([
    "café com 1 colher de chá de açúcar e outra colher",
    "café com 1 colher de chá de açúcar e outra colher de açúcar",
    "café com 1 colher de chá de açúcar e 1 colher de sopa",
  ])("A-004: ambiguous or sugar-bound second spoons never trigger a lookup: %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 7, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
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
    "café com uma colher de chá de açúcar e 1/2 g a mais de açúcar",
    "café com uma colher de chá de açúcar e ½ sachê a mais",
    "café com uma colher de chá de açúcar e 1/2 g",
    "café com uma colher de chá de açúcar e mais meia de açúcar",
    "café com uma colher de chá de açúcar e duas de açúcar",
    "café com uma colher de chá de açúcar e 5 de açúcar",
    "café com uma colher de chá de açúcar e 1/2 de açúcar",
    "café com uma colher de chá de açúcar e meia a mais",
    "café com uma colher de chá de açúcar e mais 2",
    "café com uma colher de chá de açúcar e meia a mais de açúcar",
    "café com uma colher de chá de açúcar e mais duas de açúcar",
    "café com uma colher de chá de açúcar e 0,5 de açúcar",
    "café com uma colher de chá de açúcar e duas adicionais",
    "café com uma colher de chá de açúcar e meia extra",
    "café com uma colher de chá de açúcar e meia pequena porção de açúcar",
    "café com uma colher de chá de açúcar e uma medida adicional de açúcar",
    "café com uma colher de chá de açúcar e duas porções adicionais de açúcar",
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
    "café com uma colher de chá de açúcar e 1/2 g a mais de leite",
    "café com uma colher de chá de açúcar e ½ sachê a mais de leite",
    "café com uma colher de chá de açúcar e 0,5 g a mais de leite",
    "café com uma colher de chá de açúcar e meia de leite",
    "café com uma colher de chá de açúcar e meia a mais de leite",
    "café com uma colher de chá de açúcar e duas de leite",
    "café com uma colher de chá de açúcar e mais duas bananas",
    "café com uma colher de chá de açúcar e meia pequena porção de leite",
    "café com uma colher de chá de açúcar e duas porções adicionais de leite",
    "café com 1 colher de chá de açúcar e mais um pouco de leite",
    "café com 1 colher de chá de açúcar mais um pouco de leite",
    "café com 1 colher de chá de açúcar, mais um pouco de leite",
    "café com 1 colher de chá de açúcar; mais um pouquinho de leite",
    "café com 1 colher de chá de açúcar mais leite",
    "café com 1 colher de chá de açúcar e outra de leite",
    "café com 1 colher de chá de açúcar ou mais leite",
    "café com 1 colher de chá de açúcar e outra porção de leite",
    "café com 1 colher de chá de açúcar ou menos de leite",
    "café com 1 colher de chá de açúcar e uma dose de leite",
    "café com 1 colher de chá de açúcar e mais outra dose de leite",
    "café com 1 colher de chá de açúcar e mais uma banana",
    "café com 1 colher de chá de açúcar e mais leite e outra porção de leite",
    "café com 1 colher de chá de açúcar e uma dose de leite e mais uma banana",
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


describe("PR #1339 A-008/A-1339: ambiguous amounts cannot reach personal portion lookup", () => {
  it.each([
    "caf\u00e9 com 1 ou 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com uma ou duas colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 e 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 ou duas colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 a 2 colheres de sopa de a\u00e7\u00facar",
    "caf\u00e9 com 1 at\u00e9 2 colheres de sopa de a\u00e7\u00facar",
    "caf\u00e9 com 1 ou talvez 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "café com 1 e/ou 2 colheres de chá de açúcar",
    "café com uma e/ou duas colheres de chá de açúcar",
    "café com 1 ou/e 2 colheres de sopa de açúcar",
    "café com 1 e-ou 2 colheres de sopa de açúcar",
    "café com 1 colher de chá de açúcar e mais açúcar",
    "café com 1 colher de chá de açúcar e açúcar adicional",
    "café com 1 colher de chá de açúcar ou mais",
    "café com 1 colher de chá de açúcar ou menos",
    "café com 1 colher de chá de açúcar e mais um pouco",
    "café com 1 colher de chá de açúcar mais um pouco",
    "café com 1 colher de chá de açúcar, mais um pouco",
    "café com 1 colher de chá de açúcar; mais um pouco",
    "café com 1 colher de chá de açúcar mais um pouquinho",
    "café com 1 colher de chá de açúcar, mais um tanto",
    "café com 1 colher de chá de açúcar mais um pouco de açúcar",
    "café com 1 colher de chá de açúcar outra",
    "café com 1 colher de chá de açúcar e outra",
    "café com 1 colher de chá de açúcar e outras",
    "café com 1 colher de chá de açúcar e mais um pouquinho",
    "café com 1 colher de chá de açúcar e mais um tanto",
    "café com 1 colher de chá de açúcar ou ainda menos",
    "café com 1 colher de chá de açúcar e também outra",
    "café com 1 colher de chá de açúcar ou um pouco",
    "café com 1 colher de chá de açúcar e mais uma medida",
    "café com 1 colher de chá de açúcar e mais um pouco de açúcar",
    "café com 1 colher de chá de açúcar e outra porção de açúcar",
    "café com 1 colher de chá de açúcar ou outra de açúcar",
    "café com 1 colher de chá de açúcar ou mais ainda",
    "café com 1 colher de chá de açúcar e só mais um tanto",
    "café com 1 colher de chá de açúcar ou menos de açúcar",
    "café com 1 colher de chá de açúcar e mais um pouco extra",
    "café com 1 colher de chá de açúcar e uma dose",
    "café com 1 colher de chá de açúcar e mais outra dose",
    "café com 1 colher de chá de açúcar e mais alguma coisa",
    "café com 1 colher de chá de açúcar e mais algo",
    "café com 1 colher de chá de açúcar e mais uma quantidade",
    "café com 1 colher de chá de açúcar e mais leite e mais um pouco",
    "café com 1 colher de chá de açúcar e outra porção de leite e outra",
    "café com 1 colher de chá de açúcar e uma dose de leite ou menos",
    "café com 1 colher de chá de açúcar e/ou mais",
    "café com 1 colher de chá de açúcar e mais leite e mais alguma coisa",
  ])("fails closed before tenant-scoped resolution: %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(decisions[0].coffeeSugarSegment).toBeUndefined();
    expect(resolveQuantity).not.toHaveBeenCalled();
  });
});


describe("PR #1339 A-001/A-002: authenticated scope is not blocked by milk", () => {
  it.each([
    "café com 1 colher de chá de açúcar e um pouco mais de leite",
    "café com 1 colher de chá de açúcar um pouco mais de leite",
    "café com 1 colher de chá de açúcar , um pouquinho mais de leite",
    "café com 1 colher de chá de açúcar e um pouco de leite a mais",
    "café com 1 colher de chá de açúcar e um pouco a mais de leite",
    "café com 1 colher de chá de açúcar e 2 g de leite a mais",
    "café com 1 colher de chá de açúcar e mais um pouco do leite",
    "café com 1 colher de chá de açúcar e um pouco mais do leite",
    "café com 1 colher de chá de açúcar e mais um pouco da bebida vegetal",
    "café com 1 colher de chá de açúcar e mais um pouco para o leite",
    "café com 1 colher de chá de açúcar e leite com um pouco mais",
    "café com 1 colher de chá de açúcar e mais uma colher de leite",
    "café com 1 colher de chá de açúcar e mais uma colher de chá de leite",
    "café com 1 colher de chá de açúcar e outra colher de leite",
    "café com 1 colher de chá de açúcar e duas colheres de leite",
    "café com 1 colher de chá de açúcar e uma colher de sopa de leite",
    "café com 1 colher de chá de açúcar e uma colher de leite e mais um pouco de leite",
    "café com 1 colher de chá de açúcar e duas colheres de leite e um pouco mais de leite",
  ])("resolves only the explicitly bound sugar spoon: %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual(expect.arrayContaining([expect.objectContaining({
      foodName: "açúcar", quantity: 1, unit: "colher de chá",
      resolution: expect.objectContaining({ grams: 8 }),
    })]));
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
  });

  it.each([
    "café com 1 colher de chá de açúcar e mais uma colher",
    "café com 1 colher de chá de açúcar e mais uma colher de açúcar",
    "café com 1 colher de chá de açúcar e outra colher de açúcar",
    "café com 1 colher de chá de açúcar e duas colheres de açúcar",
    "café com 1 colher de chá de açúcar e duas colheres de leite e mais um pouco",
    "café com 1 colher de chá de açúcar e 2 g de leite a mais e mais um pouco",
    "café com 1 colher de chá de açúcar e um pouco mais de açúcar",
    "café com 1 colher de chá de açúcar e um pouco de açúcar a mais",
    "café com 1 colher de chá de açúcar e mais um pouco do açúcar",
    "café com 1 colher de chá de açúcar e mais uma colher de leite e outra",
  ])("does not read a personal portion when the sugar measure is ambiguous: %s", async text => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });
});

describe("A-1339-BIND-01: bound milk ellipses do not block the scoped sugar lookup", () => {
  const stem = "café com 1 colher de chá de açúcar";
  it.each([
    "e leite com mais um pouco",
    "e leite com só um pouco mais",
    "e 100 ml de leite com mais um pouco",
    "e leite com mais um pouco e 2 g de leite",
  ])("resolves the sugar spoon for user 17 despite milk phrasing: %s", async tail => {
    const text = `${stem} ${tail}`;
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({
      foodName: "açúcar", quantity: 1, unit: "colher de chá",
      resolution: expect.objectContaining({ grams: 8 }),
    })]);
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
  });

  it.each([
    "e leite e mais um pouco",
    "e leite com mais um pouco e mais um pouco",
    "e leite com mais um pouco de açúcar",
    "e açúcar com mais um pouco",
  ])("keeps unresolved sugar-bound amounts out of the scoped lookup: %s", async tail => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(`${stem} ${tail}`, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });
});

describe("A-1339-BIND-02: connector-only ellipses never use personal portion lookup", () => {
  const stem = "café com 1 colher de chá de açúcar";
  it.each([
    "e com mais um pouco",
    "mas com mais um pouco",
    "ou com mais um pouco",
    "e/ou com mais um pouco",
    "e com só um pouco mais",
    "e com um pouco mais",
    "e leite com mais um pouco e com mais um pouco",
  ])("has zero lookup for an unbound continuation: %s", async tail => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(stem + " " + tail, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each([
    "e leite com mais um pouco",
    "e leite com só um pouco mais",
    "e 100 ml de leite com mais um pouco",
    "mas leite com mais um pouco",
  ])("preserves the measured sugar with an explicit milk subject: %s", async tail => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(stem + " " + tail, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({
      foodName: "açúcar", quantity: 1, unit: "colher de chá",
      resolution: expect.objectContaining({ grams: 8 }),
    })]);
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
  });
});

// Regressions for independent-audit findings A-133903 and A-133904.
describe("A-133903/A-133904: reject ambiguous second amounts before tenant lookup", () => {
  const stem = "café com 1 colher de chá de açúcar";
  it.each([
    "e depois com mais um pouco",
    "e infelizmente com mais um pouco",
    "e eventualmente com mais um pouco",
    "e provavelmente com mais um pouco",
    "e depois disso com mais um pouco",
    "e isso com mais um pouco",
    "e aquilo com mais um pouco",
    "e nada com mais um pouco",
    "e cuidadosamente com mais um pouco",
    "e um açúcar",
    "e várias pitadas de açúcar",
    "e então com mais um pouco",
    "e talvez com mais um pouco",
    "e agora com mais um pouco",
    "e aqui com mais um pouco",
    "e daí com mais um pouco",
    "e logo com mais um pouco",
    "e novamente com mais um pouco",
    "e por fim com mais um pouco",
    "e de novo com mais um pouco",
    "e em seguida com mais um pouco",
    "e ontem com só um pouco mais",
    "e umas gotas de açúcar",
    "e umas pitadas de açúcar",
    "e uns gramas de açúcar",
    "e vários gramas de açúcar",
    "e algum açúcar",
    "e um pouco de açúcar",
    "e algumas gotas de açúcar",
    "e muitas gotas de açúcar",
    "e poucas pitadas de açúcar",
    "e um açúcar extra",
  ])("uses zero lookups for a competing amount: %s", async tail => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(`${stem} ${tail}`, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each([
    "e leite com mais um pouco",
    "e leite com só um pouco mais",
    "e mais um pouco de leite",
    "e aveia com mais um pouco",
    "e iogurte com um pouco mais",
    "e mel com mais um pouco",
    "e aveia com só um pouco mais",
    "e umas gotas de leite",
    "e umas gotas de leite",
    "e uns gramas de leite",
    "e vários gramas de leite",
    "e algum leite",
    "e algumas gotas de leite",
  ])("preserves an unrelated ingredient and its user's scoped sugar measure: %s", async tail => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(`${stem} ${tail}`, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({
      foodName: "açúcar", quantity: 1, unit: "colher de chá",
      resolution: expect.objectContaining({ grams: 8 }),
    })]);
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
  });
});


describe("A-1339-NEW-01/02: unknown colloquial measure and genitive owner", () => {
  const stem = "café com 1 colher de chá de açúcar";
  it.each([
    "e mais um tiquinho", "e mais um cadinho", "e mais uma colherzinha",
    "e só mais um tiquinho", "e um tiquinho", "e mais um tiquinho do açúcar",
  ])("rejects an unbound additional amount before user-scoped lookup: %s", async tail => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(`${stem} ${tail}`, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each([
    "e 5 g do leite", "e duas gramas da bebida vegetal",
    "e +3g das frutas", "e mais um tiquinho do leite",
    "e uma colherzinha do leite", "e mais uma banana",
  ])("preserves sugar's measured portion and personal scope: %s", async tail => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(`${stem} ${tail}`, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "açúcar", quantity: 1 });
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
  });
});


describe("A-1339-NEW-03: no user-scoped lookup on colloquial ambiguity", () => {
  it.each([...A1339_NEW03_AUDIT_NEGATIVE, ...A1339_NEW03_METAMORPHIC_NEGATIVE])(
    "returns an unresolved decision without a lookup %s", async (_id, text) => {
      const resolveQuantity = vi.fn(async () => measured(8));
      const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
      expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
      expect(resolveQuantity).not.toHaveBeenCalled();
    },
  );

  it.each([...A1339_NEW03_AUDIT_POSITIVE, ...A1339_NEW03_METAMORPHIC_POSITIVE])(
    "preserves authenticated sugar measure independently of other items %s", async (_id, text) => {
      const resolveQuantity = vi.fn(async () => measured(8));
      const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
      expect(decisions[0]).toMatchObject({ foodName: "açúcar", quantity: 1 });
      expect(resolveQuantity).toHaveBeenCalledTimes(1);
      expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
        userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
      }));
    },
  );
});

describe("A-133905: unresolved repetition blocks authenticated lookup", () => {
  it.each(A1339_133905_NEGATIVE)("does not query for an ambiguous sugar component %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each(A1339_133905_POSITIVE)("keeps a separate food from shadowing the sugar measure %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "a\u00e7\u00facar", quantity: 1 });
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "a\u00e7\u00facar", quantity: 1, unit: "colher de ch\u00e1",
    }));
  });
});


describe("A-133906: reject competing measure before any authenticated lookup", () => {
  it.each(A1339_133906_NEGATIVE)("clarifies with zero lookups %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each(A1339_133906_POSITIVE)("preserves valid unique sugar component %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "açúcar", quantity: 1 });
    expect(resolveQuantity).toHaveBeenCalledTimes(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", unit: "colher de chá", quantity: 1,
    }));
  });
});


describe("A-133907: unclear second spoon must not trigger authenticated lookup", () => {
  it.each(A1339_133907_NEGATIVE)("clarifies with zero lookups %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each(A1339_133907_POSITIVE)("preserves other ingredients without extra sugar %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async (_request: Parameters<typeof resolveCanonicalFoodQuantity>[0]) => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "açúcar", quantity: 1 });
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", unit: "colher de chá", quantity: 1,
    }));
    // A different measured food may need a separate, legitimate lookup.
    // Never allow that lookup to replace or duplicate the sugar lookup.
    const requests = resolveQuantity.mock.calls.map(([request]) => request);
    expect(requests.filter(request => request.foodName === "açúcar")).toHaveLength(1);
    expect(requests.every(request => request.userId === 17)).toBe(true);
  });
});


describe("A-133908/A-133909: authenticate only an unambiguous sugar measure", () => {
  it.each(A1339_133908_NEGATIVE)("does not query any scoped portion for competing sugar %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each(A1339_133909_POSITIVE)("resolves only the original sugar spoon under user scope %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async (_request: Parameters<typeof resolveCanonicalFoodQuantity>[0]) => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "açúcar", quantity: 1 });
    expect(resolveQuantity.mock.calls.filter(([req]) => req.foodName === "açúcar")).toHaveLength(1);
    expect(resolveQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
  });
});


describe("A-133911/A-133912: ingredient-scoped spoon decisions", () => {
  it.each(A1339_133911_NEGATIVE)("does not query a partial sugar measurement %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });

  it.each(A1339_133912_POSITIVE)("resolves sugar only under the authenticated identity %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async (_request: Parameters<typeof resolveCanonicalFoodQuantity>[0]) => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "a\u00e7\u00facar", quantity: 1 });
    const sugarCalls = resolveQuantity.mock.calls.filter(([request]) => request.foodName === "a\u00e7\u00facar");
    expect(sugarCalls).toHaveLength(1);
    expect(sugarCalls[0]?.[0]).toEqual(expect.objectContaining({
      userId: 17, foodName: "a\u00e7\u00facar", quantity: 1, unit: "colher de ch\u00e1",
    }));
    expect(resolveQuantity.mock.calls.every(([request]) => request.userId === 17)).toBe(true);
  });
});


describe("A-133913: authenticated spoon lookup preserves food-specific negation", () => {
  it.each(A133913_INDEPENDENT_NEGATION_POSITIVE)("resolves the coffee sugar only for the authenticated owner %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async (_request: Parameters<typeof resolveCanonicalFoodQuantity>[0]) => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions[0]).toMatchObject({ foodName: "açúcar", quantity: 1 });
    const calls = resolveQuantity.mock.calls.filter(([request]) => request.foodName === "açúcar");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
    expect(resolveQuantity.mock.calls.every(([request]) => request.userId === 17)).toBe(true);
  });

  it.each(A133913_COFFEE_NEGATION_NEGATIVE)("blocks contradiction before any personal lookup %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    // The parser cannot silently reuse the first spoon while negation/second
    // sugar component remains unresolved.
    expect(decisions).toEqual([expect.objectContaining({ quantity: 0, resolution: null })]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });
});

describe("A-133914: independently owned sugar spoons", () => {
  it.each(A133914_DISTINCT_FOOD_SUGAR_POSITIVE)("resolves only the coffee's spoon with authenticated tenant %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async (_request: Parameters<typeof resolveCanonicalFoodQuantity>[0]) => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions.find(decision => decision.coffeeSugarSegment)).toMatchObject({
      foodName: "açúcar", quantity: 1, unit: "colher de chá",
    });
    const sugarCalls = resolveQuantity.mock.calls.filter(([request]) => request.foodName === "açúcar");
    expect(sugarCalls).toHaveLength(1);
    expect(sugarCalls[0]?.[0]).toEqual(expect.objectContaining({
      userId: 17, foodName: "açúcar", quantity: 1, unit: "colher de chá",
    }));
    expect(resolveQuantity.mock.calls.every(([request]) => request.userId === 17)).toBe(true);
  });

  it.each(A133914_OTHER_FOOD_SUGAR_ONLY)("does not resolve a pudding/tea spoon as coffee sugar %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    const decisions = await readSpoonDecisions(text, 17, { resolveQuantity });
    expect(decisions.some(decision => Boolean(decision.coffeeSugarSegment))).toBe(false);
    expect(resolveQuantity.mock.calls.some(([request]) => request.foodName === "açúcar")).toBe(false);
  });

  it.each(A133914_SUGAR_SCOPE_NEGATIVE)("rejects contradictions before any lookup %s", async (_id, text) => {
    const resolveQuantity = vi.fn(async () => measured(8));
    expect(await readSpoonDecisions(text, 17, { resolveQuantity })).toEqual([
      expect.objectContaining({ quantity: 0, resolution: null }),
    ]);
    expect(resolveQuantity).not.toHaveBeenCalled();
  });
});
