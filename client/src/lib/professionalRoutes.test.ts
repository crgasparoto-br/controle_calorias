import { describe, expect, it } from "vitest";
import {
  parseProfessionalPatientRoute,
  professionalPatientPath,
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
    });
    expect(parseProfessionalPatientRoute("/professional/patients/0")).toEqual({
      kind: "invalid",
      rawPatientId: "0",
    });
    expect(
      parseProfessionalPatientRoute(
        "/professional/patients/999999999999999999999"
      )
    ).toEqual({
      kind: "invalid",
      rawPatientId: "999999999999999999999",
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
