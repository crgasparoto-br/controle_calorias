import { eq } from "drizzle-orm";
import { userPreferences, userProfiles, userRestrictions } from "../../../drizzle/schema";
import { normalizeUserTimeZone } from "../../../shared/timeZone";
import { getDb } from "../../db";

const DEFAULT_ONBOARDING_PROFILE = {
  objective: "melhorar_habitos",
  activityLevel: "moderate",
  trackingExperience: "beginner",
  eatingRoutine: "misto",
  mainDifficulty: "falta_de_planejamento",
} as const;

function parsePreferenceList(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

export async function getUserOnboardingProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const [profileRows, preferenceRows, restrictionRows] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1),
    db.select().from(userPreferences).where(eq(userPreferences.userId, userId)),
    db.select().from(userRestrictions).where(eq(userRestrictions.userId, userId)),
  ]);

  const profile = profileRows[0];
  if (!profile) return null;

  const preferenceMap = new Map(preferenceRows.map(row => [row.preferenceKey, row.preferenceValue]));
  const dietaryRestrictions = uniqueStrings(restrictionRows.map(row => row.label).filter(Boolean));

  return {
    name: profile.displayName ?? "",
    birthDate: profile.birthDate ?? "",
    ageYears: profile.ageYears ?? null,
    heightCm: profile.heightCm ?? null,
    currentWeightKg: profile.currentWeightKg ?? null,
    objective: profile.nutritionObjective ?? DEFAULT_ONBOARDING_PROFILE.objective,
    activityLevel: profile.activityLevel ?? DEFAULT_ONBOARDING_PROFILE.activityLevel,
    trackingExperience: profile.trackingExperience ?? DEFAULT_ONBOARDING_PROFILE.trackingExperience,
    dietaryPreferences: parsePreferenceList(preferenceMap.get("dietary_preferences")),
    dietaryRestrictions,
    eatingRoutine: profile.eatingRoutine ?? DEFAULT_ONBOARDING_PROFILE.eatingRoutine,
    mainDifficulty: profile.mainDifficulty ?? DEFAULT_ONBOARDING_PROFILE.mainDifficulty,
    timezone: normalizeUserTimeZone(profile.timezone),
    onboardingCompletedAt: profile.onboardingCompletedAt?.toISOString() ?? null,
  };
}
