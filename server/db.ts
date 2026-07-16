import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, NutritionGoal, User, WeightEntry } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { addMealTotals, calculateDayTotals, calculateMealTotals, roundNutritionValue } from "../shared/mealTotals";
import { buildWeeklyNutritionStatus } from "../shared/safeMessages";
import { calculateAdjustedGoalCalories } from "../shared/reportsGoalAnalytics";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone, getUtcRangeForInclusiveLocalDateRange, getUtcRangeForLocalDate, getWeekDateKeys } from "../shared/timeZone";
import { HabitSnapshot, MealDraftItem, MealProcessingResult } from "./nutritionEngine";
import { createDrizzleAccountRepository } from "./repositories/accountRepository";
import { createDrizzleAppSecretsRepository } from "./repositories/appSecretsRepository";
import { createDrizzleExercisesRepository } from "./repositories/exercisesRepository";
import { createDrizzleFoodCatalogRepository } from "./repositories/foodCatalogRepository";
import { createDrizzleGamificationRepository } from "./repositories/gamificationRepository";
import { createDrizzleHabitsRepository } from "./repositories/habitsRepository";
import { createDrizzleLogsRepository } from "./repositories/logsRepository";
import { createDrizzleMealsRepository } from "./repositories/mealsRepository";
import { canUseMemoryPersistenceFallback } from "./repositories/memoryFallback";
import { createDrizzleNutritionGoalsRepository } from "./repositories/nutritionGoalsRepository";
import { createDrizzleUserProfileRepository } from "./repositories/userProfileRepository";
import { createDrizzleUsersRepository } from "./repositories/usersRepository";
import { createDrizzleWaterRepository } from "./repositories/waterRepository";
import { createDrizzleWeightRepository } from "./repositories/weightRepository";
import { createDrizzleWhatsAppRepository } from "./repositories/whatsappRepository";
import { createFoodsService, normalizeCatalogText, type FoodSearchItem, type FoodUpsertInput } from "./modules/foods/catalog";
import { createUsersService } from "./modules/users/service";
import { createExercisesService, sumExercises } from "./modules/exercises/store";
import { createGamificationService, BADGE_DEFINITIONS } from "./modules/gamification/store";
import { createGoalsService, type GoalInput } from "./modules/goals/store";
import { createPrivacyService } from "./modules/privacy/service";
import { createWaterService, sumWater } from "./modules/water/store";
import { decryptAppSecretValue as decryptAppSecretPayload, encryptAppSecretValue as encryptAppSecretPayload } from "./modules/appSecrets/encryption";
import { safeLogDetail } from "./privacy";

export { BADGE_DEFINITIONS };

let _db: ReturnType<typeof drizzle> | null = null;
const WHATSAPP_ACCESS_TOKEN_SECRET_KEY = "whatsapp_access_token";
const whatsappConnectionStore: Array<{
  id: number;
  userId: number;
  phoneNumber: string;
  displayName: string | null;
  status: "pending" | "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}> = [];
let whatsappConnectionSequence = 1;
let memoryWhatsAppAccessToken: {
  value: string;
  updatedAt: Date;
  updatedByUserId: number;
} | null = null;

export type AdminWhatsAppTokenStatus = {
  configured: boolean;
  source: "database" | "environment" | "missing";
  maskedValue: string | null;
  updatedAt: number | null;
  updatedByUserId: number | null;
};

function maskSecret(value: string) {
  if (value.length <= 10) {
    return "•".repeat(value.length);
  }

  return `${value.slice(0, 6)}${"•".repeat(Math.max(8, value.length - 10))}${value.slice(-4)}`;
}

let warnedAboutLegacyAppSecretsKey = false;

function getAppSecretCipherKeyDeps() {
  return {
    dedicatedKey: ENV.appSecretsEncryptionKey,
    getLegacyKey: () => ENV.cookieSecret,
  };
}

function encryptAppSecretValue(value: string) {
  const deps = getAppSecretCipherKeyDeps();
  const { payload, keySource } = encryptAppSecretPayload(value, deps);

  if (keySource === "legacy" && !warnedAboutLegacyAppSecretsKey) {
    warnedAboutLegacyAppSecretsKey = true;
    console.warn(
      "[Database] APP_SECRETS_ENCRYPTION_KEY not configured; encrypting persisted secret with a key derived from JWT_SECRET (legacy fallback). Configure APP_SECRETS_ENCRYPTION_KEY to decouple session and secrets encryption."
    );
  }

  return payload;
}

function decryptAppSecretValue(payload: string) {
  return decryptAppSecretPayload(payload, getAppSecretCipherKeyDeps());
}

async function getAppSecret(secretKey: string) {
  return appSecretsRepository.findBySecretKey(secretKey);
}

export async function getWhatsAppAccessToken() {
  const stored = await getAppSecret(WHATSAPP_ACCESS_TOKEN_SECRET_KEY);
  if (stored) {
    try {
      return decryptAppSecretValue(stored.valueEncrypted);
    } catch (error) {
      console.warn("[Database] Failed to decrypt WhatsApp access token, falling back to environment:", error);
    }
  }

  if (memoryWhatsAppAccessToken?.value) {
    return memoryWhatsAppAccessToken.value;
  }

  return process.env.WHATSAPP_ACCESS_TOKEN ?? null;
}

export async function getAdminWhatsAppTokenStatus(): Promise<AdminWhatsAppTokenStatus> {
  const stored = await getAppSecret(WHATSAPP_ACCESS_TOKEN_SECRET_KEY);
  if (stored) {
    try {
      const decrypted = decryptAppSecretValue(stored.valueEncrypted);
      return {
        configured: true,
        source: "database",
        maskedValue: maskSecret(decrypted),
        updatedAt: stored.updatedAt ? stored.updatedAt.getTime() : null,
        updatedByUserId: stored.updatedByUserId ?? null,
      };
    } catch (error) {
      console.warn("[Database] Failed to decrypt admin WhatsApp token status:", error);
    }
  }

  if (memoryWhatsAppAccessToken) {
    return {
      configured: true,
      source: "database",
      maskedValue: maskSecret(memoryWhatsAppAccessToken.value),
      updatedAt: memoryWhatsAppAccessToken.updatedAt.getTime(),
      updatedByUserId: memoryWhatsAppAccessToken.updatedByUserId,
    };
  }

  const envValue = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (envValue) {
    return {
      configured: true,
      source: "environment",
      maskedValue: maskSecret(envValue),
      updatedAt: null,
      updatedByUserId: null,
    };
  }

  return {
    configured: false,
    source: "missing",
    maskedValue: null,
    updatedAt: null,
    updatedByUserId: null,
  };
}

export async function upsertAdminWhatsAppAccessToken(input: { value: string; updatedByUserId: number }) {
  const normalizedValue = input.value.trim();
  if (normalizedValue.length < 20) {
    throw new Error("Informe um token de acesso do WhatsApp válido.");
  }

  const db = await getDb();
  if (!db) {
    memoryWhatsAppAccessToken = {
      value: normalizedValue,
      updatedAt: new Date(),
      updatedByUserId: input.updatedByUserId,
    };
    process.env.WHATSAPP_ACCESS_TOKEN = normalizedValue;
    return getAdminWhatsAppTokenStatus();
  }

  const encryptedValue = encryptAppSecretValue(normalizedValue);
  await appSecretsRepository.upsert(WHATSAPP_ACCESS_TOKEN_SECRET_KEY, encryptedValue, input.updatedByUserId);

  process.env.WHATSAPP_ACCESS_TOKEN = normalizedValue;
  return getAdminWhatsAppTokenStatus();
}

function envFlagEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.toLowerCase() ?? "");
}

