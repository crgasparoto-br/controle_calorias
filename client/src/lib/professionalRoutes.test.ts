import { describe, expect, it } from "vitest";
import {
  parseProfessionalPatientRoute,
  professionalPatientPath,
  professionalPatientResourceForRoute,
  professionalResourceForPath,
} from "./professionalRoutes";

describe("professionalResourceForPath", () => {
  it("distinguishes the portfolio collection from patient routes", () => {
    expect(professionalResourceForPath("/professional/patients")).toBe(
      "professional_portfolio"
    );
    expect(professionalResourceForPath("/professional/patients/42")).toBe(
      "professional_record"
    );
  });

  it("maps nested patient routes to their specific entitlements", () => {
    expect(
      professionalResourceForPath("/professional/patients/42/reports")
    ).toBe("professional_reports");
    expect(
      professionalResourceForPath("/professional/patients/42/messages")
    ).toBe("professional_messages");
    expect(
      professionalResourceForPath("/professional/patients/42/assessment")
    ).toBe("professional_record");
    expect(
      professionalResourceForPath("/professional/patients/42/goals")
    ).toBe("professional_record");
  });

  it("keeps the section entitlement for malformed patient ids", () => {
    expect(
      professionalResourceForPath("/professional/patients/abc/reports")
    ).toBe("professional_reports");
    expect(
      professionalResourceForPath("/professional/patients/0/messages")
    ).toBe("professional_messages");
    expect(
      professionalResourceForPath("/professional/patients/abc/goals")
    ).toBe("professional_record");
  });

  it("keeps aggregate and settings routes independent from patient context", () => {
    expect(professionalResourceForPath("/professional/reports")).toBe(
      "professional_reports"
    );
    expect(professionalResourceForPath("/professional/messages")).toBe(
      "professional_messages"
    );
    expect(professionalResourceForPath("/professional/settings")).toBe(
      "professional_settings"
    );
  });
});

describe("parseProfessionalPatientRoute", () => {
  it("parses a positive patient id and section", () => {
    expect(
      parseProfessionalPatientRoute("/professional/patients/123/goals?week=2")
    ).toEqual({ kind: "patient", patientId: 123, section: "goals" });
  });

  it("rejects malformed, zero and unsafe ids without coercing them to zero", () => {
    expect(parseProfessionalPatientRoute("/professional/patients/abc")).toEqual({
      kind: "invalid",
      rawPatientId: "abc",
      section: "record",
    });
    expect(
      parseProfessionalPatientRoute("/professional/patients/0/messages")
    ).toEqual({
      kind: "invalid",
      rawPatientId: "0",
      section: "messages",
    });
    expect(
      parseProfessionalPatientRoute(
        "/professional/patients/999999999999999999999"
      )
    ).toEqual({
      kind: "invalid",
      rawPatientId: "999999999999999999999",
      section: "record",
    });
  });

  it("returns none for aggregate routes", () => {
    expect(parseProfessionalPatientRoute("/professional/patients")).toEqual({
      kind: "none",
    });
    expect(parseProfessionalPatientRoute("/professional/reports")).toEqual({
      kind: "none",
    });
  });
});

describe("professionalPatientResourceForRoute", () => {
  it("selects the exact entitlement for each patient section", () => {
    expect(
      professionalPatientResourceForRoute({
        kind: "patient",
        patientId: 7,
        section: "reports",
      })
    ).toBe("professional_reports");
    expect(
      professionalPatientResourceForRoute({
        kind: "invalid",
        rawPatientId: "abc",
        section: "messages",
      })
    ).toBe("professional_messages");
    expect(
      professionalPatientResourceForRoute({
        kind: "patient",
        patientId: 7,
        section: "goals",
      })
    ).toBe("professional_record");
    expect(professionalPatientResourceForRoute({ kind: "none" })).toBeNull();
  });
});

describe("professionalPatientPath", () => {
  it("builds stable record and nested paths", () => {
    expect(professionalPatientPath(7)).toBe("/professional/patients/7");
    expect(professionalPatientPath(7, "messages")).toBe(
      "/professional/patients/7/messages"
    );
  });

  it("rejects invalid ids", () => {
    expect(() => professionalPatientPath(0)).toThrow();
    expect(() => professionalPatientPath(Number.NaN)).toThrow();
  });
});
