import { beforeEach, describe, expect, it, vi } from "vitest";

const recordFeedback = vi.fn();
const recordMemory = vi.fn();
const persistMemory = vi.fn();
const loadMemories = vi.fn();

vi.mock("./feedbackLoop", () => ({ recordWhatsappUserFeedback: recordFeedback }));
vi.mock("./contextMemory", () => ({
  WHATSAPP_CONTEXT_MEMORY_VERSION: "whatsapp-context-memory/v1",
  recordWhatsappMemoryFromFeedback: recordMemory,
}));
vi.mock("./persistentContextMemory", () => ({
  persistWhatsappContextMemoryEntry: persistMemory,
  loadPersistedWhatsappContextMemories: loadMemories,
}));

const {
  extractWhatsappReusablePreparationPreference,
  persistWhatsappReusablePreparationPreferenceFromText,
  resolveWhatsappPersonalPreparationPreference,
} = await import("./personalPreparationPreference");

const createdAt = new Date("2026-09-10T12:00:00.000Z");

function contextMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    userId: 42,
    scope: "individual",
    kind: "individual_preference",
    status: "active",
    key: "food-preparation:cafe",
    keyHash: "key-hash",
    value: "without_sugar",
    valueHash: "value-hash",
    confidence: 0.9,
    priority: 100,
    appliesToIntents: ["add_foods_to_meal"],
    source: { sourceType: "feedback", feedbackId: 10, historyId: null, ruleVersion: "whatsapp-context-memory/v1" },
    replacesMemoryId: null,
    replacedByMemoryId: null,
    expiresAt: "2027-03-09T12:00:00.000Z",
    disabledReason: null,
    privacy: { policyVersion: "test" },
    ...overrides,
  } as any;
}

describe("issue #1059 - reusable personal preparation preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordFeedback.mockReturnValue({
      id: 10,
      createdAt: createdAt.toISOString(),
      userId: 42,
      sanitizedFeedback: "normalmente tomo café sem açúcar",
      kind: "preference",
      confidence: 0.9,
      scope: "individual",
      status: "recorded",
      targetHistoryId: null,
      targetIntent: null,
      generatedMemory: {
        kind: "preference",
        scope: "user",
        key: "preference",
        value: "normalmente tomo café sem açúcar",
        confidence: 0.9,
        sourceFeedbackId: 10,
        sourceHistoryId: null,
      },
    });
    recordMemory.mockImplementation((feedback: any) => contextMemory({
      key: feedback.generatedMemory.key,
      value: feedback.generatedMemory.value,
      kind: feedback.generatedMemory.kind === "alias" ? "individual_alias" : "individual_preference",
    }));
    persistMemory.mockImplementation(async entry => ({ ...entry, id: 501 }));
    loadMemories.mockResolvedValue([]);
  });

  it.each([
    ["normalmente tomo café sem açúcar", { subject: "cafe", choice: "without_sugar" }],
    ["meu café é sem açúcar", { subject: "cafe", choice: "without_sugar" }],
    ["costumo tomar café preto", { subject: "cafe", choice: "without_sugar" }],
    ["prefiro café com açúcar", { subject: "cafe", choice: "with_sugar" }],
  ])("extracts an explicit recurring signal from %s", (text, expected) => {
    expect(extractWhatsappReusablePreparationPreference(text)).toEqual(expected);
  });

  it.each([
    "4 xícaras de café sem açúcar",
    "ontem tomei café sem açúcar",
    "café sem açúcar",
  ])("does not silently learn an isolated occurrence: %s", text => {
    expect(extractWhatsappReusablePreparationPreference(text)).toBeNull();
  });

  it("normalizes the learned memory by food identity instead of quantity", async () => {
    const learned = await persistWhatsappReusablePreparationPreferenceFromText({
      userId: 42,
      text: "normalmente tomo café sem açúcar",
      createdAt,
    });

    expect(recordFeedback).toHaveBeenCalled();
    expect(recordMemory).toHaveBeenCalledWith(expect.objectContaining({
      targetIntent: "add_foods_to_meal",
      generatedMemory: expect.objectContaining({
        key: "food-preparation:cafe",
        value: "without_sugar",
      }),
    }));
    expect(persistMemory).toHaveBeenCalledWith(expect.objectContaining({
      key: "food-preparation:cafe",
      value: "without_sugar",
      appliesToIntents: ["add_foods_to_meal"],
    }));
    expect(learned).toMatchObject({ persisted: true, subject: "cafe", choice: "without_sugar", memory: { id: 501 } });
  });

  it("isolates memory by user", async () => {
    loadMemories.mockResolvedValue([contextMemory({ userId: 99 })]);
    await expect(resolveWhatsappPersonalPreparationPreference({
      userId: 42,
      subject: "café",
      intent: "add_foods_to_meal",
      now: createdAt,
    })).resolves.toEqual({ status: "missing" });
  });

  it.each([
    contextMemory({ status: "inactive" }),
    contextMemory({ status: "replaced", replacedByMemoryId: 88 }),
    contextMemory({ expiresAt: "2026-09-09T12:00:00.000Z" }),
  ])("ignores inactive, replaced or expired memory", async invalidMemory => {
    loadMemories.mockResolvedValue([invalidMemory]);
    await expect(resolveWhatsappPersonalPreparationPreference({
      userId: 42,
      subject: "café",
      intent: "add_foods_to_meal",
      now: createdAt,
    })).resolves.toEqual({ status: "missing" });
  });

  it("fails closed on conflicting applicable memories", async () => {
    loadMemories.mockResolvedValue([
      contextMemory({ id: 501, value: "without_sugar", valueHash: "without" }),
      contextMemory({ id: 502, value: "with_sugar", valueHash: "with" }),
    ]);
    await expect(resolveWhatsappPersonalPreparationPreference({
      userId: 42,
      subject: "café",
      intent: "add_foods_to_meal",
      now: createdAt,
    })).resolves.toEqual({ status: "conflict", memoryIds: [501, 502] });
  });

  it("returns unavailable instead of using process state when durable persistence cannot be read", async () => {
    loadMemories.mockResolvedValue(null);
    await expect(resolveWhatsappPersonalPreparationPreference({
      userId: 42,
      subject: "café",
      intent: "add_foods_to_meal",
      now: createdAt,
    })).resolves.toEqual({ status: "unavailable" });
  });
});
