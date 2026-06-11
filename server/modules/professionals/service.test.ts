import { describe, expect, it } from "vitest";
import {
  answerProfessionalPatientQuestion,
  approvePatientAccess,
  getProfessionalProfile,
  requestPatientAccess,
  suggestGoalAdjustment,
  suggestMealPlan,
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

describe("professional profile", () => {
  it("returns the saved active profile state", async () => {
    const professionalUserId = 24110;

    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Marina Souza",
      registrationNumber: "Registro 12345",
      active: true,
    });

    await expect(getProfessionalProfile(professionalUserId)).resolves.toMatchObject({
      userId: professionalUserId,
      displayName: "Marina Souza",
      registrationNumber: "Registro 12345",
      active: true,
    });
  });

  it("keeps an inactive professional profile inactive", async () => {
    const professionalUserId = 24111;

    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Camila Pereira",
      active: false,
    });

    await expect(getProfessionalProfile(professionalUserId)).resolves.toMatchObject({
      userId: professionalUserId,
      displayName: "Camila Pereira",
      active: false,
    });
  });
});

describe("professional goal suggestions", () => {
  it("blocks goal suggestions when patient access is not approved", async () => {
    const professionalUserId = 24210;
    const patientUserId = 24211;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Marina Souza",
      active: true,
    });

    await expect(suggestGoalAdjustment(professionalUserId, {
      patientId: patientUserId,
      rationale: "Ajuste inicial de acompanhamento.",
      status: "sent",
      goal: goalInput(),
    })).rejects.toThrow("Acesso profissional não autorizado pela pessoa acompanhada.");
  });

  it("creates a sent goal suggestion for an approved patient", async () => {
    const professionalUserId = 24220;
    const patientUserId = 24221;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Marina Souza",
      active: true,
    });

    const access = await requestPatientAccess(professionalUserId, {
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Acompanhamento semanal",
    });
    approvePatientAccess(patientUserId, access.id);

    const suggestion = await suggestGoalAdjustment(professionalUserId, {
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

describe("professional meal suggestions", () => {
  it("blocks meal suggestions when patient access is not approved", async () => {
    const professionalUserId = 24310;
    const patientUserId = 24311;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Camila Pereira",
      active: true,
    });

    await expect(suggestMealPlan(professionalUserId, {
      patientId: patientUserId,
      mealLabel: "Jantar",
      title: "Jantar leve",
      description: "Omelete com legumes e salada.",
      rationale: "Melhorar saciedade à noite.",
      status: "sent",
    })).rejects.toThrow("Acesso profissional não autorizado pela pessoa acompanhada.");
  });

  it("creates a sent meal suggestion for an approved patient", async () => {
    const professionalUserId = 24320;
    const patientUserId = 24321;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Camila Pereira",
      active: true,
    });

    const access = await requestPatientAccess(professionalUserId, {
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Acompanhamento semanal",
    });
    approvePatientAccess(patientUserId, access.id);

    const suggestion = await suggestMealPlan(professionalUserId, {
      patientId: patientUserId,
      mealLabel: "Almoço",
      title: "Almoço rico em proteína",
      description: "Arroz, feijão, frango grelhado e salada.",
      rationale: "Ajustar proteína e saciedade no almoço.",
      notes: "Usar azeite com moderação.",
      status: "sent",
    });

    expect(suggestion).toMatchObject({
      professionalUserId,
      patientUserId,
      mealLabel: "Almoço",
      title: "Almoço rico em proteína",
      status: "sent",
      notes: "Usar azeite com moderação.",
    });
    expect(suggestion.sentAt).toEqual(expect.any(Number));
    expect(suggestion.respondedAt).toBeNull();
  });
});

describe("professional patient AI questions", () => {
  it("blocks patient questions when patient access is not approved", async () => {
    const professionalUserId = 24410;
    const patientUserId = 24411;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Beatriz Lima",
      active: true,
    });

    await expect(answerProfessionalPatientQuestion(professionalUserId, {
      patientId: patientUserId,
      question: "O que chama atenção nos registros da semana?",
    })).rejects.toThrow("Acesso profissional não autorizado pela pessoa acompanhada.");
  });
});
