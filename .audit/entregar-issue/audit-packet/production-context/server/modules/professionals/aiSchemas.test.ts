import { describe, expect, it } from "vitest";
import { professionalAiGenerateSchema } from "./aiSchemas";

const base = {
  patientId: 41,
  startDate: "2026-07-01",
  endDate: "2026-07-07",
  mode: "summary" as const,
};

describe("professionalAiGenerateSchema", () => {
  it("rejects impossible calendar dates", () => {
    expect(
      professionalAiGenerateSchema.safeParse({
        ...base,
        startDate: "2026-02-31",
      }).success
    ).toBe(false);
  });

  it("rejects periods longer than ninety days", () => {
    expect(
      professionalAiGenerateSchema.safeParse({
        ...base,
        startDate: "2026-01-01",
        endDate: "2026-04-01",
      }).success
    ).toBe(false);
  });

  it("accepts a valid inclusive ninety-day period", () => {
    expect(
      professionalAiGenerateSchema.safeParse({
        ...base,
        startDate: "2026-01-01",
        endDate: "2026-03-31",
      }).success
    ).toBe(true);
  });
});
