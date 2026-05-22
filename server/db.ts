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
      measuredAt: now,
      notes: "Peso informado no onboarding.",
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

  return { enabled };
}

async function loadUserBadges(userId: number) {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(userBadges).where(eq(userBadges.userId, userId)).orderBy(desc(userBadges.earnedAt));
      const entries = rows.map(row => ({
        id: row.id,
        userId: row.userId,
        badgeCode: row.badgeCode as BadgeCode,
        earnedAt: new Date(row.earnedAt).getTime(),
        weekStart: row.weekStart ?? null,
        metadata: parseJsonObject(row.metadataJson, {}),
      }));
      userBadgeStore.set(userId, entries);
      return entries;
    } catch (error) {
      logPersistenceWarning("User badges read skipped", error);
    }
  }

  return userBadgeStore.get(userId) ?? [];
}

async function awardUserBadge(userId: number, badgeCode: BadgeCode, weekStart: string, metadata: Record<string, unknown>) {
  const current = await loadUserBadges(userId);
  const existing = current.find(badge => badge.badgeCode === badgeCode && badge.weekStart === weekStart);
  if (existing) return existing;

  const badge: UserBadgeEntry = {
    id: userBadgeIdSequence++,
    userId,
    badgeCode,
    earnedAt: Date.now(),
    weekStart,
    metadata,
  };

  const db = await getDb();
  if (db) {
    try {
      const inserted = await db.insert(userBadges).values({
        userId,
        badgeCode,
        weekStart,
        metadataJson: JSON.stringify(metadata),
      });
      const insertedId = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
      if (insertedId) badge.id = insertedId;
    } catch (error) {
      logPersistenceWarning("User badge persistence skipped", error);
    }
  }

  userBadgeStore.set(userId, [badge, ...current]);
  return badge;
}

async function calculateEarnedBadgeCodes(userId: number, weekly: Awaited<ReturnType<typeof getWeeklySummary>>): Promise<Array<{ code: BadgeCode; metadata: Record<string, unknown> }>> {
  const daysWithMeals = weekly.filter(day => day.quality.mealCount > 0).length;
  const daysWithProteinGoal = weekly.filter(day => day.goalProtein > 0 && day.protein >= day.goalProtein).length;
  const daysWithWater = weekly.filter(day => day.waterConsumedMl > 0).length;
  const favorites = await listFavoriteMeals(userId);
  const meals = await listUserMeals(userId);
  const hasPlannedMeal = meals.some(meal => meal.occurredAt > Date.now() && meal.source === "web");
  const badges: Array<{ code: BadgeCode; metadata: Record<string, unknown> }> = [];

  if (daysWithMeals >= 3) badges.push({ code: "registered_3_days_week", metadata: { daysWithMeals } });
  if (daysWithMeals >= 5) badges.push({ code: "registered_5_days_week", metadata: { daysWithMeals } });
  if (daysWithProteinGoal >= 4) badges.push({ code: "protein_4_days_week", metadata: { daysWithProteinGoal } });
  if (daysWithWater >= 3) badges.push({ code: "water_3_days_week", metadata: { daysWithWater } });
  if (favorites.length > 0) badges.push({ code: "created_favorite_meal", metadata: { favoriteMeals: favorites.length } });
  if (hasPlannedMeal) badges.push({ code: "planned_meal", metadata: {} });
  if (daysWithMeals >= 5 && daysWithWater >= 3) badges.push({ code: "weekly_consistency", metadata: { daysWithMeals, daysWithWater } });

  return badges;
}

export async function getUserGamification(userId: number, weekly?: Awaited<ReturnType<typeof getWeeklySummary>>) {
  const enabled = await getGamificationEnabled(userId);
  const history = await loadUserBadges(userId);

  if (!enabled) {
    return {
      enabled,
      availableBadges: BADGE_DEFINITIONS,
      earnedBadges: history.map(withBadgeDefinition),
      newlyEarnedBadges: [],
    };
  }

  const weekStart = badgeWeekStart();
  const weeklyData = weekly ?? await getWeeklySummary(userId);
  const earnedCandidates = await calculateEarnedBadgeCodes(userId, weeklyData);
  const newlyEarned: UserBadgeEntry[] = [];

  for (const candidate of earnedCandidates) {
    const before = (userBadgeStore.get(userId) ?? history).some(badge => badge.badgeCode === candidate.code && badge.weekStart === weekStart);
    const awarded = await awardUserBadge(userId, candidate.code, weekStart, candidate.metadata);
    if (!before) newlyEarned.push(awarded);
  }

  const updatedHistory = await loadUserBadges(userId);
  return {
    enabled,
    availableBadges: BADGE_DEFINITIONS,
    earnedBadges: updatedHistory.map(withBadgeDefinition),
    newlyEarnedBadges: newlyEarned.map(withBadgeDefinition),
  };
}

function isMissingTableError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "ER_NO_SUCH_TABLE" || causeCode === "ER_NO_SUCH_TABLE";
}

function logPersistenceWarning(scope: string, error: unknown) {
  if (isMissingTableError(error)) {
    return;
  }
  console.warn(`[Database] ${scope}:`, safeLogDetail(error));
}

const nutritionGoalsRepository = createDrizzleNutritionGoalsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const exercisesRepository = createDrizzleExercisesRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const waterRepository = createDrizzleWaterRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

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

function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function toSlug(value: string) {
  const normalized = normalizeCatalogText(value).replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  return normalized || `food-${Date.now()}`;
}

function rankFoods(food: FoodSearchItem, query: string) {
  const normalizedQuery = normalizeCatalogText(query);
  const haystack = normalizeCatalogText(`${food.name} ${food.brandName ?? ""}`);
  const exact = normalizedQuery && haystack.startsWith(normalizedQuery) ? 4 : 0;
  const favorite = food.isFavorite ? 3 : 0;
  const recent = food.lastUsedAt ? 2 : 0;
  const userCreated = food.isUserCreated ? 1 : 0;
  return exact + favorite + recent + userCreated;
}

