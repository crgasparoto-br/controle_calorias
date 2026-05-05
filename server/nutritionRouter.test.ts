import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return {
    ...actual,
    processMealInput: vi.fn(async () => ({
      detectedMealLabel: "Almoço",
      sourceText: "almocei arroz, feijão e frango grelhado",
      confidence: 0.88,
      needsConfirmation: true,
      reasoning: "Inferência simulada em teste.",
      items: [
        {
          foodName: "arroz",
          canonicalName: "Arroz branco cozido",
          portionText: "100 g",
          servings: 1,
          estimatedGrams: 100,
          calories: 130,
          protein: 2.7,
          carbs: 28,
          fat: 0.3,
          confidence: 0.92,
          source: "catalog" as const,
        },
        {
          foodName: "frango grelhado",
          canonicalName: "Frango grelhado",
          portionText: "150 g",
          servings: 1.5,
          estimatedGrams: 150,
          calories: 247.5,
          protein: 46.5,
          carbs: 0,
          fat: 5.4,
          confidence: 0.9,
          source: "catalog" as const,
        },
      ],
      totals: {
        calories: 377.5,
        protein: 49.2,
        carbs: 28,
        fat: 5.7,
      },
    })),
  };
});

const { appRouter } = await import("./routers");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createNutritionContext(userId: number, role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `user-${userId}`,
    email: `user-${userId}@example.com`,
    name: `User ${userId}`,
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => undefined,
    } as TrpcContext["res"],
  };
}

