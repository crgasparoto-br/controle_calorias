import { describe, expect, it } from "vitest";
import {
  householdMeasurePreferenceKey,
  normalizedHouseholdMeasureIdentity,
} from "./householdMeasureResolutionPersistence";

describe("issue #1153 - household measure commercial identity", () => {
  const base = {
    foodName: "pão de forma",
    brand: "Marca A",
    quantity: 1,
    unit: "fatia",
  };

  it("keeps product variants and commercial portions in distinct persistence keys", () => {
    const premium = householdMeasurePreferenceKey(
      { ...base, variant: "premium", portionLabel: "1 fatia premium" },
      "user_learned"
    );
    const integral = householdMeasurePreferenceKey(
      { ...base, variant: "integral", portionLabel: "1 fatia integral" },
      "user_learned"
    );
    const premiumTwoSlices = householdMeasurePreferenceKey(
      { ...base, variant: "premium", portionLabel: "2 fatias premium" },
      "user_learned"
    );

    expect(new Set([premium, integral, premiumTwoSlices]).size).toBe(3);
    expect(
      normalizedHouseholdMeasureIdentity({
        ...base,
        variant: "premium",
        context: "cafe da manha",
        portionLabel: "1 fatia premium",
      })
    ).toMatchObject({
      variant: "premium",
      context: "cafe da manha",
      portionLabel: "1 fatia premium",
    });
  });
});
