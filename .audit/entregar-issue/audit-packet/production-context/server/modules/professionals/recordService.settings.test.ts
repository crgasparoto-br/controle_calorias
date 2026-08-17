import { describe, expect, it } from "vitest";
import { resolveProfessionalNextReviewAt } from "./recordService";

describe("professional record settings defaults", () => {
  it("preserves an explicit next review date", () => {
    const explicit = Date.UTC(2026, 7, 15, 12);
    const resolved = resolveProfessionalNextReviewAt({
      assessedAt: Date.UTC(2026, 6, 20, 12),
      nextReviewAt: explicit,
      defaultReviewIntervalDays: 30,
    });

    expect(resolved?.getTime()).toBe(explicit);
  });

  it("derives the next review from the configured interval when omitted", () => {
    const assessedAt = Date.UTC(2026, 6, 20, 12);
    const resolved = resolveProfessionalNextReviewAt({
      assessedAt,
      nextReviewAt: null,
      defaultReviewIntervalDays: 14,
    });

    expect(resolved?.getTime()).toBe(Date.UTC(2026, 7, 3, 12));
  });

  it("keeps the review unset when no default exists", () => {
    const resolved = resolveProfessionalNextReviewAt({
      assessedAt: Date.UTC(2026, 6, 20, 12),
      defaultReviewIntervalDays: null,
    });

    expect(resolved).toBeNull();
  });
});