describe("nutrition router", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00-03:00"));
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-id-test";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("atualiza a meta padrão com exceções e reflete a regra efetiva no dashboard", async () => {
    const caller = appRouter.createCaller(createNutritionContext(501));

    await caller.nutrition.goals.update({
      defaultGoal: {
        calories: 2300,
        proteinGrams: 170,
        carbsGrams: 240,
        fatGrams: 76,
      },
      exceptions: [
        {
          weekday: 2,
          durationType: "2_weeks",
          calories: 2500,
          proteinGrams: 180,
          carbsGrams: 260,
          fatGrams: 80,
        },
        {
          weekday: 4,
          durationType: "always",
          calories: 2600,
          proteinGrams: 185,
          carbsGrams: 280,
          fatGrams: 82,
        },
      ],
    });

    await caller.nutrition.goals.update({
      defaultGoal: {
        calories: 2350,
        proteinGrams: 172,
        carbsGrams: 245,
        fatGrams: 78,
      },
      exceptions: [],
    });

    const overview = await caller.nutrition.dashboard.overview();

    expect(overview.goal.days).toHaveLength(7);
    expect(overview.goal.defaultGoal.calories).toBe(2350);
    expect(overview.goal.exceptions).toHaveLength(0);
    expect(overview.goal.today.calories).toBe(2350);
    expect(overview.goal.today.proteinGrams).toBe(172);
    expect(overview.goal.today.source).toBe("default");
    expect(overview.goal.weeklyTotals.calories).toBe(16600);
    expect(overview.today.goal.calories).toBe(2350);
    expect(overview.today.remaining.calories).toBe(2350);
  });

  it("bloqueia metas nutricionais extremas antes de salvar", async () => {
    const caller = appRouter.createCaller(createNutritionContext(502));

    await expect(caller.nutrition.goals.update({
      defaultGoal: {
        calories: 900,
        proteinGrams: 20,
        carbsGrams: 120,
        fatGrams: 10,
      },
      exceptions: [],
    })).rejects.toThrow("não podem ser salvas aqui");

    const goal = await caller.nutrition.goals.get();

    expect(goal.defaultGoal.calories).toBe(2200);
    expect(goal.safetyWarnings).toHaveLength(0);
  });

  it("salva metas com alerta e expõe avisos de segurança nutricional", async () => {
    const caller = appRouter.createCaller(createNutritionContext(503));

    const goal = await caller.nutrition.goals.update({
      defaultGoal: {
        calories: 1450,
        proteinGrams: 130,
        carbsGrams: 120,
        fatGrams: 45,
      },
      exceptions: [],
    });

    expect(goal.defaultGoal.calories).toBe(1450);
    expect(goal.safetyWarnings.map(issue => issue.code)).toContain("calories_low");
  });

  it("conclui onboarding, persiste perfil e cria meta nutricional inicial", async () => {
    const caller = appRouter.createCaller(createNutritionContext(504));

    const result = await caller.nutrition.onboarding.complete({
      name: "Gaspa",
      ageYears: 34,
      heightCm: 178,
      currentWeightKg: 82,
      objective: "ganhar_massa",
      activityLevel: "moderate",
      trackingExperience: "beginner",
      dietaryPreferences: ["comida caseira", "café da manhã simples"],
      dietaryRestrictions: ["lactose"],
      eatingRoutine: "misto",
      mainDifficulty: "falta_de_planejamento",
    });

    const goal = await caller.nutrition.goals.get();

    expect(result.profile.name).toBe("Gaspa");
    expect(result.profile.currentWeightKg).toBe(82);
    expect(result.calculation.calculatedGoal.calories).toBeGreaterThan(result.calculation.tdee);
    expect(goal.defaultGoal.calories).toBe(result.calculation.calculatedGoal.calories);
    expect(goal.defaultGoal.proteinGrams).toBe(result.calculation.calculatedGoal.proteinGrams);
  });

  it("simula entrada por WhatsApp e confirma a refeição revisada", async () => {
    const ctx = createNutritionContext(777, "admin");
    const caller = appRouter.createCaller(ctx);

    const simulated = await caller.nutrition.whatsapp.simulateInbound({
      text: "almocei arroz, feijão e frango grelhado",
    });

    expect(simulated.processed.items.length).toBeGreaterThan(0);

    const savedMeal = await caller.nutrition.meals.confirm({
      draftId: simulated.draftId,
      mealLabel: simulated.processed.detectedMealLabel,
      occurredAt: new Date().toISOString(),
      items: simulated.processed.items,
    });

    const overview = await caller.nutrition.dashboard.overview();
    const weekly = await caller.nutrition.reports.weekly();
    const admin = await caller.nutrition.admin.overview();

    expect(savedMeal.items.length).toBe(simulated.processed.items.length);
    expect(overview.meals.length).toBeGreaterThan(0);
    expect(overview.habits.length).toBeGreaterThan(0);
    expect(weekly).toHaveLength(7);
    expect(weekly[0]?.label).toBe("seg.");
    expect(weekly[6]?.label).toBe("dom.");
    expect(admin.usage.mealsCount).toBeGreaterThan(0);
  });

  it("expõe o status do WhatsApp fixo e permite vincular o telefone de origem ao usuário autenticado", async () => {
    const userId = 991001 + Math.floor(Math.random() * 100000);
    const ctx = createNutritionContext(userId, "admin");
    const caller = appRouter.createCaller(ctx);

    const initialStatus = await caller.nutrition.whatsapp.status();
    expect(initialStatus.currentUserId).toBe(userId);
    expect(initialStatus.configured).toBe(true);
    expect(initialStatus.channel.phoneNumber).toBe("5511000000000");
    expect(initialStatus.channel.phoneNumberId).toBe("phone-number-id-test");

    const uniquePhoneNumber = `55${String(userId).padStart(11, "0").slice(-11)}`;

    const saved = await caller.nutrition.whatsapp.upsertConnection({
      phoneNumber: uniquePhoneNumber,
      displayName: "Gaspa",
    });

    const updatedStatus = await caller.nutrition.whatsapp.status();

    expect(saved.phoneNumber).toBe(uniquePhoneNumber);
    expect(saved.status).toBe("active");
    expect(updatedStatus.connection?.phoneNumber).toBe(uniquePhoneNumber);
    expect(updatedStatus.connection?.displayName).toBe("Gaspa");
  });

  it("impede vincular o número oficial fixo da solução como telefone de usuário", async () => {
    const userId = 992001 + Math.floor(Math.random() * 100000);
    const ctx = createNutritionContext(userId, "admin");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.nutrition.whatsapp.upsertConnection({
      phoneNumber: "55 11 00000-0000",
      displayName: "Canal oficial",
    })).rejects.toThrow("não o número oficial fixo da solução");
  });

  it("permite ao administrador atualizar o token do WhatsApp e expõe apenas o valor mascarado", async () => {
    const userId = 880001 + Math.floor(Math.random() * 100000);
    const caller = appRouter.createCaller(createNutritionContext(userId, "admin"));
    const accessToken = `EAA_TEST_TOKEN_${userId}_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`;

    const updated = await caller.nutrition.admin.updateWhatsappToken({
      accessToken,
    });
    const status = await caller.nutrition.admin.whatsappTokenStatus();

    expect(updated.configured).toBe(true);
    expect(updated.source).toBe("database");
    expect(updated.updatedByUserId).toBe(userId);
    expect(updated.maskedValue).toContain(accessToken.slice(0, 6));
    expect(updated.maskedValue).toContain(accessToken.slice(-4));
    expect(updated.maskedValue).not.toContain(accessToken.slice(6, -4));
    expect(status.configured).toBe(true);
    expect(status.source).toBe("database");
    expect(status.updatedByUserId).toBe(userId);
    expect(status.maskedValue).toBe(updated.maskedValue);
  });

  it("cria, lista e remove exercícios refletindo o saldo líquido diário e semanal", async () => {
    const userId = 880000 + Math.floor(Math.random() * 10000);
    const caller = appRouter.createCaller(createNutritionContext(userId));

    const existingExercises = await caller.nutrition.exercises.list();
    for (const exercise of existingExercises) {
      await caller.nutrition.exercises.remove({ exerciseId: exercise.id });
    }

    await caller.nutrition.goals.update({
      defaultGoal: {
        calories: 2200,
        proteinGrams: 160,
        carbsGrams: 240,
        fatGrams: 70,
      },
      exceptions: [],
    });

    const simulated = await caller.nutrition.whatsapp.simulateInbound({
      text: "almocei arroz, feijão e frango grelhado",
    });

    await caller.nutrition.meals.confirm({
      draftId: simulated.draftId,
      mealLabel: simulated.processed.detectedMealLabel,
      occurredAt: new Date().toISOString(),
      items: simulated.processed.items,
    });

    const createdExercise = await caller.nutrition.exercises.create({
      activityType: "Corrida leve",
      durationMinutes: 45,
      caloriesBurned: 320,
      occurredAt: new Date().toISOString(),
      notes: "Rodagem de recuperação",
    });

    const exerciseList = await caller.nutrition.exercises.list();
    const overview = await caller.nutrition.dashboard.overview();
    const weekly = await caller.nutrition.reports.weekly();

    expect(exerciseList).toHaveLength(1);
    expect(exerciseList[0]?.activityType).toBe("Corrida leve");
    expect(createdExercise.caloriesBurned).toBe(320);
    expect(overview.today.burned.calories).toBe(320);
    expect(overview.today.net.calories).toBe(57.5);
    expect(overview.week.burned.calories).toBe(320);
    expect(overview.week.net.calories).toBe(57.5);
    expect(weekly[2]?.exerciseCalories).toBe(320);
    expect(weekly[2]?.netCalories).toBe(57.5);

    const updatedExercise = await caller.nutrition.exercises.update({
      exerciseId: createdExercise.id,
      activityType: "Corrida moderada",
      durationMinutes: 50,
      caloriesBurned: 410,
      occurredAt: new Date().toISOString(),
      notes: "Treino com progressão",
    });
    const updatedListAfterEdit = await caller.nutrition.exercises.list();
    const overviewAfterEdit = await caller.nutrition.dashboard.overview();
    const weeklyAfterEdit = await caller.nutrition.reports.weekly();

    expect(updatedExercise.activityType).toBe("Corrida moderada");
    expect(updatedExercise.caloriesBurned).toBe(410);
    expect(updatedListAfterEdit[0]?.durationMinutes).toBe(50);
    expect(updatedListAfterEdit[0]?.notes).toBe("Treino com progressão");
    expect(overviewAfterEdit.today.burned.calories).toBe(410);
    expect(overviewAfterEdit.today.net.calories).toBe(-32.5);
    expect(overviewAfterEdit.week.burned.calories).toBe(410);
    expect(overviewAfterEdit.week.net.calories).toBe(-32.5);
    expect(weeklyAfterEdit[2]?.exerciseCalories).toBe(410);
    expect(weeklyAfterEdit[2]?.netCalories).toBe(-32.5);

    const removal = await caller.nutrition.exercises.remove({ exerciseId: createdExercise.id });
    const updatedList = await caller.nutrition.exercises.list();
    const updatedOverview = await caller.nutrition.dashboard.overview();

    expect(removal.success).toBe(true);
    expect(updatedList).toHaveLength(0);
    expect(updatedOverview.today.burned.calories).toBe(0);
    expect(updatedOverview.today.net.calories).toBe(377.5);
  });
});
