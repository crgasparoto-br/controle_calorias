import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  appSecrets,
  dailySummaries,
  exercises,
  foodFavorites,
  habitMemories,
  inferenceLogs,
  InsertUser,
  mealInferences,
  mealFavorites,
  mealItems,
  mealMedia,
  meals,
  foodCatalog,
  NutritionGoal,
  userBadges,
  userGamificationSettings,
  userPreferences,
  userProfiles,
  userRestrictions,
  User,
  users,
  waterGoals,
  waterLogs,
  WeightEntry,
  weightEntries,
  whatsappConnections,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";
import { addMealTotals, calculateDayTotals, calculateMealTotals, roundNutritionValue } from "../shared/mealTotals";
import { buildWeeklyNutritionStatus } from "../shared/safeMessages";
import { HabitSnapshot, MealDraftItem, MealProcessingResult } from "./nutritionEngine";
import { createDrizzleExercisesRepository } from "./repositories/exercisesRepository";
import { canUseMemoryPersistenceFallback } from "./repositories/memoryFallback";
import { createDrizzleNutritionGoalsRepository } from "./repositories/nutritionGoalsRepository";
import { createDrizzleWaterRepository } from "./repositories/waterRepository";
import type { OnboardingInput } from "./modules/onboarding/schemas";
import { safeLogDetail } from "./privacy";

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

type EncryptedSecretPayload = {
  iv: string;
  tag: string;
  value: string;
};

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

function getAppSecretCipherKey() {
  return crypto
    .createHash("sha256")
    .update(`controle-calorias::app-secrets::${ENV.cookieSecret}`)
    .digest();
}

function encryptAppSecretValue(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getAppSecretCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
  } satisfies EncryptedSecretPayload);
}

