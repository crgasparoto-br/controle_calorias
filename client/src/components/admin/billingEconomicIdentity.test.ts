import { describe, expect, it } from "vitest";
import {
  collectEconomicIdentityContext,
  economicMonthWindow,
  isEconomicRowInMonth,
} from "./billingEconomicIdentity";

describe("billing economic identity correlation", () => {
  it("keeps payer, beneficiaries and sponsor semantically distinct", () => {
    const context = collectEconomicIdentityContext(
      {
        payerUserId: 101,
        productCode: "professional",
        versionCode: "professional-v3",
        billingCycle: "monthly",
      },
      [
        {
          payerUserId: 101,
          beneficiaryUserId: 202,
          sponsorUserId: 404,
          productCode: "professional",
          versionCode: "professional-v3",
          billingCycle: "monthly",
        },
        {
          payerUserId: 101,
          beneficiaryUserId: 303,
          sponsorUserId: 404,
          productCode: "professional",
          versionCode: "professional-v3",
          billingCycle: "monthly",
        },
      ],
    );

    expect(context).toEqual({
      payerUserId: 101,
      beneficiaryUserIds: [202, 303],
      sponsorUserIds: [404],
    });
    expect(context.beneficiaryUserIds).not.toContain(context.payerUserId);
    expect(context.sponsorUserIds).not.toContain(202);
  });

  it("does not leak identities from another payer, product, version or cycle", () => {
    const context = collectEconomicIdentityContext(
      {
        payerUserId: 101,
        productCode: "professional",
        versionCode: "professional-v3",
        billingCycle: "monthly",
      },
      [
        { payerUserId: 999, beneficiaryUserId: 201, sponsorUserId: 999, productCode: "professional", versionCode: "professional-v3", billingCycle: "monthly" },
        { payerUserId: 101, beneficiaryUserId: 202, sponsorUserId: 404, productCode: "individual", versionCode: "professional-v3", billingCycle: "monthly" },
        { payerUserId: 101, beneficiaryUserId: 203, sponsorUserId: 404, productCode: "professional", versionCode: "professional-v4", billingCycle: "monthly" },
        { payerUserId: 101, beneficiaryUserId: 204, sponsorUserId: 404, productCode: "professional", versionCode: "professional-v3", billingCycle: "yearly" },
      ],
    );

    expect(context.beneficiaryUserIds).toEqual([]);
    expect(context.sponsorUserIds).toEqual([]);
  });

  it("uses UTC month boundaries for the selected competence", () => {
    expect(economicMonthWindow("2026-12")).toEqual({
      from: "2026-12-01T00:00:00.000Z",
      to: "2027-01-01T00:00:00.000Z",
    });
    expect(isEconomicRowInMonth("2026-12-31T23:59:59.000Z", "2026-12")).toBe(true);
    expect(isEconomicRowInMonth("2027-01-01T00:00:00.000Z", "2026-12")).toBe(false);
  });
});
