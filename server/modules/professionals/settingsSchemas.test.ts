import { describe, expect, it } from "vitest";
import {
  professionalIdentitySettingsSchema,
  professionalPreferencesSettingsSchema,
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

  it("rejects unsupported review and reminder ranges", () => {
    const result = professionalPreferencesSettingsSchema.safeParse({
      defaultReviewIntervalDays: 500,
      remindersEnabled: true,
      defaultReminderLeadDays: 60,
      summaryFrequency: "weekly",
      messageTemplates: [],
    });

    expect(result.success).toBe(false);
  });

  it("limits templates and requires explicit content", () => {
    const invalidTemplate = professionalPreferencesSettingsSchema.safeParse({
      defaultReviewIntervalDays: null,
      remindersEnabled: false,
      defaultReminderLeadDays: 0,
      summaryFrequency: "disabled",
      messageTemplates: [
        { title: "Lembrete", messageType: "reminder", content: "" },
      ],
    });
    const tooManyTemplates = professionalPreferencesSettingsSchema.safeParse({
      defaultReviewIntervalDays: null,
      remindersEnabled: false,
      defaultReminderLeadDays: 0,
      summaryFrequency: "disabled",
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
