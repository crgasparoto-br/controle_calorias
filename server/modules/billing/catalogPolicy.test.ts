import { describe, expect, it } from "vitest";
import {
  BILLING_PERSONAL_ENTITLEMENTS,
  BILLING_PROFESSIONAL_ENTITLEMENTS,
  INITIAL_BILLING_CATALOG,
  assertAdministrativeCatalogMutation,
  assertCatalogVersionCanActivate,
  evaluateCouponEligibility,
  intersectPaymentMethods,
  normalizeCatalogEntitlements,
  validateCouponPolicy,
  type BillingCouponPolicy,
} from "./catalogPolicy";

const baseCoupon: BillingCouponPolicy = {
  code: " boasvindas ",
  discountType: "percentage",
  discountValue: 30,
  currency: null,
  eligibleProductCodes: ["individual"],
  eligibleVersionCodes: [],
  eligibleCycles: ["monthly"],
  validFrom: new Date("2026-08-01T00:00:00Z"),
  validUntil: null,
  maxTotalUses: 100,
  maxUsesPerUser: 1,
  firstContractOnly: true,
  durationCharges: 3,
  active: true,
};

describe("billing catalog policy", () => {
  it("defines the six approved commercial versions without frontend-derived values", () => {
    expect(INITIAL_BILLING_CATALOG).toHaveLength(6);
    expect(
      INITIAL_BILLING_CATALOG.map(version => [
        version.versionCode,
        version.unitAmount,
        version.capacityLimit,
      ])
    ).toEqual([
      ["individual-monthly-v1", 3990, null],
      ["individual-yearly-v1", 35900, null],
      ["professional-monthly-v1", 8990, 30],
      ["professional-yearly-v1", 89900, 30],
      ["professional-plus-monthly-v1", 13990, 100],
      ["professional-plus-yearly-v1", 139900, 100],
    ]);
  });

  it("gives professional payers the full personal matrix plus professional resources", () => {
    for (const entitlement of BILLING_PERSONAL_ENTITLEMENTS) {
      expect(BILLING_PROFESSIONAL_ENTITLEMENTS).toContain(entitlement);
    }
    expect(
      INITIAL_BILLING_CATALOG.filter(row => row.audience === "professional").map(
        row => row.entitlements
      )
    ).toEqual([
      BILLING_PROFESSIONAL_ENTITLEMENTS,
      BILLING_PROFESSIONAL_ENTITLEMENTS,
      BILLING_PROFESSIONAL_ENTITLEMENTS,
      BILLING_PROFESSIONAL_ENTITLEMENTS,
    ]);
    expect(
      INITIAL_BILLING_CATALOG.filter(row => row.audience === "professional").map(
        row => row.coveredBeneficiaryEntitlements
      )
    ).toEqual([
      BILLING_PERSONAL_ENTITLEMENTS,
      BILLING_PERSONAL_ENTITLEMENTS,
      BILLING_PERSONAL_ENTITLEMENTS,
      BILLING_PERSONAL_ENTITLEMENTS,
    ]);
    expect(
      INITIAL_BILLING_CATALOG.filter(row => row.audience === "individual").map(
        row => row.coveredBeneficiaryEntitlements
      )
    ).toEqual([[], []]);
  });

  it("rejects unknown entitlements before a catalog version can become active", () => {
    expect(() => normalizeCatalogEntitlements(["system_access", "made_up"])).toThrow(
      "made_up"
    );
    expect(() =>
      assertCatalogVersionCanActivate({
        ...INITIAL_BILLING_CATALOG[0],
        entitlements: ["system_access", "made_up"],
      })
    ).toThrow("made_up");
  });

  it("rejects incomplete or cross-audience entitlement matrices", () => {
    expect(() =>
      assertCatalogVersionCanActivate({
        ...INITIAL_BILLING_CATALOG[0],
        entitlements: ["system_access"],
      })
    ).toThrow("canonical personal entitlement matrix");
    expect(() =>
      assertCatalogVersionCanActivate({
        ...INITIAL_BILLING_CATALOG[2],
        entitlements: BILLING_PERSONAL_ENTITLEMENTS,
      })
    ).toThrow("canonical combined entitlement matrix");
    expect(() =>
      assertCatalogVersionCanActivate({
        ...INITIAL_BILLING_CATALOG[2],
        coveredBeneficiaryEntitlements: [],
      })
    ).toThrow("covered-patient entitlement matrix");
    expect(() =>
      assertCatalogVersionCanActivate({
        ...INITIAL_BILLING_CATALOG[0],
        coveredBeneficiaryEntitlements: BILLING_PERSONAL_ENTITLEMENTS,
      })
    ).toThrow("cannot define covered-patient entitlements");
  });

  it("intersects commercial payment policy with provider capabilities", () => {
    expect(
      intersectPaymentMethods(["credit_card", "pix_automatic"], [
        "credit_card",
        "boleto",
      ])
    ).toEqual(["credit_card"]);
  });

  it("does not let range alerts or system automation publish a commercial version", () => {
    expect(() =>
      assertAdministrativeCatalogMutation({
        actorRole: "system",
        provenance: {
          origin: "catalog_range_review",
          alertIds: ["alert-100-plus"],
          analysisRef: "analysis-2026-08-09",
        },
      })
    ).toThrow();
    expect(() =>
      assertAdministrativeCatalogMutation({
        actorRole: "admin",
        provenance: {
          origin: "catalog_range_review",
          alertIds: [],
          analysisRef: "analysis-2026-08-09",
        },
      })
    ).toThrow("requires alert references");
    expect(
      assertAdministrativeCatalogMutation({
        actorRole: "admin",
        provenance: {
          origin: "catalog_range_review",
          alertIds: [" alert-100-plus ", "alert-100-plus"],
          analysisRef: " analysis-2026-08-09 ",
        },
      })
    ).toEqual({
      origin: "catalog_range_review",
      alertIds: ["alert-100-plus"],
      analysisRef: "analysis-2026-08-09",
    });
    expect(
      assertAdministrativeCatalogMutation({
        actorRole: "admin",
        provenance: { origin: "admin_manual" },
      })
    ).toEqual({ origin: "admin_manual" });
  });
});

