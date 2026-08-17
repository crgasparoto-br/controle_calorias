import { describe, expect, it } from "vitest";
import {
  billingAdminCreateCouponRevisionSchema,
  billingAdminCreateProductSchema,
  billingAdminPublishVersionSchema,
} from "./catalogSchemas";

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

  it("defaults catalog mutations to manual admin provenance", () => {
    expect(
      billingAdminCreateProductSchema.parse({
        code: "clinic",
        audience: "professional",
        name: "Clínica",
        reason: "Nova família comercial",
      }).provenance
    ).toEqual({ origin: "admin_manual" });
  });

  it("requires structured alert and analysis references for range-review mutations", () => {
    const parsed = billingAdminPublishVersionSchema.parse({
      versionCode: "professional-monthly-v2",
      effectiveFrom: new Date("2026-08-09T00:00:00Z"),
      reason: "Nova faixa aprovada",
      provenance: {
        origin: "catalog_range_review",
        alertIds: [" alert-100-plus "],
        analysisRef: " analysis-2026-08-09 ",
      },
    });
    expect(parsed.provenance).toEqual({
      origin: "catalog_range_review",
      alertIds: ["alert-100-plus"],
      analysisRef: "analysis-2026-08-09",
    });

    expect(() =>
      billingAdminPublishVersionSchema.parse({
        versionCode: "professional-monthly-v2",
        effectiveFrom: new Date("2026-08-09T00:00:00Z"),
        reason: "Nova faixa aprovada",
        provenance: {
          origin: "catalog_range_review",
          alertIds: [],
          analysisRef: "analysis-2026-08-09",
        },
      })
    ).toThrow();
    expect(() =>
      billingAdminPublishVersionSchema.parse({
        versionCode: "professional-monthly-v2",
        effectiveFrom: new Date("2026-08-09T00:00:00Z"),
        reason: "Automação indevida",
        provenance: { origin: "catalog_range_review_required" },
      })
    ).toThrow();
  });
});