function envFlagDisabled(value: string | undefined) {
  return ["0", "false", "no", "off"].includes(value?.toLowerCase() ?? "");
}

function shouldEnableRuntimeDatabaseSsl(connectionString: string) {
  const explicitValue = process.env.TIDB_ENABLE_SSL;
  if (envFlagEnabled(explicitValue)) return true;
  if (envFlagDisabled(explicitValue)) return false;

  return connectionString.includes("tidbcloud.com");
}

function getRuntimeDatabaseConnectionLimit() {
  const configured = Number(process.env.DATABASE_CONNECTION_LIMIT ?? "10");
  return Number.isFinite(configured) && configured > 0 ? configured : 10;
}

function createRuntimeDatabaseClient(connectionString: string): string | Pool {
  if (!shouldEnableRuntimeDatabaseSsl(connectionString)) {
    return connectionString;
  }

  return createPool({
    uri: connectionString,
    waitForConnections: true,
    connectionLimit: getRuntimeDatabaseConnectionLimit(),
    ssl: {
      minVersion: "TLSv1.2",
    },
  });
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const client = createRuntimeDatabaseClient(process.env.DATABASE_URL);
        _db = (typeof client === "string" ? drizzle(client) : drizzle(client)) as unknown as typeof _db;
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export function normalizeWhatsAppPhoneNumber(phoneNumber: string) {
  return phoneNumber.replace(/\D/g, "");
}

export async function getUserWhatsappConnection(userId: number) {
  const db = await getDb();
  if (!db) {
    const rows = whatsappConnectionStore
      .filter(row => row.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return rows.find(row => row.status === "active") ?? rows[0] ?? null;
  }

  const rows = await whatsappRepository.findAllByUserId(userId);
  const active = rows.find(row => row.status === "active") ?? rows[0];
  return active ?? null;
}

export async function getUserIdByWhatsappPhone(phoneNumber: string) {
  const normalizedPhoneNumber = normalizeWhatsAppPhoneNumber(phoneNumber);
  if (!normalizedPhoneNumber) {
    return null;
  }

  const db = await getDb();
  if (!db) {
    return whatsappConnectionStore.find(row => row.phoneNumber === normalizedPhoneNumber && row.status === "active")?.userId ?? null;
  }

  const rows = await whatsappRepository.findAllByPhoneNumber(normalizedPhoneNumber);
  return rows.find(row => row.status === "active")?.userId ?? null;
}

export async function upsertUserWhatsappConnection(input: {
  userId: number;
  phoneNumber: string;
  displayName?: string;
}) {
  const normalizedPhoneNumber = normalizeWhatsAppPhoneNumber(input.phoneNumber);
  if (normalizedPhoneNumber.length < 10 || normalizedPhoneNumber.length > 16) {
    throw new Error("Informe um número de WhatsApp válido com DDD e código do país quando necessário.");
  }

  const normalizedDisplayName = input.displayName?.trim() ? input.displayName.trim() : null;
  const db = await getDb();
  if (!db) {
    const activeConflict = whatsappConnectionStore.find(row => row.phoneNumber === normalizedPhoneNumber && row.userId !== input.userId && row.status !== "disabled");
    if (activeConflict) {
      throw new Error("Este telefone de origem já está vinculado a outro usuário.");
    }

    const now = new Date();
    const userRows = whatsappConnectionStore
      .filter(row => row.userId === input.userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const existing = userRows[0];

    if (existing) {
      existing.phoneNumber = normalizedPhoneNumber;
      existing.displayName = normalizedDisplayName;
      existing.status = "active";
      existing.updatedAt = now;
    } else {
      whatsappConnectionStore.push({
        id: whatsappConnectionSequence++,
        userId: input.userId,
        phoneNumber: normalizedPhoneNumber,
        displayName: normalizedDisplayName,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const row of userRows.slice(1)) {
      row.status = "disabled";
      row.updatedAt = now;
    }

    const saved = await getUserWhatsappConnection(input.userId);
    if (!saved) {
      throw new Error("Não foi possível recuperar o contato do WhatsApp após o salvamento.");
    }

    return saved;
  }

  const conflictingRows = await whatsappRepository.findAllByPhoneNumber(normalizedPhoneNumber);

  const activeConflict = conflictingRows.find(row => row.userId !== input.userId && row.status !== "disabled");
  if (activeConflict) {
    throw new Error("Este telefone de origem já está vinculado a outro usuário.");
  }

  const userRows = await whatsappRepository.findAllByUserId(input.userId);

  let connectionId = userRows[0]?.id;

  if (connectionId) {
    await whatsappRepository.update(connectionId, {
      phoneNumber: normalizedPhoneNumber,
      displayName: normalizedDisplayName,
      status: "active",
    });
  } else {
    connectionId = await whatsappRepository.insert({
      userId: input.userId,
      phoneNumber: normalizedPhoneNumber,
      displayName: normalizedDisplayName,
    });
  }

  for (const row of userRows.slice(1)) {
    await whatsappRepository.disable(row.id);
  }

  const saved = await getUserWhatsappConnection(input.userId);
  if (!saved) {
    throw new Error("Não foi possível recuperar o contato do WhatsApp após o salvamento.");
  }

  return saved;
}

type SavedMedia = {
  id: number;
  mediaType: "image" | "audio";
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  originalFileName?: string;
};

type PendingInference = {
  draftId: string;
  userId: number;
  source: "web" | "whatsapp";
  processed: MealProcessingResult;
  media: SavedMedia[];
  createdAt: number;
};

type SavedMeal = {
  id: number;
  userId: number;
  source: "web" | "whatsapp";
  mealLabel: string;
  status: "confirmed";
  occurredAt: number;
  notes?: string;
  sourceText: string;
  transcript?: string;
  confidence: number;
  items: MealDraftItem[];
  media: SavedMedia[];
  createdAt: number;
};

type FavoriteMeal = {
  id: number;
  userId: number;
  name: string;
  mealLabel: string;
  notes?: string;
  items: MealDraftItem[];
  createdAt: number;
};

type HabitMemoryState = {
  foodName: string;
  typicalMealLabel?: string | null;
  preferredPortionGrams: number;
  notes?: string | null;
  occurrenceCount: number;
  lastSeenAt: number;
};

type AdminLogEntry = {
  id: string;
  userId?: number | null;
  origin: "web" | "whatsapp" | "admin";
  status: "success" | "warning" | "error";
  eventType: string;
  detail: string;
  createdAt: number;
};

const mealStore = new Map<number, SavedMeal[]>();
const habitStore = new Map<number, HabitMemoryState[]>();
const favoriteMealStore = new Map<number, FavoriteMeal[]>();
const inferenceStore = new Map<string, PendingInference>();
const adminLogStore: AdminLogEntry[] = [];
let mealIdSequence = 1;
let mediaIdSequence = 1;
let favoriteMealIdSequence = 1;

function dateKey(date: Date, timeZone = DEFAULT_APP_TIME_ZONE) {
  return getDateKeyInTimeZone(date, timeZone);
}

function sumMealItems(items: MealDraftItem[]) {
  return calculateMealTotals(items);
}

function sumMeals(meals: Array<{ items: MealDraftItem[] }>) {
  return calculateDayTotals(meals);
}

type QualityIndicators = {
  proteinGrams: number;
  fiberGrams: number;
  waterMl: number;
  fruitServings: number;
  vegetableServings: number;
  ultraProcessedServings: number;
  mealCount: number;
  regularityScore: number;
};

function emptyQualityIndicators(waterMl = 0): QualityIndicators {
  return {
    proteinGrams: 0,
    fiberGrams: 0,
    waterMl: round(waterMl),
    fruitServings: 0,
    vegetableServings: 0,
    ultraProcessedServings: 0,
    mealCount: 0,
    regularityScore: 0,
  };
}

function calculateRegularityScore(meals: SavedMeal[]) {
  if (!meals.length) return 0;
  const labels = new Set(meals.map(meal => normalizeCatalogText(meal.mealLabel)));
  const hasMainMeal = ["cafe da manha", "almoco", "jantar"].filter(label => labels.has(label)).length;
  return Math.min(Math.round(((Math.min(meals.length, 4) / 4) * 60) + ((hasMainMeal / 3) * 40)), 100);
}

async function calculateQualityIndicators(userId: number, meals: SavedMeal[], waterMl = 0): Promise<QualityIndicators> {
  if (!meals.length) {
    return emptyQualityIndicators(waterMl);
  }

  const foods = await searchFoods(userId, "", 500);
  const foodsByName = new Map<string, FoodSearchItem>();
  for (const food of foods) {
    foodsByName.set(normalizeCatalogText(food.name), food);
  }

  const quality = meals.reduce(
    (acc, meal) => {
      for (const item of meal.items) {
        acc.proteinGrams += Number(item.protein || 0);
        const food = foodsByName.get(normalizeCatalogText(item.canonicalName)) ?? foodsByName.get(normalizeCatalogText(item.foodName));
        if (!food) continue;

        const servingFactor = food.servingSize > 0 && item.estimatedGrams > 0 ? item.estimatedGrams / food.servingSize : item.servings || 1;
        acc.fiberGrams += Number(food.fiber || 0) * servingFactor;
        if (food.isFruit) acc.fruitServings += servingFactor;
        if (food.isVegetable) acc.vegetableServings += servingFactor;
        if (food.isUltraProcessed) acc.ultraProcessedServings += servingFactor;
      }
      return acc;
    },
    emptyQualityIndicators(waterMl),
  );

  quality.mealCount = meals.length;
  quality.regularityScore = calculateRegularityScore(meals);
  return {
    proteinGrams: round(quality.proteinGrams),
    fiberGrams: round(quality.fiberGrams),
    waterMl: round(waterMl),
    fruitServings: round(quality.fruitServings),
    vegetableServings: round(quality.vegetableServings),
    ultraProcessedServings: round(quality.ultraProcessedServings),
    mealCount: quality.mealCount,
    regularityScore: quality.regularityScore,
  };
}

const round = roundNutritionValue;

function isMissingTableError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "ER_NO_SUCH_TABLE" || causeCode === "ER_NO_SUCH_TABLE";
}

export function logPersistenceWarning(scope: string, error: unknown) {
  if (isMissingTableError(error)) {
    return;
  }
  console.warn(`[Database] ${scope}:`, safeLogDetail(error));
}

const nutritionGoalsRepository = createDrizzleNutritionGoalsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const goalsService = createGoalsService({
  nutritionGoalsRepository,
  onEvent: logInferenceEvent,
});
const getStoredNutritionGoals = goalsService.getStoredNutritionGoals;
export const getUserNutritionGoal = goalsService.getUserNutritionGoal;
export const upsertNutritionGoal = goalsService.upsertNutritionGoal;
const exercisesRepository = createDrizzleExercisesRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const waterRepository = createDrizzleWaterRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const appSecretsRepository = createDrizzleAppSecretsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const usersRepository = createDrizzleUsersRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const userProfileRepository = createDrizzleUserProfileRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const weightRepository = createDrizzleWeightRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const usersService = createUsersService({
  usersRepository,
  userProfileRepository,
  weightRepository,
  getDb,
  onWarning: logPersistenceWarning,
});
export const upsertUser = usersService.upsertUser;
export const getUserByOpenId = usersService.getUserByOpenId;
export const saveUserOnboardingProfile = usersService.saveUserOnboardingProfile;
export const updateUserCurrentWeight = usersService.updateUserCurrentWeight;
export const getFoodAssistantProfile = usersService.getFoodAssistantProfile;
const exercisesService = createExercisesService({
  exercisesRepository,
  buildOccurredAtRange,
  onEvent: logInferenceEvent,
});
export const listUserExercises = exercisesService.listExercises;
export const listUserExercisesByDate = exercisesService.listExercisesByDate;
export const listUserExercisesInRange = exercisesService.listExercisesInRange;
export const createUserExercise = exercisesService.createExercise;
export const updateUserExercise = exercisesService.updateExercise;
export const removeUserExercise = exercisesService.removeExercise;
const waterService = createWaterService({
  waterRepository,
  buildOccurredAtRange,
  onEvent: logInferenceEvent,
});
export const getUserWaterGoal = waterService.getWaterGoal;
export const listUserWaterLogs = waterService.listWaterLogs;
export const listUserWaterLogsByDate = waterService.listWaterLogsByDate;
export const listUserWaterLogsInRange = waterService.listWaterLogsInRange;
export const updateUserWaterGoal = waterService.updateWaterGoal;
export const createUserWaterLog = waterService.createWaterLog;
export const removeUserWaterLog = waterService.removeWaterLog;
const whatsappRepository = createDrizzleWhatsAppRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const gamificationRepository = createDrizzleGamificationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const gamificationService = createGamificationService({
  gamificationRepository,
  getDb,
  getWeekStart: timeZone => getWeekDateKeys(new Date(), timeZone)[0],
  getWeeklySummary,
  listFavoriteMeals,
  listUserMeals,
  parseJsonObject,
  onWarning: logPersistenceWarning,
});
export const getUserGamification = gamificationService.getUserGamification;
export const updateUserGamificationSettings = gamificationService.updateUserGamificationSettings;
const foodCatalogRepository = createDrizzleFoodCatalogRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const mealsRepository = createDrizzleMealsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const habitsRepository = createDrizzleHabitsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const logsRepository = createDrizzleLogsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const accountRepository = createDrizzleAccountRepository({ getDb });

const foodsService = createFoodsService({
  foodCatalogRepository,
  findMealItemsWithDates: userId => mealsRepository.findItemsWithMealDates(userId),
  getUserMealsMemory: userId => mealStore.get(userId) ?? [],
  getDb,
  onWarning: logPersistenceWarning,
});
export const searchFoods = foodsService.searchFoods;
export const getFoodsByIds = foodsService.getFoodsByIds;
export const listRecentFoods = foodsService.listRecentFoods;
export const upsertFavoriteFood = foodsService.upsertFavoriteFood;
export const createUserFood = foodsService.createUserFood;
export const updateUserFood = foodsService.updateUserFood;
const resolveFoodCatalogIds = foodsService.resolveFoodCatalogIds;
export type { FoodSearchItem, FoodUpsertInput } from "./modules/foods/catalog";

function parseJsonArray<T>(value: string | null | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonObject(value: string | null | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : fallback;
  } catch {
    return fallback;
  }
}

async function persistInferenceToDb(draft: PendingInference) {
  await mealsRepository.insertInference({
    draftId: draft.draftId,
    userId: draft.userId,
    source: draft.source,
    sourceText: draft.processed.sourceText,
    transcript: draft.processed.transcript,
    media: draft.media,
    reasoning: draft.processed.reasoning,
    confidence: draft.processed.confidence,
    items: draft.processed.items,
    totals: draft.processed.totals,
  });
}

async function persistMealToDb(meal: SavedMeal) {
  const db = await getDb();
  if (!db) return;

  try {
    const resolvedCatalogIds = meal.items.length
      ? await resolveFoodCatalogIds(meal.items, meal.userId)
      : new Map<string, number>();

    const insertedMealId = await mealsRepository.persistMeal({
      meal: {
        userId: meal.userId,
        source: meal.source,
        mealLabel: meal.mealLabel,
        notes: meal.notes,
        sourceText: meal.sourceText,
        transcript: meal.transcript,
        confidence: meal.confidence,
        occurredAt: meal.occurredAt,
      },
      items: meal.items,
      media: meal.media,
      resolvedCatalogIds,
    });

    meal.id = insertedMealId || meal.id;
  } catch (error) {
    logPersistenceWarning("Meal persistence skipped", error);
  }
}

async function updateMealInDb(meal: SavedMeal) {
  const db = await getDb();
  if (!db) return;

  try {
    const resolvedCatalogIds = meal.items.length ? await resolveFoodCatalogIds(meal.items, meal.userId) : new Map<string, number>();

    await mealsRepository.persistMealUpdate({
      meal: {
        id: meal.id,
        userId: meal.userId,
        mealLabel: meal.mealLabel,
        notes: meal.notes,
        confidence: meal.confidence,
        occurredAt: meal.occurredAt,
      },
      items: meal.items,
      resolvedCatalogIds,
    });
  } catch (error) {
    logPersistenceWarning("Meal update skipped", error);
  }
}

async function deleteMealFromDb(userId: number, mealId: number) {
  const db = await getDb();
  if (!db) return;

  try {
    await mealsRepository.deleteMeal(userId, mealId);
  } catch (error) {
    logPersistenceWarning("Meal deletion skipped", error);
  }
}

async function persistHabitsToDb(userId: number, habits: HabitMemoryState[]) {
  await habitsRepository.insertMany(userId, habits);
}

async function persistLogToDb(entry: AdminLogEntry) {
  await logsRepository.insert({
    userId: entry.userId,
    origin: entry.origin,
    status: entry.status,
    eventType: entry.eventType,
    detail: safeLogDetail(entry.detail),
  });
}

type OccurredAtRange = {
  startAt?: Date;
  endAt?: Date;
};

type MealLoadOptions = OccurredAtRange & {
  includeMedia?: boolean;
};

function buildOccurredAtRange(date: string, timeZone = DEFAULT_APP_TIME_ZONE): Required<OccurredAtRange> {
  return getUtcRangeForLocalDate(date, timeZone);
}

async function loadMealsFromDb(userId: number, options: MealLoadOptions = {}) {
  const dbMeals = await mealsRepository.findConfirmedByUserId(userId, options);
  return dbMeals as SavedMeal[] | null;
}

async function loadWeightEntriesFromDb(userId: number) {
  return weightRepository.findByUserId(userId);
}

async function loadHabitsFromDb(userId: number) {
  const rows = await habitsRepository.findRawByUserId(userId);
  if (!rows) return null;
  if (!rows.length) return [];

  const aggregate = new Map<string, HabitMemoryState>();
  for (const row of rows) {
    const current = aggregate.get(row.foodName);
    const lastSeenAt = new Date(row.lastSeenAt).getTime();
    if (!current) {
      aggregate.set(row.foodName, {
        foodName: row.foodName,
        typicalMealLabel: row.typicalMealLabel ?? undefined,
        preferredPortionGrams: row.preferredPortionGrams,
        notes: row.notes ?? undefined,
        occurrenceCount: row.occurrenceCount,
        lastSeenAt,
      });
      continue;
    }

    aggregate.set(row.foodName, {
      foodName: row.foodName,
      typicalMealLabel: lastSeenAt >= current.lastSeenAt ? row.typicalMealLabel ?? current.typicalMealLabel : current.typicalMealLabel,
      preferredPortionGrams: lastSeenAt >= current.lastSeenAt ? row.preferredPortionGrams : current.preferredPortionGrams,
      notes: lastSeenAt >= current.lastSeenAt ? row.notes ?? current.notes : current.notes,
      occurrenceCount: current.occurrenceCount + row.occurrenceCount,
      lastSeenAt: Math.max(current.lastSeenAt, lastSeenAt),
    });
  }

  return Array.from(aggregate.values()).sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.lastSeenAt - a.lastSeenAt);
}

async function loadRecentLogsFromDb() {
  const rows = await logsRepository.findRecent(20);
  if (!rows) return null;

  return rows.map(row => ({
    id: String(row.id),
    userId: row.userId ?? undefined,
    origin: row.origin,
    status: row.status,
    eventType: row.eventType,
    detail: row.detail,
    createdAt: new Date(row.createdAt).getTime(),
  } satisfies AdminLogEntry));
}

export async function getHabitSnapshots(userId: number): Promise<HabitSnapshot[]> {
  const dbHabits = await loadHabitsFromDb(userId);
  const habits = dbHabits ?? habitStore.get(userId) ?? [];
  if (dbHabits) {
    habitStore.set(userId, dbHabits);
  }

  return habits
    .slice()
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .slice(0, 8)
    .map(item => ({
      foodName: item.foodName,
      typicalTimeLabel: item.typicalMealLabel,
      notes: item.notes,
      occurrenceCount: item.occurrenceCount,
    }));
}

export function createPendingMealInference(userId: number, source: "web" | "whatsapp", processed: MealProcessingResult, media: SavedMedia[] = []) {
  const draftId = crypto.randomUUID();
  const draft: PendingInference = {
    draftId,
    userId,
    source,
    processed,
    media,
    createdAt: Date.now(),
  };
  inferenceStore.set(draftId, draft);
  void persistInferenceToDb(draft);
  logInferenceEvent({
    userId,
    origin: source,
    status: processed.confidence >= 0.6 ? "success" : "warning",
    eventType: "meal.inference_created",
    detail: `Inferência criada para ${processed.detectedMealLabel} com ${processed.items.length} itens.`,
  });
  return draft;
}

export function getPendingInference(draftId: string) {
  return inferenceStore.get(draftId);
}

export async function getPendingInferenceFromDb(draftId: string) {
  const db = await getDb();
  if (!db) return undefined;

  try {
    const row = await mealsRepository.findInferenceByDraftId(draftId);
    if (!row) return undefined;

    const requestText = row.sourceText ?? row.requestSummary ?? "";
    const items = parseJsonArray<MealDraftItem>(row.itemsJson, []);
    const rawTotals = row.totalsJson ? JSON.parse(row.totalsJson) as Record<string, number> : {};
    const mealLabel = requestText.split(/[,.!?\n]/)[0]?.trim() || items[0]?.foodName || "Refeição";

    return {
      draftId: row.draftId,
      userId: row.userId,
      source: row.source,
      processed: {
        sourceText: requestText,
        transcript: row.transcript ?? undefined,
        reasoning: row.reasoning ?? "",
        confidence: row.confidence,
        detectedMealLabel: mealLabel,
        needsConfirmation: true,
        items,
        totals: {
          calories: Number(rawTotals.calories ?? 0),
          protein: Number(rawTotals.protein ?? 0),
          carbs: Number(rawTotals.carbs ?? 0),
          fat: Number(rawTotals.fat ?? 0),
        },
      },
      media: parseJsonArray<SavedMedia>(row.mediaJson, []),
      createdAt: new Date(row.createdAt).getTime(),
    } satisfies PendingInference;
  } catch (error) {
    logPersistenceWarning("Pending inference rehydration skipped", error);
    return undefined;
  }
}

async function updateHabitsFromMeal(meal: SavedMeal) {
  const existing = (await loadHabitsFromDb(meal.userId)) ?? habitStore.get(meal.userId) ?? [];
  const next = [...existing];

  for (const item of meal.items) {
    const matchIndex = next.findIndex(habit => habit.foodName === item.canonicalName);
    if (matchIndex >= 0) {
      next[matchIndex] = {
        ...next[matchIndex],
        typicalMealLabel: meal.mealLabel,
        preferredPortionGrams: item.estimatedGrams,
        notes: `Última porção confirmada: ${item.portionText}`,
        occurrenceCount: next[matchIndex].occurrenceCount + 1,
        lastSeenAt: meal.occurredAt,
      };
    } else {
      next.push({
        foodName: item.canonicalName,
        typicalMealLabel: meal.mealLabel,
        preferredPortionGrams: item.estimatedGrams,
        notes: `Última porção confirmada: ${item.portionText}`,
        occurrenceCount: 1,
        lastSeenAt: meal.occurredAt,
      });
    }
  }

  const ordered = next.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  habitStore.set(meal.userId, ordered);
  await persistHabitsToDb(meal.userId, ordered);
}

/** Rebuilds derived habits idempotently after a compensable meal batch. */
export async function rebuildUserMealHabits(userId: number) {
  const meals = await listUserMeals(userId);
  const byFoodName = new Map<string, HabitMemoryState>();

  for (const meal of meals) {
    for (const item of meal.items) {
      const foodName = item.canonicalName?.trim() || item.foodName?.trim();
      if (!foodName) continue;
      const existing = byFoodName.get(foodName);
      const isLatest = !existing || meal.occurredAt >= existing.lastSeenAt;
      byFoodName.set(foodName, {
        foodName,
        typicalMealLabel: isLatest ? meal.mealLabel : existing?.typicalMealLabel,
        preferredPortionGrams: isLatest ? item.estimatedGrams : existing?.preferredPortionGrams ?? item.estimatedGrams,
        notes: isLatest ? `Última porção confirmada: ${item.portionText}` : existing?.notes,
        occurrenceCount: (existing?.occurrenceCount ?? 0) + 1,
        lastSeenAt: isLatest ? meal.occurredAt : existing!.lastSeenAt,
      });
    }
  }

  const rebuilt = [...byFoodName.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  await persistHabitsToDb(userId, rebuilt);
  habitStore.set(userId, rebuilt);
  return rebuilt;
}

async function syncHabitsMealLabelFromMeals(userId: number, mealsToSync: SavedMeal[]) {
  if (!mealsToSync.length) {
    return;
  }

  const existing = (await loadHabitsFromDb(userId)) ?? habitStore.get(userId) ?? [];
  const next = [...existing];

  for (const meal of mealsToSync) {
    for (const item of meal.items) {
      const matchIndex = next.findIndex(habit => habit.foodName === item.canonicalName);
      if (matchIndex < 0) {
        continue;
      }

      next[matchIndex] = {
        ...next[matchIndex],
        typicalMealLabel: meal.mealLabel,
        preferredPortionGrams: item.estimatedGrams,
        notes: `Última porção confirmada: ${item.portionText}`,
        lastSeenAt: Math.max(next[matchIndex].lastSeenAt, meal.occurredAt),
      };
    }
  }

  const ordered = next.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  habitStore.set(userId, ordered);
  await persistHabitsToDb(userId, ordered);
}

export async function confirmPendingMeal(input: {
  draftId: string;
  userId: number;
  mealLabel: string;
  occurredAt: string;
  notes?: string;
  items: MealDraftItem[];
}) {
  const pending = inferenceStore.get(input.draftId);
  if (!pending || pending.userId !== input.userId) {
    throw new Error("Rascunho de inferência não encontrado.");
  }

  const savedMeal: SavedMeal = {
    id: mealIdSequence++,
    userId: input.userId,
    source: pending.source,
    mealLabel: input.mealLabel,
    status: "confirmed",
    occurredAt: new Date(input.occurredAt).getTime(),
    notes: input.notes,
    sourceText: pending.processed.sourceText,
    transcript: pending.processed.transcript,
    confidence: pending.processed.confidence,
    items: input.items,
    media: pending.media,
    createdAt: Date.now(),
  };

  const mealsForUser = (await loadMealsFromDb(input.userId)) ?? mealStore.get(input.userId) ?? [];
  mealStore.set(input.userId, [savedMeal, ...mealsForUser.filter(meal => meal.id !== savedMeal.id)]);
  inferenceStore.delete(input.draftId);
  await persistMealToDb(savedMeal);
  await updateHabitsFromMeal(savedMeal);

  // Aprendizado silencioso de aliases pessoais: se o texto original difere do
  // nome canônico, registra o mapeamento para uso futuro sem intervenção do usuário.
  if (savedMeal.sourceText && savedMeal.source === "whatsapp") {
    const { learnPersonalFoodAlias } = await import("./modules/whatsapp/personalFoodAliasStore");
    for (const item of savedMeal.items) {
      learnPersonalFoodAlias({
        userId: savedMeal.userId,
        aliasText: savedMeal.sourceText,
        canonicalName: item.canonicalName,
        canonicalSlug: item.source === "catalog" ? item.canonicalName : undefined,
      });
    }
  }

  logInferenceEvent({
    userId: input.userId,
    origin: pending.source,
    status: "success",
    eventType: "meal.confirmed",
    detail: `Refeição ${savedMeal.mealLabel} confirmada e salva com ${savedMeal.items.length} itens.`,
  });
  return savedMeal;
}

export async function listUserMeals(userId: number) {
  const dbMeals = await loadMealsFromDb(userId);
  const mealsForUser = dbMeals ?? mealStore.get(userId) ?? [];
  if (dbMeals) {
    mealStore.set(userId, dbMeals);
  }

  return mealsForUser
    .slice()
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .map(meal => ({
      ...meal,
      totals: sumMealItems(meal.items),
    }));
}

export async function listUserMealsByDate(
  userId: number,
  date: string,
  options: { includeMedia?: boolean; timeZone?: string } = {},
) {
  const timeZone = options.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const range = buildOccurredAtRange(date, timeZone);
  const dbMeals = await loadMealsFromDb(userId, { ...range, includeMedia: options.includeMedia });
  const mealsForUser = dbMeals ?? mealStore.get(userId) ?? [];

  return mealsForUser
    .filter(meal => getDateKeyInTimeZone(meal.occurredAt, timeZone) === date)
    .slice()
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .map(meal => ({
      ...meal,
      totals: sumMealItems(meal.items),
    }));
}

export async function listUserMealsInRange(
  userId: number,
  startDate: string,
  endDate: string,
  options: { includeMedia?: boolean; timeZone?: string } = {},
) {
  const timeZone = options.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const { startAt, endAt } = getUtcRangeForInclusiveLocalDateRange(startDate, endDate, timeZone);

  const dbMeals = await loadMealsFromDb(userId, { startAt, endAt, includeMedia: options.includeMedia });
  const mealsForUser = dbMeals ?? mealStore.get(userId) ?? [];

  return mealsForUser
    .filter(meal => {
      const key = getDateKeyInTimeZone(meal.occurredAt, timeZone);
      return key >= startDate && key <= endDate;
    })
    .slice()
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .map(meal => ({
      ...meal,
      totals: sumMealItems(meal.items),
    }));
}

export async function getUserDayMealTotals(userId: number, date: string, timeZone = DEFAULT_APP_TIME_ZONE) {
  const key = date || dateKey(new Date(), timeZone);
  const mealsOnDay = await listUserMealsByDate(userId, key, { timeZone });
  return {
    date: key,
    meals: mealsOnDay,
    totals: calculateDayTotals(mealsOnDay),
  };
}

export async function createUserManualMeal(input: {
  userId: number;
  mealLabel: string;
  occurredAt: string;
  notes?: string;
  items: MealDraftItem[];
}) {
  const savedMeal: SavedMeal = {
    id: mealIdSequence++,
    userId: input.userId,
    source: "web",
    mealLabel: input.mealLabel,
    status: "confirmed",
    occurredAt: new Date(input.occurredAt).getTime(),
    notes: input.notes,
    sourceText: input.notes ?? "Registro manual",
    transcript: undefined,
    confidence: 1,
    items: input.items,
    media: [],
    createdAt: Date.now(),
  };

  const current = await listUserMeals(input.userId);
  mealStore.set(input.userId, [savedMeal, ...current.filter(meal => meal.id !== savedMeal.id)]);
  await persistMealToDb(savedMeal);
  await updateHabitsFromMeal(savedMeal);
  logInferenceEvent({
    userId: input.userId,
    origin: "web",
    status: "success",
    eventType: "meal.manual_created",
    detail: `Refeição manual ${savedMeal.mealLabel} criada com ${savedMeal.items.length} itens.`,
  });
  return { ...savedMeal, totals: sumMealItems(savedMeal.items) };
}

export async function copyUserMeal(input: {
  userId: number;
  mealId: number;
  occurredAt: string;
  mealLabel?: string;
}) {
  const current = await listUserMeals(input.userId);
  const sourceMeal = current.find(meal => meal.id === input.mealId);
  if (!sourceMeal) {
    throw new Error("Refeição de origem não encontrada.");
  }

  return createUserManualMeal({
    userId: input.userId,
    mealLabel: input.mealLabel?.trim() || sourceMeal.mealLabel,
    occurredAt: input.occurredAt,
    notes: sourceMeal.notes,
    items: sourceMeal.items.map(item => ({ ...item })),
  });
}

export async function listFavoriteMeals(userId: number) {
  const db = await getDb();
  if (db) {
    try {
      const rows = await mealsRepository.findFavoritesByUserId(userId);
      const favorites = rows.map(row => ({
        id: row.id,
        userId: row.userId,
        name: row.name,
        mealLabel: row.mealLabel,
        notes: row.notes ?? undefined,
        items: parseJsonArray<MealDraftItem>(row.itemsJson, []),
        createdAt: new Date(row.createdAt).getTime(),
      }));
      favoriteMealStore.set(userId, favorites);
      return favorites
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(meal => ({
          ...meal,
          totals: sumMealItems(meal.items),
        }));
    } catch (error) {
      logPersistenceWarning("Meal favorites read skipped", error);
    }
  }

  return (favoriteMealStore.get(userId) ?? [])
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(meal => ({
      ...meal,
      totals: sumMealItems(meal.items),
    }));
}

export async function saveFavoriteMeal(input: {
  userId: number;
  mealId: number;
  name?: string;
}) {
  const current = await listUserMeals(input.userId);
  const meal = current.find(item => item.id === input.mealId);
  if (!meal) {
    throw new Error("Refeição não encontrada para favoritar.");
  }

  const favorite: FavoriteMeal = {
    id: favoriteMealIdSequence++,
    userId: input.userId,
    name: input.name?.trim() || meal.mealLabel,
    mealLabel: meal.mealLabel,
    notes: meal.notes,
    items: meal.items.map(item => ({ ...item })),
    createdAt: Date.now(),
  };

  const favorites = favoriteMealStore.get(input.userId) ?? [];
  favoriteMealStore.set(input.userId, [favorite, ...favorites.filter(item => item.name !== favorite.name)]);

  const db = await getDb();
  if (db) {
    try {
      await mealsRepository.upsertFavorite({
        userId: input.userId,
        name: favorite.name,
        mealLabel: favorite.mealLabel,
        notes: favorite.notes,
        itemsJson: JSON.stringify(favorite.items),
      });
    } catch (error) {
      logPersistenceWarning("Meal favorite persistence skipped", error);
    }
  }

  logInferenceEvent({
    userId: input.userId,
    origin: "web",
    status: "success",
    eventType: "meal.favorite_saved",
    detail: `Refeição favorita ${favorite.name} salva com ${favorite.items.length} itens.`,
  });

  return { ...favorite, totals: sumMealItems(favorite.items) };
}

export async function reuseFavoriteMeal(input: {
  userId: number;
  favoriteMealId: number;
  occurredAt: string;
}) {
  const favorite = (await listFavoriteMeals(input.userId)).find(item => item.id === input.favoriteMealId);
  if (!favorite) {
    throw new Error("Refeição favorita não encontrada.");
  }

  return createUserManualMeal({
    userId: input.userId,
    mealLabel: favorite.mealLabel,
    occurredAt: input.occurredAt,
    notes: favorite.notes,
    items: favorite.items.map(item => ({ ...item })),
  });
}

export type UpdateUserMealOptions = {
  updateHabits?: boolean;
  logEvent?: boolean;
};

export async function updateUserMeal(input: {
  userId: number;
  mealId: number;
  mealLabel: string;
  occurredAt: string;
  notes?: string;
  items: MealDraftItem[];
}, options: UpdateUserMealOptions = {}) {
  const current = await listUserMeals(input.userId);
  const existing = current.find(meal => meal.id === input.mealId);
  if (!existing) {
    throw new Error("Refeição não encontrada.");
  }

  const updatedMeal: SavedMeal = {
    ...existing,
    mealLabel: input.mealLabel,
    occurredAt: new Date(input.occurredAt).getTime(),
    notes: input.notes,
    sourceText: existing.sourceText || input.notes || "Registro manual",
    items: input.items,
  };

  mealStore.set(
    input.userId,
    current.map(meal => (meal.id === input.mealId ? updatedMeal : meal)).sort((a, b) => b.occurredAt - a.occurredAt),
  );
  await updateMealInDb(updatedMeal);
  if (options.updateHabits !== false) {
    await updateHabitsFromMeal(updatedMeal);
  }
  if (options.logEvent !== false) {
    logInferenceEvent({
      userId: input.userId,
      origin: "web",
      status: "success",
      eventType: "meal.manual_updated",
      detail: `Refeição ${updatedMeal.mealLabel} atualizada manualmente pelo usuário.`,
    });
  }
  return { ...updatedMeal, totals: sumMealItems(updatedMeal.items) };
}

export async function relabelUserMeals(input: {
  userId: number;
  mealIds: number[];
  mealLabel: string;
  origin?: "web" | "whatsapp";
}) {
  const origin = input.origin ?? "web";
  const current = await listUserMeals(input.userId);
  const targetIds = new Set(input.mealIds);
  const existingMeals = current.filter(meal => targetIds.has(meal.id));

  if (!existingMeals.length) {
    throw new Error("Nenhuma refeição encontrada para reclassificação.");
  }

  const updatedMeals = existingMeals.map(meal => ({
    ...meal,
    mealLabel: input.mealLabel,
  }));

  mealStore.set(
    input.userId,
    current
      .map(meal => updatedMeals.find(updated => updated.id === meal.id) ?? meal)
      .sort((a, b) => b.occurredAt - a.occurredAt),
  );

  for (const meal of updatedMeals) {
    await updateMealInDb(meal);
  }

  await syncHabitsMealLabelFromMeals(input.userId, updatedMeals);
  logInferenceEvent({
    userId: input.userId,
    origin,
    status: "success",
    eventType: "meal.reclassified",
    detail: `${updatedMeals.length} refeição(ões) reclassificada(s) para ${input.mealLabel}.`,
  });

  return updatedMeals.map(meal => ({
    ...meal,
    totals: sumMealItems(meal.items),
  }));
}

export async function removeUserMeal(userId: number, mealId: number) {
  const current = await listUserMeals(userId);
  const existing = current.find(meal => meal.id === mealId);
  if (!existing) {
    throw new Error("Refeição não encontrada.");
  }

  mealStore.set(userId, current.filter(meal => meal.id !== mealId));
  await deleteMealFromDb(userId, mealId);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "meal.manual_deleted",
    detail: `Refeição ${existing.mealLabel} removida pelo usuário.`,
  });
  return { success: true };
}

export async function getWeeklySummary(userId: number, timeZone = DEFAULT_APP_TIME_ZONE) {
  const goal = await getUserNutritionGoal(userId);
  const waterGoal = await getUserWaterGoal(userId);
  const mealsForUser = await listUserMeals(userId);
  const exercisesForUser = await listUserExercises(userId);
  const waterLogsForUser = await listUserWaterLogs(userId);
  const dateKeys = getWeekDateKeys(new Date(), timeZone);

  return Promise.all(dateKeys.map(async (key, index) => {
    const dailyMeals = mealsForUser.filter(meal => dateKey(new Date(meal.occurredAt), timeZone) === key);
    const dailyExercises = exercisesForUser.filter(exercise => dateKey(new Date(Number(exercise.occurredAt)), timeZone) === key);
    const dailyWaterLogs = waterLogsForUser.filter(log => dateKey(new Date(Number(log.occurredAt)), timeZone) === key);
    const totals = sumMeals(dailyMeals);
    const burnedCalories = sumExercises(dailyExercises);
    const waterConsumedMl = sumWater(dailyWaterLogs);
    const quality = await calculateQualityIndicators(userId, dailyMeals, waterConsumedMl);
    const planned = goal.days[index] ?? goal.today;

    return {
      date: key,
      label: planned.shortLabel,
      calories: round(totals.calories),
      protein: round(totals.protein),
      carbs: round(totals.carbs),
      fat: round(totals.fat),
      exerciseCalories: round(burnedCalories),
      netCalories: round(totals.calories - burnedCalories),
      waterConsumedMl: round(waterConsumedMl),
      waterGoalMl: waterGoal.dailyTargetMl,
      quality,
      goalCalories: planned.calories,
      goalProtein: planned.proteinGrams,
      goalCarbs: planned.carbsGrams,
      goalFat: planned.fatGrams,
    };
  }));
}

function classifyWeeklyDay(day: Awaited<ReturnType<typeof getWeeklySummary>>[number]) {
  if (day.calories <= 0) return "no_data" as const;
  const ratio = day.goalCalories ? day.calories / day.goalCalories : 0;
  if (ratio > 1.05) return "above" as const;
  if (ratio < 0.9) return "below" as const;
  return "within" as const;
}

export async function listUserWeightEntries(userId: number) {
  const dbEntries = await loadWeightEntriesFromDb(userId);
  if (dbEntries) {
    if (canUseMemoryPersistenceFallback()) {
      usersService.setWeightEntriesMemory(userId, dbEntries);
    }
    return dbEntries;
  }

  const memoryEntries = usersService.getWeightEntriesMemory(userId);
  if (memoryEntries?.length) return memoryEntries;

  const onboardingProfile = usersService.getOnboardingProfileMemory(userId);
  if (!onboardingProfile?.currentWeightKg) return [];

  return [{
    id: 0,
    userId,
    weightKg: onboardingProfile.currentWeightKg,
    measuredAt: onboardingProfile.completedAt,
    notes: "Peso informado no onboarding.",
    createdAt: onboardingProfile.completedAt,
    updatedAt: onboardingProfile.completedAt,
  } satisfies WeightEntry];
}

export async function getWeeklyProgress(userId: number, timeZone = DEFAULT_APP_TIME_ZONE) {
  const [days, weights] = await Promise.all([
    getWeeklySummary(userId, timeZone),
    listUserWeightEntries(userId),
  ]);

  const totalCalories = round(days.reduce((acc, day) => acc + day.calories, 0));
  const totalGoalCalories = round(days.reduce((acc, day) => acc + day.goalCalories, 0));
  const totalExerciseCalories = round(days.reduce((acc, day) => acc + day.exerciseCalories, 0));
  const totalNetCalories = round(days.reduce((acc, day) => acc + day.netCalories, 0));
  const averageCalories = round(totalCalories / Math.max(days.length, 1));
  const averageProtein = round(days.reduce((acc, day) => acc + day.protein, 0) / Math.max(days.length, 1));
  const daysByStatus = days.reduce(
    (acc, day) => {
      const status = classifyWeeklyDay(day);
      acc[status] += 1;
      return acc;
    },
    { within: 0, above: 0, below: 0, no_data: 0 },
  );

  const sortedWeights = weights
    .slice()
    .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
    .map(entry => ({
      id: entry.id,
      date: dateKey(new Date(entry.measuredAt), timeZone),
      weightKg: round(entry.weightKg),
      notes: entry.notes ?? null,
    }));
  const firstWeight = sortedWeights[0];
  const lastWeight = sortedWeights[sortedWeights.length - 1];

  const balanceCalories = round(totalGoalCalories - totalNetCalories);
  const message = buildWeeklyNutritionStatus({
    totalCalories,
    daysAboveGoal: daysByStatus.above,
    daysWithinGoal: daysByStatus.within,
  });

  return {
    days: days.map(day => ({
      ...day,
      status: classifyWeeklyDay(day),
      calorieDelta: round(day.calories - day.goalCalories),
      netDelta: round(day.netCalories - day.goalCalories),
    })),
    summary: {
      averageCalories,
      totalCalories,
      totalGoalCalories,
      calorieDelta: round(totalCalories - totalGoalCalories),
      daysWithinGoal: daysByStatus.within,
      daysAboveGoal: daysByStatus.above,
      daysBelowGoal: daysByStatus.below,
      daysWithoutRecords: daysByStatus.no_data,
      averageProtein,
      totalExerciseCalories,
      totalNetCalories,
      balanceCalories,
      message,
    },
    weight: {
      entries: sortedWeights,
      firstWeightKg: firstWeight?.weightKg ?? null,
      lastWeightKg: lastWeight?.weightKg ?? null,
      deltaKg: firstWeight && lastWeight ? round(lastWeight.weightKg - firstWeight.weightKg) : null,
      hasData: sortedWeights.length > 0,
    },
  };
}

export async function getDashboardSnapshot(userId: number, timeZone = DEFAULT_APP_TIME_ZONE) {
  const goal = await getUserNutritionGoal(userId);
  const waterGoal = await getUserWaterGoal(userId);
  const mealsForUser = await listUserMeals(userId);
  const exercisesForUser = await listUserExercises(userId);
  const waterLogsForUser = await listUserWaterLogs(userId);
  const todayKey = dateKey(new Date(), timeZone);
  const todaysMeals = mealsForUser.filter(meal => dateKey(new Date(meal.occurredAt), timeZone) === todayKey);
  const todaysExercises = exercisesForUser.filter(exercise => dateKey(new Date(Number(exercise.occurredAt)), timeZone) === todayKey);
  const todaysWaterLogs = waterLogsForUser.filter(log => dateKey(new Date(Number(log.occurredAt)), timeZone) === todayKey);
  const todayTotals = sumMeals(todaysMeals);
  const todayBurnedCalories = sumExercises(todaysExercises);
  const todayWaterMl = sumWater(todaysWaterLogs);
  const todayQuality = await calculateQualityIndicators(userId, todaysMeals, todayWaterMl);
  const todayAdjustedGoalCalories = calculateAdjustedGoalCalories(goal.today.calories, todayBurnedCalories, goal.today.includeExerciseCalories);

  const [weekly, habits] = await Promise.all([
    getWeeklySummary(userId, timeZone),
    getHabitSnapshots(userId),
  ]);
  const gamification = await getUserGamification(userId, weekly);

  const weeklyConsumed = addMealTotals(weekly);
  const weeklyBurnedCalories = weekly.reduce((acc, day) => acc + Number(day.exerciseCalories ?? 0), 0);
  const weeklyWaterMl = weekly.reduce((acc, day) => acc + Number(day.waterConsumedMl ?? 0), 0);

  return {
    goal,
    today: {
      goal: {
        calories: goal.today.calories,
        protein: goal.today.proteinGrams,
        carbs: goal.today.carbsGrams,
        fat: goal.today.fatGrams,
        label: goal.today.label,
      },
      consumed: Object.fromEntries(Object.entries(todayTotals).map(([key, value]) => [key, round(value)])),
      burned: {
        calories: round(todayBurnedCalories),
      },
      water: {
        consumedMl: round(todayWaterMl),
        goalMl: waterGoal.dailyTargetMl,
        remainingMl: Math.max(waterGoal.dailyTargetMl - round(todayWaterMl), 0),
      },
      quality: todayQuality,
      net: {
        calories: round(todayTotals.calories - todayBurnedCalories),
        remainingToGoal: round(todayAdjustedGoalCalories - todayTotals.calories),
      },
      remaining: {
        calories: round(goal.today.calories - todayTotals.calories),
        protein: round(goal.today.proteinGrams - todayTotals.protein),
        carbs: round(goal.today.carbsGrams - todayTotals.carbs),
        fat: round(goal.today.fatGrams - todayTotals.fat),
      },
      adherence: round(goal.today.calories ? Math.min((todayTotals.calories / goal.today.calories) * 100, 100) : 0),
    },
    week: {
      planned: {
        calories: round(goal.weeklyTotals.calories),
        protein: round(goal.weeklyTotals.proteinGrams),
        carbs: round(goal.weeklyTotals.carbsGrams),
        fat: round(goal.weeklyTotals.fatGrams),
      },
      consumed: Object.fromEntries(Object.entries(weeklyConsumed).map(([key, value]) => [key, round(value)])),
      burned: {
        calories: round(weeklyBurnedCalories),
      },
      water: {
        consumedMl: round(weeklyWaterMl),
        goalMl: waterGoal.dailyTargetMl * 7,
        remainingMl: Math.max(waterGoal.dailyTargetMl * 7 - round(weeklyWaterMl), 0),
      },
      quality: weekly.reduce(
        (acc, day) => ({
          proteinGrams: round(acc.proteinGrams + day.quality.proteinGrams),
          fiberGrams: round(acc.fiberGrams + day.quality.fiberGrams),
          waterMl: round(acc.waterMl + day.quality.waterMl),
          fruitServings: round(acc.fruitServings + day.quality.fruitServings),
          vegetableServings: round(acc.vegetableServings + day.quality.vegetableServings),
          ultraProcessedServings: round(acc.ultraProcessedServings + day.quality.ultraProcessedServings),
          mealCount: acc.mealCount + day.quality.mealCount,
          regularityScore: round(acc.regularityScore + day.quality.regularityScore / 7),
        }),
        emptyQualityIndicators(0),
      ),
      net: {
        calories: round(weeklyConsumed.calories - weeklyBurnedCalories),
        remainingToGoal: round(goal.weeklyTotals.calories - (weeklyConsumed.calories - weeklyBurnedCalories)),
      },
      remaining: {
        calories: round(goal.weeklyTotals.calories - weeklyConsumed.calories),
        protein: round(goal.weeklyTotals.proteinGrams - weeklyConsumed.protein),
        carbs: round(goal.weeklyTotals.carbsGrams - weeklyConsumed.carbs),
        fat: round(goal.weeklyTotals.fatGrams - weeklyConsumed.fat),
      },
      adherence: round(goal.weeklyTotals.calories ? Math.min((weeklyConsumed.calories / goal.weeklyTotals.calories) * 100, 100) : 0),
    },
    weekly,
    meals: mealsForUser.slice(0, 8),
    exercises: exercisesForUser.slice(0, 8),
    water: {
      goal: waterGoal,
      logs: waterLogsForUser.slice(0, 8),
    },
    gamification,
    habits,
  };
}

export async function getKnownUsers(): Promise<User[]> {
  const db = await getDb();
  if (db) {
    const recentUsers = await usersRepository.listRecent(25);
    if (recentUsers) {
      return recentUsers;
    }
  }

  return [
    {
      id: 1,
      openId: "local:owner",
      name: "Administrador",
      email: null,
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  ];
}

export async function getAdminSnapshot() {
  const usersList = await getKnownUsers();
  const db = await getDb();
  const whatsappToken = await getAdminWhatsAppTokenStatus();

  if (db) {
    try {
      const [mealsCount, recentLogs] = await Promise.all([
        mealsRepository.countConfirmed(),
        loadRecentLogsFromDb(),
      ]);

      return {
        usage: {
          usersCount: usersList.length,
          mealsCount,
          pendingInferences: inferenceStore.size,
          logsCount: recentLogs?.length ?? adminLogStore.length,
        },
        users: usersList,
        whatsappToken,
        recentInferenceLogs: recentLogs ?? adminLogStore.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 20),
      };
    } catch (error) {
      logPersistenceWarning("Admin read skipped", error);
    }
  }

  const allMeals = Array.from(mealStore.values()).flat();
  return {
    usage: {
      usersCount: usersList.length,
      mealsCount: allMeals.length,
      pendingInferences: inferenceStore.size,
      logsCount: adminLogStore.length,
    },
    users: usersList,
    whatsappToken,
    recentInferenceLogs: adminLogStore.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 20),
  };
}

export function logInferenceEvent(entry: Omit<AdminLogEntry, "id" | "createdAt">) {
  const created: AdminLogEntry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...entry,
    detail: safeLogDetail(entry.detail),
  };
  adminLogStore.unshift(created);
  void persistLogToDb(created);
}

