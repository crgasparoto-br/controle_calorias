import { describe, expect, it } from "vitest";
import {
  professionalIdentitySettingsSchema,
  professionalPreferencesSettingsSchema,
  storedProfessionalSettingsSchema,
} from "./settingsSchemas";

describe("professional settings schemas", () => {
  it("normalizes optional patient-facing identification", () => {
    const result = professionalIdentitySettingsSchema.parse({
      displayName: "  Nutricionista Ana  ",
      registrationNumber: "  CRN 123  ",
      contactEmail: "ana@example.com",
      contactPhone: "  +55 11 99999-9999  ",
      patientFacingBio: "  Atendimento nutricional individual.  ",
    });

    expect(result).toEqual({
      displayName: "Nutricionista Ana",
      registrationNumber: "CRN 123",
      contactEmail: "ana@example.com",
      contactPhone: "+55 11 99999-9999",
      patientFacingBio: "Atendimento nutricional individual.",
    });
  });

  it("rejects unsupported review ranges", () => {
    const result = professionalPreferencesSettingsSchema.safeParse({
      defaultReviewIntervalDays: 500,
      messageTemplates: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsupported automatic reminder and summary fields", () => {
    const result = professionalPreferencesSettingsSchema.safeParse({
      defaultReviewIntervalDays: 30,
      messageTemplates: [],
      remindersEnabled: false,
      defaultReminderLeadDays: 5,
      summaryFrequency: "weekly",
    });

    expect(result.success).toBe(false);
  });

  it("reads and removes obsolete stored automation fields safely", () => {
    const result = storedProfessionalSettingsSchema.parse({
      version: 1,
      contactEmail: null,
      contactPhone: null,
      patientFacingBio: null,
      defaultReviewIntervalDays: 30,
      remindersEnabled: false,
      defaultReminderLeadDays: 5,
      summaryFrequency: "weekly",
      messageTemplates: [],
      updatedAt: Date.now(),
    });

    expect(result).not.toHaveProperty("remindersEnabled");
    expect(result).not.toHaveProperty("summaryFrequency");
  });

  it("limits templates and requires explicit content", () => {
    const invalidTemplate = professionalPreferencesSettingsSchema.safeParse({
      defaultReviewIntervalDays: null,
      messageTemplates: [
        { title: "Lembrete", messageType: "reminder", content: "" },
      ],
    });
    const tooManyTemplates = professionalPreferencesSettingsSchema.safeParse({
      defaultReviewIntervalDays: null,
      messageTemplates: Array.from({ length: 21 }, (_, index) => ({
        title: `Modelo ${index}`,
        messageType: "reminder",
        content: "Mensagem",
      })),
    });

    expect(invalidTemplate.success).toBe(false);
    expect(tooManyTemplates.success).toBe(false);
  });
});
