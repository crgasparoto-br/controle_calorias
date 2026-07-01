import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const file = relativePath => path.join(root, relativePath);

function read(relativePath) {
  return readFileSync(file(relativePath), "utf8");
}

function write(relativePath, content) {
  mkdirSync(path.dirname(file(relativePath)), { recursive: true });
  writeFileSync(file(relativePath), content);
}

const serviceContent = `import { safeLogDetail } from "../../privacy";

type DatabaseState = unknown | null | undefined;

type MaybePromise<T> = T | Promise<T>;

type AccountUser = {
  id: number;
  name: string | null;
  email: string | null;
  loginMethod: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date | null;
};

type WhatsappConnection = {
  status: string;
  phoneNumber: string;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserProfileRepository = {
  findProfileByUserId(userId: number): Promise<unknown | undefined>;
  findPreferencesByUserId(userId: number): Promise<unknown[]>;
  findRestrictionsByUserId(userId: number): Promise<unknown[]>;
};

type UsersRepository = {
  findById(userId: number): Promise<AccountUser | undefined>;
};

type AccountRepository = {
  purgeUserData(userId: number): Promise<void>;
};

type ClearMemoryService = {
  clearMemory(userId: number): void;
};

type UsersService = ClearMemoryService & {
  getOnboardingProfileMemory(userId: number): unknown | undefined;
};

export type PrivacyAccountServiceDependencies = {
  getDb(): Promise<DatabaseState>;
  accountRepository: AccountRepository;
  usersRepository: UsersRepository;
  userProfileRepository: UserProfileRepository;
  usersService: UsersService;
  goalsService: ClearMemoryService;
  exercisesService: ClearMemoryService;
  waterService: ClearMemoryService;
  foodsService: ClearMemoryService;
  gamificationService: ClearMemoryService;
  getStoredNutritionGoals(userId: number): Promise<unknown[]>;
  listUserMeals(userId: number): Promise<unknown[]>;
  listUserExercises(userId: number): Promise<unknown[]>;
  getUserWaterGoal(userId: number): Promise<unknown>;
  listUserWaterLogs(userId: number): Promise<unknown[]>;
  getWeeklyProgress(userId: number): Promise<{ weight: unknown }>;
  getUserWhatsappConnection(userId: number): Promise<WhatsappConnection | null>;
  getFavoriteMealsMemory(userId: number): unknown[];
  clearMealMemory(userId: number): MaybePromise<void>;
  clearHabitMemory(userId: number): MaybePromise<void>;
  clearFavoriteMealMemory(userId: number): MaybePromise<void>;
  clearPendingInferenceMemory(userId: number): MaybePromise<void>;
  clearWhatsappConnectionMemory(userId: number): MaybePromise<void>;
  onWarning?: (scope: string, detail: string) => void;
  now?: () => Date;
};

export function createPrivacyAccountService(deps: PrivacyAccountServiceDependencies) {
  const now = deps.now ?? (() => new Date());

  async function exportUserPrivacyData(userId: number) {
    const db = await deps.getDb();
    const [profile, goals, mealsForUser, exercisesForUser, waterGoal, waterLogsForUser, weeklyProgress, whatsappConnection] =
      await Promise.all([
        db ? deps.userProfileRepository.findProfileByUserId(userId) : Promise.resolve(undefined),
        deps.getStoredNutritionGoals(userId),
        deps.listUserMeals(userId),
        deps.listUserExercises(userId),
        deps.getUserWaterGoal(userId),
        deps.listUserWaterLogs(userId),
        deps.getWeeklyProgress(userId),
        deps.getUserWhatsappConnection(userId),
      ]);

    const dbUser = db ? await deps.usersRepository.findById(userId) : undefined;
    const dbPreferences = db ? await deps.userProfileRepository.findPreferencesByUserId(userId) : [];
    const dbRestrictions = db ? await deps.userProfileRepository.findRestrictionsByUserId(userId) : [];

    return {
      exportedAt: now().toISOString(),
      policy: {
        format: "JSON",
        scope: "Dados principais da conta, rotina alimentar, metas, peso, hidratação, exercícios, preferências e consentimentos ativos.",
        sensitiveDataNotice: "Este arquivo pode conter dados pessoais e dados sensíveis de saúde.",
      },
      account: dbUser
        ? {
            id: dbUser.id,
            name: dbUser.name,
            email: dbUser.email,
            loginMethod: dbUser.loginMethod,
            role: dbUser.role,
            createdAt: dbUser.createdAt,
            updatedAt: dbUser.updatedAt,
            lastSignedIn: dbUser.lastSignedIn,
          }
        : { id: userId },
      profile: profile ?? deps.usersService.getOnboardingProfileMemory(userId) ?? null,
      nutritionGoals: goals,
      meals: mealsForUser,
      favoriteMeals: deps.getFavoriteMealsMemory(userId),
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

  async function deleteUserMemoryData(userId: number) {
    deps.goalsService.clearMemory(userId);
    deps.usersService.clearMemory(userId);
    await deps.clearMealMemory(userId);
    deps.exercisesService.clearMemory(userId);
    deps.waterService.clearMemory(userId);
    await deps.clearHabitMemory(userId);
    deps.foodsService.clearMemory(userId);
    await deps.clearFavoriteMealMemory(userId);
    deps.gamificationService.clearMemory(userId);
    await deps.clearPendingInferenceMemory(userId);
    await deps.clearWhatsappConnectionMemory(userId);
  }

  async function requestUserAccountDeletion(userId: number) {
    try {
      const db = await deps.getDb();
      if (db) {
        await deps.accountRepository.purgeUserData(userId);
      }

      await deleteUserMemoryData(userId);

      return {
        success: true,
        deletedAt: now().toISOString(),
        scope: "Conta e dados principais vinculados ao usuário removidos ou desvinculados.",
      } as const;
    } catch (error) {
      deps.onWarning?.("Account deletion skipped", safeLogDetail(error));
      throw error;
    }
  }

  return {
    exportUserPrivacyData,
    requestUserAccountDeletion,
  };
}
`;

