import { describe, expect, it } from "vitest";
import { professionalProfileSchema, requestPatientAccessSchema } from "./schemas";

describe("professional schemas", () => {
  it("defaults professional profile to active when omitted", () => {
    const result = professionalProfileSchema.parse({
      displayName: "Dra. Ana",
      registrationNumber: "CRN 12345",
    });

    expect(result.active).toBe(true);
  });

  it("accepts an inactive professional profile", () => {
    const result = professionalProfileSchema.parse({
      displayName: "Dra. Ana",
      active: false,
    });

    expect(result.active).toBe(false);
  });

  it("accepts patient access requests by email or phone contact", () => {
    expect(requestPatientAccessSchema.parse({
      patientContact: "paciente@example.com",
      reason: "Acompanhamento semanal",
    }).patientContact).toBe("paciente@example.com");

    expect(requestPatientAccessSchema.parse({
      patientContact: "+55 (11) 99999-9999",
      reason: "Acompanhamento semanal",
    }).patientContact).toBe("+55 (11) 99999-9999");
  });

  it("keeps the previous patientEmail field for compatibility", () => {
    const result = requestPatientAccessSchema.parse({
      patientEmail: "paciente@example.com",
      reason: "Acompanhamento semanal",
    });

    expect(result.patientEmail).toBe("paciente@example.com");
  });
});
