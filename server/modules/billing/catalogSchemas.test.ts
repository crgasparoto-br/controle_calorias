import { describe, expect, it } from "vitest";
import { billingAdminCreateCouponRevisionSchema } from "./catalogSchemas";

const baseCoupon = {
  code: "FIXED10",
  discountType: "fixed_amount" as const,
  discountValue: 1000,
  currency: "BRL" as const,
  eligibleProductCodes: ["individual"],
  eligibleVersionCodes: [],
  eligibleCycles: ["monthly" as const],
  validFrom: new Date("2026-08-08T00:00:00Z"),
  validUntil: null,
  maxTotalUses: null,
  maxUsesPerUser: null,
  firstContractOnly: false,
  durationCharges: 1,
  active: true,
  reason: "Canonical currency contract",
};

describe("billing catalog schemas", () => {
  it("accepts only canonical BRL for fixed-amount coupon input", () => {
    expect(billingAdminCreateCouponRevisionSchema.parse(baseCoupon).currency).toBe("BRL");
    expect(() =>
      billingAdminCreateCouponRevisionSchema.parse({ ...baseCoupon, currency: "brl" })
    ).toThrow();
    expect(() =>
      billingAdminCreateCouponRevisionSchema.parse({ ...baseCoupon, currency: " BRL " })
    ).toThrow();
  });
});
