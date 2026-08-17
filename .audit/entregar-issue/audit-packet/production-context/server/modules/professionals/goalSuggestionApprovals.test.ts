import { describe, expect, it } from "vitest";
import { professionalContentRepository } from "./contentPersistenceService";
import {
  listPatientGoalSuggestions,
  respondPatientGoalSuggestion,
} from "./goalSuggestionApprovals";
import { upsertProfessionalProfile } from "./service";

function goal(calories = 1800) {
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

describe("patient professional goal suggestions", () => {
  it("lists canonical suggestions with the professional profile", async () => {
    const suffix = crypto.randomUUID();
    const professionalUserId = 80541;
    const patientUserId = 80542;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional Persistente",
      active: true,
    });
    await professionalContentRepository.createGoalSuggestion({
      id: `patient-list-${suffix}`,
      professionalUserId,
      patientUserId,
      rationale: "Sugestão disponível ao paciente.",
      status: "sent",
      goal: goal(),
    });

    await expect(listPatientGoalSuggestions(patientUserId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `patient-list-${suffix}`,
          professional: expect.objectContaining({
            displayName: "Profissional Persistente",
          }),
        }),
      ])
    );
  });

  it("keeps repeated acceptance idempotent and rejects opposite regression", async () => {
    const suffix = crypto.randomUUID();
    const professionalUserId = 80551;
    const patientUserId = 80552;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional Decisão",
      active: true,
    });
    await professionalContentRepository.createGoalSuggestion({
      id: `patient-decision-${suffix}`,
      professionalUserId,
      patientUserId,
      rationale: "Sugestão para decisão.",
      status: "sent",
      goal: goal(1750),
    });

    const accepted = await respondPatientGoalSuggestion(patientUserId, {
      suggestionId: `patient-decision-${suffix}`,
      decision: "accepted",
    });
    const retried = await respondPatientGoalSuggestion(patientUserId, {
      suggestionId: `patient-decision-${suffix}`,
      decision: "accepted",
    });

    expect(accepted.status).toBe("accepted");
    expect(retried.status).toBe("accepted");
    await expect(
      respondPatientGoalSuggestion(patientUserId, {
        suggestionId: `patient-decision-${suffix}`,
        decision: "refused",
      })
    ).rejects.toThrow("já foi respondida");
  });
});