function getMemoryFoodsForUser(userId: number) {
  const favorites = favoriteFoodStore.get(userId) ?? new Set<number>();
  const userFoods = userFoodStore.get(userId) ?? [];
  const recentMeals = mealStore.get(userId) ?? [];
  const recentByName = new Map<string, number>();

  for (const meal of recentMeals) {
    for (const item of meal.items) {
      const key = normalizeCatalogText(item.canonicalName || item.foodName);
      recentByName.set(key, Math.max(recentByName.get(key) ?? 0, meal.occurredAt));
    }
  }

  return [...userFoods, ...referenceFoods].map(food => {
    const lastUsedAt = recentByName.get(normalizeCatalogText(food.name)) ?? food.lastUsedAt ?? null;
    return {
      ...food,
      isFavorite: favorites.has(food.id),
      lastUsedAt,
    };
  });
}

async function loadFavoriteFoodIdsFromDb(userId: number) {
  const db = await getDb();
  if (!db) return favoriteFoodStore.get(userId) ?? new Set<number>();

  try {
    const rows = await db.select().from(foodFavorites).where(eq(foodFavorites.userId, userId));
    const ids = new Set(rows.map(row => row.foodCatalogId));
    favoriteFoodStore.set(userId, ids);
    return ids;
  } catch (error) {
    logPersistenceWarning("Food favorites read skipped", error);
    return favoriteFoodStore.get(userId) ?? new Set<number>();
  }
}

async function loadRecentFoodUsageFromDb(userId: number) {
  const db = await getDb();
  if (!db) return new Map<string, number>();

  try {
    const mealRows = await db.select().from(meals).where(eq(meals.userId, userId));
    const usage = new Map<string, number>();
    for (const meal of mealRows) {
      const items = await db.select().from(mealItems).where(eq(mealItems.mealId, meal.id));
      for (const item of items) {
        const key = normalizeCatalogText(item.canonicalName || item.foodName);
        usage.set(key, Math.max(usage.get(key) ?? 0, new Date(meal.occurredAt).getTime()));
      }
    }
    return usage;
  } catch (error) {
    logPersistenceWarning("Recent foods read skipped", error);
    return new Map<string, number>();
  }
}

