import { describe, expect, it } from "vitest";
import {
  approvePatientAccess,
  requestPatientAccess,
  suggestGoalAdjustment,
  upsertProfessionalProfile,
} from "./service";

function goalInput(calories = 1800) {
  return {
    defaultGoal: {
      calories,
      proteinGrams: 120,
      carbsGrams: 190,
      fatGrams: 55,
    },
    exceptions: [],
  };
}

describe("professional goal suggestions", () => {
  it("blocks goal suggestions when patient access is not approved", () => {
    const professionalUserId = 24210;
    const patientUserId = 24211;
    upsertProfessionalProfile(professionalUserId, {
      displayName: "Dra. Marina",
      active: true,
    });

    expect(() => suggestGoalAdjustment(professionalUserId, {
      patientId: patientUserId,
      rationale: "Ajuste inicial de acompanhamento.",
      status: "sent",
      goal: goalInput(),
    })).toThrow("Acesso profissional não autorizado pelo paciente.");
  });

  it("creates a sent goal suggestion for an approved patient", async () => {
    const professionalUserId = 24220;
    const patientUserId = 24221;
    upsertProfessionalProfile(professionalUserId, {
      displayName: "Dra. Marina",
      active: true,
    });

    const access = await requestPatientAccess(professionalUserId, {
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Acompanhamento semanal",
    });
    approvePatientAccess(patientUserId, access.id);

    const suggestion = suggestGoalAdjustment(professionalUserId, {
      patientId: patientUserId,
      rationale: "Reduzir calorias mantendo proteína alta.",
      status: "sent",
      goal: goalInput(1750),
    });

    expect(suggestion).toMatchObject({
      professionalUserId,
      patientUserId,
      status: "sent",
      rationale: "Reduzir calorias mantendo proteína alta.",
      goal: goalInput(1750),
    });
    expect(suggestion.sentAt).toEqual(expect.any(Number));
    expect(suggestion.respondedAt).toBeNull();
  });
});
