import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  let nextId = 1;
  const rows = new Map<number, any>();
  const meals: any[] = [];
  const repository = {
    async createPendingOperation(input: any) {
      const now = input.now ?? new Date();
      const row = {
        id: nextId++,
        userId: input.userId,
        type: input.type,
        origin: input.origin,
        target: input.target,
        state: "active",
        version: 1,
        createdAt: now,
        expiresAt: new Date(now.getTime() + input.ttlMs),
        updatedAt: now,
        consumedAt: null,
      };
      rows.set(row.id, row);
      return row;
    },
    async getActivePendingOperation(userId: number, now = new Date()) {
      return [...rows.values()]
        .filter(row => row.userId === userId && row.state === "active" && row.expiresAt.getTime() >= now.getTime())
        .sort((left, right) => right.id - left.id)[0] ?? null;
    },
    async getPendingOperationById(id: number) {
      return rows.get(id) ?? null;
    },
    async claimPendingOperation({ id, expectedVersion }: any) {
      const row = rows.get(id);
      if (!row || row.state !== "active" || row.version !== expectedVersion) return { claimed: false };
      row.state = "consumed";
      row.version += 1;
      row.consumedAt = new Date();
      return { claimed: true };
    },
    async cancelPendingOperation(id: number) {
      const row = rows.get(id);
      if (!row || row.state !== "active") return { cancelled: false };
      row.state = "cancelled";
      row.version += 1;
      return { cancelled: true };
    },
    async supersedePendingOperation(id: number) {
      const row = rows.get(id);
      if (!row || row.state !== "active") return { superseded: false };
      row.state = "superseded";
      row.version += 1;
      return { superseded: true };
    },
    async purgeInactiveOperations() {
      return 0;
    },
  };
  return { rows, meals, repository, reset() { nextId = 1; rows.clear(); meals.splice(0); } };
});