function decryptAppSecretValue(payload: string) {
  const parsed = JSON.parse(payload) as EncryptedSecretPayload;
  const decipher = crypto.createDecipheriv("aes-256-gcm", getAppSecretCipherKey(), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.value, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

async function getAppSecret(secretKey: string) {
  const db = await getDb();
  if (!db) {
    return null;
  }

  try {
    const rows = await db.select().from(appSecrets).where(eq(appSecrets.secretKey, secretKey)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.warn("[Database] Failed to get app secret:", error);
    return null;
  }
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
  const existing = await getAppSecret(WHATSAPP_ACCESS_TOKEN_SECRET_KEY);

  if (existing) {
    await db
      .update(appSecrets)
      .set({
        valueEncrypted: encryptedValue,
        updatedByUserId: input.updatedByUserId,
      })
      .where(eq(appSecrets.id, existing.id));
  } else {
    await db.insert(appSecrets).values({
      secretKey: WHATSAPP_ACCESS_TOKEN_SECRET_KEY,
      valueEncrypted: encryptedValue,
      updatedByUserId: input.updatedByUserId,
    });
  }

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

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    return;
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

  try {
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.warn("[Database] Failed to upsert user, continuing with auth only:", error);
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    return undefined;
  }

  try {
    const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.warn("[Database] Failed to get user by openId:", error);
    return undefined;
  }
}

export async function saveUserOnboardingProfile(userId: number, input: OnboardingInput) {
  const now = new Date();
  const measuredAt = input.weightMeasuredAt ? new Date(input.weightMeasuredAt) : now;
  const weightEntryNote = input.weightEntryNote?.trim() || "Peso informado no onboarding.";
  const profile = {
    userId,
    ...input,
    completedAt: now,
  };

  if (canUseMemoryPersistenceFallback()) {
    onboardingProfileStore.set(userId, profile);
  }

  const db = await getDb();
  if (!db) {
    return profile;
  }

  const profileValues = {
    userId,
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
    const existingProfile = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    if (existingProfile.length) {
      await db.update(userProfiles).set(profileValues).where(eq(userProfiles.userId, userId));
    } else {
      await db.insert(userProfiles).values({
        ...profileValues,
        createdAt: now,
      });
    }

    await db.insert(weightEntries).values({
      userId,
      weightKg: input.currentWeightKg,
      measuredAt,
      notes: weightEntryNote,
    });

    const preferenceKeys = ["dietary_preferences", "eating_routine", "main_difficulty", "tracking_experience"];
    await db
      .delete(userPreferences)
      .where(and(eq(userPreferences.userId, userId), inArray(userPreferences.preferenceKey, preferenceKeys)));
    await db.insert(userPreferences).values([
      {
        userId,
        preferenceKey: "dietary_preferences",
        preferenceValue: JSON.stringify(input.dietaryPreferences),
      },
      {
        userId,
        preferenceKey: "eating_routine",
        preferenceValue: input.eatingRoutine,
      },
      {
        userId,
        preferenceKey: "main_difficulty",
        preferenceValue: input.mainDifficulty,
      },
      {
        userId,
        preferenceKey: "tracking_experience",
        preferenceValue: input.trackingExperience,
      },
    ]);

    if (input.dietaryRestrictions.length) {
      await db.insert(userRestrictions).values(input.dietaryRestrictions.map(label => ({
        userId,
        restrictionType: "other" as const,
        label,
        severity: "avoid" as const,
        notes: "Informado no onboarding.",
      })));
    }
  } catch (error) {
    logPersistenceWarning("Onboarding persistence skipped", error);
  }

  return profile;
}

function parsePreferenceList(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function getFoodAssistantProfile(userId: number) {
  const memoryProfile = onboardingProfileStore.get(userId);
  const fallback = {
    preferences: memoryProfile?.dietaryPreferences ?? [],
    restrictions: memoryProfile?.dietaryRestrictions ?? [],
    eatingRoutine: memoryProfile?.eatingRoutine ?? null,
    objective: memoryProfile?.objective ?? null,
  };

  const db = await getDb();
  if (!db) {
    return fallback;
  }

  try {
    const [profileRows, preferenceRows, restrictionRows] = await Promise.all([
      db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1),
      db.select().from(userPreferences).where(eq(userPreferences.userId, userId)),
      db.select().from(userRestrictions).where(eq(userRestrictions.userId, userId)),
    ]);
    const preferenceMap = new Map(preferenceRows.map(row => [row.preferenceKey, row.preferenceValue]));

    return {
      preferences: parsePreferenceList(preferenceMap.get("dietary_preferences")),
      restrictions: restrictionRows.map(row => row.label).filter(Boolean),
      eatingRoutine: profileRows[0]?.eatingRoutine ?? preferenceMap.get("eating_routine") ?? null,
      objective: profileRows[0]?.nutritionObjective ?? null,
    };
  } catch (error) {
    logPersistenceWarning("Food assistant profile read skipped", error);
    return fallback;
  }
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

  try {
    const rows = await db
      .select()
      .from(whatsappConnections)
      .where(eq(whatsappConnections.userId, userId))
      .orderBy(desc(whatsappConnections.updatedAt));

    const active = rows.find(row => row.status === "active") ?? rows[0];
    return active ?? null;
  } catch (error) {
    console.warn("[Database] Failed to get WhatsApp connection:", error);
    return null;
  }
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

  try {
    const rows = await db
      .select()
      .from(whatsappConnections)
      .where(and(eq(whatsappConnections.phoneNumber, normalizedPhoneNumber), eq(whatsappConnections.status, "active")))
      .limit(1);

    return rows[0]?.userId ?? null;
  } catch {
    return null;
  }
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

  const conflictingRows = await db
    .select()
    .from(whatsappConnections)
    .where(eq(whatsappConnections.phoneNumber, normalizedPhoneNumber));

  const activeConflict = conflictingRows.find(row => row.userId !== input.userId && row.status !== "disabled");
  if (activeConflict) {
    throw new Error("Este telefone de origem já está vinculado a outro usuário.");
  }

  const userRows = await db
    .select()
    .from(whatsappConnections)
    .where(eq(whatsappConnections.userId, input.userId))
    .orderBy(desc(whatsappConnections.updatedAt));

  let connectionId = userRows[0]?.id;

  if (connectionId) {
    await db
      .update(whatsappConnections)
      .set({
        phoneNumber: normalizedPhoneNumber,
        displayName: normalizedDisplayName,
        status: "active",
      })
      .where(eq(whatsappConnections.id, connectionId));
  } else {
    const inserted = await db.insert(whatsappConnections).values({
      userId: input.userId,
      phoneNumber: normalizedPhoneNumber,
      displayName: normalizedDisplayName,
      status: "active",
    });

    connectionId = Number((inserted as { insertId?: number }).insertId ?? 0);
  }

  for (const row of userRows.slice(1)) {
    await db
      .update(whatsappConnections)
      .set({ status: "disabled" })
      .where(eq(whatsappConnections.id, row.id));
  }

  const saved = await getUserWhatsappConnection(input.userId);
  if (!saved) {
    throw new Error("Não foi possível recuperar o contato do WhatsApp após o salvamento.");
  }

  return saved;
}

type GoalTargetInput = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

type GoalExceptionDuration = "1_week" | "2_weeks" | "3_weeks" | "always";

type GoalExceptionInput = GoalTargetInput & {
  id?: number;
  weekday: number;
  durationType: GoalExceptionDuration;
};

type GoalInput = {
  defaultGoal: GoalTargetInput;
  exceptions: GoalExceptionInput[];
};

type GoalDayView = NutritionGoal & {
  label: string;
  shortLabel: string;
  source: "default" | "exception";
  exceptionId?: number;
};

type GoalExceptionView = NutritionGoal & {
  label: string;
  shortLabel: string;
  isActive: boolean;
};

type GoalSummary = {
  defaultGoal: NutritionGoal;
  exceptions: GoalExceptionView[];
  days: GoalDayView[];
  today: GoalDayView;
  weeklyTotals: {
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
  };
};

const WEEKDAY_META = [
  { weekday: 0, label: "Segunda-feira", shortLabel: "seg." },
  { weekday: 1, label: "Terça-feira", shortLabel: "ter." },
  { weekday: 2, label: "Quarta-feira", shortLabel: "qua." },
  { weekday: 3, label: "Quinta-feira", shortLabel: "qui." },
  { weekday: 4, label: "Sexta-feira", shortLabel: "sex." },
  { weekday: 5, label: "Sábado", shortLabel: "sáb." },
  { weekday: 6, label: "Domingo", shortLabel: "dom." },
] as const;

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

type ExerciseEntry = {
  id: number;
  userId: number;
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  notes?: string | null;
  occurredAt: number;
  createdAt: number;
  updatedAt: Date;
};

type WaterGoalEntry = {
  id: number;
  userId: number;
  dailyTargetMl: number;
  createdAt: number;
  updatedAt: Date;
};

type WaterLogEntry = {
  id: number;
  userId: number;
  amountMl: number;
  occurredAt: number;
  createdAt: number;
  updatedAt: Date;
};

type BadgeCode =
  | "registered_3_days_week"
  | "registered_5_days_week"
  | "protein_4_days_week"
  | "water_3_days_week"
  | "created_favorite_meal"
  | "planned_meal"
  | "weekly_consistency";

type BadgeDefinition = {
  code: BadgeCode;
  title: string;
  description: string;
};

type UserBadgeEntry = {
  id: number;
  userId: number;
  badgeCode: BadgeCode;
  earnedAt: number;
  weekStart: string | null;
  metadata?: Record<string, unknown>;
};

type GamificationSettingEntry = {
  userId: number;
  enabled: boolean;
  updatedAt: number;
};

type OnboardingProfileEntry = OnboardingInput & {
  userId: number;
  completedAt: Date;
};

const goalStore = new Map<number, NutritionGoal[]>();
const onboardingProfileStore = new Map<number, OnboardingProfileEntry>();
const mealStore = new Map<number, SavedMeal[]>();
const exerciseStore = new Map<number, ExerciseEntry[]>();
const waterGoalStore = new Map<number, WaterGoalEntry>();
const waterLogStore = new Map<number, WaterLogEntry[]>();
const weightEntryStore = new Map<number, WeightEntry[]>();
const habitStore = new Map<number, HabitMemoryState[]>();
const userFoodStore = new Map<number, FoodSearchItem[]>();
const favoriteFoodStore = new Map<number, Set<number>>();
const favoriteMealStore = new Map<number, FavoriteMeal[]>();
const gamificationSettingsStore = new Map<number, GamificationSettingEntry>();
const userBadgeStore = new Map<number, UserBadgeEntry[]>();
const inferenceStore = new Map<string, PendingInference>();
const adminLogStore: AdminLogEntry[] = [];
let mealIdSequence = 1;
let mediaIdSequence = 1;
let goalIdSequence = 1;
let exerciseIdSequence = 1;
let waterGoalIdSequence = 1;
let waterLogIdSequence = 1;
let foodIdSequence = 10000;
let favoriteMealIdSequence = 1;
let userBadgeIdSequence = 1;

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  { code: "registered_3_days_week", title: "3 dias registrados", description: "Registrou refeições em 3 dias da semana." },
  { code: "registered_5_days_week", title: "5 dias registrados", description: "Registrou refeições em 5 dias da semana." },
  { code: "protein_4_days_week", title: "Proteína em 4 dias", description: "Atingiu a meta de proteína em 4 dias da semana." },
  { code: "water_3_days_week", title: "Água em 3 dias", description: "Registrou água em 3 dias da semana." },
  { code: "created_favorite_meal", title: "Refeição favorita criada", description: "Salvou uma refeição favorita para reduzir fricção na rotina." },
  { code: "planned_meal", title: "Refeição planejada", description: "Planejou uma refeição para um horário futuro." },
  { code: "weekly_consistency", title: "Consistência semanal", description: "Manteve registros consistentes ao longo da semana." },
];

const BADGE_DEFINITION_BY_CODE = new Map(BADGE_DEFINITIONS.map(badge => [badge.code, badge]));

export type FoodSearchItem = {
  id: number;
  name: string;
  brandName?: string | null;
  servingSize: number;
  servingUnit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  isFruit: boolean;
  isVegetable: boolean;
  isUltraProcessed: boolean;
  source: string;
  foodType: "generic" | "branded";
  isUserCreated: boolean;
  createdByUserId?: number | null;
  isFavorite: boolean;
  lastUsedAt?: number | null;
};

const referenceFoods: FoodSearchItem[] = FOOD_CATALOG_REFERENCE.map((food, index) => ({
  id: index + 1,
  name: food.name,
  brandName: null,
  servingSize: food.gramsPerServing,
  servingUnit: food.servingLabel.replace(String(food.gramsPerServing), "").trim() || "porção",
  calories: food.calories,
  protein: food.protein,
  carbs: food.carbs,
  fat: food.fat,
  fiber: null,
  isFruit: false,
  isVegetable: false,
  isUltraProcessed: false,
  source: "catalog",
  foodType: "generic",
  isUserCreated: false,
  createdByUserId: null,
  isFavorite: false,
  lastUsedAt: null,
}));

function getWeekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

const DEFAULT_GOAL_WEEKDAY = -1;

const defaultGoal = (userId: number): NutritionGoal => ({
  id: goalIdSequence++,
  userId,
  ruleType: "default",
  weekday: DEFAULT_GOAL_WEEKDAY,
  durationType: "always",
  calories: 2200,
  proteinGrams: 160,
  carbsGrams: 240,
  fatGrams: 70,
  effectiveFrom: new Date(),
  effectiveUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function startOfWeek(date: Date) {
  const value = startOfDay(date);
  value.setDate(value.getDate() - getWeekdayIndex(value));
  return value;
}

function endOfWeek(date: Date) {
  const value = startOfWeek(date);
  value.setDate(value.getDate() + 6);
  value.setHours(23, 59, 59, 999);
  return value;
}

function buildExceptionEndDate(referenceDate: Date, durationType: GoalExceptionDuration) {
  if (durationType === "always") {
    return null;
  }

  const durationWeeks = durationType === "1_week" ? 1 : durationType === "2_weeks" ? 2 : 3;
  const value = endOfWeek(referenceDate);
  value.setDate(value.getDate() + (durationWeeks - 1) * 7);
  return value;
}

function isDefaultGoalActiveOnDate(rule: NutritionGoal, date: Date) {
  if (rule.ruleType !== "default") {
    return false;
  }

  const currentTime = date.getTime();
  const startTime = new Date(rule.effectiveFrom).getTime();
  const endTime = rule.effectiveUntil ? new Date(rule.effectiveUntil).getTime() : Number.POSITIVE_INFINITY;
  return currentTime >= startTime && currentTime <= endTime;
}

function getDefaultGoalRule(userId: number, rows: NutritionGoal[], referenceDate = new Date()) {
  return rows
    .filter(row => isDefaultGoalActiveOnDate(row, referenceDate))
    .sort((a, b) => {
      if (!a.effectiveUntil && b.effectiveUntil) return -1;
      if (a.effectiveUntil && !b.effectiveUntil) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0] ?? defaultGoal(userId);
}

function getExceptionRules(rows: NutritionGoal[]) {
  return rows
    .filter(row => row.ruleType === "exception")
    .slice()
    .sort((a, b) => {
      const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (updatedDiff !== 0) return updatedDiff;
      return new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime();
    });
}

function isExceptionActiveOnDate(rule: NutritionGoal, date: Date) {
  if (rule.ruleType !== "exception") {
    return false;
  }

  if (rule.weekday !== getWeekdayIndex(date)) {
    return false;
  }

  const currentWeek = startOfWeek(date).getTime();
  const startWeek = startOfWeek(new Date(rule.effectiveFrom)).getTime();
  const endTime = rule.effectiveUntil ? new Date(rule.effectiveUntil).getTime() : Number.POSITIVE_INFINITY;
  return currentWeek >= startWeek && date.getTime() < endTime;
}

function resolveGoalForDate(userId: number, rows: NutritionGoal[], date: Date): GoalDayView {
  const fallback = getDefaultGoalRule(userId, rows, date);
  const activeException = getExceptionRules(rows).find(rule => isExceptionActiveOnDate(rule, date));
  const applied = activeException ?? fallback;
  const weekday = getWeekdayIndex(date);
  const meta = WEEKDAY_META[weekday] ?? { label: "Dia", shortLabel: "dia" };

  return {
    ...applied,
    weekday,
    label: meta.label,
    shortLabel: meta.shortLabel,
    source: activeException ? "exception" : "default",
    exceptionId: activeException?.id,
  };
}

function buildGoalSummary(rows: NutritionGoal[], userId: number, referenceDate = new Date()): GoalSummary {
  const monday = startOfWeek(referenceDate);
  const days = Array.from({ length: 7 }).map((_, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    return resolveGoalForDate(userId, rows, current);
  });
  const today = resolveGoalForDate(userId, rows, referenceDate);
  const defaultGoalRule = getDefaultGoalRule(userId, rows, referenceDate);
  const currentTime = referenceDate.getTime();
  const exceptions = getExceptionRules(rows)
    .filter(rule => !rule.effectiveUntil || new Date(rule.effectiveUntil).getTime() > currentTime)
    .map(rule => ({
      ...rule,
      label: WEEKDAY_META[rule.weekday]?.label ?? "Dia",
      shortLabel: WEEKDAY_META[rule.weekday]?.shortLabel ?? "dia",
      isActive: isExceptionActiveOnDate(rule, referenceDate),
    }));

  return {
    defaultGoal: defaultGoalRule,
    exceptions,
    days,
    today,
    weeklyTotals: days.reduce(
      (acc, day) => {
        acc.calories += day.calories;
        acc.proteinGrams += day.proteinGrams;
        acc.carbsGrams += day.carbsGrams;
        acc.fatGrams += day.fatGrams;
        return acc;
      },
      { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
    ),
  };
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfLocalDay(date: Date) {
  return startOfDay(date);
}

function startOfLocalWeek(date: Date) {
  const value = startOfLocalDay(date);
  value.setDate(value.getDate() - getWeekdayIndex(value));
  return value;
}

function dateKey(date: Date) {
  const value = startOfLocalDay(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sumMealItems(items: MealDraftItem[]) {
  return calculateMealTotals(items);
}

function sumMeals(meals: Array<{ items: MealDraftItem[] }>) {
  return calculateDayTotals(meals);
}

function sumExercises(items: ExerciseEntry[]) {
  return items.reduce((acc, item) => acc + Number(item.caloriesBurned ?? 0), 0);
}

function sumWater(items: WaterLogEntry[]) {
  return items.reduce((acc, item) => acc + Number(item.amountMl ?? 0), 0);
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

function badgeWeekStart() {
  return dateKey(startOfLocalWeek(new Date()));
}

function withBadgeDefinition(entry: UserBadgeEntry) {
  const definition = BADGE_DEFINITION_BY_CODE.get(entry.badgeCode);
  return {
    id: entry.id,
    code: entry.badgeCode,
    title: definition?.title ?? entry.badgeCode,
    description: definition?.description ?? "",
    earnedAt: entry.earnedAt,
    weekStart: entry.weekStart,
    metadata: entry.metadata ?? {},
  };
}

async function getGamificationEnabled(userId: number) {
  const memory = gamificationSettingsStore.get(userId);
  if (memory) return memory.enabled;

  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(userGamificationSettings).where(eq(userGamificationSettings.userId, userId)).limit(1);
      const row = rows[0];
      if (row) {
        const setting = { userId, enabled: row.enabled === 1, updatedAt: new Date(row.updatedAt).getTime() };
        gamificationSettingsStore.set(userId, setting);
        return setting.enabled;
      }
    } catch (error) {
      logPersistenceWarning("Gamification settings read skipped", error);
    }
  }

  return true;
}

export async function updateUserGamificationSettings(userId: number, enabled: boolean) {
  const setting = { userId, enabled, updatedAt: Date.now() };
  gamificationSettingsStore.set(userId, setting);

  const db = await getDb();
  if (db) {
    try {
      await db.insert(userGamificationSettings).values({
        userId,
        enabled: enabled ? 1 : 0,
      }).onDuplicateKeyUpdate({
        set: {
          enabled: enabled ? 1 : 0,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logPersistenceWarning("Gamification settings persistence skipped", error);
    }
  }
}