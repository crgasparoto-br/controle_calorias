import { describe, expect, it } from "vitest";
import { withoutBlockedPatients } from "./ProfessionalPatients";

describe("ProfessionalPatients access safety", () => {
  it("removes a patient whose access validation failed from the visible portfolio", () => {
    const items = [
      { patientUserId: 41, authorizationStatus: "approved" },
      { patientUserId: 42, authorizationStatus: "approved" },
    ];

    expect(withoutBlockedPatients(items, new Set([41]))).toEqual([
      { patientUserId: 42, authorizationStatus: "approved" },
    ]);
  });

  it("preserves the original list when no patient is blocked", () => {
    const items = [{ patientUserId: 41, authorizationStatus: "approved" }];

    expect(withoutBlockedPatients(items, new Set())).toBe(items);
  });
});
