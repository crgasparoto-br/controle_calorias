import { beforeEach, describe, expect, it, vi } from "vitest";

const { composeReplyMock } = vi.hoisted(() => ({
  composeReplyMock: vi.fn(),
}));

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: composeReplyMock,
}));
vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({ action: "created", meal })),
}));

import { persistResolvedFoodSafely } from "./foodClarificationPersistence";
import type { PendingFoodClarificationTarget } from "./foodClarificationContract";

const target: PendingFoodClarificationTarget = {
  contractVersion: 1,
  interactionId: "interaction-855",
  kind: "food_registration_clarification",
  classification: "closed",
  pendingKind: "confirmation",
  originalText: "2 kit kat",
  sanitizedOriginalText: "2 kit kat",
  originalCandidate: "kit kat",
  normalizedCandidate: "kit kat",
  normalizationChanged: false,
  count: 2,
  qualifiers: ["kat"],
  candidates: [],
  selectedCandidateIndex: 0,
  actions: [],
  instructionText: "Confirme",
  inboundMessageId: "wamid.855",
  allowedDomainEffect: "register_original_food_once",
};

const candidate = {
  name: "Kit Kat",
  servingLabel: "1 unidade",
  gramsPerServing: 41.5,
  brandName: "Nestlé",
  isBrandedProduct: true,
  matchKind: "exact" as const,
};

const processedItem = {
  foodName: "Kit Kat",
  canonicalName: "Kit Kat",
  brand: "Nestlé",
  quantity: 2,
  unit: "unidades",
  portionText: "2 unidades",
  servings: 2,
  estimatedGrams: 83,
  calories: 420,
  protein: 6,
  carbs: 50,
  fat: 20,
  confidence: 0.95,
  source: "catalog" as const,
};

function createDependencies() {
  const meals: any[] = [];
  const createMeal = vi.fn(async (userId: number, input: any) => {
    const meal = { id: 1, userId, ...input };
    meals.push(meal);
    return meal;
  });
  return {
    meals,
    createMeal,
    deps: {
      repository: {} as any,
      processFood: vi.fn(async () => ({
        detectedMealLabel: "Lanche",
        sourceText: "2 unidades de kit kat",
        confidence: 0.95,
        needsConfirmation: false,
        reasoning: "teste",
        items: [processedItem],
        totals: { calories: 420, protein: 6, carbs: 50, fat: 20 },
      })) as any,
      getHabits: vi.fn(async () => []) as any,
      createMeal: createMeal as any,
      listMeals: vi.fn(async (userId: number) => meals.filter(meal => meal.userId === userId)) as any,
      updateMeal: vi.fn() as any,
      removeMeal: vi.fn(async () => true) as any,
    },
  };
}

describe("persistResolvedFoodSafely", () => {
  beforeEach(() => {
    composeReplyMock.mockReset();
    composeReplyMock.mockResolvedValue("Resposta canônica");
  });

  it("só permite recriar pendência quando a falha ocorreu antes de qualquer mutação", async () => {
    const { deps, createMeal } = createDependencies();
    deps.processFood.mockRejectedValueOnce(new Error("provider indisponível"));

    const outcome = await persistResolvedFoodSafely(
      deps,
      42,
      target,
      candidate,
      new Date("2026-07-21T15:00:00.000Z"),
      "America/Sao_Paulo",
    );

    expect(outcome).toEqual({ status: "safe_to_retry" });
    expect(createMeal).not.toHaveBeenCalled();
  });

  it("não libera retry automático quando a refeição já mudou antes da falha de resposta", async () => {
    const { deps, createMeal } = createDependencies();
    composeReplyMock.mockRejectedValueOnce(new Error("formatter indisponível"));

    const outcome = await persistResolvedFoodSafely(
      deps,
      42,
      target,
      candidate,
      new Date("2026-07-21T15:00:00.000Z"),
      "America/Sao_Paulo",
    );

    expect(outcome.status).toBe("verification_required");
    expect(outcome).toEqual(expect.objectContaining({
      result: expect.objectContaining({
        action: "food_clarification_unavailable",
        data: expect.objectContaining({
          verificationRequired: true,
          retryBlockedToPreventDuplicate: true,
        }),
      }),
    }));
    expect(createMeal).toHaveBeenCalledTimes(1);
  });

  it("persiste a quantidade resultante de uma porção canônica multiunidade", async () => {
    const { deps, createMeal } = createDependencies();
    const multiUnitTarget: PendingFoodClarificationTarget = {
      ...target,
      originalText: "2 pão integral Wickbold",
      sanitizedOriginalText: "2 pão integral Wickbold",
      originalCandidate: "pão integral Wickbold",
      normalizedCandidate: "pão integral Wickbold",
      count: 2,
    };
    const multiUnitCandidate = {
      ...candidate,
      name: "Pão integral Wickbold",
      servingLabel: "2 fatias",
      gramsPerServing: 50,
      brandName: "Wickbold",
    };
    const multiUnitItem = {
      ...processedItem,
      foodName: "Pão integral Wickbold",
      canonicalName: "Pão integral Wickbold",
      brand: "Wickbold",
      quantity: 4,
      unit: "fatias",
      portionText: "4 fatias",
      servings: 2,
      estimatedGrams: 100,
      calories: 248,
      protein: 10,
      carbs: 42,
      fat: 4,
    };
    deps.processFood.mockResolvedValueOnce({
      detectedMealLabel: "Lanche",
      sourceText: "4 fatias de Pão integral Wickbold",
      confidence: 0.95,
      needsConfirmation: false,
      reasoning: "porção canônica preservada",
      items: [multiUnitItem],
      totals: { calories: 248, protein: 10, carbs: 42, fat: 4 },
    });

    const outcome = await persistResolvedFoodSafely(
      deps,
      42,
      multiUnitTarget,
      multiUnitCandidate,
      new Date("2026-07-21T15:00:00.000Z"),
      "America/Sao_Paulo",
    );

    expect(outcome.status).toBe("success");
    expect(deps.processFood).toHaveBeenCalledWith(expect.objectContaining({
      text: "4 fatias de Pão integral Wickbold",
    }));
    expect(createMeal).toHaveBeenCalledWith(42, expect.objectContaining({
      items: [expect.objectContaining({ quantity: 4, unit: "fatias", calories: 248 })],
    }));
  });
});
