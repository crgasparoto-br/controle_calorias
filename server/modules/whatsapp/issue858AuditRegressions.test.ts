import { beforeEach, describe, expect, it, vi } from "vitest";

const listUserMealsMock = vi.hoisted(() => vi.fn());
const relabelUserMealsMock = vi.hoisted(() => vi.fn());
const listMealsMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", async () => {
  const actual = await vi.importActual<typeof import("../../db")>("../../db");
  return {
    ...actual,
    getDb: vi.fn(async () => null),
    logPersistenceWarning: vi.fn(),
    listUserMeals: listUserMealsMock,
    relabelUserMeals: relabelUserMealsMock,
  };
});

vi.mock("../meals/service", async () => {
  const actual = await vi.importActual<typeof import("../meals/service")>("../meals/service");
  return {
    ...actual,
    listMeals: listMealsMock,
  };
});

const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");
const { buildWhatsAppCallbackId } = await import("./interactiveCallback");
const { executeWhatsappTextIntent } = await import("./intentActions");
const {
  completeWhatsappIntentClarificationCallback,
  INTENT_CLARIFICATION_ACTIONS,
  PENDING_INTENT_CLARIFICATION_TYPE,
} = await import("./intentClarificationInteraction");
const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");
const { PENDING_PERIOD_REPORT_TYPE } = await import("./periodReportClarification");
const {
  handlePendingWhatsAppConfirmation,
  handleWhatsAppAction,
} = await import("./webhookTextCommands");

const pendingRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});

describe("regressões discriminantes da auditoria da issue #858", () => {
  beforeEach(() => {
    listUserMealsMock.mockReset();
    relabelUserMealsMock.mockReset();
    listMealsMock.mockReset();
    listMealsMock.mockResolvedValue([]);
  });

  it("executor textual direto, usado pelo áudio transcrito, resolve a pendência pelo gate antes dos parsers", async () => {
    const userId = 85_801;
    const receivedAt = new Date("2026-07-22T01:00:00.000Z");
    const pending = await pendingRepository.createPendingOperation({
      userId,
      type: PENDING_PERIOD_REPORT_TYPE,
      origin: "test.audioTranscription",
      ttlMs: 60_000,
      now: receivedAt,
      target: { kind: "period_report" },
    });
    expect(pending).toBeTruthy();

    const result = await executeWhatsappTextIntent(userId, {
      text: "ontem",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      entrypoint: "audioTranscription",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "period_report",
      eventType: "whatsapp.intent.period_report",
    }));
    expect(await pendingRepository.getActivePendingOperation(userId, receivedAt)).toBeNull();
  });

  it("Registrar alimento retoma o texto original quando ele já contém dados suficientes para uma clarificação específica", async () => {
    const userId = 85_802;
    const target = {
      contractVersion: 1 as const,
      interactionId: "intent_clarification.generic" as const,
      kind: "intent_clarification" as const,
      originalText: "1 iorgute natual",
      actions: [...INTENT_CLARIFICATION_ACTIONS],
    };

    const result = await completeWhatsappIntentClarificationCallback(
      userId,
      { target } as never,
      "register_food",
      new Date("2026-07-22T01:00:00.000Z"),
    );

    expect(result.eventType).toMatch(/^whatsapp\.food_clarification\./);
    expect(result.data).toEqual(expect.objectContaining({
      originalTextPreserved: true,
      originalTextResumed: true,
    }));
    const active = await pendingRepository.getActivePendingOperation(userId);
    expect(active?.type).toBe("food_registration_clarification");
  });

  it("reclassificação Todos recentes usa somente os IDs persistidos, mesmo quando surge uma refeição mais nova", async () => {
    const userId = 85_803;
    const firstSnapshot = [
      { id: 101, userId, mealLabel: "Lanche", source: "whatsapp", occurredAt: "2026-07-21T20:00:00.000Z" },
      { id: 102, userId, mealLabel: "Jantar", source: "whatsapp", occurredAt: "2026-07-21T19:00:00.000Z" },
    ];
    listUserMealsMock.mockResolvedValueOnce(firstSnapshot);

    const created = await handleWhatsAppAction({
      kind: "reclassify_recent_meals",
      fromMealLabel: "Lanche",
      toMealLabel: "Café da manhã",
    }, userId);
    expect(created.eventType).toBe("whatsapp.action_clarification_needed");

    listUserMealsMock.mockResolvedValueOnce([
      { id: 999, userId, mealLabel: "Lanche", source: "whatsapp", occurredAt: "2026-07-21T21:00:00.000Z" },
      ...firstSnapshot,
    ]);
    relabelUserMealsMock.mockResolvedValue([
      { ...firstSnapshot[0], mealLabel: "Café da manhã" },
      { ...firstSnapshot[1], mealLabel: "Café da manhã" },
    ]);

    const confirmed = await handlePendingWhatsAppConfirmation({ text: { body: "todos" } }, userId);

    expect(confirmed?.eventType).toBe("whatsapp.action_applied");
    expect(relabelUserMealsMock).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      mealIds: [101, 102],
      mealLabel: "Café da manhã",
    }));
    expect(relabelUserMealsMock.mock.calls[0][0].mealIds).not.toContain(999);
  });

  it("callback Cancelar registra ciclo de vida cancelled em vez de consumed", async () => {
    const userId = 85_804;
    const pending = await pendingRepository.createPendingOperation({
      userId,
      type: PENDING_INTENT_CLARIFICATION_TYPE,
      origin: "intentClarificationInteraction",
      ttlMs: 60_000,
      target: {
        contractVersion: 1,
        interactionId: "intent_clarification.generic",
        kind: "intent_clarification",
        originalText: "registrar",
        actions: [...INTENT_CLARIFICATION_ACTIONS],
      },
    });
    if (!pending) throw new Error("pendência não criada");

    const result = await resolveWhatsAppPrecedenceGate({
      userId,
      interactiveReplyId: buildWhatsAppCallbackId(pending.id, "cancel"),
    });

    expect(result.step).toBe("interactive_callback");
    if (result.step !== "interactive_callback") throw new Error("callback não resolvido");
    expect(result.result.eventType).toBe("whatsapp.intent_clarification.cancelled");
    expect(result.result.data).toEqual(expect.objectContaining({
      interactionLifecycle: "cancelled",
      callbackBlocked: false,
    }));
    expect(result.result.detail).toContain('"lifecycle":"cancelled"');
  });
});
