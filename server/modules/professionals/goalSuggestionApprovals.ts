import { updateNutritionGoal } from "../goals/service";
import { professionalContentRepository } from "./contentPersistenceService";
import { getProfessionalProfile } from "./service";
import type {
  GoalSuggestionDecisionInput,
  ProfessionalGoalSuggestionInput,
  ProfessionalGoalSuggestionStatus,
} from "./schemas";

type StoredGoalSuggestionInput = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  rationale: string;
  status: ProfessionalGoalSuggestionStatus;
  goal: ProfessionalGoalSuggestionInput["goal"];
  createdAt: number;
  sentAt: number | null;
  respondedAt: number | null;
};

async function withProfessionalProfiles<
  T extends { professionalUserId: number },
>(suggestions: T[]) {
  const profileEntries = await Promise.all(
    Array.from(
      new Set(suggestions.map(suggestion => suggestion.professionalUserId))
    ).map(
      async professionalUserId =>
        [
          professionalUserId,
          await getProfessionalProfile(professionalUserId),
        ] as const
    )
  );
  const profileMap = new Map(profileEntries);

  return suggestions.map(suggestion => ({
    ...suggestion,
    professional: profileMap.get(suggestion.professionalUserId) ?? null,
  }));
}

/**
 * Compatibilidade temporária para consumidores antigos que ainda registram a
 * sugestão depois de criá-la. A inserção é idempotente pelo ID canônico e não
 * gera um segundo evento de histórico.
 */
export async function recordProfessionalGoalSuggestion(
  suggestion: StoredGoalSuggestionInput
) {
  return professionalContentRepository.createGoalSuggestion(suggestion, {
    recordHistory: false,
  });
}

export async function listPatientGoalSuggestions(patientUserId: number) {
  const suggestions =
    await professionalContentRepository.listGoalSuggestionsByPatient(
      patientUserId,
      { limit: 100 }
    );
  return withProfessionalProfiles(suggestions);
}

export async function respondPatientGoalSuggestion(
  patientUserId: number,
  input: GoalSuggestionDecisionInput
) {
  const suggestion =
    await professionalContentRepository.getGoalSuggestionForPatient(
      patientUserId,
      input.suggestionId
    );
  if (!suggestion) {
    throw new Error("Sugestão de meta não encontrada.");
  }

  const status: "accepted" | "refused" =
    input.decision === "accepted" ? "accepted" : "refused";
  if (suggestion.status === status) {
    return (await withProfessionalProfiles([suggestion]))[0];
  }
  if (suggestion.status !== "sent") {
    throw new Error("Essa sugestão já foi respondida.");
  }

  // A validação de segurança e a persistência da meta permanecem no serviço
  // canônico de metas. Repetições concorrentes aplicam o mesmo conteúdo e a
  // transição abaixo usa CAS para garantir um único estado final auditável.
  if (status === "accepted") {
    await updateNutritionGoal(patientUserId, suggestion.goal);
  }

  const updated = await professionalContentRepository.transitionGoalSuggestion(
    patientUserId,
    input.suggestionId,
    status
  );

  return (await withProfessionalProfiles([updated]))[0];
}
