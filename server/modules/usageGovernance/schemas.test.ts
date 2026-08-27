import { describe, expect, it } from "vitest";
import { openUsageAbuseCaseSchema, usageAdminEconomicRowsSchema } from "./schemas";

describe("usage governance abuse evidence schema", () => {
  it("accepts a proven security signal with a sanitized heavy-operation list", () => {
    const parsed = openUsageAbuseCaseSchema.parse({
      subjectUserId: 11,
      signals: ["security_risk"],
      evidence: {
        securityRiskConfirmed: true,
        affectedOperations: ["ai_heavy_processing"],
      },
    });
    expect(parsed.evidence.affectedOperations).toEqual(["ai_heavy_processing"]);
  });

  it("does not accept high cost alone as proof of abuse", () => {
    expect(() => openUsageAbuseCaseSchema.parse({
      subjectUserId: 11,
      signals: ["high_cost"],
      evidence: { affectedOperations: ["ai_heavy_processing"] },
    })).toThrow(/high_cost_not_sufficient/);
  });
  it("accepts only canonical monthly economic periods", () => {
    expect(usageAdminEconomicRowsSchema.parse({ month: "2026-08" }).month).toBe("2026-08");
    expect(() => usageAdminEconomicRowsSchema.parse({ month: "2026-13" })).toThrow();
    expect(() => usageAdminEconomicRowsSchema.parse({ month: "2026-8" })).toThrow();
  });

});
