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

const processMealDraftMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: vi.fn(async () => ({ configured: true, source: "env" })),
  getDb: vi.fn(),
  getHabitSnapshots: vi.fn(async () => []),
  getUserWhatsappConnection: vi.fn(async () => null),
  logInferenceEvent: vi.fn(),
  logPersistenceWarning: vi.fn(),
  upsertUserWhatsappConnection: vi.fn(),
}));
vi.mock("../../nutritionEngine", () => ({ processMealInput: vi.fn() }));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => state.repository),
}));
vi.mock("../meals/service", () => ({
  processMealDraft: processMealDraftMock,
  createManualMeal: vi.fn(),
  listMeals: vi.fn(async () => []),
  updateMeal: vi.fn(),
  removeMeal: vi.fn(),
}));
vi.mock("../professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: vi.fn(async () => null),
}));
vi.mock("../../whatsappConfig", () => ({
  getMissingWhatsAppChannelConfig: vi.fn(() => []),
  getWhatsAppChannelConfig: vi.fn(() => ({
    solutionPhoneNumber: null,
    phoneNumberId: null,
    businessAccountId: null,
  })),
  normalizeWhatsAppPhoneNumber: vi.fn((value: string) => value),
}));
vi.mock("./conversationContext", () => ({
  getWhatsappConversationPendingContext: vi.fn(() => null),
  registerWhatsappConversationPendingContext: vi.fn(),
  resolveWhatsappConversationContext: vi.fn(() => null),
}));
vi.mock("./aiQuestionAssistant", () => ({ executeWhatsappAiQuestionIntent: vi.fn(async () => null) }));
vi.mock("./datedFoodAdditionIntent", () => ({ executeWhatsappDatedFoodAdditionIntent: vi.fn(async () => null) }));
vi.mock("./deleteIntent", () => ({ executeWhatsappDeleteIntent: vi.fn(async () => null) }));
vi.mock("./foodAssistant", () => ({ executeWhatsAppFoodAssistantIntent: vi.fn(() => null) }));
vi.mock("./inboundIdempotencyGuard", () => ({
  evaluateWhatsappInboundIdempotency: vi.fn(() => ({ shouldProcess: true })),
  buildWhatsappDuplicateInboundResult: vi.fn(),
}));
vi.mock("./intentActions", () => ({ executeWhatsappTextIntent: vi.fn(async () => null) }));
vi.mock("./llmIntentActions", () => ({ executeWhatsappLlmIntent: vi.fn(async () => null) }));
vi.mock("./multiActionIntent", () => ({ executeWhatsappMultiActionIntent: vi.fn(() => null) }));
vi.mock("./pendingOperationPrecedence", () => ({ supersedeActiveWhatsappPendingOperations: vi.fn(async () => true) }));
vi.mock("./intentResult", () => ({ getWhatsAppIntentLogStatus: vi.fn(() => "success") }));
vi.mock("./recordAdjustmentIntent", () => ({ executeWhatsappRecordAdjustmentIntent: vi.fn(async () => null) }));
vi.mock("./gramsAdjustmentIntent", () => ({ executeWhatsappGramsAdjustmentIntent: vi.fn(async () => null) }));
vi.mock("./gramsIncrementIntent", () => ({ executeWhatsappGramsIncrementIntent: vi.fn(async () => null) }));
vi.mock("./temporalContext", () => ({
  resolveWhatsappTemporalContext: vi.fn(() => ({ context: null, clarification: null })),
}));
vi.mock("./waterFoodText", () => ({
  isWhatsAppWaterOnlyText: vi.fn(() => false),
  splitWhatsAppWaterAndFoodText: vi.fn(() => null),
}));
vi.mock("./timeZoneContext", () => ({
  resolveInjectedWhatsAppTimeZone: vi.fn(() => ({ timeZone: "America/Sao_Paulo", source: "profile" })),
}));
vi.mock("./mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: vi.fn() }));
vi.mock("./mealConsolidationService", () => ({ consolidateWhatsAppMealAfterSave: vi.fn() }));

const { simulateWhatsappInbound } = await import("./service");

function pendingTarget() {
  return {
    contractVersion: 1,
    interactionId: "free-text-simulator-855",
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
    inboundMessageId: "simulator.pending.855",
    allowedDomainEffect: "register_original_food_once",
  };
}

describe("issue #855 - simulador substitui pendência por refeição livre", () => {
  beforeEach(() => {
    state.reset();
    vi.clearAllMocks();
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-free-text-855",
      processed: { items: [{ foodName: "Arroz com frango" }] },
      media: [],
    });
  });

  it.each([
    "arroz com frango",
    "jantar: arroz e frango",
    "pão com queijo e café",
  ])("encaminha %s uma única vez ao fallback nutricional canônico", async text => {
    const start = new Date("2026-07-21T20:00:00.000Z");
    await state.repository.createPendingOperation({
      userId: 42,
      type: "food_registration_clarification",
      origin: "foodClarification",
      target: pendingTarget(),
      ttlMs: 600_000,
      now: start,
    });

    const result = await simulateWhatsappInbound(42, {
      text,
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
      messageId: `simulator-new-${text}`,
    });

    expect(result).toEqual(expect.objectContaining({ draftId: "draft-free-text-855" }));
    expect(processMealDraftMock).toHaveBeenCalledTimes(1);
    expect(processMealDraftMock).toHaveBeenCalledWith(42, { source: "whatsapp", text }, "America/Sao_Paulo");
    expect(await state.repository.getActivePendingOperation(42, new Date(start.getTime() + 1000))).toBeNull();
    expect([...state.rows.values()].some(row => row.state === "superseded")).toBe(true);
  });
});