export async function searchFoods(userId: number, query = "", limit = 20) {
  const normalizedQuery = normalizeCatalogText(query);
  const db = await getDb();
  const favorites = await loadFavoriteFoodIdsFromDb(userId);

  if (db) {
    try {
      const [rows, usage] = await Promise.all([
        db.select().from(foodCatalog),
        loadRecentFoodUsageFromDb(userId),
      ]);

      const foods = rows
        .filter(row => !row.createdByUserId || row.createdByUserId === userId)
        .map(row => {
          const lastUsedAt = usage.get(normalizeCatalogText(row.name)) ?? null;
          return {
            id: row.id,
            name: row.name,
            brandName: row.brandName,
            servingSize: row.gramsPerServing,
            servingUnit: row.servingUnit,
            calories: row.calories,
            protein: row.protein,
            carbs: row.carbs,
            fat: row.fat,
            fiber: row.fiber,
            isFruit: row.isFruit === 1,
            isVegetable: row.isVegetable === 1,
            isUltraProcessed: row.isUltraProcessed === 1,
            source: row.dataSource,
            foodType: row.foodType,
            isUserCreated: row.isUserCreated === 1,
            createdByUserId: row.createdByUserId,
            isFavorite: favorites.has(row.id),
            lastUsedAt,
          } satisfies FoodSearchItem;
        });

      return foods
        .filter(food => !normalizedQuery || normalizeCatalogText(`${food.name} ${food.brandName ?? ""}`).includes(normalizedQuery))
        .sort((a, b) => rankFoods(b, query) - rankFoods(a, query) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name))
        .slice(0, limit);
    } catch (error) {
      logPersistenceWarning("Food search read skipped", error);
    }
  }

  return getMemoryFoodsForUser(userId)
    .filter(food => !normalizedQuery || normalizeCatalogText(`${food.name} ${food.brandName ?? ""}`).includes(normalizedQuery))
    .sort((a, b) => rankFoods(b, query) - rankFoods(a, query) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function listRecentFoods(userId: number, limit = 10) {
  return (await searchFoods(userId, "", 100)).filter(food => food.lastUsedAt).slice(0, limit);
}

export async function upsertFavoriteFood(userId: number, foodId: number, favorite: boolean) {
  const favorites = new Set(favoriteFoodStore.get(userId) ?? []);
  if (favorite) favorites.add(foodId);
  else favorites.delete(foodId);
  favoriteFoodStore.set(userId, favorites);

  const db = await getDb();
  if (db) {
    try {
      if (favorite) {
        await db.insert(foodFavorites).values({ userId, foodCatalogId: foodId }).onDuplicateKeyUpdate({ set: { userId } });
      } else {
        await db.delete(foodFavorites).where(and(eq(foodFavorites.userId, userId), eq(foodFavorites.foodCatalogId, foodId)));
      }
    } catch (error) {
      logPersistenceWarning("Food favorite write skipped", error);
    }
  }

  const [food] = await searchFoods(userId, "", 200);
  return (await searchFoods(userId, "", 200)).find(item => item.id === foodId) ?? food;
}

export type FoodUpsertInput = {
  foodId?: number;
  name: string;
  brandName?: string | null;
  servingSize: number;
  servingUnit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  isFruit?: boolean;
  isVegetable?: boolean;
  isUltraProcessed?: boolean;
  source: string;
  foodType: "generic" | "branded";
};

export async function createUserFood(userId: number, input: FoodUpsertInput) {
  const food: FoodSearchItem = {
    id: foodIdSequence++,
    name: input.name,
    brandName: input.brandName ?? null,
    servingSize: input.servingSize,
    servingUnit: input.servingUnit,
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    fiber: input.fiber ?? null,
    isFruit: input.isFruit ?? false,
    isVegetable: input.isVegetable ?? false,
    isUltraProcessed: input.isUltraProcessed ?? false,
    source: input.source || "manual",
    foodType: input.foodType,
    isUserCreated: true,
    createdByUserId: userId,
    isFavorite: false,
    lastUsedAt: null,
  };

  const db = await getDb();
  if (db) {
    try {
      const inserted = await db.insert(foodCatalog).values({
        slug: `${toSlug(`${input.brandName ?? ""} ${input.name}`)}-${userId}-${Date.now()}`,
        name: input.name,
        aliases: JSON.stringify([]),
        brandName: input.brandName ?? null,
        foodType: input.foodType,
        dataSource: input.source || "manual",
        servingLabel: `${input.servingSize} ${input.servingUnit}`,
        servingUnit: input.servingUnit,
        gramsPerServing: input.servingSize,
        calories: input.calories,
        protein: input.protein,
        carbs: input.carbs,
        fat: input.fat,
        fiber: input.fiber ?? null,
        isFruit: input.isFruit ? 1 : 0,
        isVegetable: input.isVegetable ? 1 : 0,
        isUltraProcessed: input.isUltraProcessed ? 1 : 0,
        isUserCreated: 1,
        createdByUserId: userId,
      });
      const insertedId = Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
      if (insertedId) food.id = insertedId;
    } catch (error) {
      logPersistenceWarning("Food creation persistence skipped", error);
    }
  }

  const current = userFoodStore.get(userId) ?? [];
  userFoodStore.set(userId, [food, ...current]);
  return food;
}

export async function updateUserFood(userId: number, input: FoodUpsertInput & { foodId: number }) {
  const current = userFoodStore.get(userId) ?? [];
  const existing = current.find(food => food.id === input.foodId);
  if (!existing) {
    const dbFoods = await searchFoods(userId, "", 200);
    const dbExisting = dbFoods.find(food => food.id === input.foodId && food.isUserCreated && food.createdByUserId === userId);
    if (!dbExisting) {
      throw new Error("Alimento criado pelo usuário não encontrado.");
    }
  }

  const updated: FoodSearchItem = {
    ...(existing ?? { id: input.foodId, isFavorite: false, lastUsedAt: null }),
    id: input.foodId,
    name: input.name,
    brandName: input.brandName ?? null,
    servingSize: input.servingSize,
    servingUnit: input.servingUnit,
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    fiber: input.fiber ?? null,
    isFruit: input.isFruit ?? false,
    isVegetable: input.isVegetable ?? false,
    isUltraProcessed: input.isUltraProcessed ?? false,
    source: input.source || "manual",
    foodType: input.foodType,
    isUserCreated: true,
    createdByUserId: userId,
  };

  const db = await getDb();
  if (db) {
    try {
      await db.update(foodCatalog).set({
        name: input.name,
        brandName: input.brandName ?? null,
        foodType: input.foodType,
        dataSource: input.source || "manual",
        servingLabel: `${input.servingSize} ${input.servingUnit}`,
        servingUnit: input.servingUnit,
        gramsPerServing: input.servingSize,
        calories: input.calories,
        protein: input.protein,
        carbs: input.carbs,
        fat: input.fat,
        fiber: input.fiber ?? null,
        isFruit: input.isFruit ? 1 : 0,
        isVegetable: input.isVegetable ? 1 : 0,
        isUltraProcessed: input.isUltraProcessed ? 1 : 0,
        updatedAt: new Date(),
      }).where(and(eq(foodCatalog.id, input.foodId), eq(foodCatalog.createdByUserId, userId)));
    } catch (error) {
      logPersistenceWarning("Food update persistence skipped", error);
    }
  }

  userFoodStore.set(userId, [updated, ...current.filter(food => food.id !== input.foodId)]);
  return updated;
}

async function resolveFoodCatalogIds(items: MealDraftItem[]) {
  const db = await getDb();
  if (!db || !items.length) {
    return new Map<string, number>();
  }

  try {
    const rows = await db.select().from(foodCatalog);
    const catalogIndex = new Map<string, number>();

    for (const row of rows) {
      const aliases = parseJsonArray<string>(row.aliases, []);
      const keys = [row.name, ...aliases].map(normalizeCatalogText);
      for (const key of keys) {
        if (key) {
          catalogIndex.set(key, row.id);
        }
      }
    }

    const resolved = new Map<string, number>();
    for (const item of items) {
      const directKey = normalizeCatalogText(item.canonicalName);
      const fallbackKey = normalizeCatalogText(item.foodName);
      const resolvedId = catalogIndex.get(directKey) ?? catalogIndex.get(fallbackKey);
      if (resolvedId) {
        resolved.set(item.canonicalName, resolvedId);
        resolved.set(item.foodName, resolvedId);
      }
    }

    return resolved;
  } catch (error) {
    logPersistenceWarning("Food catalog resolution skipped", error);
    return new Map<string, number>();
  }
}

async function persistGoalToDb(goals: NutritionGoal[]) {
  if (!goals.length) return;
  await nutritionGoalsRepository.replaceForUser(goals[0].userId, goals);
}

async function persistInferenceToDb(draft: PendingInference) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(mealInferences).values({
      draftId: draft.draftId,
      userId: draft.userId,
      source: draft.source,
      requestSummary: draft.processed.sourceText,
      sourceText: draft.processed.sourceText,
      transcript: draft.processed.transcript ?? null,
      mediaJson: JSON.stringify(draft.media),
      reasoning: draft.processed.reasoning,
      confidence: draft.processed.confidence,
      itemsJson: JSON.stringify(draft.processed.items),
      totalsJson: JSON.stringify(draft.processed.totals),
    });
  } catch (error) {
    try {
      await db.insert(mealInferences).values({
        userId: draft.userId,
        source: draft.source,
        requestSummary: draft.processed.sourceText,
        reasoning: draft.processed.reasoning,
        confidence: draft.processed.confidence,
        itemsJson: JSON.stringify(draft.processed.items),
        totalsJson: JSON.stringify(draft.processed.totals),
      } as any);
    } catch (legacyError) {
      logPersistenceWarning("Inference persistence skipped", legacyError);
    }
  }
}

