import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import type { GamificationRepository } from "../../repositories/gamificationRepository";

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

export type WeeklyGamificationDay = {
  quality: { mealCount: number };
  goalProtein: number;
  protein: number;
  waterConsumedMl: number;
};

export function createGamificationService(deps: {
  gamificationRepository: GamificationRepository;
  getDb: () => Promise<unknown>;
  getWeekStart: (timeZone: string) => string;
  getWeeklySummary: (userId: number, timeZone: string) => Promise<WeeklyGamificationDay[]>;
  listFavoriteMeals: (userId: number) => Promise<unknown[]>;
  listUserMeals: (userId: number) => Promise<Array<{ occurredAt: number; source: "web" | "whatsapp" }>>;
  parseJsonObject: (value: string | null | undefined, fallback: Record<string, unknown>) => Record<string, unknown>;
  onWarning: (scope: string, error: unknown) => void;
  now?: () => number;
}) {
  const gamificationSettingsStore = new Map<number, GamificationSettingEntry>();
  const userBadgeStore = new Map<number, UserBadgeEntry[]>();
  let userBadgeIdSequence = 1;
  const now = deps.now ?? (() => Date.now());

  async function getGamificationEnabled(userId: number) {
    const memory = gamificationSettingsStore.get(userId);
    if (memory) return memory.enabled;

    const db = await deps.getDb();
    if (db) {
      try {
        const row = await deps.gamificationRepository.findSettingByUserId(userId);
        if (row) {
          const setting = { userId, enabled: row.enabled === 1, updatedAt: new Date(row.updatedAt).getTime() };
          gamificationSettingsStore.set(userId, setting);
          return setting.enabled;
        }
      } catch (error) {
        deps.onWarning("Gamification settings read skipped", error);
      }
    }

    return true;
  }

  async function updateUserGamificationSettings(userId: number, enabled: boolean) {
    const setting = { userId, enabled, updatedAt: now() };
    gamificationSettingsStore.set(userId, setting);

    try {
      await deps.gamificationRepository.upsertSetting(userId, enabled);
    } catch (error) {
      deps.onWarning("Gamification settings persistence skipped", error);
    }

    return { enabled };
  }

  async function loadUserBadges(userId: number) {
    const db = await deps.getDb();
    if (db) {
      try {
        const rows = await deps.gamificationRepository.findBadgesByUserId(userId);
        const entries = rows.map(row => ({
          id: row.id,
          userId: row.userId,
          badgeCode: row.badgeCode as BadgeCode,
          earnedAt: new Date(row.earnedAt).getTime(),
          weekStart: row.weekStart ?? null,
          metadata: deps.parseJsonObject(row.metadataJson, {}),
        }));
        userBadgeStore.set(userId, entries);
        return entries;
      } catch (error) {
        deps.onWarning("User badges read skipped", error);
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
      earnedAt: now(),
      weekStart,
      metadata,
    };

    const db = await deps.getDb();
    if (db) {
      try {
        const insertedId = await deps.gamificationRepository.insertBadge({
          userId,
          badgeCode,
          weekStart,
          metadataJson: JSON.stringify(metadata),
        });
        if (insertedId) badge.id = insertedId;
      } catch (error) {
        deps.onWarning("User badge persistence skipped", error);
      }
    }

    userBadgeStore.set(userId, [badge, ...current]);
    return badge;
  }

  async function calculateEarnedBadgeCodes(userId: number, weekly: WeeklyGamificationDay[]): Promise<Array<{ code: BadgeCode; metadata: Record<string, unknown> }>> {
    const daysWithMeals = weekly.filter(day => day.quality.mealCount > 0).length;
    const daysWithProteinGoal = weekly.filter(day => day.goalProtein > 0 && day.protein >= day.goalProtein).length;
    const daysWithWater = weekly.filter(day => day.waterConsumedMl > 0).length;
    const favorites = await deps.listFavoriteMeals(userId);
    const meals = await deps.listUserMeals(userId);
    const hasPlannedMeal = meals.some(meal => meal.occurredAt > now() && meal.source === "web");
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

  async function getUserGamification(userId: number, weekly?: WeeklyGamificationDay[], timeZone = DEFAULT_APP_TIME_ZONE) {
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

    const weekStart = deps.getWeekStart(timeZone);
    const weeklyData = weekly ?? await deps.getWeeklySummary(userId, timeZone);
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

  function clearMemory(userId: number) {
    gamificationSettingsStore.delete(userId);
    userBadgeStore.delete(userId);
  }

  return {
    getUserGamification,
    updateUserGamificationSettings,
    loadUserBadges,
    clearMemory,
  };
}

export type GamificationService = ReturnType<typeof createGamificationService>;
