import { describe, expect, it } from "vitest";
import { mapProfessionalPortfolioItem } from "./professionalPortfolioRepository";

const now = new Date("2026-07-24T00:00:00.000Z");
const sensitiveRow = {
  authorizationId: "authorization-1",
  patientUserId: 42,
  patientName: "Paciente Exemplo",
  patientEmail: "patient@example.com",
  trackingStatus: "active",
  requestedAt: "2026-07-20T00:00:00.000Z",
  lastFoodActivityAt: "2026-07-23T12:00:00.000Z",
  lastProfessionalInteractionAt: "2026-07-23T13:00:00.000Z",
  nextReviewAt: "2026-07-25T12:00:00.000Z",
  nextWeighingAt: "2026-07-26T12:00:00.000Z",
  periodRecordCount: 5,
};

describe("professional portfolio privacy", () => {
  it.each(["pending", "rejected", "revoked"] as const)(
    "removes personal and clinical details for %s authorization",
    authorizationStatus => {
      const item = mapProfessionalPortfolioItem(
        { ...sensitiveRow, authorizationStatus },
        now
      );

      expect(item.patientName).toBe("Paciente Exemplo");
      expect(item.patientEmail).toBeNull();
      expect(item.trackingStatus).toBeNull();
      expect(item.lastFoodActivityAt).toBeNull();
      expect(item.lastProfessionalInteractionAt).toBeNull();
      expect(item.nextReviewAt).toBeNull();
      expect(item.nextWeighingAt).toBeNull();
      expect(item.hasRecordsInReportPeriod).toBe(false);
    }
  );

  it("keeps the authorized operational data for approved access", () => {
    const item = mapProfessionalPortfolioItem(
      { ...sensitiveRow, authorizationStatus: "approved" },
      now
    );

    expect(item.patientEmail).toBe("patient@example.com");
    expect(item.trackingStatus).toBe("active");
    expect(item.lastFoodActivityAt).not.toBeNull();
    expect(item.nextReviewAt).not.toBeNull();
    expect(item.hasRecordsInReportPeriod).toBe(true);
  });
});