const privacyService = createPrivacyService({
  getDb,
  findUserById: userId => usersRepository.findById(userId),
  findProfileByUserId: userId => userProfileRepository.findProfileByUserId(userId),
  getOnboardingProfileMemory: userId => usersService.getOnboardingProfileMemory(userId),
  findPreferencesByUserId: userId => userProfileRepository.findPreferencesByUserId(userId),
  findRestrictionsByUserId: userId => userProfileRepository.findRestrictionsByUserId(userId),
  getStoredNutritionGoals,
  listUserMeals,
  listFavoriteMeals: userId => favoriteMealStore.get(userId) ?? [],
  listUserExercises,
  getUserWaterGoal,
  listUserWaterLogs,
  getWeeklyProgress,
  getUserWhatsappConnection,
  purgeDatabaseUserData: userId => accountRepository.purgeUserData(userId),
  purgeMemoryDomains: [
    userId => goalsService.clearMemory(userId),
    userId => usersService.clearMemory(userId),
    userId => mealStore.delete(userId),
    userId => exercisesService.clearMemory(userId),
    userId => waterService.clearMemory(userId),
    userId => habitStore.delete(userId),
    userId => foodsService.clearMemory(userId),
    userId => favoriteMealStore.delete(userId),
    userId => gamificationService.clearMemory(userId),
    userId => {
      for (const [draftId, draft] of Array.from(inferenceStore.entries())) {
        if (draft.userId === userId) inferenceStore.delete(draftId);
      }
    },
    userId => {
      for (let index = whatsappConnectionStore.length - 1; index >= 0; index -= 1) {
        if (whatsappConnectionStore[index].userId === userId) whatsappConnectionStore.splice(index, 1);
      }
    },
  ],
});

export const exportUserPrivacyData = privacyService.exportUserPrivacyData;
export const requestUserAccountDeletion = privacyService.requestUserAccountDeletion;

export function buildSavedMedia(input: Omit<SavedMedia, "id">) {
  return {
    ...input,
    id: mediaIdSequence++,
  };
}
