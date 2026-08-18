import { beforeEach, describe, expect, it, vi } from "vitest";

const events: Array<{ eventType: string; detail: string }> = [];
const getUserIdByWhatsappPhoneImplementation = vi.fn(async () => {
  await new Promise(resolve => setTimeout(resolve, 5));
  return 42;
});
const resolveEffectiveUserTimeZone = vi.fn(async () => {
  await new Promise(resolve => setTimeout(resolve, 6));
  return { timeZone: "America/Sao_Paulo", source: "profile", fallbackReason: null };
});

vi.mock("../../dbImplementation", () => ({
  getDb: vi.fn(async () => null),
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneImplementation,
  logInferenceEvent: (event: { eventType: string; detail: string }) => events.push(event),
  logPersistenceWarning: vi.fn(),
}));
vi.mock("../../repositories/billingRepositorySupport", () => ({ getConfiguredBillingDbProvider: () => null }));
vi.mock("./imageAnnotationTelemetryContext", () => ({ normalizeImageAnnotationInferenceEvent: (event: unknown) => event }));
vi.mock("../timeZone/service", () => ({ resolveEffectiveUserTimeZone }));

import { getUserIdByWhatsappPhone } from "../../db";
import { resolveWhatsAppOperationTimeZone } from "./timeZoneContext";
import {
  beginCurrentQuestionLatencyTrace,
  finalizeCurrentQuestionLatencyTrace,
  recordCurrentQuestionAiStage,
  recordCurrentQuestionDeliveryOutcome,
  recordCurrentQuestionOutcome,
  runWithQuestionLatencyContext,
} from "./questionLatencyContext";

describe("QUESTION audit remediation: preparatory db attribution", () => {
  beforeEach(() => { events.length = 0; vi.clearAllMocks(); });

  it("keeps user lookup and timezone DB time when the AI stage adds its own db_ms", async () => {
    await runWithQuestionLatencyContext(async () => {
      beginCurrentQuestionLatencyTrace({ userId: null, contentType: "text", text: "/ fibras?" });
      const userId = await getUserIdByWhatsappPhone("5511999999999");
      await resolveWhatsAppOperationTimeZone(userId);
      recordCurrentQuestionAiStage({
        contextScope: "none", dbMs: 3, contextMs: 0, llmMs: 1,
        configuredProvider: "openai", configuredModel: "model",
        effectiveProvider: "openai", effectiveModel: "model", attempts: 1,
        fallbackOccurred: false, webSearchAvailable: true, webSearchExecuted: false,
      });
      recordCurrentQuestionOutcome("success", null);
      recordCurrentQuestionDeliveryOutcome(true);
      finalizeCurrentQuestionLatencyTrace();
    });

    expect(getUserIdByWhatsappPhoneImplementation).toHaveBeenCalledTimes(1);
    expect(resolveEffectiveUserTimeZone).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(events.find(event => event.eventType === "whatsapp.ai_question.latency")!.detail);
    expect(payload.db_ms).toBeGreaterThanOrEqual(12);
  });
});
