import { describe, expect, it } from "vitest";
import { buildFoodObservationFixture, buildFoodResolutionDecisionFixture, buildV1HistoricalSnapshotFixture } from "./fixtures";
import { buildFoodShadowBaseline, buildFoodShadowEvent } from "./shadowComparison";
import { pairFoodShadowItems } from "./shadowPairing";
import type { FoodShadowV1Item } from "./shadowV1Snapshot";
import type { FoodResolutionDecision } from "./schemas";

const traceId = "b4e590ab-35bd-44cd-932a-e895e51ec7a2";

function saved(input: {
  ref?: string | null; brand?: string | null; variant?: string | null;
  name?: string; calories?: number;
} = {}): FoodShadowV1Item {
  return {
    ...buildV1HistoricalSnapshotFixture().items[0],
    historicalRef: input.ref ?? null,
    foodName: input.name ?? "Leite", canonicalName: input.name ?? "Leite",
    brand: input.brand ?? null, productVariant: input.variant ?? null,
    quantity: 1, unit: "copo", estimatedGrams: 200,
    calories: input.calories ?? 125, protein: 7, carbs: 8, fat: 7,
  };
}

function resolved(input: {
  family?: number | null; id?: number | null; brand?: string | null;
  variant?: string | null; name?: string; calories?: number;
} = {}): FoodResolutionDecision {
  return buildFoodResolutionDecisionFixture({
    identity: {
      canonicalName: input.name ?? "Leite", foodEntityId: input.family ?? null,
      variantId: input.id ?? null, brand: input.brand ?? null, variant: input.variant ?? null,
    },
    quantity: { value: 1, unit: "copo", grams: 200 },
    nutrition: { consumed: { calories: input.calories ?? 72, protein: 7, carbs: 9, fat: 1 } },
  });
}

function event(left: readonly FoodShadowV1Item[], right: readonly FoodResolutionDecision[]) {
  const old = buildV1HistoricalSnapshotFixture();
  return buildFoodShadowEvent({
    traceId, modality: "text", entrypoint: "replay", scenarioClass: "commercial",
    v1: { ...old, items: [...left] }, v1Failure: null,
    v2: right, observations: right.map(() => buildFoodObservationFixture()),
    failure: "none", timings: { v1Ms: 2, languageMs: 3, resolverMs: 4, totalMs: 10 },
  });
}

const noMacroPair = { comparablePairs: 0, unpairedItems: 2,
  v1UnpairedItems: 1, v2UnpairedItems: 1, variant: 1,
  quantity: 0, nutrition: 0, macros: { calories: null, protein: null, carbs: null, fat: null } };

