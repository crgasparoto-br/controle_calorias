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
    async claimPendingOperation() {
      return { claimed: false };
    },
    async cancelPendingOperation() {
      return { cancelled: false };
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

vi.mock("../../db", () => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
  getHabitSnapshots: vi.fn(async () => []),
}));
vi.mock("../../nutritionEngine", () => ({ processMealInput: vi.fn() }));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => state.repository),
}));
vi.mock("../meals/service", () => ({
  createManualMeal: vi.fn(),
  listMeals: vi.fn(async () => []),
  updateMeal: vi.fn(),
  removeMeal: vi.fn(),
}));
vi.mock("./aiQuestionAssistant", () => ({
  isWhatsappAiQuestionText: vi.fn(() => false),
  executeWhatsappAiQuestionIntent: vi.fn(async () => null),
}));
vi.mock("./webhookTextCommands", () => ({
  PENDING_CONFIRMATION_TYPE: "confirmation",
  handlePendingWhatsAppConfirmation: vi.fn(async () => null),
  completeWhatsappGenericConfirmationCallback: vi.fn(),
}));
vi.mock("./deleteIntent", () => ({
  PENDING_DELETE_TYPE: "delete",
  executeWhatsappDeleteIntent: vi.fn(async () => null),
  completeWhatsappDeleteInteractiveCallback: vi.fn(),
}));
vi.mock("./mealItemSelectionCallback", () => ({
  PENDING_MEAL_ITEM_SELECTION_TYPE: "meal_item_selection",
  completeMealItemSelectionInteractiveCallback: vi.fn(),
}));
vi.mock("./periodReportClarification", () => ({
  PENDING_PERIOD_REPORT_TYPE: "period_report",
  isExpectedWhatsappPeriodReportAction: vi.fn(() => false),
  completeWhatsappPeriodReportCallback: vi.fn(),
}));
vi.mock("./interactiveCallback", () => ({ claimWhatsAppInteractiveCallback: vi.fn() }));
vi.mock("./mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: vi.fn() }));
vi.mock("./mealConsolidationService", () => ({ consolidateWhatsAppMealAfterSave: vi.fn() }));

const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");

function pendingTarget() {
  return {
    contractVersion: 1,
    interactionId: "free-text-webhook-855",
    kind: "food_registration_clarification",
    classification: "open",
    pendingKind: "quantity",
    originalText: "1 iogurte natural desnatado",
    sanitizedOriginalText: "1 iogurte natural desnatado",
    originalCandidate: "iogurte natural desnatado",
    normalizedCandidate: "iogurte natural desnatado",
    normalizationChanged: false,
    count: 1,
    qualifiers: ["natural", "desnatado"],
    candidates: [],
    selectedCandidateIndex: null,
    actions: [
      { id: "provide_quantity", label: "Informar quantidade", effect: "complete_original_food" },
      { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
    ],
    instructionText: "Qual é o peso do iogurte?",
    inboundMessageId: "wamid.pending.855",
    allowedDomainEffect: "register_original_food_once",
  };
}

describe("issue #855 - gate real do webhook para nova refeição livre", () => {
  beforeEach(() => state.reset());

  it.each([
    "arroz com frango",
    "jantar: arroz e frango",
    "pão com queijo e café",
  ])("libera %s para o pipeline e substitui a pendência anterior", async text => {
    const start = new Date("2026-07-21T20:00:00.000Z");
    await state.repository.createPendingOperation({
      userId: 42,
      type: "food_registration_clarification",
      origin: "foodClarification",
      target: pendingTarget(),
      ttlMs: 600_000,
      now: start,
    });

    const result = await resolveWhatsAppPrecedenceGate({
      userId: 42,
      text,
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.new-meal.855",
    });

    expect(result).toEqual({ step: "continue_pipeline" });
    expect(await state.repository.getActivePendingOperation(42, new Date(start.getTime() + 1000))).toBeNull();
    expect([...state.rows.values()].some(row => row.state === "superseded")).toBe(true);
  });
});
