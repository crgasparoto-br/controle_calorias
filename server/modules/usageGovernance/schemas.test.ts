import { describe, expect, it } from "vitest";
import { authorizeConsumptionChargingSchema, openUsageAbuseCaseSchema, usageAdminEconomicRowsSchema } from "./schemas";

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

  it("requires literal reinforced confirmation for activation", () => {
    const authorizationId = "00000000-0000-4000-8000-000000000001";
    expect(() => authorizeConsumptionChargingSchema.parse({ action: "activate", id: authorizationId, reason: "activate", reinforcedConfirmation: false })).toThrow();
    const parsed = authorizeConsumptionChargingSchema.parse({ action: "activate", id: authorizationId, reason: "activate", reinforcedConfirmation: true });
    expect("reinforcedConfirmation" in parsed && parsed.reinforcedConfirmation).toBe(true);
  });

});