async function persistMealToDb(meal: SavedMeal) {
  const db = await getDb();
  if (!db) return;

  try {
    const mealInsert = await db.insert(meals).values({
      userId: meal.userId,
      source: meal.source,
      status: meal.status,
      mealLabel: meal.mealLabel,
      notes: meal.notes ?? null,
      sourceText: meal.sourceText || null,
      transcript: meal.transcript ?? null,
      confidence: meal.confidence,
      occurredAt: new Date(meal.occurredAt),
    });

    const insertedMealId = Number((mealInsert as any)?.[0]?.insertId ?? (mealInsert as any)?.insertId ?? 0);
    const resolvedMealId = insertedMealId || meal.id;
    meal.id = resolvedMealId;

    if (meal.items.length) {
      const resolvedCatalogIds = await resolveFoodCatalogIds(meal.items);
      await db.insert(mealItems).values(
        meal.items.map(item => ({
          mealId: resolvedMealId,
          foodCatalogId: resolvedCatalogIds.get(item.canonicalName) ?? resolvedCatalogIds.get(item.foodName) ?? null,
          foodName: item.foodName,
          canonicalName: item.canonicalName,
          portionText: item.portionText,
          servings: item.servings,
          estimatedGrams: item.estimatedGrams,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          source: item.source,
        })),
      );
    }

    if (meal.media.length) {
      await db.insert(mealMedia).values(
        meal.media.map(media => ({
          mealId: resolvedMealId,
          mediaType: media.mediaType,
          storageKey: media.storageKey,
          storageUrl: media.storageUrl,
          mimeType: media.mimeType,
          originalFileName: media.originalFileName ?? null,
        })),
      );
    }
  } catch (error) {
    logPersistenceWarning("Meal persistence skipped", error);
  }
}

async function persistExerciseToDb(exercise: ExerciseEntry) {
  await exercisesRepository.insert(exercise);
}

async function updateExerciseInDb(exercise: ExerciseEntry) {
  await exercisesRepository.update(exercise);
}

async function deleteExerciseFromDb(userId: number, exerciseId: number) {
  await exercisesRepository.delete(userId, exerciseId);
}

async function updateMealInDb(meal: SavedMeal) {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(meals)
      .set({
        mealLabel: meal.mealLabel,
        notes: meal.notes ?? null,
        confidence: meal.confidence,
        occurredAt: new Date(meal.occurredAt),
        updatedAt: new Date(),
      })
      .where(and(eq(meals.userId, meal.userId), eq(meals.id, meal.id)));

    await db.delete(mealItems).where(eq(mealItems.mealId, meal.id));

    if (meal.items.length) {
      const resolvedCatalogIds = await resolveFoodCatalogIds(meal.items);
      await db.insert(mealItems).values(
        meal.items.map(item => ({
          mealId: meal.id,
          foodCatalogId: resolvedCatalogIds.get(item.canonicalName) ?? resolvedCatalogIds.get(item.foodName) ?? null,
          foodName: item.foodName,
          canonicalName: item.canonicalName,
          portionText: item.portionText,
          servings: item.servings,
          estimatedGrams: item.estimatedGrams,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          source: item.source,
        })),
      );
    }
  } catch (error) {
    logPersistenceWarning("Meal update skipped", error);
  }
}

async function deleteMealFromDb(userId: number, mealId: number) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.delete(mealItems).where(eq(mealItems.mealId, mealId));
    await db.delete(mealMedia).where(eq(mealMedia.mealId, mealId));
    await db.delete(meals).where(and(eq(meals.userId, userId), eq(meals.id, mealId)));
  } catch (error) {
    logPersistenceWarning("Meal deletion skipped", error);
  }
}

async function persistWaterGoalToDb(goal: WaterGoalEntry) {
  await waterRepository.upsertGoal(goal);
}

async function persistWaterLogToDb(log: WaterLogEntry) {
  await waterRepository.insertLog(log);
}

async function deleteWaterLogFromDb(userId: number, waterLogId: number) {
  await waterRepository.deleteLog(userId, waterLogId);
}

async function persistHabitsToDb(userId: number, habits: HabitMemoryState[]) {
  const db = await getDb();
  if (!db) return;

  try {
    for (const habit of habits) {
      await db.insert(habitMemories).values({
        userId,
        foodName: habit.foodName,
        typicalMealLabel: habit.typicalMealLabel ?? null,
        preferredPortionGrams: habit.preferredPortionGrams,
        notes: habit.notes ?? null,
        occurrenceCount: habit.occurrenceCount,
        lastSeenAt: new Date(habit.lastSeenAt),
      });
    }
  } catch (error) {
    logPersistenceWarning("Habit persistence skipped", error);
  }
}

async function persistLogToDb(entry: AdminLogEntry) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(inferenceLogs).values({
      userId: entry.userId ?? null,
      origin: entry.origin,
      status: entry.status,
      eventType: entry.eventType,
      detail: safeLogDetail(entry.detail),
    });
  } catch (error) {
    logPersistenceWarning("Log persistence skipped", error);
  }
}

