import { and, eq } from "drizzle-orm";
import { userPreferences } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { updateNutritionGoal } from "../goals/service";
import { getProfessionalProfile } from "./service";
import type {
  GoalSuggestionDecisionInput,
  ProfessionalGoalSuggestionInput,
  ProfessionalGoalSuggestionStatus,
} from "./schemas";

type StoredGoalSuggestion = {
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

type StoredGoalSuggestionInput = StoredGoalSuggestion | {
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

const PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY = "patient_professional_goal_suggestions_v1";
const goalSuggestionsMemory: StoredGoalSuggestion[] = [];

function normalizeStoredGoalSuggestion(value: Partial<StoredGoalSuggestion>): StoredGoalSuggestion | null {
  if (
    typeof value.id !== "string" ||
    typeof value.professionalUserId !== "number" ||
    typeof value.patientUserId !== "number" ||
    typeof value.rationale !== "string" ||
    typeof value.createdAt !== "number" ||
    !value.goal ||
    !["draft", "sent", "accepted", "refused", "cancelled"].includes(String(value.status))
  ) {
    return null;
  }

  return {
    id: value.id,
    professionalUserId: value.professionalUserId,
    patientUserId: value.patientUserId,
    rationale: value.rationale,
    status: value.status as ProfessionalGoalSuggestionStatus,
    goal: value.goal,
    createdAt: value.createdAt,
    sentAt: typeof value.sentAt === "number" ? value.sentAt : null,
    respondedAt: typeof value.respondedAt === "number" ? value.respondedAt : null,
  };
}

function parseStoredGoalSuggestions(patientUserId: number, value: string) {
  try {
    const parsed = JSON.parse(value) as Array<Partial<StoredGoalSuggestion>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeStoredGoalSuggestion)
      .filter((suggestion): suggestion is StoredGoalSuggestion => Boolean(suggestion))
      .filter(suggestion => suggestion.patientUserId === patientUserId);
  } catch {
    return [];
  }
}

function mergeGoalSuggestion(current: StoredGoalSuggestion[], nextSuggestion: StoredGoalSuggestion) {
  const next = current.filter(suggestion => suggestion.id !== nextSuggestion.id);
  next.push(nextSuggestion);
  return next.sort((a, b) => b.createdAt - a.createdAt);
}

async function loadPatientGoalSuggestions(patientUserId: number) {
  const db = await getDb();
  if (!db) {
    return goalSuggestionsMemory.filter(suggestion => suggestion.patientUserId === patientUserId);
  }

  const rows = await db
    .select()
    .from(userPreferences)
    .where(and(
      eq(userPreferences.userId, patientUserId),
      eq(userPreferences.preferenceKey, PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY),
    ))
    .limit(1);

  const loaded = rows[0]?.preferenceValue
    ? parseStoredGoalSuggestions(patientUserId, rows[0].preferenceValue)
    : [];

  loaded.forEach(suggestion => {
    const index = goalSuggestionsMemory.findIndex(item => item.id === suggestion.id);
    if (index >= 0) goalSuggestionsMemory[index] = suggestion;
    else goalSuggestionsMemory.push(suggestion);
  });

  return loaded;
}

async function persistPatientGoalSuggestions(patientUserId: number, suggestions: StoredGoalSuggestion[]) {
  const db = await getDb();
  goalSuggestionsMemory.splice(
    0,
    goalSuggestionsMemory.length,
    ...goalSuggestionsMemory.filter(suggestion => suggestion.patientUserId !== patientUserId),
    ...suggestions,
  );

  if (!db) return;

  await db.insert(userPreferences).values({
    userId: patientUserId,
    preferenceKey: PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY,
    preferenceValue: JSON.stringify(suggestions),
  }).onDuplicateKeyUpdate({
    set: {
      preferenceValue: JSON.stringify(suggestions),
    },
  });
}

async function withProfessionalProfiles(suggestions: StoredGoalSuggestion[]) {
  const profileEntries = await Promise.all(
    Array.from(new Set(suggestions.map(suggestion => suggestion.professionalUserId)))
      .map(async professionalUserId => [professionalUserId, await getProfessionalProfile(professionalUserId)] as const),
  );
  const profileMap = new Map(profileEntries);

  return suggestions.map(suggestion => ({
    ...suggestion,
    professional: profileMap.get(suggestion.professionalUserId) ?? null,
  }));
}

export async function recordProfessionalGoalSuggestion(suggestion: StoredGoalSuggestionInput) {
  const stored = normalizeStoredGoalSuggestion(suggestion);
  if (!stored) return suggestion;

  const current = await loadPatientGoalSuggestions(stored.patientUserId);
  const next = mergeGoalSuggestion(current, stored);
  await persistPatientGoalSuggestions(stored.patientUserId, next);
  return stored;
}

export async function listPatientGoalSuggestions(patientUserId: number) {
  const suggestions = await loadPatientGoalSuggestions(patientUserId);
  return withProfessionalProfiles(suggestions.sort((a, b) => b.createdAt - a.createdAt));
}

export async function respondPatientGoalSuggestion(patientUserId: number, input: GoalSuggestionDecisionInput) {
  const current = await loadPatientGoalSuggestions(patientUserId);
  const suggestion = current.find(item => item.id === input.suggestionId);
  if (!suggestion || suggestion.patientUserId !== patientUserId) {
    throw new Error("Sugestão de meta não encontrada.");
  }
  if (suggestion.status !== "sent") {
    throw new Error("Essa sugestão já foi respondida.");
  }

  const now = Date.now();
  const status: ProfessionalGoalSuggestionStatus = input.decision === "accepted" ? "accepted" : "refused";

  if (status === "accepted") {
    await updateNutritionGoal(patientUserId, suggestion.goal);
  }

  const updated: StoredGoalSuggestion = {
    ...suggestion,
    status,
    respondedAt: now,
  };
  await persistPatientGoalSuggestions(
    patientUserId,
    current.map(item => item.id === updated.id ? updated : item),
  );

  return (await withProfessionalProfiles([updated]))[0];
}
