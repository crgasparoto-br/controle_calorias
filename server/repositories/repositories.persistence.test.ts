import { describe, expect, it, vi } from "vitest";
import {
  appSecrets,
  dailySummaries,
  exercises,
  foodCatalog,
  foodFavorites,
  habitMemories,
  inferenceLogs,
  mealFavorites,
  mealInferences,
  mealItems,
  mealMedia,
  meals,
  userBadges,
  userGamificationSettings,
  userPreferences,
  userProfiles,
  userRestrictions,
  users,
  waterGoals,
  waterLogs,
  weightEntries,
  whatsappConnections,
} from "../../drizzle/schema";
import { createDrizzleAccountRepository } from "./accountRepository";
import { createDrizzleMealsRepository } from "./mealsRepository";
import { createDrizzleUserProfileRepository } from "./userProfileRepository";
import { createDrizzleUsersRepository } from "./usersRepository";
import { createDrizzleWeightRepository } from "./weightRepository";
import { createDrizzleWhatsAppRepository } from "./whatsappRepository";

type DbOperation = {
  op: string;
  table: unknown;
  payload?: unknown;
};

function createSelectChain(result: unknown, operations: DbOperation[] = []) {
  const chain: any = {
    from: vi.fn((table: unknown) => {
      operations.push({ op: "select", table });
      return chain;
    }),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function createMutationChain(op: string, table: unknown, operations: DbOperation[], response: unknown = undefined) {
  const chain: any = {
    values: vi.fn((payload: unknown) => {
      operations.push({ op: `${op}.values`, table, payload });
      return {
        onDuplicateKeyUpdate: vi.fn((payload: unknown) => {
          operations.push({ op: `${op}.onDuplicateKeyUpdate`, table, payload });
          return Promise.resolve(response);
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(response).then(resolve, reject),
      };
    }),
    set: vi.fn((payload: unknown) => {
      operations.push({ op: `${op}.set`, table, payload });
      return chain;
    }),
    where: vi.fn(() => {
      operations.push({ op: `${op}.where`, table });
      return Promise.resolve(response);
    }),
  };
  return chain;
}

function createFakeDb(options: { selectResults?: unknown[]; insertResponse?: unknown } = {}) {
  const operations: DbOperation[] = [];
  const selectResults = [...(options.selectResults ?? [])];
  const db = {
    operations,
    select: vi.fn(() => createSelectChain(selectResults.shift() ?? [], operations)),
    insert: vi.fn((table: unknown) => createMutationChain("insert", table, operations, options.insertResponse)),
    update: vi.fn((table: unknown) => createMutationChain("update", table, operations)),
    delete: vi.fn((table: unknown) => createMutationChain("delete", table, operations)),
  };
  return db;
}

const warning = vi.fn();

describe("extracted repositories persistence contracts", () => {
  it("returns safe fallback values when getDb returns null", async () => {
    const getDb = async () => null;

    const usersRepository = createDrizzleUsersRepository({ getDb, onWarning: warning });
    const profileRepository = createDrizzleUserProfileRepository({ getDb, onWarning: warning });
    const mealsRepository = createDrizzleMealsRepository({ getDb, onWarning: warning });
    const whatsappRepository = createDrizzleWhatsAppRepository({ getDb, onWarning: warning });
    const weightRepository = createDrizzleWeightRepository({ getDb, onWarning: warning });
    const accountRepository = createDrizzleAccountRepository({ getDb });

    await expect(usersRepository.upsert({ openId: "local:test" }, {})).resolves.toBeUndefined();
    await expect(usersRepository.findByOpenId("local:test")).resolves.toBeUndefined();
    await expect(usersRepository.findById(1)).resolves.toBeUndefined();
    await expect(usersRepository.listRecent(10)).resolves.toBeNull();
    await expect(profileRepository.findProfileByUserId(1)).resolves.toBeUndefined();
    await expect(profileRepository.findPreferencesByUserId(1)).resolves.toEqual([]);
    await expect(profileRepository.findRestrictionsByUserId(1)).resolves.toEqual([]);
    await expect(mealsRepository.findConfirmedByUserId(1)).resolves.toBeNull();
    await expect(whatsappRepository.findAllByUserId(1)).resolves.toEqual([]);
    await expect(whatsappRepository.findAllByPhoneNumber("5511999999999")).resolves.toEqual([]);
    await expect(weightRepository.findByUserId(1)).resolves.toBeNull();
    await expect(accountRepository.purgeUserData(1)).resolves.toBeUndefined();
  });

  it("builds confirmed meals with items, media and newest-first ordering", async () => {
    const olderMeal = {
      id: 10,
      userId: 7,
      source: "web",
      mealLabel: "Almoço",
      status: "confirmed",
      occurredAt: new Date("2026-06-15T12:00:00Z"),
      notes: null,
      sourceText: null,
      transcript: null,
      confidence: 0.82,
      createdAt: new Date("2026-06-15T12:10:00Z"),
    };
    const newerMeal = {
      id: 11,
      userId: 7,
      source: "whatsapp",
      mealLabel: "Jantar",
      status: "confirmed",
      occurredAt: new Date("2026-06-16T21:00:00Z"),
      notes: "sem sobremesa",
      sourceText: "jantar",
      transcript: "audio jantar",
      confidence: 0.93,
      createdAt: new Date("2026-06-16T21:05:00Z"),
    };
    const itemRows = [
      {
        mealId: 11,
        foodName: "Arroz",
        canonicalName: "arroz",
        portionText: "100 g",
        quantity: 100,
        unit: "g",
        servings: 1,
        estimatedGrams: 100,
        calories: 130,
        protein: 2.5,
        carbs: 28,
        fat: 0.3,
        source: "catalog",
      },
      {
        mealId: 10,
        foodName: "Feijão",
        canonicalName: "feijao",
        portionText: "1 concha",
        quantity: 1,
        unit: "concha",
        servings: 1,
        estimatedGrams: 90,
        calories: 80,
        protein: 5,
        carbs: 14,
        fat: 0.5,
        source: "heuristic",
      },
    ];
    const mediaRows = [
      {
        id: 21,
        mealId: 11,
        mediaType: "image",
        storageKey: "meals/11.jpg",
        storageUrl: "https://cdn.example/meals/11.jpg",
        mimeType: "image/jpeg",
        originalFileName: null,
      },
    ];
    const db = createFakeDb({ selectResults: [[olderMeal, newerMeal], itemRows, mediaRows] });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    const result = await repository.findConfirmedByUserId(7);

    expect(result?.map(meal => meal.id)).toEqual([11, 10]);
    expect(result?.[0]).toMatchObject({
      id: 11,
      userId: 7,
      source: "whatsapp",
      mealLabel: "Jantar",
      notes: "sem sobremesa",
      sourceText: "jantar",
      transcript: "audio jantar",
      confidence: 0.93,
    });
    expect(result?.[0].items).toEqual([
      expect.objectContaining({ foodName: "Arroz", canonicalName: "arroz", confidence: 0.9 }),
    ]);
    expect(result?.[0].media).toEqual([
      {
        id: 21,
        mediaType: "image",
        storageKey: "meals/11.jpg",
        storageUrl: "https://cdn.example/meals/11.jpg",
        mimeType: "image/jpeg",
        originalFileName: undefined,
      },
    ]);
    expect(result?.[1].items).toEqual([
      expect.objectContaining({ foodName: "Feijão", canonicalName: "feijao" }),
    ]);
  });

  it("sorts weight entries newest first and normalizes date fields", async () => {
    const db = createFakeDb({
      selectResults: [[
        {
          id: 1,
          userId: 7,
          weightKg: 82,
          measuredAt: "2026-06-01T10:00:00Z",
          notes: null,
          createdAt: "2026-06-01T10:01:00Z",
          updatedAt: "2026-06-01T10:02:00Z",
        },
        {
          id: 2,
          userId: 7,
          weightKg: 81.5,
          measuredAt: "2026-06-10T10:00:00Z",
          notes: "jejum",
          createdAt: "2026-06-10T10:01:00Z",
          updatedAt: "2026-06-10T10:02:00Z",
        },
      ]],
    });
    const repository = createDrizzleWeightRepository({ getDb: async () => db, onWarning: warning });

    const result = await repository.findByUserId(7);

    expect(result?.map(entry => entry.id)).toEqual([2, 1]);
    expect(result?.[0].measuredAt).toBeInstanceOf(Date);
    expect(result?.[0].createdAt).toBeInstanceOf(Date);
    expect(result?.[0].updatedAt).toBeInstanceOf(Date);
  });

  it("keeps WhatsApp connection read shape and insert id contract", async () => {
    const rows = [
      { id: 3, userId: 7, phoneNumber: "5511999999999", displayName: "Ana", status: "active", updatedAt: new Date() },
      { id: 2, userId: 7, phoneNumber: "5511888888888", displayName: null, status: "disabled", updatedAt: new Date() },
    ];
    const db = createFakeDb({ selectResults: [rows], insertResponse: { insertId: 42 } });
    const repository = createDrizzleWhatsAppRepository({ getDb: async () => db, onWarning: warning });

    await expect(repository.findAllByUserId(7)).resolves.toBe(rows);
    await expect(repository.insert({ userId: 7, phoneNumber: "5511777777777", displayName: null })).resolves.toBe(42);
    expect(db.operations).toContainEqual(expect.objectContaining({
      op: "insert.values",
      table: whatsappConnections,
      payload: {
        userId: 7,
        phoneNumber: "5511777777777",
        displayName: null,
        status: "active",
      },
    }));
  });

  it("replaces user preferences by deleting selected keys before inserting new values", async () => {
    const db = createFakeDb();
    const repository = createDrizzleUserProfileRepository({ getDb: async () => db, onWarning: warning });

    await repository.replacePreferences(7, ["dietary_preferences", "eating_routine"], [
      { preferenceKey: "dietary_preferences", preferenceValue: "[\"vegetariano\"]" },
      { preferenceKey: "eating_routine", preferenceValue: "misto" },
    ]);

    expect(db.operations.map(operation => operation.op)).toEqual(["delete.where", "insert.values"]);
    expect(db.operations[0].table).toBe(userPreferences);
    expect(db.operations[1]).toMatchObject({
      table: userPreferences,
      payload: [
        { userId: 7, preferenceKey: "dietary_preferences", preferenceValue: "[\"vegetariano\"]" },
        { userId: 7, preferenceKey: "eating_routine", preferenceValue: "misto" },
      ],
    });
  });

  it("warns and returns empty user data when repository reads fail", async () => {
    const readError = new Error("db unavailable");
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.reject(readError)),
          })),
        })),
      })),
    };
    const onWarning = vi.fn();
    const repository = createDrizzleUsersRepository({ getDb: async () => db, onWarning });

    await expect(repository.findByOpenId("local:missing")).resolves.toBeUndefined();
    expect(onWarning).toHaveBeenCalledWith("User read by openId skipped", readError);
  });

  it("purges account data in a child-first sequence and anonymizes user-owned references", async () => {
    const db = createFakeDb();
    const repository = createDrizzleAccountRepository({ getDb: async () => db });

    await repository.purgeUserData(7);

    const mutationOperations = db.operations.filter(operation => operation.op !== "select");
    expect(mutationOperations.map(operation => operation.table)).toEqual([
      mealItems,
      mealMedia,
      mealInferences,
      inferenceLogs,
      foodFavorites,
      mealFavorites,
      habitMemories,
      dailySummaries,
      exercises,
      waterLogs,
      waterGoals,
      weightEntries,
      userPreferences,
      userRestrictions,
      userBadges,
      userGamificationSettings,
      whatsappConnections,
      foodCatalog,
      appSecrets,
      userProfiles,
      meals,
      users,
    ]);
    expect(mutationOperations.filter(operation => operation.op === "update.set")).toEqual([
      expect.objectContaining({ table: foodCatalog, payload: { createdByUserId: null } }),
      expect.objectContaining({ table: appSecrets, payload: { updatedByUserId: null } }),
    ]);
  });
});