const processFoodMock = vi.hoisted(() => vi.fn());
const createMealMock = vi.hoisted(() => vi.fn());
const deleteIntentMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
  getHabitSnapshots: vi.fn(async () => []),
}));
vi.mock("../../nutritionEngine", () => ({
  processMealInput: processFoodMock,
}));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => state.repository),
}));
vi.mock("../meals/service", () => ({
  createManualMeal: createMealMock,
  listMeals: vi.fn(async (userId: number) => state.meals.filter(meal => meal.userId === userId)),
  updateMeal: vi.fn(async (userId: number, input: any) => ({ id: input.mealId, userId, ...input })),
  removeMeal: vi.fn(async () => true),
}));
vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resposta canônica da refeição."),
}));
vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({ action: "created", meal })),
}));
vi.mock("./deleteIntent", () => ({ executeWhatsappDeleteIntent: deleteIntentMock }));
vi.mock("./intent/foodAdditionHandlers", () => ({
  handleCoffeeAdditionIntent: vi.fn(),
  handleCoffeeLorCapsuleIntent: vi.fn(),
  handleFoodAdditionIntent: vi.fn(),
}));
vi.mock("./intent/foodReplacementHandlers", () => ({ handleFoodReplacementIntents: vi.fn() }));
vi.mock("./intent/gramsAdjustmentHandlers", () => ({
  handleMealItemMultiAdjustment: vi.fn(),
  handleMealItemMultiIncrement: vi.fn(),
  handleMealItemReplacement: vi.fn(),
  handleQuantityCorrectionIntent: vi.fn(),
}));
vi.mock("./intent/waterAndReportHandlers", () => ({
  handlePeriodReportIntent: vi.fn(),
  handleSnackSuggestionIntent: vi.fn(),
  handleWaterIntent: vi.fn(),
}));
vi.mock("./intent/parsers", () => ({
  parseCoffeeAdditionIntent: vi.fn(() => null),
  parseCoffeeLorCapsuleIntent: vi.fn(() => null),
  parseFoodAdditionIntent: vi.fn(() => null),
  parseFoodReplacementIntents: vi.fn(() => null),
  parseMealItemGramsAdjustmentMulti: vi.fn(() => null),
  parseMealItemGramsIncrementMulti: vi.fn(() => null),
  parseMealItemGramsReplacement: vi.fn(() => null),
  parseQuantityCorrectionIntent: vi.fn(() => null),
  parseSnackSuggestionIntent: vi.fn(() => false),
  parseWaterIntent: vi.fn(() => null),
}));
vi.mock("./intent/dateTime", () => ({ parseReportPeriod: vi.fn(() => null) }));
vi.mock("./userMeasurementReplyContext", () => ({
  getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

const { executeWhatsappTextIntent } = await import("./intentActions");
const { resolvePendingWhatsappFoodClarification } = await import("./foodClarificationGate");
const { beginInboundMessage, withMessageLifecycleService } = await import("./messageLifecycle");

function processedFood(text: string) {
  return {
    detectedMealLabel: "Lanche",
    sourceText: text,
    confidence: 0.95,
    needsConfirmation: false,
    reasoning: "teste de cadeia",
    items: [{
      foodName: "Iogurte natural desnatado",
      canonicalName: "Iogurte natural desnatado",
      brand: null,
      quantity: 170,
      unit: "g",
      portionText: "170 g",
      servings: 1,
      estimatedGrams: 170,
      calories: 90,
      protein: 8,
      carbs: 10,
      fat: 1,
      confidence: 0.9,
      source: "catalog" as const,
    }],
    totals: { calories: 90, protein: 8, carbs: 10, fat: 1 },
  };
}

function createLifecycleService() {
  return {
    beginInboundMessage: vi.fn(async () => ({ conversationId: 1, messageId: 10, wasNewInsert: true })),
    claimMessageForProcessing: vi.fn(async () => true),
    wasMessageAlreadyProcessed: vi.fn(async () => false),
    recordOutboundReply: vi.fn(async () => undefined),
    recordDomainLink: vi.fn(async () => undefined),
    markMessageProcessed: vi.fn(async () => undefined),
    enrichInboundMessage: vi.fn(async () => true),
  } as any;
}

describe("issue #855 production text chain", () => {
  beforeEach(() => {
    state.reset();
    vi.clearAllMocks();
    deleteIntentMock.mockResolvedValue(null);
    processFoodMock.mockImplementation(async ({ text }: any) => processedFood(text));
    createMealMock.mockImplementation(async (userId: number, input: any) => {
      const meal = { id: state.meals.length + 1, userId, ...input };
      state.meals.push(meal);
      return meal;
    });
  });

  it("usa o executor textual real para áudio transcrito e herda o ID externo do lifecycle", async () => {
    const start = new Date("2026-07-21T20:00:00.000Z");
    const requested = await withMessageLifecycleService(createLifecycleService(), async () => {
      await beginInboundMessage({
        userId: 42,
        whatsappConnectionId: null,
        phoneNumber: "5515999999999",
        externalMessageId: "wamid.audio.855",
        contentType: "audio",
        transcript: "1 iogurte natual desnatado",
        occurredAt: start,
      });
      return executeWhatsappTextIntent(42, {
        text: "1 iogurte natual desnatado",
        receivedAt: start,
        userTimezone: "America/Sao_Paulo",
        entrypoint: "audio_transcription",
      });
    });
    expect(requested).toEqual(expect.objectContaining({
      action: "food_clarification_requested",
      data: expect.objectContaining({ inboundMessageId: "wamid.audio.855" }),
    }));

    const incompatible = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "registrar",
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.text.855.1",
    });
    expect(incompatible).toEqual(expect.objectContaining({ action: "food_clarification_reprompted" }));
    expect(processFoodMock).not.toHaveBeenCalled();

    const completed = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "170 g.",
      receivedAt: new Date(start.getTime() + 2000),
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.text.855.2",
    });
    expect(completed).toEqual(expect.objectContaining({ action: "food_clarification_completed" }));
    expect(processFoodMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "170 g de iogurte natural desnatado",
    }));
    expect(createMealMock).toHaveBeenCalledTimes(1);
  });

  it("bloqueia comando pontuado no gate antes de qualquer inferência nutricional", async () => {
    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "registrar!",
      receivedAt: new Date("2026-07-21T20:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });
    expect(result).toEqual(expect.objectContaining({ action: "food_clarification_standalone_command_blocked" }));
    expect(processFoodMock).not.toHaveBeenCalled();
    expect(createMealMock).not.toHaveBeenCalled();
  });
});
