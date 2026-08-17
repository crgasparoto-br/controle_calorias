import { InsertUser, WeightEntry } from "../../../drizzle/schema";
import type { OnboardingInput } from "../onboarding/schemas";
import type { UsersRepository } from "../../repositories/usersRepository";
import type { UserProfileRepository } from "../../repositories/userProfileRepository";
import type { WeightRepository } from "../../repositories/weightRepository";
import { canUseMemoryPersistenceFallback } from "../../repositories/memoryFallback";

export type OnboardingProfileEntry = OnboardingInput & {
  userId: number;
  completedAt: Date;
};

export function parsePreferenceList(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function createUsersService(deps: {
  usersRepository: UsersRepository;
  userProfileRepository: UserProfileRepository;
  weightRepository: WeightRepository;
  getDb: () => Promise<unknown>;
  onWarning: (scope: string, error: unknown) => void;
}) {
  const onboardingProfileStore = new Map<number, OnboardingProfileEntry>();
  const weightEntryStore = new Map<number, WeightEntry[]>();

  async function upsertUser(user: InsertUser): Promise<void> {
    if (!user.openId) {
      throw new Error("User openId is required for upsert");
    }

    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === "local:owner") {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await deps.usersRepository.upsert(values, updateSet);
  }

  async function getUserByOpenId(openId: string) {
    return deps.usersRepository.findByOpenId(openId);
  }

  async function saveUserOnboardingProfile(userId: number, input: OnboardingInput) {
    const now = new Date();
    const profile: OnboardingProfileEntry = {
      userId,
      ...input,
      completedAt: now,
    };

    if (canUseMemoryPersistenceFallback()) {
      onboardingProfileStore.set(userId, profile);
    }

    const profileValues = {
      displayName: input.name,
      birthDate: input.birthDate ?? null,
      ageYears: input.ageYears,
      sex: "prefer_not_to_say" as const,
      heightCm: input.heightCm,
      currentWeightKg: input.currentWeightKg,
      nutritionObjective: input.objective,
      activityLevel: input.activityLevel,
      trackingExperience: input.trackingExperience,
      eatingRoutine: input.eatingRoutine,
      mainDifficulty: input.mainDifficulty,
      onboardingCompletedAt: now,
      updatedAt: now,
    };

    try {
      await deps.userProfileRepository.upsertProfile(userId, profileValues);
      await deps.weightRepository.insertEntry(userId, input.currentWeightKg, now, "Peso informado no onboarding.");

      const preferenceKeys = ["dietary_preferences", "eating_routine", "main_difficulty", "tracking_experience"];
      await deps.userProfileRepository.replacePreferences(userId, preferenceKeys, [
        { preferenceKey: "dietary_preferences", preferenceValue: JSON.stringify(input.dietaryPreferences) },
        { preferenceKey: "eating_routine", preferenceValue: input.eatingRoutine },
        { preferenceKey: "main_difficulty", preferenceValue: input.mainDifficulty },
        { preferenceKey: "tracking_experience", preferenceValue: input.trackingExperience },
      ]);

      await deps.userProfileRepository.insertRestrictions(userId, input.dietaryRestrictions);
    } catch (error) {
      deps.onWarning("Onboarding persistence skipped", error);
    }

    return profile;
  }

  async function updateUserCurrentWeight(userId: number, input: {
    weightKg: number;
    measuredAt: Date;
    notes?: string;
  }) {
    if (canUseMemoryPersistenceFallback()) {
      const existingProfile = onboardingProfileStore.get(userId);
      if (existingProfile) {
        onboardingProfileStore.set(userId, {
          ...existingProfile,
          currentWeightKg: input.weightKg,
          weightMeasuredAt: input.measuredAt.toISOString(),
          weightEntryNote: input.notes,
        });
      }

      const entries = weightEntryStore.get(userId) ?? [];
      const nextId = entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
      const now = new Date();
      weightEntryStore.set(userId, [
        ...entries,
        {
          id: nextId,
          userId,
          weightKg: input.weightKg,
          measuredAt: input.measuredAt,
          notes: input.notes ?? null,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    await deps.userProfileRepository.updateCurrentWeight(userId, input.weightKg);
    await deps.weightRepository.insertEntry(userId, input.weightKg, input.measuredAt, input.notes ?? "Peso atualizado pelo WhatsApp.");

    return {
      userId,
      weightKg: input.weightKg,
      measuredAt: input.measuredAt,
      notes: input.notes ?? null,
    };
  }

  async function getFoodAssistantProfile(userId: number) {
    const memoryProfile = onboardingProfileStore.get(userId);
    const fallback = {
      preferences: memoryProfile?.dietaryPreferences ?? [],
      restrictions: memoryProfile?.dietaryRestrictions ?? [],
      eatingRoutine: memoryProfile?.eatingRoutine ?? null,
      objective: memoryProfile?.objective ?? null,
    };

    const db = await deps.getDb();
    if (!db) {
      return fallback;
    }

    try {
      const [profile, preferenceRows, restrictionRows] = await Promise.all([
        deps.userProfileRepository.findProfileByUserId(userId),
        deps.userProfileRepository.findPreferencesByUserId(userId),
        deps.userProfileRepository.findRestrictionsByUserId(userId),
      ]);
      const preferenceMap = new Map(preferenceRows.map(row => [row.preferenceKey, row.preferenceValue]));

      return {
        preferences: parsePreferenceList(preferenceMap.get("dietary_preferences")),
        restrictions: restrictionRows.map(row => row.label).filter(Boolean),
        eatingRoutine: profile?.eatingRoutine ?? preferenceMap.get("eating_routine") ?? null,
        objective: profile?.nutritionObjective ?? null,
      };
    } catch (error) {
      deps.onWarning("Food assistant profile read skipped", error);
      return fallback;
    }
  }

  function getOnboardingProfileMemory(userId: number) {
    return onboardingProfileStore.get(userId);
  }

  function getWeightEntriesMemory(userId: number) {
    return weightEntryStore.get(userId);
  }

  function setWeightEntriesMemory(userId: number, entries: WeightEntry[]) {
    weightEntryStore.set(userId, entries);
  }

  function clearMemory(userId: number) {
    onboardingProfileStore.delete(userId);
    weightEntryStore.delete(userId);
  }

  return {
    upsertUser,
    getUserByOpenId,
    saveUserOnboardingProfile,
    updateUserCurrentWeight,
    getFoodAssistantProfile,
    getOnboardingProfileMemory,
    getWeightEntriesMemory,
    setWeightEntriesMemory,
    clearMemory,
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
