import { beforeEach, describe, expect, it, vi } from "vitest";

const processMealInputMock = vi.fn();

vi.mock("../../nutritionEngine", () => ({
  processMealInput: processMealInputMock,
}));

const {
  createQuestionMealCalculationContinuation,
  isPendingQuestionMealCalculation,
  parseQuestionMealCalculationAction,
  rebuildQuestionMealCalculation,
  resolveQuestionMealCalculationText,
  supportsQuestionMealCalculation,
  PENDING_QUESTION_MEAL_CALCULATION_TYPE,
} = await import("./questionMealCalculationInteraction");
const { createDrizzleWhatsAppPendingOperationRepository } = await import(
  "../../repositories/whatsappPendingOperationRepository"
);

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});

const processedOption = {
  detectedMealLabel: "Café da tarde",
  sourceText: "1 fatia de pão integral, 20 g de mussarela e 6 tomates-cereja",
  confidence: 0.91,
  reasoning: "Snapshot estruturado da sugestão.",
  items: [
    {
      foodName: "Pão integral",
      canonicalName: "Pão integral",
      quantity: 1,
      unit: "fatia",
      portionText: "1 fatia",
      servings: 1,
      estimatedGrams: 25,
      calories: 62,
      protein: 2.5,
      carbs: 11,
      fat: 1,
      confidence: 0.9,
      source: "catalog",
    },
    {
      foodName: "Queijo mussarela",
      canonicalName: "Queijo mussarela",
      quantity: 20,
      unit: "g",
      portionText: "20 g",
      servings: 1,
      estimatedGrams: 20,
      calories: 66,
      protein: 4.5,
      carbs: 0.6,
      fat: 5,
      confidence: 0.9,
      source: "catalog",
    },
    {
      foodName: "Tomate-cereja",
      canonicalName: "Tomate-cereja",
      quantity: 6,
      unit: "unidade",
      portionText: "6 unidades",
      servings: 1,
      estimatedGrams: 90,
      calories: 16,
      protein: 0.8,
      carbs: 3.5,
      fat: 0.2,
      confidence: 0.9,
      source: "catalog",
    },
  ],
  totals: { calories: 144, protein: 7.8, carbs: 15.1, fat: 6.2 },
};

function inputFor(userId: number, text: string) {
  return {
    userId,
    pendingOperation: undefined as never,
    text,
    receivedAt: new Date("2026-09-26T20:00:00.000Z"),
    userTimezone: "America/Sao_Paulo",
  };
}

