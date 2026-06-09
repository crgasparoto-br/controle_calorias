import { describe, expect, it } from "vitest";
import {
  professionalGoalSuggestionSchema,
  professionalMealSuggestionSchema,
  professionalProfileSchema,
  requestPatientAccessSchema,
} from "./schemas";

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

  it("defaults professional goal suggestions to sent status", () => {
    const result = professionalGoalSuggestionSchema.parse({
      patientId: 2,
      rationale: "Ajuste para nova fase do acompanhamento.",
      goal: {
        defaultGoal: {
          calories: 1800,
          proteinGrams: 120,
          carbsGrams: 190,
          fatGrams: 55,
        },
        exceptions: [],
      },
    });

    expect(result.status).toBe("sent");
  });

  it("defaults professional meal suggestions to sent status", () => {
    const result = professionalMealSuggestionSchema.parse({
      patientId: 2,
      mealLabel: "Almoço",
      title: "Almoço rico em proteína",
      description: "Arroz, feijão, frango grelhado e salada.",
      rationale: "Ajustar saciedade e proteína no almoço.",
    });

    expect(result.status).toBe("sent");
  });
});