async function loadGoalFromDb(userId: number) {
  return nutritionGoalsRepository.findByUserId(userId);
}

async function loadMealsFromDb(userId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const mealRows = await db.select().from(meals).where(eq(meals.userId, userId));
    if (!mealRows.length) return [];

    const builtMeals = await Promise.all(
      mealRows
        .filter(row => row.status === "confirmed")
        .map(async row => {
          const [itemRows, mediaRows] = await Promise.all([
            db.select().from(mealItems).where(eq(mealItems.mealId, row.id)),
            db.select().from(mealMedia).where(eq(mealMedia.mealId, row.id)),
          ]);

          const items: MealDraftItem[] = itemRows.map(item => ({
            foodName: item.foodName,
            canonicalName: item.canonicalName,
            portionText: item.portionText,
            servings: item.servings,
            estimatedGrams: item.estimatedGrams,
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            confidence: 0.9,
            source: item.source,
          }));

          const media: SavedMedia[] = mediaRows.map(media => ({
            id: media.id,
            mediaType: media.mediaType,
            storageKey: media.storageKey,
            storageUrl: media.storageUrl,
            mimeType: media.mimeType,
            originalFileName: media.originalFileName ?? undefined,
          }));

          return {
            id: row.id,
            userId: row.userId,
            source: row.source,
            mealLabel: row.mealLabel,
            status: "confirmed" as const,
            occurredAt: new Date(row.occurredAt).getTime(),
            notes: row.notes ?? undefined,
            sourceText: row.sourceText ?? "",
            transcript: row.transcript ?? undefined,
            confidence: row.confidence,
            items,
            media,
            createdAt: new Date(row.createdAt).getTime(),
          } satisfies SavedMeal;
        }),
    );

    builtMeals.sort((a, b) => b.occurredAt - a.occurredAt);
    return builtMeals;
  } catch (error) {
    logPersistenceWarning("Meal read skipped", error);
    return null;
  }
}

async function loadExercisesFromDb(userId: number) {
  return exercisesRepository.findByUserId(userId);
}

async function loadWaterGoalFromDb(userId: number) {
  return waterRepository.findGoalByUserId(userId);
}

async function loadWaterLogsFromDb(userId: number) {
  return waterRepository.findLogsByUserId(userId);
}

async function loadWeightEntriesFromDb(userId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(weightEntries).where(eq(weightEntries.userId, userId));
    return rows
      .map(row => ({
        ...row,
        measuredAt: new Date(row.measuredAt),
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      }))
      .sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime());
  } catch (error) {
    logPersistenceWarning("Weight entries read skipped", error);
    return null;
  }
}

async function loadHabitsFromDb(userId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(habitMemories).where(eq(habitMemories.userId, userId));
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
  } catch (error) {
    logPersistenceWarning("Habit read skipped", error);
    return null;
  }
}

async function loadRecentLogsFromDb() {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(inferenceLogs).orderBy(desc(inferenceLogs.createdAt)).limit(20);
    return rows.map(row => ({
      id: String(row.id),
      userId: row.userId ?? undefined,
      origin: row.origin,
      status: row.status,
      eventType: row.eventType,
      detail: row.detail,
      createdAt: new Date(row.createdAt).getTime(),
    } satisfies AdminLogEntry));
  } catch (error) {
    logPersistenceWarning("Log read skipped", error);
    return null;
  }
}

async function getStoredNutritionGoals(userId: number) {
  const dbGoals = await loadGoalFromDb(userId);
  if (dbGoals?.length) {
    if (canUseMemoryPersistenceFallback()) {
      goalStore.set(userId, dbGoals);
    }
    return dbGoals;
  }

  if (canUseMemoryPersistenceFallback()) {
    const stored = goalStore.get(userId);
    if (stored?.length) {
      return stored;
    }
  }

  const created = [defaultGoal(userId)];
  if (canUseMemoryPersistenceFallback()) {
    goalStore.set(userId, created);
  }
  return created;
}

export async function getUserNutritionGoal(userId: number) {
  const goals = await getStoredNutritionGoals(userId);
  return buildGoalSummary(goals, userId);
}

export async function upsertNutritionGoal(userId: number, input: GoalInput) {
  const now = new Date();
  const effectiveFrom = startOfWeek(now);
  const currentGoals = await getStoredNutritionGoals(userId);
  const historicalGoals = currentGoals.map(goal => {
    const existingEnd = goal.effectiveUntil ? new Date(goal.effectiveUntil).getTime() : Number.POSITIVE_INFINITY;
    if (existingEnd <= now.getTime()) {
      return goal;
    }

    return {
      ...goal,
      effectiveUntil: now,
      updatedAt: now,
    };
  });

  const updated: NutritionGoal[] = [
    {
      id: goalIdSequence++,
      userId,
      ruleType: "default",
      weekday: DEFAULT_GOAL_WEEKDAY,
      durationType: "always",
      calories: input.defaultGoal.calories,
      proteinGrams: input.defaultGoal.proteinGrams,
      carbsGrams: input.defaultGoal.carbsGrams,
      fatGrams: input.defaultGoal.fatGrams,
      effectiveFrom,
      effectiveUntil: null,
      createdAt: now,
      updatedAt: now,
    },
    ...input.exceptions.map(exception => ({
      id: exception.id ?? goalIdSequence++,
      userId,
      ruleType: "exception" as const,
      weekday: exception.weekday,
      durationType: exception.durationType,
      calories: exception.calories,
      proteinGrams: exception.proteinGrams,
      carbsGrams: exception.carbsGrams,
      fatGrams: exception.fatGrams,
      effectiveFrom,
      effectiveUntil: buildExceptionEndDate(effectiveFrom, exception.durationType),
      createdAt: now,
      updatedAt: now,
    })),
  ];

  if (canUseMemoryPersistenceFallback()) {
    goalStore.set(userId, [...historicalGoals, ...updated]);
  }
  await persistGoalToDb(updated);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "goal.updated",
    detail: "Meta padrão e exceções nutricionais atualizadas pelo usuário.",
  });
  return buildGoalSummary([...historicalGoals, ...updated], userId);
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
    const rows = await db.select().from(mealInferences).where(eq(mealInferences.draftId, draftId)).limit(1);
    const row = rows[0];
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

