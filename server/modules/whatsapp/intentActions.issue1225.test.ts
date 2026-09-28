import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmed = vi.fn();
const structured = vi.fn();
const logInferenceEvent = vi.fn(async () => undefined);
const rows: Array<{ id: number; userId: number; preferenceKey: string; preferenceValue: string }> = [];
let nextId = 1;

function queryResult(result: typeof rows) {
  return {
    limit: async (count: number) => result.slice(0, count),
    then: (resolve: (value: typeof rows) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
}

const fakeDb = {
  insert: () => ({
    values: (values: Omit<(typeof rows)[number], "id">) => ({
      onDuplicateKeyUpdate: async ({ set }: { set: Partial<(typeof rows)[number]> }) => {
        const existing = rows.find(row => row.userId === values.userId && row.preferenceKey === values.preferenceKey);
        if (existing) Object.assign(existing, set, { preferenceValue: values.preferenceValue });
        else rows.push({ id: nextId++, ...values });
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => queryResult([...rows]),
    }),
  }),
};

const getDb = vi.fn(async () => fakeDb);

vi.mock("../../db", () => ({
  getDb,
  getHabitSnapshots: vi.fn(async () => []),
  logInferenceEvent,
  logPersistenceWarning: vi.fn(),
}));
vi.mock("./confirmedMealRegistration", () => ({ executeConfirmedWhatsAppMealRegistration: confirmed }));
vi.mock("./structuredCoffeeIntentActions", () => ({ tryExecuteWhatsappStructuredCoffeeIntent: structured }));
vi.mock("./messageRouter", () => ({
  resolveWhatsAppPrecedenceGate: vi.fn(async () => ({ step: "continue_pipeline" })),
}));
vi.mock("../meals/service", () => ({ listMeals: vi.fn(), updateMeal: vi.fn() }));
vi.mock("../water/service", () => ({ createWaterLog: vi.fn() }));
vi.mock("../onboarding/profileRead", () => ({
  getUserOnboardingProfile: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })),
}));

const {
  recordWhatsappContextMemory,
  __resetWhatsappContextMemoryForTests,
} = await import("./contextMemory");
const {
  persistWhatsappContextMemoryEntry,
  __resetPersistentWhatsappContextMemoryForTests,
} = await import("./persistentContextMemory");
const { executeWhatsappTextIntent } = await import("./intentActions");

const receivedAt = new Date("2026-09-28T13:00:00.000Z");

async function persistCoffeePreference(userId: number) {
  const entry = recordWhatsappContextMemory({
    userId,
    scope: "individual",
    kind: "individual_preference",
    key: "food-preparation:cafe",
    value: "without_sugar",
    confidence: 0.92,
    appliesToIntents: ["add_foods_to_meal"],
    source: { sourceType: "feedback", feedbackId: 1225 },
    createdAt: receivedAt,
  });
  await persistWhatsappContextMemoryEntry(entry);

  // Simula restart/segunda instância: a próxima decisão só pode vir do adapter
  // persistente, nunca do estado local do processo anterior.
  __resetWhatsappContextMemoryForTests();
  __resetPersistentWhatsappContextMemoryForTests();
}

function registeredResult() {
  return {
    status: "registered" as const,
    result: {
      handled: true as const,
      action: "meal_item_added" as const,
      reply: "Refeição registrada.",
      eventType: "whatsapp.meal_intent_decision.registered",
      detail: "pipeline nutricional canônico",
      data: { mealId: 1225 },
    },
  };
}

describe("issue #1225 - canonical coffee routing with durable personal memory", () => {
  beforeEach(() => {
    rows.length = 0;
    nextId = 1;
    vi.clearAllMocks();
    getDb.mockResolvedValue(fakeDb);
    __resetWhatsappContextMemoryForTests();
    __resetPersistentWhatsappContextMemoryForTests();
    confirmed.mockResolvedValue(registeredResult());
    structured.mockResolvedValue({
      matched: true,
      result: {
        handled: true,
        action: "clarification_needed",
        reply: "com ou sem açúcar?",
        eventType: "whatsapp.coffee_preparation_clarification.created",
        detail: "#974",
      },
    });
  });

  it.each([undefined, "audioTranscription", "simulateWhatsappInbound"])(
    "applies the persisted preference through the canonical %s entrypoint",
    async entrypoint => {
      await persistCoffeePreference(101);

      const result = await executeWhatsappTextIntent(101, {
        text: "3 xícaras de café",
        receivedAt,
        userTimezone: "America/Sao_Paulo",
        messageId: "wamid.issue1225",
        ...(entrypoint ? { entrypoint } : {}),
      });

      expect(result).toMatchObject({
        action: "meal_item_added",
        data: {
          contextMemoryApplied: true,
          contextMemoryKey: "food-preparation:cafe",
          preparationChoice: "without_sugar",
        },
      });
      expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({
        userId: 101,
        registrationText: "3 xícaras de café sem açúcar",
        originalText: "3 xícaras de café",
      }));
      expect(structured).not.toHaveBeenCalled();
    },
  );

  it("keeps #974 and isolates users when no applicable persisted memory exists", async () => {
    await persistCoffeePreference(101);

    const result = await executeWhatsappTextIntent(202, {
      text: "3 xícaras de café",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toMatchObject({ action: "clarification_needed" });
    expect(structured).toHaveBeenCalledOnce();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("keeps explicit current preparation ahead of the persisted preference", async () => {
    await persistCoffeePreference(101);

    const result = await executeWhatsappTextIntent(101, {
      text: "3 xícaras de café com açúcar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toMatchObject({ action: "meal_item_added" });
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({
      registrationText: "3 xícaras de café com açúcar",
      originalText: "3 xícaras de café com açúcar",
    }));
    expect(result.data?.contextMemoryApplied).toBeUndefined();
  });
});
