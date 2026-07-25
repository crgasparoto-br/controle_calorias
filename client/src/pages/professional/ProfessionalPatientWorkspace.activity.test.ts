import { describe, expect, it } from "vitest";
import { getLatestPatientActivityAt } from "./ProfessionalPatientWorkspace";

describe("workspace patient activity", () => {
  it("uses canonical timeline activity instead of the review date", () => {
    const activityAt = Date.UTC(2026, 6, 25, 18, 30);
    const reviewAt = Date.UTC(2026, 7, 20, 12);
    const record = { latestAssessment: { nextReviewAt: reviewAt }, timeline: [{ occurredAt: activityAt }] };
    expect(getLatestPatientActivityAt(record)).toBe(activityAt);
    expect(getLatestPatientActivityAt(record)).not.toBe(reviewAt);
  });
  it("returns null without timeline activity", () => {
    expect(getLatestPatientActivityAt({ timeline: [] })).toBeNull();
    expect(getLatestPatientActivityAt({})).toBeNull();
  });
});