export async function getUserDayMealTotals(userId: number, date: string) {
  const key = date || dateKey(new Date());
  const mealsForUser = await listUserMeals(userId);
  const mealsOnDay = mealsForUser.filter(meal => dateKey(new Date(meal.occurredAt)) === key);
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
      const rows = await db.select().from(mealFavorites).where(eq(mealFavorites.userId, userId));
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
      await db.insert(mealFavorites).values({
        userId: input.userId,
        name: favorite.name,
        mealLabel: favorite.mealLabel,
        notes: favorite.notes ?? null,
        itemsJson: JSON.stringify(favorite.items),
      }).onDuplicateKeyUpdate({
        set: {
          mealLabel: favorite.mealLabel,
          notes: favorite.notes ?? null,
          itemsJson: JSON.stringify(favorite.items),
        },
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

export async function updateUserMeal(input: {
  userId: number;
  mealId: number;
  mealLabel: string;
  occurredAt: string;
  notes?: string;
  items: MealDraftItem[];
}) {
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
  await updateHabitsFromMeal(updatedMeal);
  logInferenceEvent({
    userId: input.userId,
    origin: "web",
    status: "success",
    eventType: "meal.manual_updated",
    detail: `Refeição ${updatedMeal.mealLabel} atualizada manualmente pelo usuário.`,
  });
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

async function getStoredWaterGoal(userId: number) {
  const dbGoal = await loadWaterGoalFromDb(userId);
  if (dbGoal) {
    if (canUseMemoryPersistenceFallback()) {
      waterGoalStore.set(userId, dbGoal);
    }
    return dbGoal;
  }

  if (canUseMemoryPersistenceFallback()) {
    const stored = waterGoalStore.get(userId);
    if (stored) {
      return stored;
    }
  }

  const created: WaterGoalEntry = {
    id: waterGoalIdSequence++,
    userId,
    dailyTargetMl: 2500,
    createdAt: Date.now(),
    updatedAt: new Date(),
  };
  if (canUseMemoryPersistenceFallback()) {
    waterGoalStore.set(userId, created);
  }
  return created;
}

async function getStoredWaterLogs(userId: number) {
  const dbLogs = await loadWaterLogsFromDb(userId);
  if (dbLogs) {
    if (canUseMemoryPersistenceFallback()) {
      waterLogStore.set(userId, dbLogs);
    }
    return dbLogs;
  }

  return canUseMemoryPersistenceFallback() ? waterLogStore.get(userId) ?? [] : [];
}

export async function getUserWaterGoal(userId: number) {
  return getStoredWaterGoal(userId);
}

export async function listUserWaterLogs(userId: number) {
  const logs = await getStoredWaterLogs(userId);
  return logs.slice().sort((a, b) => b.occurredAt - a.occurredAt);
}

export async function updateUserWaterGoal(userId: number, dailyTargetMl: number) {
  const current = await getStoredWaterGoal(userId);
  const updated: WaterGoalEntry = {
    ...current,
    dailyTargetMl,
    updatedAt: new Date(),
  };
  if (canUseMemoryPersistenceFallback()) {
    waterGoalStore.set(userId, updated);
  }
  await persistWaterGoalToDb(updated);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "water.goal_updated",
    detail: `Meta diária de água atualizada para ${dailyTargetMl} ml.`,
  });
  return updated;
}

export async function createUserWaterLog(userId: number, input: { amountMl: number; occurredAt: string }) {
  const created: WaterLogEntry = {
    id: waterLogIdSequence++,
    userId,
    amountMl: input.amountMl,
    occurredAt: new Date(input.occurredAt).getTime(),
    createdAt: Date.now(),
    updatedAt: new Date(),
  };

  const current = await listUserWaterLogs(userId);
  if (canUseMemoryPersistenceFallback()) {
    waterLogStore.set(userId, [created, ...current.filter(item => item.id !== created.id)]);
  }
  await persistWaterLogToDb(created);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "water.logged",
    detail: `Consumo de ${created.amountMl} ml de água registrado.`,
  });
  return created;
}

export async function removeUserWaterLog(userId: number, waterLogId: number) {
  const current = await listUserWaterLogs(userId);
  const existing = current.find(item => item.id === waterLogId);
  if (!existing) {
    throw new Error("Registro de água não encontrado.");
  }

  if (canUseMemoryPersistenceFallback()) {
    waterLogStore.set(userId, current.filter(item => item.id !== waterLogId));
  }
  await deleteWaterLogFromDb(userId, waterLogId);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "water.deleted",
    detail: `Registro de água de ${existing.amountMl} ml removido pelo usuário.`,
  });
  return { success: true };
}

async function getStoredExercises(userId: number) {
  const dbExercises = await loadExercisesFromDb(userId);
  if (dbExercises) {
    if (canUseMemoryPersistenceFallback()) {
      exerciseStore.set(userId, dbExercises);
    }
    return dbExercises;
  }

  return canUseMemoryPersistenceFallback() ? exerciseStore.get(userId) ?? [] : [];
}

export async function listUserExercises(userId: number) {
  const exercisesForUser = await getStoredExercises(userId);
  return exercisesForUser.slice().sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt));
}

