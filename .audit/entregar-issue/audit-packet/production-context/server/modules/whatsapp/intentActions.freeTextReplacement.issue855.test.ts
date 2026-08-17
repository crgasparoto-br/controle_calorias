import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  let nextId = 1;
  const rows = new Map<number, any>();
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
  return {
    rows,
    repository,
    reset() {
      nextId = 1;
      rows.clear();
    },
  };
});

const processFoodMock = vi.hoisted(() => vi.fn());
const createMealMock = vi.hoisted(() => vi.fn());
const parseFoodAdditionIntentMock = vi.hoisted(() => vi.fn());
const handleFoodAdditionIntentMock = vi.hoisted(() => vi.fn());
const deleteIntentMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
  getHabitSnapshots: vi.fn(async () => []),
}));
vi.mock("../../nutritionEngine", () => ({ processMealInput: processFoodMock }));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => state.repository),
}));
vi.mock("../meals/service", () => ({
  createManualMeal: createMealMock,
  listMeals: vi.fn(async () => []),
  updateMeal: vi.fn(),
  removeMeal: vi.fn(async () => true),
}));
vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resposta canônica."),
}));
vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({ action: "created", meal })),
}));
vi.mock("./deleteIntent", () => ({ executeWhatsappDeleteIntent: deleteIntentMock }));
vi.mock("./intent/foodAdditionHandlers", () => ({
  handleCoffeeAdditionIntent: vi.fn(),
  handleCoffeeLorCapsuleIntent: vi.fn(),
  handleFoodAdditionIntent: handleFoodAdditionIntentMock,
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
  parseFoodAdditionIntent: parseFoodAdditionIntentMock,
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

describe("issue #855 - cadeia textual após substituir clarificação", () => {
  beforeEach(() => {
    state.reset();
    vi.clearAllMocks();
    deleteIntentMock.mockResolvedValue(null);
    parseFoodAdditionIntentMock.mockReturnValue(null);
    processFoodMock.mockResolvedValue({
      detectedMealLabel: "Refeição",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: false,
      reasoning: "teste",
      items: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
  });

  it.each(["audio_transcription", "simulateWhatsappInbound", "webhook_text"])(
    "entrega refeição livre ao parser canônico uma vez no entrypoint %s",
    async entrypoint => {
      const start = new Date("2026-07-21T20:00:00.000Z");
      const pending = await executeWhatsappTextIntent(42, {
        text: "1 iogurte natural desnatado",
        receivedAt: start,
        userTimezone: "America/Sao_Paulo",
        entrypoint,
      });
      expect(pending?.action).toBe("food_clarification_requested");

      const parsed = {
        mealLabel: "Jantar",
        date: new Date(start.getTime() + 1000),
        items: [{ foodName: "arroz com frango", quantity: 1, unit: "porção", brand: null }],
      };
      parseFoodAdditionIntentMock.mockReturnValue(parsed);
      handleFoodAdditionIntentMock.mockResolvedValue({
        handled: true,
        action: "meal_item_added",
        reply: "Nova refeição encaminhada.",
        eventType: "whatsapp.intent.meal_item_added",
        detail: "Parser alimentar canônico executado.",
      });

      const result = await executeWhatsappTextIntent(42, {
        text: "jantar: arroz e frango",
        receivedAt: new Date(start.getTime() + 1000),
        userTimezone: "America/Sao_Paulo",
        entrypoint,
      });

      expect(result).toEqual(expect.objectContaining({ action: "meal_item_added" }));
      expect(parseFoodAdditionIntentMock).toHaveBeenCalledTimes(1);
      expect(handleFoodAdditionIntentMock).toHaveBeenCalledTimes(1);
      expect(await state.repository.getActivePendingOperation(42, new Date(start.getTime() + 1000))).toBeNull();
      expect([...state.rows.values()].some(row => row.state === "superseded")).toBe(true);
      expect(processFoodMock).not.toHaveBeenCalled();
      expect(createMealMock).not.toHaveBeenCalled();
    },
  );
});