describe("#1307 A-027: variant identity before nutrition comparison", () => {
  it("blocks the audited 53-kcal brand and variant collision with no stable IDs", () => {
    const left = saved({ brand: "Marca A", variant: "integral", calories: 125 });
    const right = resolved({ brand: "Marca B", variant: "desnatado", calories: 72 });
    expect(pairFoodShadowItems([left], [right]).pairs).toHaveLength(0);
    const comparison = event([left], [right]);
    expect(comparison.differences).toMatchObject({ ...noMacroPair, identity: 1 });
    const baseline = buildFoodShadowBaseline([comparison]);
    expect(baseline.segments[0]).toMatchObject({
      runs: 1, compared: 1, pairedItems: 0, unpairedItems: 2,
      variantDifferences: 1, nutritionDifferences: 0,
      macroAbsDelta: { calories: null },
    });
    expect(baseline.verifiedAccuracy).toBeNull();
    expect(baseline.rolloutEligible).toBe(false);
  });

  it("blocks the same 53-kcal collision even when both sides know family 10", () => {
    const comparison = event(
      [saved({ ref: "food:10", brand: "Marca A", variant: "integral" })],
      [resolved({ family: 10, id: 102, brand: "Marca B", variant: "desnatado" })],
    );
    expect(comparison.differences).toMatchObject(noMacroPair);
    expect(buildFoodShadowBaseline([comparison]).segments[0]).toMatchObject({
      pairedItems: 0, variantDifferences: 1, macroAbsDelta: { calories: null },
    });
  });

  it("rejects brand-only and variant-only conflicts, even with equal macros", () => {
    for (const [a, b] of [
      [{ brand: "Marca A", variant: "integral" }, { brand: "Marca B", variant: "integral" }],
      [{ brand: "Marca A", variant: "integral" }, { brand: "Marca A", variant: "desnatado" }],
    ] as const) {
      const comparison = event(
        [saved({ ...a, calories: 72 })], [resolved({ ...b, calories: 72 })],
      );
      expect(comparison.differences).toMatchObject(noMacroPair);
    }
  });

  it("pairs stable variant IDs first, even after a label change, and keeps real macro drift", () => {
    const comparison = event(
      [saved({ ref: "variant:101", brand: "Marca A", variant: "integral" })],
      [resolved({ family: 10, id: 101, brand: "Marca B", variant: "desnatado" })],
    );
    expect(comparison.differences).toMatchObject({
      comparablePairs: 1, unpairedItems: 0, variant: 1,
      nutrition: 1, macros: { calories: 53 },
      variantIdUnverifiable: 0,
    });
    expect(buildFoodShadowBaseline([comparison]).segments[0]).toMatchObject({
      pairedItems: 1, nutritionDifferences: 1, macroAbsDelta: { calories: 53 },
    });
  });

  it("never pairs different immutable variant IDs, even with identical labels", () => {
    const comparison = event(
      [saved({ ref: "variant:101", brand: "Marca A", variant: "integral" })],
      [resolved({ id: 102, brand: "Marca A", variant: "integral", calories: 125 })],
    );
    expect(comparison.differences).toMatchObject(noMacroPair);
    expect(comparison.differences.variantIdUnverifiable).toBe(0);
  });

  it("reordered duplicates pair exactly and do not use other variants for nutrition", () => {
    const integral = saved({ brand: "Marca A", variant: "integral", calories: 125 });
    const skimmed = saved({ brand: "Marca B", variant: "desnatado", calories: 72 });
    const actual = [
      resolved({ brand: "Marca B", variant: "desnatado", calories: 72 }),
      resolved({ brand: "Marca A", variant: "integral", calories: 125 }),
    ];
    const aligned = event([integral, skimmed], actual);
    expect(aligned.differences).toMatchObject({
      comparablePairs: 2, unpairedItems: 0, variant: 0,
      nutrition: 2, macros: { calories: 0 },
    });
    // Per-fixture noncalorie macros differ; still report them only for valid pairs.
    const changed = event([integral, skimmed], [actual[0],
      resolved({ brand: "Marca C", variant: "zero", calories: 53 })]);
    expect(changed.differences).toMatchObject({
      comparablePairs: 1, unpairedItems: 2, variant: 1,
      nutrition: 1, macros: { calories: 0 },
    });
    expect(buildFoodShadowBaseline([changed]).segments[0]).toMatchObject({
      pairedItems: 1, unpairedItems: 2, variantDifferences: 1,
      macroAbsDelta: { calories: 0 },
    });
  });

  it("one-sided missing commercial evidence stays unknown, not a manufactured conflict", () => {
    const comparison = event(
      [saved({ brand: null, variant: "integral", calories: 72 })],
      [resolved({ brand: "Marca A", variant: "integral", calories: 72 })],
    );
    expect(comparison.differences).toMatchObject({
      comparablePairs: 1, unpairedItems: 0, variantIdUnverifiable: 1,
      macros: { calories: 0 },
    });
  });

  it("still rejects different known families with the same displayed food", () => {
    const comparison = event(
      [saved({ ref: "food:10", brand: "Marca A", variant: "integral" })],
      [resolved({ family: 11, brand: "Marca B", variant: "desnatado" })],
    );
    expect(comparison.differences).toMatchObject({
      comparablePairs: 0, unpairedItems: 2, identity: 1,
      variant: 0, macros: { calories: null },
    });
  });
});
