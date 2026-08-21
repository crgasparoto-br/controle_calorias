import { describe, expect, it } from "vitest";
import { openUsageAbuseCaseSchema } from "./schemas";

const base = {
  subjectUserId: 99,
  signals: ["control_bypass_attempt"],
};

describe("usage abuse evidence operation scope schema", () => {
  it("accepts sanitized affected operations for a confirmed security case", () => {
    expect(openUsageAbuseCaseSchema.safeParse({
      ...base,
      evidence: {
        securityRiskConfirmed: true,
        affectedOperations: ["image_processing", "capability:meal-photo-analysis"],
      },
    }).success).toBe(true);
  });

  it("rejects a non-heavy operation inside the evidence scope", () => {
    expect(openUsageAbuseCaseSchema.safeParse({
      ...base,
      evidence: {
        securityRiskConfirmed: true,
        affectedOperations: ["manual_food_entry"],
      },
    }).success).toBe(false);
  });
});
