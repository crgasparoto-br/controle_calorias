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
    loginMethod: "password",
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
    expect(overview.goal.weeklyTotals.calories).toBe(16450);
    expect(overview.today.goal.calories).toBe(2350);
    expect(overview.today.remaining.calories).toBe(2350);
  });

  it("bloqueia metas nutricionais extremas antes de salvar", async () => {
    const caller = appRouter.createCaller(createNutritionContext(502));

    await expect(caller.nutrition.goals.update({
      defaultGoal: {
        calories: 900,
        proteinGrams: 30,
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
      birthDate: "1991-05-01",
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

  it("cobre o fluxo principal: onboarding, meta, alimento, refeição, edição, cópia, dashboard e relatórios", async () => {
    const caller = appRouter.createCaller(createNutritionContext(930));

    const onboarding = await caller.nutrition.onboarding.complete({
      name: "Ana Rotina",
      birthDate: "1994-08-10",
      heightCm: 165,
      currentWeightKg: 68,
      objective: "melhorar_habitos",
      activityLevel: "light",
      trackingExperience: "beginner",
      dietaryPreferences: ["comida brasileira", "lanches simples"],
      dietaryRestrictions: ["castanhas"],
      eatingRoutine: "misto",
      mainDifficulty: "falta_de_tempo",
    });
    const generatedGoal = await caller.nutrition.goals.get();

    expect(onboarding.profile.name).toBe("Ana Rotina");
    expect(generatedGoal.defaultGoal.calories).toBe(onboarding.calculation.calculatedGoal.calories);
    expect(generatedGoal.defaultGoal.proteinGrams).toBe(onboarding.calculation.calculatedGoal.proteinGrams);

    const adjustedGoal = await caller.nutrition.goals.update({
      defaultGoal: {
        calories: 2100,
        proteinGrams: 120,
        carbsGrams: 245,
        fatGrams: 70,
      },
      exceptions: [
        {
          weekday: 2,
          durationType: "always",
          calories: 2200,
          proteinGrams: 125,
          carbsGrams: 260,
          fatGrams: 72,
        },
      ],
    });

    expect(adjustedGoal.today.calories).toBe(2200);
    expect(adjustedGoal.today.source).toBe("exception");

    const createdFood = await caller.nutrition.foods.create({
      name: "Iogurte natural caseiro",
      brandName: "Feito em casa",
      servingSize: 170,
      servingUnit: "g",
      calories: 105,
      protein: 8,
      carbs: 12,
      fat: 3,
      fiber: 0,
      isFruit: false,
      isVegetable: false,
      isUltraProcessed: false,
      source: "manual",
      foodType: "generic",
    });
    const searchResults = await caller.nutrition.foods.search({ query: "iogurte natural", limit: 5 });

    expect(searchResults[0]).toMatchObject({
      id: createdFood.id,
      name: "Iogurte natural caseiro",
      calories: 105,
      isUserCreated: true,
    });

    const meal = await caller.nutrition.meals.createManual({
      mealLabel: "almoço",
      occurredAt: "2026-04-22T15:00:00.000Z",
      notes: "Almoço simples preparado em casa.",
      items: [
        {
          foodName: "Arroz integral",
          canonicalName: "Arroz integral cozido",
          portionText: "4 colheres de sopa",
          servings: 1,
          estimatedGrams: 100,
          calories: 124,
          protein: 2.6,
          carbs: 25.8,
          fat: 1,
          confidence: 1,
          source: "catalog",
        },
        {
          foodName: "Frango grelhado",
          canonicalName: "Frango grelhado",
          portionText: "1 filé médio",
          servings: 1,
          estimatedGrams: 120,
          calories: 198,
          protein: 37.2,
          carbs: 0,
          fat: 4.3,
          confidence: 1,
          source: "catalog",
        },
      ],
    });

    expect(meal.totals).toEqual({ calories: 322, protein: 39.8, carbs: 25.8, fat: 5.3 });

    const editedMeal = await caller.nutrition.meals.update({
      mealId: meal.id,
      mealLabel: "almoço",
      occurredAt: "2026-04-22T15:00:00.000Z",
      notes: "Porção ajustada após revisar o prato.",
      items: [
        {
          ...meal.items[0],
          portionText: "5 colheres de sopa",
          estimatedGrams: 125,
          calories: 155,
          protein: 3.3,
          carbs: 32.3,
          fat: 1.3,
        },
        meal.items[1],
        {
          foodName: "Iogurte natural caseiro",
          canonicalName: "Iogurte natural caseiro",
          portionText: "170 g",
          servings: 1,
          estimatedGrams: 170,
          calories: 105,
          protein: 8,
          carbs: 12,
          fat: 3,
          confidence: 1,
          source: "catalog",
        },
      ],
    });

    expect(editedMeal.items).toHaveLength(3);
    expect(editedMeal.totals).toEqual({ calories: 458, protein: 48.5, carbs: 44.3, fat: 8.6 });

    const copiedMeal = await caller.nutrition.meals.copy({
      mealId: editedMeal.id,
      occurredAt: "2026-04-23T15:00:00.000Z",
      mealLabel: "almoço",
    });

    expect(copiedMeal.id).not.toBe(editedMeal.id);
    expect(copiedMeal.totals).toEqual(editedMeal.totals);

    const dayTotals = await caller.nutrition.meals.dayTotals({ date: "2026-04-22" });
    const today = await caller.nutrition.dashboard.today();
    const dashboard = await caller.nutrition.dashboard.overview();
    const weeklyView = await caller.nutrition.reports.weeklyProgress();
    const weeklyReport = await caller.nutrition.reports.weekly();

    expect(dayTotals.totals).toEqual(editedMeal.totals);
    expect(today.today.goal.calories).toBe(2200);
    expect(today.today.consumed.calories).toBe(458);
    expect(today.today.remaining.calories).toBe(1742);
    expect(today.meals).toHaveLength(1);
    expect(dashboard.today.goal.calories).toBe(2200);
    expect(dashboard.today.consumed.calories).toBe(458);
    expect(dashboard.today.remaining.calories).toBe(1742);
    expect(dashboard.meals[0].notes).toBe("Porção ajustada após revisar o prato.");
    expect(weeklyView.days).toHaveLength(7);
    expect(weeklyView.summary.totalCalories).toBe(916);
    expect(weeklyView.summary.daysWithoutRecords).toBe(5);
    expect(weeklyReport).toHaveLength(7);
    expect(weeklyReport.find(day => day.date === "2026-04-22")?.calories).toBe(458);
    expect(weeklyReport.find(day => day.date === "2026-04-23")?.calories).toBe(458);
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

  it("busca alimentos e prioriza favoritos", async () => {
    const caller = appRouter.createCaller(createNutritionContext(880));

    const created = await caller.nutrition.foods.create({
      name: "Granola artesanal",
      brandName: "Casa Fit",
      servingSize: 40,
      servingUnit: "g",
      calories: 160,
      protein: 5,
      carbs: 24,
      fat: 4,
      fiber: 3,
      isFruit: false,
      isVegetable: false,
      isUltraProcessed: false,
      source: "manual",
      foodType: "branded",
    });

    await caller.nutrition.foods.favorite({ foodId: created.id, favorite: true });

    const results = await caller.nutrition.foods.search({ query: "granola", limit: 10 });

    expect(results[0].name).toBe("Granola artesanal");
    expect(results[0].brandName).toBe("Casa Fit");
    expect(results[0].isFavorite).toBe(true);
    expect(results[0].calories).toBe(160);
    expect(results[0].protein).toBe(5);
    expect(results[0].carbs).toBe(24);
    expect(results[0].fat).toBe(4);
    expect(results[0].fiber).toBe(3);
    expect(results[0].isUltraProcessed).toBe(false);
  });

  it("calcula indicadores de qualidade alimentar no dashboard e na semana", async () => {
    const caller = appRouter.createCaller(createNutritionContext(889));

    await caller.nutrition.foods.create({
      name: "Banana prata teste",
      servingSize: 100,
      servingUnit: "g",
      calories: 89,
      protein: 1,
      carbs: 23,
      fat: 0.3,
      fiber: 2.6,
      isFruit: true,
      isVegetable: false,
      isUltraProcessed: false,
      source: "manual",
      foodType: "generic",
    });

    await caller.nutrition.meals.createManual({
      mealLabel: "lanche",
      occurredAt: "2026-04-22T15:00:00.000Z",
      items: [
        {
          foodName: "Banana prata teste",
          canonicalName: "Banana prata teste",
          portionText: "100 g",
          servings: 1,
          estimatedGrams: 100,
          calories: 89,
          protein: 1,
          carbs: 23,
          fat: 0.3,
          confidence: 1,
          source: "catalog",
        },
      ],
    });
    await caller.nutrition.water.create({ amountMl: 300, occurredAt: "2026-04-22T16:00:00.000Z" });

    const overview = await caller.nutrition.dashboard.overview();
    const weekly = await caller.nutrition.reports.weekly();

    expect(overview.today.quality.fiberGrams).toBe(2.6);
    expect(overview.today.quality.fruitServings).toBe(1);
    expect(overview.today.quality.waterMl).toBe(300);
    expect(overview.today.quality.mealCount).toBe(1);
    expect(weekly.find(day => day.date === "2026-04-22")?.quality.fruitServings).toBe(1);
  });

  it("agrupa dashboard, semana e pesos por data local perto da meia-noite", async () => {
    vi.setSystemTime(new Date("2026-04-22T00:30:00-03:00"));

    const caller = appRouter.createCaller(createNutritionContext(891));

      await caller.nutrition.onboarding.complete({
        name: "Local Date",
        birthDate: "1990-01-10",
        heightCm: 170,
        currentWeightKg: 72.5,
        objective: "manter_peso",
        activityLevel: "light",
        trackingExperience: "beginner",
        dietaryPreferences: [],
        dietaryRestrictions: [],
        eatingRoutine: "misto",
        mainDifficulty: "falta_de_tempo",
      });

      await caller.nutrition.meals.createManual({
        mealLabel: "ceia",
        occurredAt: "2026-04-22T00:30:00-03:00",
        items: [{
          foodName: "Refeição local",
          canonicalName: "Refeição local",
          portionText: "1 porção",
          servings: 1,
          estimatedGrams: 100,
          calories: 100,
          protein: 10,
          carbs: 12,
          fat: 3,
          confidence: 1,
          source: "heuristic",
        }],
      });

      await caller.nutrition.meals.createManual({
        mealLabel: "jantar",
        occurredAt: "2026-04-21T23:30:00-03:00",
        items: [{
          foodName: "Refeição anterior local",
          canonicalName: "Refeição anterior local",
          portionText: "1 porção",
          servings: 1,
          estimatedGrams: 100,
          calories: 50,
          protein: 5,
          carbs: 6,
          fat: 2,
          confidence: 1,
          source: "heuristic",
        }],
      });

      await caller.nutrition.exercises.create({
        activityType: "Caminhada local",
        durationMinutes: 20,
        caloriesBurned: 40,
        occurredAt: "2026-04-22T00:45:00-03:00",
      });
      await caller.nutrition.water.create({ amountMl: 250, occurredAt: "2026-04-22T00:50:00-03:00" });

      const weekly = await caller.nutrition.reports.weekly();
      const overview = await caller.nutrition.dashboard.overview();
      const progress = await caller.nutrition.reports.weeklyProgress();
      const localDay = weekly.find(day => day.date === "2026-04-22");
      const previousLocalDay = weekly.find(day => day.date === "2026-04-21");

      expect(localDay?.calories).toBe(100);
      expect(localDay?.exerciseCalories).toBe(40);
      expect(localDay?.waterConsumedMl).toBe(250);
      expect(previousLocalDay?.calories).toBe(50);
      expect(overview.today.consumed.calories).toBe(100);
      expect(overview.today.burned.calories).toBe(40);
    expect(overview.today.water.consumedMl).toBe(250);
    expect(progress.days.map(day => day.date)).toEqual(weekly.map(day => day.date));
    expect(progress.weight.entries[0]).toMatchObject({ date: "2026-04-22", weightKg: 72.5 });
  });

  it("concede badges saudáveis de consistência e permite desativar gamificação", async () => {
    const caller = appRouter.createCaller(createNutritionContext(890));

    await caller.nutrition.goals.update({
      defaultGoal: {
        calories: 2200,
        proteinGrams: 30,
        carbsGrams: 220,
        fatGrams: 70,
      },
      exceptions: [],
    });

    for (const [index, date] of ["2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24"].entries()) {
      await caller.nutrition.meals.createManual({
        mealLabel: index === 4 ? "lanche" : "almoço",
        occurredAt: `${date}T15:00:00.000Z`,
        items: [{
          foodName: `Refeição consistente ${index}`,
          canonicalName: `Refeição consistente ${index}`,
          portionText: "1 porção",
          servings: 1,
          estimatedGrams: 100,
          calories: 450,
          protein: 35,
          carbs: 45,
          fat: 12,
          confidence: 1,
          source: "heuristic",
        }],
      });
    }

    for (const date of ["2026-04-20", "2026-04-21", "2026-04-22"]) {
      await caller.nutrition.water.create({ amountMl: 300, occurredAt: `${date}T16:00:00.000Z` });
    }

    const meals = await caller.nutrition.meals.list();
    await caller.nutrition.meals.saveFavorite({ mealId: meals[0].id, name: "Base simples" });

    const overview = await caller.nutrition.dashboard.overview();
    const earnedCodes = overview.gamification.earnedBadges.map(badge => badge.code);

    expect(earnedCodes).toEqual(expect.arrayContaining([
      "registered_3_days_week",
      "registered_5_days_week",
      "protein_4_days_week",
      "water_3_days_week",
      "created_favorite_meal",
      "planned_meal",
      "weekly_consistency",
    ]));
    expect(earnedCodes.every(code => [
      "registered_3_days_week",
      "registered_5_days_week",
      "protein_4_days_week",
      "water_3_days_week",
      "created_favorite_meal",
      "planned_meal",
      "weekly_consistency",
    ].includes(code))).toBe(true);

    await caller.nutrition.gamification.updateSettings({ enabled: false });
    const disabled = await caller.nutrition.dashboard.overview();
    expect(disabled.gamification.enabled).toBe(false);
    expect(disabled.gamification.newlyEarnedBadges).toHaveLength(0);
  });

  it("permite editar alimento criado pelo usuário", async () => {
    const caller = appRouter.createCaller(createNutritionContext(881));

    const created = await caller.nutrition.foods.create({
      name: "Pasta de amendoim",
      servingSize: 15,
      servingUnit: "g",
      calories: 90,
      protein: 4,
      carbs: 3,
      fat: 7,
      source: "manual",
      foodType: "generic",
    });

    await caller.nutrition.foods.update({
      foodId: created.id,
      name: "Pasta de amendoim integral",
      servingSize: 20,
      servingUnit: "g",
      calories: 120,
      protein: 5,
      carbs: 4,
      fat: 10,
      source: "manual",
      foodType: "generic",
    });

    const results = await caller.nutrition.foods.search({ query: "integral", limit: 5 });

    expect(results[0].id).toBe(created.id);
    expect(results[0].servingSize).toBe(20);
    expect(results[0].isUserCreated).toBe(true);
  });

  it("calcula totais da refeição e totais do dia sem duplicar regra de soma", async () => {
    const caller = appRouter.createCaller(createNutritionContext(882));

    const meal = await caller.nutrition.meals.createManual({
      mealLabel: "almoço",
      occurredAt: "2026-04-22T15:00:00.000Z",
      items: [
        {
          foodName: "Arroz",
          canonicalName: "Arroz branco cozido",
          portionText: "100 g",
          servings: 1,
          estimatedGrams: 100,
          calories: 130,
          protein: 2.7,
          carbs: 28,
          fat: 0.3,
          confidence: 1,
          source: "catalog",
        },
        {
          foodName: "Frango",
          canonicalName: "Frango grelhado",
          portionText: "150 g",
          servings: 1.5,
          estimatedGrams: 150,
          calories: 247.5,
          protein: 46.5,
          carbs: 0,
          fat: 5.4,
          confidence: 1,
          source: "catalog",
        },
      ],
    });

    const day = await caller.nutrition.meals.dayTotals({ date: "2026-04-22" });

    expect(meal.totals).toEqual({ calories: 377.5, protein: 49.2, carbs: 28, fat: 5.7 });
    expect(day.totals).toEqual(meal.totals);
  });

  it("agrega progresso semanal com dias sem registro e comparação com meta ajustada", async () => {
    const caller = appRouter.createCaller(createNutritionContext(884));

    await caller.nutrition.goals.update({
      defaultGoal: {
        calories: 2000,
        proteinGrams: 140,
        carbsGrams: 220,
        fatGrams: 65,
      },
      exceptions: [],
    });

    await caller.nutrition.meals.createManual({
      mealLabel: "almoço",
      occurredAt: "2026-04-20T15:00:00.000Z",
      items: [{
        foodName: "Dia dentro",
        canonicalName: "Dia dentro",
        portionText: "1 porção",
        servings: 1,
        estimatedGrams: 100,
        calories: 1950,
        protein: 120,
        carbs: 210,
        fat: 60,
        confidence: 1,
        source: "heuristic",
      }],
    });

    await caller.nutrition.meals.createManual({
      mealLabel: "jantar",
      occurredAt: "2026-04-21T22:00:00.000Z",
      items: [{
        foodName: "Dia acima",
        canonicalName: "Dia acima",
        portionText: "1 porção",
        servings: 1,
        estimatedGrams: 100,
        calories: 2300,
        protein: 160,
        carbs: 260,
        fat: 70,
        confidence: 1,
        source: "heuristic",
      }],
    });

    await caller.nutrition.exercises.create({
      activityType: "Caminhada",
      durationMinutes: 45,
      caloriesBurned: 300,
      occurredAt: "2026-04-21T23:00:00.000Z",
    });

    const progress = await caller.nutrition.reports.weeklyProgress();

    expect(progress.days).toHaveLength(7);
    expect(progress.summary.totalCalories).toBe(4250);
    expect(progress.summary.averageCalories).toBe(607.1);
    expect(progress.summary.totalGoalCalories).toBe(14300);
    expect(progress.summary.daysWithinGoal).toBe(2);
    expect(progress.summary.daysAboveGoal).toBe(0);
    expect(progress.summary.daysBelowGoal).toBe(0);
    expect(progress.summary.daysWithoutRecords).toBe(5);
    expect(progress.summary.averageProtein).toBe(40);
    expect(progress.summary.totalExerciseCalories).toBe(300);
    expect(progress.summary.totalNetCalories).toBe(3950);
    expect(progress.summary.balanceCalories).toBe(10050);
  });

  it("copia refeição anterior e reutiliza refeição favorita", async () => {
    const caller = appRouter.createCaller(createNutritionContext(883));

    const breakfast = await caller.nutrition.meals.createManual({
      mealLabel: "café da manhã",
      occurredAt: "2026-04-21T10:00:00.000Z",
      items: [
        {
          foodName: "Ovo",
          canonicalName: "Ovo de galinha",
          portionText: "2 unidades",
          servings: 2,
          estimatedGrams: 100,
          calories: 156,
          protein: 12.6,
          carbs: 1.2,
          fat: 10.6,
          confidence: 1,
          source: "catalog",
        },
      ],
    });

    const copied = await caller.nutrition.meals.copy({
      mealId: breakfast.id,
      occurredAt: "2026-04-22T10:00:00.000Z",
    });
    const favorite = await caller.nutrition.meals.saveFavorite({ mealId: breakfast.id, name: "Café com ovos" });
    const reused = await caller.nutrition.meals.reuseFavorite({
      favoriteMealId: favorite.id,
      occurredAt: "2026-04-23T10:00:00.000Z",
    });

    expect(copied.id).not.toBe(breakfast.id);
    expect(copied.totals).toEqual(breakfast.totals);
    expect(favorite.name).toBe("Café com ovos");
    expect(reused.totals).toEqual(breakfast.totals);
  });

  it("analisa foto, permite corrigir sugestões e só cria refeição após confirmação", async () => {
    const caller = appRouter.createCaller(createNutritionContext(884));

    const before = await caller.nutrition.meals.list();
    const analysis = await caller.nutrition.foodPhotoAnalysis.analyze({
      image: {
        base64: "data:image/png;base64,aW1hZ2VtLXRlc3Rl",
        mimeType: "image/png",
        fileName: "prato.png",
      },
    });
    const afterAnalysis = await caller.nutrition.meals.list();

    expect(analysis.status).toBe("analyzed");
    expect(analysis.suggestedItems.length).toBeGreaterThan(0);
    expect(analysis.editableItems[0]).toMatchObject({
      foodName: expect.any(String),
      portionText: expect.any(String),
      confidence: expect.any(Number),
    });
    expect(afterAnalysis).toHaveLength(before.length);

    const correctedItems = analysis.editableItems.map((item, index) => index === 0
      ? { ...item, foodName: "Arroz integral corrigido", calories: 140, confidence: 0.95 }
      : item);

    const meal = await caller.nutrition.foodPhotoAnalysis.confirm({
      analysisId: analysis.id,
      mealLabel: "almoço",
      occurredAt: "2026-04-22T15:00:00.000Z",
      notes: "Confirmado após revisar a foto.",
      items: correctedItems,
    });
    const afterConfirm = await caller.nutrition.meals.list();

    expect(meal.items[0].foodName).toBe("Arroz integral corrigido");
    expect(afterConfirm).toHaveLength(before.length + 1);
    await expect(caller.nutrition.foodPhotoAnalysis.confirm({
      analysisId: analysis.id,
      mealLabel: "almoço",
      occurredAt: "2026-04-22T15:30:00.000Z",
      items: correctedItems,
    })).rejects.toThrow("precisa estar pronta");
  });

  it("permite rejeitar análise de foto sem criar refeição", async () => {
    const caller = appRouter.createCaller(createNutritionContext(885));
    const before = await caller.nutrition.meals.list();

    const analysis = await caller.nutrition.foodPhotoAnalysis.analyze({
      image: {
        base64: "data:image/png;base64,aW1hZ2VtLXRlc3Rl",
        mimeType: "image/png",
      },
    });
    const rejected = await caller.nutrition.foodPhotoAnalysis.reject({ analysisId: analysis.id });
    const afterReject = await caller.nutrition.meals.list();

    expect(rejected.status).toBe("rejected");
    expect(afterReject).toHaveLength(before.length);
  });

  it("conecta, sincroniza e desconecta integração de saúde com origem dos dados", async () => {
    const caller = appRouter.createCaller(createNutritionContext(886));

    const initial = await caller.nutrition.healthIntegrations.status();
    expect(initial.platform).toBe("web");
    expect(initial.providers.find(provider => provider.provider === "apple_health")?.available).toBe(false);
    const garminConnect = initial.providers.find(provider => provider.provider === "garmin_connect");
    expect(garminConnect?.available).toBe(false);
    expect(garminConnect?.supportedDataTypes).toEqual(["activity", "energy_burned"]);

    await expect(caller.nutrition.healthIntegrations.sync({ provider: "mock" })).rejects.toThrow("Conceda consentimento");

    const connection = await caller.nutrition.healthIntegrations.connect({
      provider: "mock",
      consentAccepted: true,
      scopes: ["steps", "activity", "energy_burned", "sleep"],
    });
    expect(connection.status).toBe("connected");
    expect(connection.scopes).toEqual(["steps", "activity", "energy_burned", "sleep"]);

    const synced = await caller.nutrition.healthIntegrations.sync({ provider: "mock" });
    expect(synced.records.length).toBe(4);
    expect(synced.records.every(record => record.source === "mock")).toBe(true);
    expect(synced.records.find(record => record.dataType === "energy_burned")?.energyKind).toBe("burned");

    const status = await caller.nutrition.healthIntegrations.status();
    expect(status.totals.energyBurnedCalories).toBeGreaterThan(0);
    expect(status.recentRecords[0].source).toBe("mock");

    const disconnected = await caller.nutrition.healthIntegrations.disconnect({ provider: "mock" });
    const afterDisconnect = await caller.nutrition.healthIntegrations.status();
    expect(disconnected.status).toBe("disconnected");
    expect(afterDisconnect.recentRecords).toHaveLength(0);
  });

  it("bloqueia dados de paciente sem consentimento e libera após aprovação com comentários", async () => {
    const professional = appRouter.createCaller(createNutritionContext(910));
    const patient = appRouter.createCaller(createNutritionContext(911));
    const outsider = appRouter.createCaller(createNutritionContext(912));

    await patient.nutrition.meals.createManual({
      mealLabel: "almoço",
      occurredAt: "2026-04-22T15:00:00.000Z",
      items: [{
        foodName: "Prato do paciente",
        canonicalName: "Prato do paciente",
        portionText: "1 prato",
        servings: 1,
        estimatedGrams: 350,
        calories: 520,
        protein: 35,
        carbs: 55,
        fat: 18,
        confidence: 1,
        source: "heuristic",
      }],
    });

    await expect(professional.nutrition.professionals.patientDashboard({ patientId: 911 })).rejects.toThrow("não autorizado");

    await professional.nutrition.professionals.upsertProfile({
      displayName: "Nutri Teste",
      registrationNumber: "CRN-123",
    });
    const request = await professional.nutrition.professionals.requestAccess({
      patientEmail: "user-911@example.com",
      reason: "Acompanhamento semanal consentido.",
    });
    expect(request.status).toBe("pending");
    await expect(outsider.nutrition.professionals.approveAccess({ accessId: request.id })).rejects.toThrow("não encontrada");

    const approved = await patient.nutrition.professionals.approveAccess({ accessId: request.id });
    expect(approved.status).toBe("approved");

    const dashboard = await professional.nutrition.professionals.patientDashboard({ patientId: 911 });
    expect(dashboard.patientId).toBe(911);
    expect(dashboard.meals[0].items[0].foodName).toBe("Prato do paciente");

    const comment = await professional.nutrition.professionals.addComment({
      patientId: 911,
      comment: "Boa consistência de registros nesta semana.",
    });
    expect(comment.comment).toContain("Boa consistência");

    const updatedDashboard = await professional.nutrition.professionals.patientDashboard({ patientId: 911 });
    expect(updatedDashboard.comments).toHaveLength(1);

    const revoked = await patient.nutrition.professionals.revokeAccess({ accessId: request.id });
    expect(revoked.status).toBe("revoked");
    await expect(professional.nutrition.professionals.patientDashboard({ patientId: 911 })).rejects.toThrow("não autorizado");
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