describe("billing coupon policy", () => {
  it("normalizes a valid public coupon and caps monthly duration at three charges", () => {
    expect(validateCouponPolicy({
      ...baseCoupon,
      eligibleProductCodes: [" INDIVIDUAL ", "individual"],
      eligibleVersionCodes: [" INDIVIDUAL-MONTHLY-V1 "],
    })).toMatchObject({
      code: "BOASVINDAS",
      discountValue: 30,
      durationCharges: 3,
      eligibleProductCodes: ["individual"],
      eligibleVersionCodes: ["individual-monthly-v1"],
    });
    expect(() =>
      validateCouponPolicy({ ...baseCoupon, durationCharges: 4 })
    ).toThrow();
    expect(() =>
      validateCouponPolicy({ ...baseCoupon, code: "INVALID CODE!" })
    ).toThrow("unsupported characters");
    expect(() =>
      validateCouponPolicy({
        ...baseCoupon,
        eligibleProductCodes: [],
        eligibleVersionCodes: [],
      })
    ).toThrow("target at least one product or version");
    expect(() =>
      validateCouponPolicy({ ...baseCoupon, eligibleCycles: [] })
    ).toThrow("at least one eligible billing cycle");
    expect(() =>
      validateCouponPolicy({
        ...baseCoupon,
        eligibleCycles: ["weekly" as never],
      })
    ).toThrow("Unknown billing coupon cycle");
  });

  it("rejects 100 percent public coupons and annual discounts beyond first charge", () => {
    expect(() =>
      validateCouponPolicy({ ...baseCoupon, discountValue: 100 })
    ).toThrow();
    expect(() =>
      validateCouponPolicy({
        ...baseCoupon,
        eligibleCycles: ["yearly"],
        durationCharges: 2,
      })
    ).toThrow();
  });

  it("evaluates limits, first-contract rule and prevents a fixed coupon from becoming 100 percent", () => {
    expect(
      evaluateCouponEligibility(baseCoupon, {
        now: new Date("2026-08-08T12:00:00Z"),
        productCode: "individual",
        versionCode: "individual-monthly-v1",
        billingCycle: "monthly",
        unitAmount: 3990,
        currency: "BRL",
        totalConfirmedUses: 4,
        userConfirmedUses: 0,
        userHasPriorPaidContract: false,
      })
    ).toEqual({
      eligible: true,
      discountAmount: 1197,
      finalAmount: 2793,
      durationCharges: 3,
    });

    expect(
      evaluateCouponEligibility(baseCoupon, {
        now: new Date("2026-08-08T12:00:00Z"),
        productCode: "individual",
        versionCode: "individual-monthly-v1",
        billingCycle: "monthly",
        unitAmount: 3990,
        currency: "BRL",
        totalConfirmedUses: 4,
        userConfirmedUses: 0,
        userHasPriorPaidContract: true,
      })
    ).toEqual({ eligible: false, reason: "first_contract_required" });

    expect(
      evaluateCouponEligibility(
        {
          ...baseCoupon,
          discountType: "fixed_amount",
          discountValue: 3990,
          currency: "BRL",
          firstContractOnly: false,
        },
        {
          now: new Date("2026-08-08T12:00:00Z"),
          productCode: "individual",
          versionCode: "individual-monthly-v1",
          billingCycle: "monthly",
          unitAmount: 3990,
          currency: "BRL",
          totalConfirmedUses: 0,
          userConfirmedUses: 0,
          userHasPriorPaidContract: false,
        }
      )
    ).toEqual({ eligible: false, reason: "invalid_discount" });

    expect(
      evaluateCouponEligibility(
        {
          ...baseCoupon,
          discountType: "fixed_amount",
          discountValue: 1237,
          currency: "BRL",
          firstContractOnly: false,
        },
        {
          now: new Date("2026-08-08T12:00:00Z"),
          productCode: "individual",
          versionCode: "individual-monthly-v1",
          billingCycle: "monthly",
          unitAmount: 3990,
          currency: "BRL",
          totalConfirmedUses: 0,
          userConfirmedUses: 0,
          userHasPriorPaidContract: false,
        }
      )
    ).toEqual({ eligible: false, reason: "invalid_discount" });
  });

  it("normalizes fixed-amount coupon currency before evaluating eligibility", () => {
    const fixedAmountCoupon = validateCouponPolicy({
      ...baseCoupon,
      discountType: "fixed_amount",
      discountValue: 1000,
      currency: " brl ",
      firstContractOnly: false,
    });

    expect(fixedAmountCoupon.currency).toBe("BRL");
    expect(
      evaluateCouponEligibility(fixedAmountCoupon, {
        now: new Date("2026-08-08T12:00:00Z"),
        productCode: "individual",
        versionCode: "individual-monthly-v1",
        billingCycle: "monthly",
        unitAmount: 3990,
        currency: "BRL",
        totalConfirmedUses: 0,
        userConfirmedUses: 0,
        userHasPriorPaidContract: false,
      })
    ).toEqual({
      eligible: true,
      discountAmount: 1000,
      finalAmount: 2990,
      durationCharges: 3,
    });
  });
});
