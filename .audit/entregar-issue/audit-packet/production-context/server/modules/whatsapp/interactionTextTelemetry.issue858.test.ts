import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", async () => {
  const actual = await vi.importActual<typeof import("../../db")>("../../db");
  return {
    ...actual,
    getDb: vi.fn(async () => null),
    logPersistenceWarning: vi.fn(),
  };
});

const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");
const { resolvePendingWhatsappFoodClarification } = await import("./foodClarificationGate");
const {
  INTENT_CLARIFICATION_ACTIONS,
  PENDING_INTENT_CLARIFICATION_TYPE,
} = await import("./intentClarificationInteraction");
const { PENDING_PERIOD_REPORT_TYPE } = await import("./periodReportClarification");

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});

describe("telemetria textual das interações da issue #858", () => {
  it("marca cancelamento textual como cancelled", async () => {
    const userId = 85_811;
    const receivedAt = new Date("2026-07-22T01:00:00.000Z");
    await repository.createPendingOperation({
      userId,
      type: PENDING_INTENT_CLARIFICATION_TYPE,
      origin: "intentClarificationInteraction",
      ttlMs: 60_000,
      now: receivedAt,
      target: {
        contractVersion: 1,
        interactionId: "intent_clarification.generic",
        kind: "intent_clarification",
        originalText: "registrar",
        actions: [...INTENT_CLARIFICATION_ACTIONS],
      },
    });

    const result = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "cancelar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.eventType).toBe("whatsapp.intent_clarification.cancelled");
    expect(result?.data).toEqual(expect.objectContaining({
      interactionId: "intent_clarification.generic",
      interactionLifecycle: "cancelled",
      interactionClassification: "closed",
      interactionActionCount: 4,
    }));
    expect(result?.detail).toContain('"lifecycle":"cancelled"');
  });

  it("marca resolução textual de período como consumed", async () => {
    const userId = 85_812;
    const receivedAt = new Date("2026-07-22T01:00:00.000Z");
    await repository.createPendingOperation({
      userId,
      type: PENDING_PERIOD_REPORT_TYPE,
      origin: "periodReportClarification",
      ttlMs: 60_000,
      now: receivedAt,
      target: { kind: "period_report" },
    });

    const result = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "ontem",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.eventType).toBe("whatsapp.intent.period_report");
    expect(result?.data).toEqual(expect.objectContaining({
      interactionId: "period_report.period_selection",
      interactionLifecycle: "consumed",
      interactionClassification: "closed",
      interactionActionCount: 5,
    }));
    expect(result?.detail).toContain('"lifecycle":"consumed"');
  });
});