export async function createUserExercise(userId: number, input: {
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  occurredAt: string;
  notes?: string;
}) {
  const created: ExerciseEntry = {
    id: exerciseIdSequence++,
    userId,
    activityType: input.activityType,
    durationMinutes: input.durationMinutes,
    caloriesBurned: input.caloriesBurned,
    notes: input.notes ?? null,
    occurredAt: new Date(input.occurredAt).getTime(),
    createdAt: Date.now(),
    updatedAt: new Date(),
  };

  const current = await listUserExercises(userId);
  if (canUseMemoryPersistenceFallback()) {
    exerciseStore.set(userId, [created, ...current.filter(item => item.id !== created.id)]);
  }
  await persistExerciseToDb(created);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "exercise.created",
    detail: `Exercício ${created.activityType} registrado com gasto de ${round(created.caloriesBurned)} kcal.`,
  });
  return created;
}

export async function updateUserExercise(userId: number, input: {
  exerciseId: number;
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  occurredAt: string;
  notes?: string;
}) {
  const current = await listUserExercises(userId);
  const existing = current.find(item => item.id === input.exerciseId);
  if (!existing) {
    throw new Error("Exercício não encontrado.");
  }

  const updated: ExerciseEntry = {
    ...existing,
    activityType: input.activityType,
    durationMinutes: input.durationMinutes,
    caloriesBurned: input.caloriesBurned,
    occurredAt: new Date(input.occurredAt).getTime(),
    notes: input.notes ?? null,
    updatedAt: new Date(),
  };

  if (canUseMemoryPersistenceFallback()) {
    exerciseStore.set(
      userId,
      current
        .map(item => (item.id === input.exerciseId ? updated : item))
        .sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt)),
    );
  }
  await updateExerciseInDb(updated);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "exercise.updated",
    detail: `Exercício ${updated.activityType} atualizado pelo usuário.`,
  });
  return updated;
}

export async function removeUserExercise(userId: number, exerciseId: number) {
  const current = await listUserExercises(userId);
  const existing = current.find(item => item.id === exerciseId);
  if (!existing) {
    throw new Error("Exercício não encontrado.");
  }

  if (canUseMemoryPersistenceFallback()) {
    exerciseStore.set(userId, current.filter(item => item.id !== exerciseId));
  }
  await deleteExerciseFromDb(userId, exerciseId);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "exercise.deleted",
    detail: `Exercício ${existing.activityType} removido pelo usuário.`,
  });
  return { success: true };
}

