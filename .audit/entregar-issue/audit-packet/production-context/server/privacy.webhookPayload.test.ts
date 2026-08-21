import { describe, expect, it } from "vitest";
import { getAdminSnapshot, logInferenceEvent } from "./db";
import type { AiInferenceEvent } from "./_core/ai/observability";
import { serializeAiInferenceEvent } from "./_core/ai/observability";

/**
 * Issue #767: confirma, de ponta a ponta (logInferenceEvent -> armazenamento ->
 * leitura), que um payload de webhook do Meta contendo token/URL/telefone nunca
 * fica exposto em texto puro no log persistido/consultável.
 */
describe("logInferenceEvent redige payload de webhook sensível de ponta a ponta", () => {
  it("token de acesso, URL temporária e telefone não aparecem no detail persistido", async () => {
    const fakeMetaPayload = {
      accessToken: "Bearer EAAG1234567890secretaccesstoken",
      mediaUrl: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=abc123",
      phoneNumber: "+55 11 98888-7777",
      messageId: "wamid.HBg",
    };

    logInferenceEvent({
      userId: 999999,
      origin: "whatsapp",
      status: "error",
      eventType: "whatsapp.history.persistence_error",
      detail: `Falha ao processar payload: ${JSON.stringify(fakeMetaPayload)}`,
    });

    const snapshot = await getAdminSnapshot();
    const entry = snapshot.recentInferenceLogs.find(log => log.eventType === "whatsapp.history.persistence_error");

    expect(entry).toBeDefined();
    expect(entry!.detail).not.toContain("EAAG1234567890secretaccesstoken");
    expect(entry!.detail).not.toContain("98888-7777");
    expect(entry!.detail).toContain("Bearer [redacted]");
    expect(entry!.detail).toContain("[phone_redacted]");
  });

  it("preserva telemetria estruturada de IA como JSON íntegro acima de 500 caracteres", async () => {
    const event: AiInferenceEvent = {
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      executionId: `structured-${crypto.randomUUID()}`,
      capability: "QUESTION",
      origin: "whatsapp",
      flow: "whatsapp_question",
      configuredProvider: "openai",
      configuredModel: "gpt-4.1-mini-2025-04-14",
      effectiveProvider: "openai",
      effectiveModel: "gpt-4.1-mini-2025-04-14",
      callRole: "primary",
      attemptIndex: 1,
      totalAttempts: 1,
      latencyMs: 321,
      totalLatencyMs: 321,
      outcome: "success",
      usage: {
        inputTokens: 10_000,
        cachedInputTokens: 2_000,
        outputTokens: 1_000,
        reasoningTokens: 250,
        totalTokens: 11_000,
      },
      tools: [{ tool: "web_search", executed: true, billableUnits: 2 }],
      estimatedCostUsd: 0.0246,
      executionEstimatedCostUsd: 0.0246,
      pricingCatalogVersion: "2026-08-05.2",
      pricingEffectiveDate: "2026-08-05",
      fallback: {
        requested: true,
        enabled: true,
        kind: "same_provider",
        eligibility: "not_needed",
        reason: "primary_succeeded",
        primaryAttempts: 1,
        fallbackCalls: 0,
      },
      degradation: "none",
      correlation: {
        request_id: "req_alpha_1234",
        route: "whatsapp_question_assistant",
        tenant: "tenant_42",
        trace: "person@example.com",
      },
    };
    const detail = serializeAiInferenceEvent(event);
    expect(detail.length).toBeGreaterThan(500);

    logInferenceEvent({
      origin: "whatsapp",
      status: "success",
      eventType: "ai.inference_call",
      detail,
    });

    const snapshot = await getAdminSnapshot();
    const entry = snapshot.recentInferenceLogs.find(log =>
      log.eventType === "ai.inference_call" && log.detail.includes(event.executionId));
    expect(entry).toBeDefined();
    expect(entry!.detail.length).toBeGreaterThan(500);
    const persisted = JSON.parse(entry!.detail) as AiInferenceEvent;
    expect(persisted).toMatchObject({
      executionId: event.executionId,
      configuredModel: event.configuredModel,
      effectiveModel: event.effectiveModel,
      pricingCatalogVersion: event.pricingCatalogVersion,
      pricingEffectiveDate: event.pricingEffectiveDate,
      fallback: event.fallback,
      correlation: {
        request_id: event.correlation.request_id,
        route: event.correlation.route,
        tenant: event.correlation.tenant,
        trace: "[email_redacted]",
      },
    });
  });
});