const testContent = `import { describe, expect, it, vi } from "vitest";
import { createPrivacyAccountService, type PrivacyAccountServiceDependencies } from "./service";

function createDeps(overrides: Partial<PrivacyAccountServiceDependencies> = {}) {
  const calls: string[] = [];
  const deps: PrivacyAccountServiceDependencies = {
    getDb: async () => null,
    accountRepository: {
      purgeUserData: async userId => {
        calls.push(\`db:\${userId}\`);
      },
    },
    usersRepository: {
      findById: async () => undefined,
    },
    userProfileRepository: {
      findProfileByUserId: async () => undefined,
      findPreferencesByUserId: async () => [],
      findRestrictionsByUserId: async () => [],
    },
    usersService: {
      getOnboardingProfileMemory: () => undefined,
      clearMemory: () => calls.push("users"),
    },
    goalsService: {
      clearMemory: () => calls.push("goals"),
    },
    exercisesService: {
      clearMemory: () => calls.push("exercises"),
    },
    waterService: {
      clearMemory: () => calls.push("water"),
    },
    foodsService: {
      clearMemory: () => calls.push("foods"),
    },
    gamificationService: {
      clearMemory: () => calls.push("gamification"),
    },
    getStoredNutritionGoals: async () => [],
    listUserMeals: async () => [],
    listUserExercises: async () => [],
    getUserWaterGoal: async () => ({ dailyTargetMl: 2500 }),
    listUserWaterLogs: async () => [],
    getWeeklyProgress: async () => ({ weight: [] }),
    getUserWhatsappConnection: async () => null,
    getFavoriteMealsMemory: () => [],
    clearMealMemory: () => calls.push("meals"),
    clearHabitMemory: () => calls.push("habits"),
    clearFavoriteMealMemory: () => calls.push("favoriteMeals"),
    clearPendingInferenceMemory: () => calls.push("inferences"),
    clearWhatsappConnectionMemory: () => calls.push("whatsapp"),
    now: () => new Date("2026-07-01T12:00:00.000Z"),
    ...overrides,
  };

  return { deps, calls };
}

describe("createPrivacyAccountService", () => {
  it("preserva formato de exportacao com fallback em memoria e dominios vazios", async () => {
    const { deps } = createDeps({
      usersService: {
        getOnboardingProfileMemory: () => ({ age: 38, goal: "manutencao" }),
        clearMemory: vi.fn(),
      },
      getStoredNutritionGoals: async () => [{ calories: 2200 }],
      getFavoriteMealsMemory: () => [{ id: 9, name: "Almoco" }],
    });
    const service = createPrivacyAccountService(deps);

    const exported = await service.exportUserPrivacyData(7);

    expect(exported).toMatchObject({
      exportedAt: "2026-07-01T12:00:00.000Z",
      policy: { format: "JSON" },
      account: { id: 7 },
      profile: { age: 38, goal: "manutencao" },
      nutritionGoals: [{ calories: 2200 }],
      favoriteMeals: [{ id: 9, name: "Almoco" }],
      meals: [],
      exercises: [],
      water: { goal: { dailyTargetMl: 2500 }, logs: [] },
      weight: [],
      preferences: [],
      restrictions: [],
      whatsapp: null,
    });
  });

  it("preserva dados observaveis quando banco esta disponivel", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const updatedAt = new Date("2026-01-02T00:00:00.000Z");
    const lastSignedIn = new Date("2026-01-03T00:00:00.000Z");
    const { deps } = createDeps({
      getDb: async () => ({}),
      usersRepository: {
        findById: async userId => ({
          id: userId,
          name: "Pessoa Teste",
          email: "pessoa@example.com",
          loginMethod: "password",
          role: "user",
          createdAt,
          updatedAt,
          lastSignedIn,
        }),
      },
      userProfileRepository: {
        findProfileByUserId: async () => ({ height: 180 }),
        findPreferencesByUserId: async () => [{ key: "diet", value: "vegetariana" }],
        findRestrictionsByUserId: async () => [{ name: "amendoim" }],
      },
      getUserWhatsappConnection: async () => ({
        status: "active",
        phoneNumber: "5511999999999",
        displayName: "Pessoa",
        createdAt,
        updatedAt,
      }),
    });
    const service = createPrivacyAccountService(deps);

    const exported = await service.exportUserPrivacyData(11);

    expect(exported.account).toEqual({
      id: 11,
      name: "Pessoa Teste",
      email: "pessoa@example.com",
      loginMethod: "password",
      role: "user",
      createdAt,
      updatedAt,
      lastSignedIn,
    });
    expect(exported.profile).toEqual({ height: 180 });
    expect(exported.preferences).toEqual([{ key: "diet", value: "vegetariana" }]);
    expect(exported.restrictions).toEqual([{ name: "amendoim" }]);
    expect(exported.whatsapp).toEqual({
      status: "active",
      phoneNumber: "5511999999999",
      displayName: "Pessoa",
      createdAt,
      updatedAt,
    });
  });

  it("orquestra purge de banco e memoria na mesma ordem do fluxo legado", async () => {
    const { deps, calls } = createDeps({ getDb: async () => ({}) });
    const service = createPrivacyAccountService(deps);

    const result = await service.requestUserAccountDeletion(42);

    expect(result).toEqual({
      success: true,
      deletedAt: "2026-07-01T12:00:00.000Z",
      scope: "Conta e dados principais vinculados ao usuário removidos ou desvinculados.",
    });
    expect(calls).toEqual([
      "db:42",
      "goals",
      "users",
      "meals",
      "exercises",
      "water",
      "habits",
      "foods",
      "favoriteMeals",
      "gamification",
      "inferences",
      "whatsapp",
    ]);
  });

  it("limpa memoria mesmo sem banco configurado", async () => {
    const { deps, calls } = createDeps({ getDb: async () => null });
    const service = createPrivacyAccountService(deps);

    await service.requestUserAccountDeletion(15);

    expect(calls).toEqual([
      "goals",
      "users",
      "meals",
      "exercises",
      "water",
      "habits",
      "foods",
      "favoriteMeals",
      "gamification",
      "inferences",
      "whatsapp",
    ]);
  });

  it("registra falhas de purge com detalhe sanitizado", async () => {
    const onWarning = vi.fn();
    const { deps } = createDeps({
      getDb: async () => ({}),
      accountRepository: {
        purgeUserData: async () => {
          throw new Error("Falha ao excluir telefone 5511999999999 com token Bearer abc.def.ghi");
        },
      },
      onWarning,
    });
    const service = createPrivacyAccountService(deps);

    await expect(service.requestUserAccountDeletion(77)).rejects.toThrow("Falha ao excluir telefone");

    expect(onWarning).toHaveBeenCalledWith(
      "Account deletion skipped",
      "Error: Falha ao excluir telefone [phone_redacted] com token Bearer [redacted]",
    );
  });
});
`;

