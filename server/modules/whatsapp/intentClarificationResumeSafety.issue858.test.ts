import { describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", async () => {
  const actual = await vi.importActual<typeof import("../../db")>("../../db");
  return {
    ...actual,
    getDb: vi.fn(async () => null),
    logPersistenceWarning: vi.fn(),
  };
});

vi.mock("../meals/service", async () => {
  const actual = await vi.importActual<typeof import("../meals/service")>("../meals/service");
  return {
    ...actual,
    listMeals: listMealsMock,
  };
});

const {
  completeWhatsappIntentClarificationCallback,
  INTENT_CLARIFICATION_ACTIONS,
} = await import("./intentClarificationInteraction");

describe("segurança da retomada Registrar alimento da issue #858", () => {
  it("não executa exclusão quando o texto original pertence a outro domínio", async () => {
    listMealsMock.mockResolvedValue([{
      id: 901,
      userId: 85_821,
      mealLabel: "Almoço",
      occurredAt: "2026-07-21T15:00:00.000Z",
      source: "whatsapp",
      items: [{ foodName: "Arroz", portionText: "100 g" }],
    }]);

    const result = await completeWhatsappIntentClarificationCallback(
      85_821,
      {
        target: {
          contractVersion: 1,
          interactionId: "intent_clarification.generic",
          kind: "intent_clarification",
          originalText: "excluir almoço",
          actions: [...INTENT_CLARIFICATION_ACTIONS],
        },
      } as never,
      "register_food",
      new Date("2026-07-22T01:00:00.000Z"),
    );

    expect(result.eventType).toBe("whatsapp.intent_clarification.register_food");
    expect(result.data).toEqual(expect.objectContaining({
      originalTextPreserved: true,
      originalTextResumed: false,
    }));
    expect(listMealsMock).not.toHaveBeenCalled();
  });
});