describe("question.meal_calculation", () => {
  beforeEach(() => {
    processMealInputMock.mockReset();
    processMealInputMock.mockResolvedValue(processedOption);
  });

  it("only supports the explicit café da tarde continuation and normalizes affirmative aliases", () => {
    expect(supportsQuestionMealCalculation("me dê uma opção de café da tarde")).toBe(true);
    expect(supportsQuestionMealCalculation("qual é a melhor opção de almoço?")).toBe(false);
    expect(parseQuestionMealCalculationAction("sim")).toBe("calculate");
    expect(parseQuestionMealCalculationAction("pode sim")).toBe("calculate");
    expect(parseQuestionMealCalculationAction("quero")).toBe("calculate");
    expect(parseQuestionMealCalculationAction("ok")).toBe("calculate");
    expect(parseQuestionMealCalculationAction("calcule")).toBe("calculate");
    expect(parseQuestionMealCalculationAction("faça isso")).toBe("calculate");
    expect(parseQuestionMealCalculationAction("não")).toBe("cancel");
    expect(parseQuestionMealCalculationAction("talvez")).toBeNull();
  });

  it("persists the structured snapshot before exposing the confirmation and resumes after a simulated restart", async () => {
    const userId = 120901;
    const created = await createQuestionMealCalculationContinuation({
      userId,
      question: "me dê uma opção de café da tarde",
      receivedAt: new Date("2026-09-26T20:00:00.000Z"),
      messageId: "question-1209-1",
      userTimezone: "America/Sao_Paulo",
    });

    expect(created).toEqual(expect.objectContaining({
      eventType: "whatsapp.question_meal_calculation.requested",
      reply: expect.stringContaining("Quer que eu calcule"),
      interactiveReply: expect.any(Object),
    }));
    expect(processMealInputMock).toHaveBeenCalledTimes(1);

    const persisted = await repository.getActivePendingOperation(
      userId,
      new Date("2026-09-26T20:01:00.000Z"),
    );
    expect(persisted?.type).toBe(PENDING_QUESTION_MEAL_CALCULATION_TYPE);
    expect(isPendingQuestionMealCalculation(persisted?.target)).toBe(true);
    expect((persisted?.target as any).option.items).toHaveLength(3);
    expect((persisted?.target as any).originalQuestion).toContain("café da tarde");

    const resumed = await resolveQuestionMealCalculationText({
      ...inputFor(userId, "sim"),
      pendingOperation: persisted!,
    });
    expect(resumed).toEqual(expect.objectContaining({
      eventType: "whatsapp.question_meal_calculation.completed",
      action: "question_meal_calculation_completed",
      reply: expect.stringContaining("Cálculo da opção sugerida"),
    }));
    expect(resumed?.reply).toContain("Tomate-cereja");
    expect(resumed?.reply).not.toContain("Refeição registrada");
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
  });

  it.each(["pode", "pode sim", "quero", "ok", "calcule", "faça isso"]) (
    "resolves affirmative alias %s through the same registered action",
    async (alias) => {
      const userId = 120910 + alias.length;
      const created = await createQuestionMealCalculationContinuation({
        userId,
        question: "me dê uma opção de café da tarde",
        receivedAt: new Date("2026-09-26T20:00:00.000Z"),
        messageId: `alias-${alias}`,
      });
      expect(created).toEqual(expect.objectContaining({ eventType: "whatsapp.question_meal_calculation.requested" }));
      const pending = await repository.getActivePendingOperation(userId, new Date("2026-09-26T20:01:00.000Z"));
      const result = await resolveQuestionMealCalculationText({
        ...inputFor(userId, alias),
        pendingOperation: pending!,
      });
      expect(result?.action).toBe("question_meal_calculation_completed");
    },
  );

  it("cancels without calculating and leaves no active continuation", async () => {
    const userId = 120920;
    await createQuestionMealCalculationContinuation({
      userId,
      question: "me dê uma opção de café da tarde",
      messageId: "cancel-1209",
    });
    const pending = await repository.getActivePendingOperation(userId, new Date("2026-09-26T20:01:00.000Z"));
    const result = await resolveQuestionMealCalculationText({
      ...inputFor(userId, "não"),
      pendingOperation: pending!,
    });
    expect(result?.action).toBe("question_meal_calculation_cancelled");
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(await repository.getActivePendingOperation(userId)).toBeNull();
  });

  it("does not consume the operation for an invalid response", async () => {
    const userId = 120930;
    await createQuestionMealCalculationContinuation({
      userId,
      question: "me dê uma opção de café da tarde",
      messageId: "invalid-1209",
    });
    const pending = await repository.getActivePendingOperation(userId);
    expect(parseQuestionMealCalculationAction("talvez")).toBeNull();
    expect(rebuildQuestionMealCalculation(pending!)).toEqual(expect.objectContaining({
      reply: expect.stringContaining("Quer que eu calcule"),
      interactiveReply: expect.any(Object),
    }));
    expect(await repository.getActivePendingOperation(userId)).toEqual(pending);
  });

  it("does not invent an action without a pending continuation and does not execute an expired one", async () => {
    const withoutPending = await repository.getActivePendingOperation(120960, new Date("2026-09-26T20:01:00.000Z"));
    expect(withoutPending).toBeNull();
    expect(parseQuestionMealCalculationAction("sim")).toBe("calculate");

    const userId = 120961;
    await createQuestionMealCalculationContinuation({
      userId,
      question: "me dê uma opção de café da tarde",
      receivedAt: new Date("2026-09-26T20:00:00.000Z"),
      messageId: "expired-1209",
    });
    expect(await repository.getActivePendingOperation(userId, new Date("2026-09-26T20:20:00.000Z"))).toBeNull();
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
  });

  it("recreates a recoverable continuation when rendering fails after the claim", async () => {
    const userId = 120970;
    await createQuestionMealCalculationContinuation({
      userId,
      question: "me dê uma opção de café da tarde",
      messageId: "recover-1209",
      receivedAt: new Date("2026-09-26T20:00:00.000Z"),
    });
    const pending = await repository.getActivePendingOperation(userId, new Date("2026-09-26T20:01:00.000Z"));
    (pending!.target as any).option.items = [{}];

    const recovered = await resolveQuestionMealCalculationText({
      ...inputFor(userId, "sim"),
      pendingOperation: pending!,
    });
    expect(recovered).toEqual(expect.objectContaining({
      eventType: "whatsapp.question_meal_calculation.recovery_requested",
      action: "clarification_needed",
    }));
    expect(await repository.getActivePendingOperation(userId, new Date("2026-09-26T20:01:00.000Z"))).toEqual(expect.objectContaining({
      type: PENDING_QUESTION_MEAL_CALCULATION_TYPE,
    }));
  });

  it("allows only one concurrent material resolution through the versioned claim", async () => {
    const userId = 120940;
    await createQuestionMealCalculationContinuation({
      userId,
      question: "me dê uma opção de café da tarde",
      messageId: "race-1209",
    });
    const pending = await repository.getActivePendingOperation(userId, new Date("2026-09-26T20:01:00.000Z"));
    const [first, second] = await Promise.all([
      resolveQuestionMealCalculationText({
        ...inputFor(userId, "sim"),
        pendingOperation: pending!,
      }),
      resolveQuestionMealCalculationText({
        ...inputFor(userId, "sim"),
        pendingOperation: pending!,
      }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
  });
});
