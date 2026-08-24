import type { MixedIncrementUnit } from "./intent/mixedIncrementParser";

export type MixedIncrementTarget = {
  mealId: number;
  mealLabel: string;
  itemIndex: number;
  itemName: string;
  itemFingerprint?: string;
};

export type MixedMealItemIncrementOperation = {
  targetFood: string | null;
  quantity: number;
  unit: MixedIncrementUnit;
  inheritedUnit?: boolean;
  target?: MixedIncrementTarget;
  gramsDelta?: number;
  resolvedBy?: "explicit_mass_or_volume" | "canonical_portion" | "clarification";
};

export type MixedMealItemIncrementPlan = {
  contractVersion: 1;
  originalText: string;
  mealLabel: string | null;
  timeZone: string;
  operations: MixedMealItemIncrementOperation[];
};

export type MixedIncrementSelectionContinuation = {
  kind: "mixed_increment_plan";
  plan: MixedMealItemIncrementPlan;
};
