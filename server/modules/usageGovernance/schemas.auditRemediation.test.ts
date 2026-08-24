import { describe, expect, it } from "vitest";
import { openUsageAbuseCaseSchema, reviewUsageAbuseCaseSchema } from "./schemas";

const caseBase = {
  subjectUserId: 99,
  evidence: { requestRate: 120 },
};

describe("usage governance public schemas after audit remediation", () => {
  it("rejects high cost as the sole case-opening signal at the public boundary", () => {
    expect(openUsageAbuseCaseSchema.safeParse({
      ...caseBase,
      signals: ["high_cost"],
    }).success).toBe(false);
  });

  it("rejects arbitrary signal names at the public boundary", () => {
    expect(openUsageAbuseCaseSchema.safeParse({
      ...caseBase,
      signals: ["volume_anomaly", "arbitrary_signal"],
    }).success).toBe(false);
  });

  it("accepts a supported distinct signal combination", () => {
    expect(openUsageAbuseCaseSchema.safeParse({
      ...caseBase,
      signals: ["volume_anomaly", "client_retry_anomaly"],
    }).success).toBe(true);
  });

  it("rejects limitation approval without an explicit affected-operation scope", () => {
    expect(reviewUsageAbuseCaseSchema.safeParse({
      id: "8b228782-0f68-4dbe-bc19-1c3bfd7a6c47",
      outcome: "limitation_approved",
      reason: "reviewed abuse",
      systemFailuresExcluded: true,
      legitimateGrowthReviewed: true,
      impact: { affectedOperations: [] },
    }).success).toBe(false);
  });
});