export async function getWeeklySummary(userId: number) {
  const goal = await getUserNutritionGoal(userId);
  const waterGoal = await getUserWaterGoal(userId);
  const mealsForUser = await listUserMeals(userId);
  const exercisesForUser = await listUserExercises(userId);
  const waterLogsForUser = await listUserWaterLogs(userId);
  const monday = startOfLocalWeek(new Date());

  const days = Array.from({ length: 7 }).map((_, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    return current;
  });

  return Promise.all(days.map(async (day, index) => {
    const key = dateKey(day);
    const dailyMeals = mealsForUser.filter(meal => dateKey(new Date(meal.occurredAt)) === key);
    const dailyExercises = exercisesForUser.filter(exercise => dateKey(new Date(Number(exercise.occurredAt))) === key);
    const dailyWaterLogs = waterLogsForUser.filter(log => dateKey(new Date(Number(log.occurredAt))) === key);
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

async function listUserWeightEntries(userId: number) {
  const dbEntries = await loadWeightEntriesFromDb(userId);
  if (dbEntries) {
    if (canUseMemoryPersistenceFallback()) {
      weightEntryStore.set(userId, dbEntries);
    }
    return dbEntries;
  }

  const memoryEntries = weightEntryStore.get(userId);
  if (memoryEntries?.length) return memoryEntries;

  const onboardingProfile = onboardingProfileStore.get(userId);
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

export async function getWeeklyProgress(userId: number) {
  const [days, weights] = await Promise.all([
    getWeeklySummary(userId),
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
      date: dateKey(new Date(entry.measuredAt)),
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

export async function getDashboardSnapshot(userId: number) {
  const goal = await getUserNutritionGoal(userId);
  const waterGoal = await getUserWaterGoal(userId);
  const mealsForUser = await listUserMeals(userId);
  const exercisesForUser = await listUserExercises(userId);
  const waterLogsForUser = await listUserWaterLogs(userId);
  const todayKey = dateKey(new Date());
  const todaysMeals = mealsForUser.filter(meal => dateKey(new Date(meal.occurredAt)) === todayKey);
  const todaysExercises = exercisesForUser.filter(exercise => dateKey(new Date(Number(exercise.occurredAt))) === todayKey);
  const todaysWaterLogs = waterLogsForUser.filter(log => dateKey(new Date(Number(log.occurredAt))) === todayKey);
  const todayTotals = sumMeals(todaysMeals);
  const todayBurnedCalories = sumExercises(todaysExercises);
  const todayWaterMl = sumWater(todaysWaterLogs);
  const todayQuality = await calculateQualityIndicators(userId, todaysMeals, todayWaterMl);

  const [weekly, habits] = await Promise.all([
    getWeeklySummary(userId),
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
        remainingToGoal: round(goal.today.calories - (todayTotals.calories - todayBurnedCalories)),
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
    try {
      return await db.select().from(users).orderBy(desc(users.lastSignedIn)).limit(25);
    } catch {
      // continue with synthetic list
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
      const [mealRows, recentLogs] = await Promise.all([
        db.select().from(meals),
        loadRecentLogsFromDb(),
      ]);

      return {
        usage: {
          usersCount: usersList.length,
          mealsCount: mealRows.filter(row => row.status === "confirmed").length,
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

export async function exportUserPrivacyData(userId: number) {
  const db = await getDb();
  const [profile, goals, mealsForUser, exercisesForUser, waterGoal, waterLogsForUser, weeklyProgress, whatsappConnection] =
    await Promise.all([
      db ? db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1) : Promise.resolve([]),
      getStoredNutritionGoals(userId),
      listUserMeals(userId),
      listUserExercises(userId),
      getUserWaterGoal(userId),
      listUserWaterLogs(userId),
      getWeeklyProgress(userId),
      getUserWhatsappConnection(userId),
    ]);

  const dbUser = db ? await db.select().from(users).where(eq(users.id, userId)).limit(1) : [];
  const dbPreferences = db ? await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)) : [];
  const dbRestrictions = db ? await db.select().from(userRestrictions).where(eq(userRestrictions.userId, userId)) : [];

  return {
    exportedAt: new Date().toISOString(),
    policy: {
      format: "JSON",
      scope: "Dados principais da conta, rotina alimentar, metas, peso, hidratação, exercícios, preferências e consentimentos ativos.",
      sensitiveDataNotice: "Este arquivo pode conter dados pessoais e dados sensíveis de saúde.",
    },
    account: dbUser[0]
      ? {
          id: dbUser[0].id,
          name: dbUser[0].name,
          email: dbUser[0].email,
          loginMethod: dbUser[0].loginMethod,
          role: dbUser[0].role,
          createdAt: dbUser[0].createdAt,
          updatedAt: dbUser[0].updatedAt,
          lastSignedIn: dbUser[0].lastSignedIn,
        }
      : { id: userId },
    profile: profile[0] ?? onboardingProfileStore.get(userId) ?? null,
    nutritionGoals: goals,
    meals: mealsForUser,
    favoriteMeals: favoriteMealStore.get(userId) ?? [],
    exercises: exercisesForUser,
    water: {
      goal: waterGoal,
      logs: waterLogsForUser,
    },
    weight: weeklyProgress.weight,
    preferences: dbPreferences,
    restrictions: dbRestrictions,
    whatsapp: whatsappConnection
      ? {
          status: whatsappConnection.status,
          phoneNumber: whatsappConnection.phoneNumber,
          displayName: whatsappConnection.displayName,
          createdAt: whatsappConnection.createdAt,
          updatedAt: whatsappConnection.updatedAt,
        }
      : null,
    professionalSharing: "Compartilhamento operacional depende de solicitação pendente e aprovação explícita do paciente.",
    healthIntegrations: "Integrações de saúde exigem consentimento no módulo healthIntegrations antes da sincronização.",
  };
}

function deleteUserMemoryData(userId: number) {
  goalStore.delete(userId);
  onboardingProfileStore.delete(userId);
  mealStore.delete(userId);
  exerciseStore.delete(userId);
  waterGoalStore.delete(userId);
  waterLogStore.delete(userId);
  weightEntryStore.delete(userId);
  habitStore.delete(userId);
  userFoodStore.delete(userId);
  favoriteFoodStore.delete(userId);
  favoriteMealStore.delete(userId);
  gamificationSettingsStore.delete(userId);
  userBadgeStore.delete(userId);

  for (const [draftId, draft] of Array.from(inferenceStore.entries())) {
    if (draft.userId === userId) inferenceStore.delete(draftId);
  }

  for (let index = whatsappConnectionStore.length - 1; index >= 0; index -= 1) {
    if (whatsappConnectionStore[index].userId === userId) whatsappConnectionStore.splice(index, 1);
  }
}

export async function requestUserAccountDeletion(userId: number) {
  const db = await getDb();
  if (db) {
    const mealIdsForUser = db.select({ id: meals.id }).from(meals).where(eq(meals.userId, userId));
    await db.delete(mealItems).where(inArray(mealItems.mealId, mealIdsForUser));
    await db.delete(mealMedia).where(inArray(mealMedia.mealId, mealIdsForUser));
    await db.delete(mealInferences).where(eq(mealInferences.userId, userId));
    await db.delete(inferenceLogs).where(eq(inferenceLogs.userId, userId));
    await db.delete(foodFavorites).where(eq(foodFavorites.userId, userId));
    await db.delete(mealFavorites).where(eq(mealFavorites.userId, userId));
    await db.delete(habitMemories).where(eq(habitMemories.userId, userId));
    await db.delete(dailySummaries).where(eq(dailySummaries.userId, userId));
    await db.delete(exercises).where(eq(exercises.userId, userId));
    await db.delete(waterLogs).where(eq(waterLogs.userId, userId));
    await db.delete(waterGoals).where(eq(waterGoals.userId, userId));
    await db.delete(weightEntries).where(eq(weightEntries.userId, userId));
    await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
    await db.delete(userRestrictions).where(eq(userRestrictions.userId, userId));
    await db.delete(userBadges).where(eq(userBadges.userId, userId));
    await db.delete(userGamificationSettings).where(eq(userGamificationSettings.userId, userId));
    await db.delete(whatsappConnections).where(eq(whatsappConnections.userId, userId));
    await db.update(foodCatalog).set({ createdByUserId: null }).where(eq(foodCatalog.createdByUserId, userId));
    await db.update(appSecrets).set({ updatedByUserId: null }).where(eq(appSecrets.updatedByUserId, userId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await db.delete(meals).where(eq(meals.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }

  deleteUserMemoryData(userId);

  return {
    success: true,
    deletedAt: new Date().toISOString(),
    scope: "Conta e dados principais vinculados ao usuário removidos ou desvinculados.",
  } as const;
}

export function buildSavedMedia(input: Omit<SavedMedia, "id">) {
  return {
    ...input,
    id: mediaIdSequence++,
  };
}
