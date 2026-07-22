import { describe, expect, it } from "vitest";
import {
  activeHolderPlanKey,
  subscriptionGrantsAccess,
} from "./subscriptionPolicy";

const now = new Date("2026-07-22T12:00:00.000Z");

describe("billing subscription policy", () => {
  it.each(["pending", "past_due", "canceled", "expired"] as const)(
    "does not grant access for %s",
    status => {
      expect(
        subscriptionGrantsAccess(
          { status, currentPeriodStart: null, currentPeriodEnd: null },
          now
        )
      ).toBe(false);
    }
  );

  it("grants access only to an active subscription inside its period", () => {
    expect(
      subscriptionGrantsAccess(
        {
          status: "active",
          currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
          currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
        },
        now
      )
    ).toBe(true);
    expect(
      subscriptionGrantsAccess(
        {
          status: "active",
          currentPeriodStart: null,
          currentPeriodEnd: now,
        },
        now
      )
    ).toBe(false);
  });

  it("creates a uniqueness key only for active subscriptions", () => {
    expect(
      activeHolderPlanKey({ payerUserId: 7, planId: "pro", status: "active" })
    ).toBe("7:pro");
    expect(
      activeHolderPlanKey({ payerUserId: 7, planId: "pro", status: "pending" })
    ).toBeNull();
  });
});
