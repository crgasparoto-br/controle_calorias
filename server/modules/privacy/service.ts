export type PrivacyExportDeps = {
  getDb: () => Promise<unknown>;
  findUserById: (userId: number) => Promise<unknown>;
  findProfileByUserId: (userId: number) => Promise<unknown>;
  getOnboardingProfileMemory: (userId: number) => unknown;
  findPreferencesByUserId: (userId: number) => Promise<unknown[]>;
  findRestrictionsByUserId: (userId: number) => Promise<unknown[]>;
  getStoredNutritionGoals: (userId: number) => Promise<unknown>;
  listProfessionalGoalData?: (userId: number) => Promise<unknown>;
  listUserMeals: (userId: number) => Promise<unknown[]>;
  listFavoriteMeals: (userId: number) => unknown[];
  listUserExercises: (userId: number) => Promise<unknown[]>;
  getUserWaterGoal: (userId: number) => Promise<unknown>;
  listUserWaterLogs: (userId: number) => Promise<unknown[]>;
  getWeeklyProgress: (userId: number) => Promise<{ weight: unknown }>;
  getUserWhatsappConnection: (userId: number) => Promise<{
    status: string;
    phoneNumber: string;
    displayName: string | null;
    createdAt: unknown;
    updatedAt: unknown;
  } | null>;
};

export type PrivacyAccountDeletionDeps = {
  getDb: () => Promise<unknown>;
  purgeDatabaseUserData: (userId: number) => Promise<void>;
  purgeMemoryDomains: Array<(userId: number) => void>;
};

/**
 * Orchestrates privacy export and account deletion for domains that still live in server/db.ts
 * (e.g. meals). Callers inject the concrete read functions and purge callbacks per domain so this
 * module has no direct coupling to db.ts internals and no domain is silently skipped when new
 * domains are added — every purge step must be listed explicitly by the caller.
 */
export function createPrivacyService(deps: PrivacyExportDeps & PrivacyAccountDeletionDeps) {
  async function exportUserPrivacyData(userId: number) {
    const db = await deps.getDb();
    const [profile, goals, professionalGoals, mealsForUser, exercisesForUser, waterGoal, waterLogsForUser, weeklyProgress, whatsappConnection] =
      await Promise.all([
        db ? deps.findProfileByUserId(userId) : Promise.resolve(undefined),
        deps.getStoredNutritionGoals(userId),
        deps.listProfessionalGoalData?.(userId) ?? Promise.resolve(null),
        deps.listUserMeals(userId),
        deps.listUserExercises(userId),
        deps.getUserWaterGoal(userId),
        deps.listUserWaterLogs(userId),
        deps.getWeeklyProgress(userId),
        deps.getUserWhatsappConnection(userId),
      ]);

    const dbUser = db ? await deps.findUserById(userId) : undefined;
    const dbPreferences = db ? await deps.findPreferencesByUserId(userId) : [];
    const dbRestrictions = db ? await deps.findRestrictionsByUserId(userId) : [];

    const user = dbUser as
      | {
          id: number;
          name: unknown;
          email: unknown;
          loginMethod: unknown;
          role: unknown;
          createdAt: unknown;
          updatedAt: unknown;
          lastSignedIn: unknown;
        }
      | undefined;

    return {
      exportedAt: new Date().toISOString(),
      policy: {
        format: "JSON",
        scope: "Dados principais da conta, rotina alimentar, metas, peso, hidratação, exercícios, preferências e consentimentos ativos.",
        sensitiveDataNotice: "Este arquivo pode conter dados pessoais e dados sensíveis de saúde.",
      },
      account: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            loginMethod: user.loginMethod,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            lastSignedIn: user.lastSignedIn,
          }
        : { id: userId },
      profile: profile ?? deps.getOnboardingProfileMemory(userId) ?? null,
      nutritionGoals: goals,
      professionalGoals,
      meals: mealsForUser,
      favoriteMeals: deps.listFavoriteMeals(userId),
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

  async function requestUserAccountDeletion(userId: number) {
    const db = await deps.getDb();
    if (db) {
      await deps.purgeDatabaseUserData(userId);
    }

    for (const purgeDomain of deps.purgeMemoryDomains) {
      purgeDomain(userId);
    }

    return {
      success: true,
      deletedAt: new Date().toISOString(),
      scope: "Conta e dados principais vinculados ao usuário removidos ou desvinculados.",
    } as const;
  }

  return { exportUserPrivacyData, requestUserAccountDeletion };
}

export type PrivacyService = ReturnType<typeof createPrivacyService>;