function updateDb() {
  let content = read("server/db.ts");
  const importLine = 'import { createPrivacyAccountService } from "./modules/privacyAccount/service";\n';
  if (!content.includes(importLine)) {
    content = content.replace(
      'import { createWaterService, sumWater } from "./modules/water/store";\n',
      'import { createWaterService, sumWater } from "./modules/water/store";\n' + importLine,
    );
  }

  const facadeContent = `const privacyAccountService = createPrivacyAccountService({
  getDb,
  accountRepository,
  usersRepository,
  userProfileRepository,
  usersService,
  goalsService,
  exercisesService,
  waterService,
  foodsService,
  gamificationService,
  getStoredNutritionGoals,
  listUserMeals,
  listUserExercises,
  getUserWaterGoal,
  listUserWaterLogs,
  getWeeklyProgress,
  getUserWhatsappConnection,
  getFavoriteMealsMemory: userId => favoriteMealStore.get(userId) ?? [],
  clearMealMemory: userId => {
    mealStore.delete(userId);
  },
  clearHabitMemory: userId => {
    habitStore.delete(userId);
  },
  clearFavoriteMealMemory: userId => {
    favoriteMealStore.delete(userId);
  },
  clearPendingInferenceMemory: userId => {
    for (const [draftId, draft] of Array.from(inferenceStore.entries())) {
      if (draft.userId === userId) inferenceStore.delete(draftId);
    }
  },
  clearWhatsappConnectionMemory: userId => {
    for (let index = whatsappConnectionStore.length - 1; index >= 0; index -= 1) {
      if (whatsappConnectionStore[index].userId === userId) whatsappConnectionStore.splice(index, 1);
    }
  },
  onWarning: logPersistenceWarning,
});
export const exportUserPrivacyData = privacyAccountService.exportUserPrivacyData;
export const requestUserAccountDeletion = privacyAccountService.requestUserAccountDeletion;`;

  const privacyBlockPattern = /export async function exportUserPrivacyData\(userId: number\) \{[\s\S]*?\nexport function buildSavedMedia/;
  if (!privacyBlockPattern.test(content)) {
    throw new Error("Could not find privacy/account implementation block in server/db.ts");
  }

  content = content.replace(privacyBlockPattern, `${facadeContent}\n\nexport function buildSavedMedia`);
  write("server/db.ts", content);
}

function updateArchitecture() {
  let content = read("ARCHITECTURE.md");
  content = content.replace(
    "- [ ] `privacy/account`: mover exportação de privacidade, exclusão de dados em memória e orquestração de purge por domínio.",
    "- [x] `privacy/account`: mover exportação de privacidade, exclusão de dados em memória e orquestração de purge por domínio (`server/modules/privacyAccount/service.ts`), preservando `server/db.ts` como fachada compatível.",
  );
  write("ARCHITECTURE.md", content);
}

write("server/modules/privacyAccount/service.ts", serviceContent);
write("server/modules/privacyAccount/service.test.ts", testContent);
updateDb();
updateArchitecture();
