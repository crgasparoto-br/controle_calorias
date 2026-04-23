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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("atualiza metas e reflete o novo saldo no dashboard", async () => {
    const caller = appRouter.createCaller(createNutritionContext(501));

    await caller.nutrition.goals.update({
      days: [
        { weekday: 0, calories: 2500, proteinGrams: 180, carbsGrams: 260, fatGrams: 80 },
        { weekday: 1, calories: 2400, proteinGrams: 175, carbsGrams: 250, fatGrams: 78 },
        { weekday: 2, calories: 2300, proteinGrams: 170, carbsGrams: 240, fatGrams: 76 },
        { weekday: 3, calories: 2200, proteinGrams: 165, carbsGrams: 230, fatGrams: 74 },
        { weekday: 4, calories: 2600, proteinGrams: 185, carbsGrams: 280, fatGrams: 82 },
        { weekday: 5, calories: 2700, proteinGrams: 190, carbsGrams: 295, fatGrams: 84 },
        { weekday: 6, calories: 2100, proteinGrams: 160, carbsGrams: 220, fatGrams: 72 },
      ],
    });

    const overview = await caller.nutrition.dashboard.overview();

    expect(overview.goal.days).toHaveLength(7);
    expect(overview.goal.today.calories).toBe(2300);
    expect(overview.goal.today.proteinGrams).toBe(170);
    expect(overview.goal.weeklyTotals.calories).toBe(16800);
    expect(overview.today.remaining.calories).toBe(2300);
  });

  it("simula entrada por WhatsApp e confirma a refeição revisada", async () => {
    const ctx = createNutritionContext(777, "admin");
    const caller = appRouter.createCaller(ctx);

    const simulated = await caller.nutrition.whatsapp.simulateInbound({
      userId: 777,
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
});
