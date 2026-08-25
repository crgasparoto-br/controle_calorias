import { describe, expect, it } from "vitest";
import { mapSubscription } from "./billingRepositorySupport";

describe("billing subscription summary", () => {
  it("maps the public commercial version number without exposing it from versionCode", () => {
    const result = mapSubscription({
      id: "subscription-1",
      provider: "asaas",
      planCode: "professional-monthly",
      productCode: "professional",
      versionCode: "professional_monthly_internal_v9",
      planVersion: 3,
      planName: "Profissional",
      status: "active",
      billingCycle: "monthly",
      currency: "BRL",
      unitAmount: 7990,
      currentPeriodStart: "2026-08-01T00:00:00.000Z",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    });

    expect(result.planVersion).toBe(3);
    expect(result.versionCode).toBe("professional_monthly_internal_v9");
  });
});
