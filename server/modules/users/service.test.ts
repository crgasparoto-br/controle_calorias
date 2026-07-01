import { describe, expect, it, vi } from "vitest";
import { createUsersService } from "./service";
import type { UsersRepository } from "../../repositories/usersRepository";
import type { UserProfileRepository } from "../../repositories/userProfileRepository";
import type { WeightRepository } from "../../repositories/weightRepository";

function createFakeUsersRepository(overrides: Partial<UsersRepository> = {}): UsersRepository {
  return {
    upsert: vi.fn(async () => undefined),
    findByOpenId: vi.fn(async () => undefined),
    findById: vi.fn(async () => undefined),
    listRecent: vi.fn(async () => []),
    ...overrides,
  } as UsersRepository;
}

function createFakeUserProfileRepository(overrides: Partial<UserProfileRepository> = {}): UserProfileRepository {
  return {
    upsertProfile: vi.fn(async () => undefined),
    updateCurrentWeight: vi.fn(async () => undefined),
    replacePreferences: vi.fn(async () => undefined),
    insertRestrictions: vi.fn(async () => undefined),
    findProfileByUserId: vi.fn(async () => undefined),
    findPreferencesByUserId: vi.fn(async () => []),
    findRestrictionsByUserId: vi.fn(async () => []),
    ...overrides,
  } as UserProfileRepository;
}

function createFakeWeightRepository(overrides: Partial<WeightRepository> = {}): WeightRepository {
  return {
    insertEntry: vi.fn(async () => undefined),
    findByUserId: vi.fn(async () => []),
    ...overrides,
  } as WeightRepository;
}

const baseOnboardingInput = {
  name: "Maria",
  birthDate: "1990-01-01",
  ageYears: 34,
  heightCm: 165,
  currentWeightKg: 70,
  objective: "emagrecer" as const,
  activityLevel: "moderate" as const,
  trackingExperience: "beginner" as const,
  dietaryPreferences: ["vegetariano"],
  dietaryRestrictions: ["lactose"],
  eatingRoutine: "cozinha_em_casa" as const,
  mainDifficulty: "fome" as const,
};

describe("users service", () => {
  it("keeps the in-memory onboarding profile and weight memory in sync after a weight update", async () => {
    const service = createUsersService({
      usersRepository: createFakeUsersRepository(),
      userProfileRepository: createFakeUserProfileRepository(),
      weightRepository: createFakeWeightRepository(),
      getDb: async () => null,
      onWarning: vi.fn(),
    });

    await service.saveUserOnboardingProfile(1, baseOnboardingInput);
    const measuredAt = new Date("2026-02-01T00:00:00Z");
    await service.updateUserCurrentWeight(1, { weightKg: 68, measuredAt });

    expect(service.getOnboardingProfileMemory(1)?.currentWeightKg).toBe(68);
    expect(service.getWeightEntriesMemory(1)).toEqual([
      expect.objectContaining({ userId: 1, weightKg: 68, measuredAt }),
    ]);
  });

  it("falls back to the in-memory onboarding profile for the food assistant when the database is unavailable", async () => {
    const service = createUsersService({
      usersRepository: createFakeUsersRepository(),
      userProfileRepository: createFakeUserProfileRepository(),
      weightRepository: createFakeWeightRepository(),
      getDb: async () => null,
      onWarning: vi.fn(),
    });

    await service.saveUserOnboardingProfile(2, baseOnboardingInput);
    const profile = await service.getFoodAssistantProfile(2);

    expect(profile).toEqual({
      preferences: ["vegetariano"],
      restrictions: ["lactose"],
      eatingRoutine: "cozinha_em_casa",
      objective: "emagrecer",
    });
  });

  it("clears both onboarding profile and weight memory for a user", async () => {
    const service = createUsersService({
      usersRepository: createFakeUsersRepository(),
      userProfileRepository: createFakeUserProfileRepository(),
      weightRepository: createFakeWeightRepository(),
      getDb: async () => null,
      onWarning: vi.fn(),
    });

    await service.saveUserOnboardingProfile(3, baseOnboardingInput);
    service.setWeightEntriesMemory(3, [
      { id: 1, userId: 3, weightKg: 70, measuredAt: new Date(), notes: null, createdAt: new Date(), updatedAt: new Date() },
    ]);

    service.clearMemory(3);

    expect(service.getOnboardingProfileMemory(3)).toBeUndefined();
    expect(service.getWeightEntriesMemory(3)).toBeUndefined();
  });
});
