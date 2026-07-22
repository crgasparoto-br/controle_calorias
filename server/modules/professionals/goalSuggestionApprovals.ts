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
  const status: "accepted" | "refused" =
    input.decision === "accepted" ? "accepted" : "refused";
  const reservation =
    await professionalContentRepository.reserveGoalSuggestionDecision(
      patientUserId,
      input.suggestionId
    );

  if (reservation.result === "not_found") {
    throw new Error("Sugestão de meta não encontrada.");
  }
  if (reservation.result === "already_completed") {
    if (reservation.suggestion.status !== status) {
      throw new Error("Essa sugestão já foi respondida.");
    }
    return (await withProfessionalProfiles([reservation.suggestion]))[0];
  }
  if (reservation.result === "conflict") {
    throw new Error(
      "Essa sugestão está sendo processada por outra operação. Tente novamente."
    );
  }

  try {
    if (status === "accepted") {
      await updateNutritionGoal(patientUserId, reservation.suggestion.goal);
    }
    const updated =
      await professionalContentRepository.completeGoalSuggestionDecision({
        patientUserId,
        suggestionId: input.suggestionId,
        lockId: reservation.lockId,
        nextStatus: status,
      });
    return (await withProfessionalProfiles([updated]))[0];
  } catch (error) {
    await professionalContentRepository.releaseGoalSuggestionDecision({
      patientUserId,
      suggestionId: input.suggestionId,
      lockId: reservation.lockId,
    });
    throw error;
  }
}
