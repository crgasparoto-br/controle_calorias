import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getDbMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const processMealDraftMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();
const executeWhatsappRecordAdjustmentIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getDb: getDbMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  upsertUserWhatsappConnection: upsertUserWhatsappConnectionMock,
}));

vi.mock("../meals/service", () => ({
  processMealDraft: processMealDraftMock,
}));

vi.mock("./llmIntentActions", () => ({
  executeWhatsappLlmIntent: executeWhatsappLlmIntentMock,
}));

vi.mock("./intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));

vi.mock("./foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: executeWhatsAppFoodAssistantIntentMock,
}));

vi.mock("./recordAdjustmentIntent", () => ({
  executeWhatsappRecordAdjustmentIntent: executeWhatsappRecordAdjustmentIntentMock,
}));

const { __resetWhatsappIdempotencyForTests } = await import("./idempotencyGuard");
const { __resetWhatsappOperationalTracesForTests, listWhatsappOperationalTraces } = await import("./operationalTrace");
const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound", () => {
  beforeEach(() => {
    __resetWhatsappIdempotencyForTests();
    __resetWhatsappOperationalTracesForTests();
    getAdminWhatsAppTokenStatusMock.mockReset();
    getDbMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    upsertUserWhatsappConnectionMock.mockReset();
    processMealDraftMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    executeWhatsappRecordAdjustmentIntentMock.mockReset();
    getDbMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    executeWhatsappRecordAdjustmentIntentMock.mockResolvedValue(null);
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-1",
      processed: {
        items: [
          {
            foodName: "pão de cenoura",
            canonicalName: "pão de cenoura",
          },
        ],
      },
      media: [],
    });
  });

  it("trata correção 'não é água é pão de cenoura' como alimento corrigido antes da intenção de água", async () => {
    const result = await simulateWhatsappInbound(42, {
      text: "Não é água é pão de cenoura",
    });

    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "pão de cenoura",
    });
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      eventType: "whatsapp.intent.food_correction_text_detected",
    }));
    expect(result).toEqual(expect.objectContaining({
      draftId: "draft-1",
    }));
  });

  it("normaliza unidade digitada incorretamente antes de interpretar texto de água", async () => {
    executeWhatsappTextIntentMock.mockResolvedValueOnce({
      handled: true,
      action: "water_logged",
      reply: "Registrei 300 ml de água.",
      eventType: "whatsapp.intent.water_logged",
      detail: "Registro de hidratação via WhatsApp.",
      data: {
        amountMl: 300,
      },
    });

    const result = await simulateWhatsappInbound(42, {
      text: "300mo água",
    });

    expect(executeWhatsappLlmIntentMock).toHaveBeenCalledWith(42, {
      text: "300 ml água",
      receivedAt: expect.any(Date),
    });
    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(42, {
      text: "300 ml água",
      receivedAt: expect.any(Date),
    });
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "water_logged",
    }));

    const [trace] = listWhatsappOperationalTraces({ userId: 42 });
    expect(trace.messageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(trace)).not.toContain("300mo");
    expect(trace.steps.map(step => step.stage)).toEqual(expect.arrayContaining([
      "normalization",
      "idempotency",
      "llm_router",
      "deterministic_intent",
      "response",
    ]));
    expect(trace.steps.find(step => step.stage === "normalization")).toEqual(expect.objectContaining({
      status: "success",
      ruleVersion: "whatsapp-normalization-v1",
    }));
    expect(trace.steps.find(step => step.stage === "llm_router")).toEqual(expect.objectContaining({
      status: "fallback",
    }));
    expect(trace.steps.find(step => step.stage === "deterministic_intent")).toEqual(expect.objectContaining({
      status: "success",
      intent: "water_logged",
    }));
  });

  it("separa hidratação e alimentos em mensagens multi-linha antes de processar refeição", async () => {
    executeWhatsappTextIntentMock.mockResolvedValue({
      handled: true,
      action: "water_logged",
      reply: "Registrei 300 ml de água.",
      eventType: "whatsapp.intent.water_logged",
      detail: "Registro de hidratação via WhatsApp.",
      data: {
        amountMl: 300,
      },
    });

    const result = await simulateWhatsappInbound(42, {
      text: "3 bisnaguinhas panco\n300ml água\n19g de mel",
    });

    expect(executeWhatsappTextIntentMock).toHaveBeenCalledTimes(1);
    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(42, {
      text: "300 ml água",
      receivedAt: expect.any(Date),
    });
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "3 bisnaguinhas panco\n19 g de mel",
    });
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "water_and_meal_logged",
      meal: expect.objectContaining({
        draftId: "draft-1",
      }),
      water: [expect.objectContaining({
        action: "water_logged",
      })],
    }));
  });

  it("bloqueia numero isolado antes do fallback nutricional quando nao ha contexto pendente", async () => {
    const result = await simulateWhatsappInbound(42, { text: "2" });

    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "router_clarification_needed",
      eventType: "whatsapp.router.clarification_needed",
    }));
    const [trace] = listWhatsappOperationalTraces({ userId: 42 });
    expect(trace.steps.find(step => step.stage === "canonical_router")).toEqual(expect.objectContaining({
      status: "warning",
      intent: "mensagem_ambigua",
      schemaVersion: "whatsapp-intent-schema/v1",
    }));
  });

  it("bloqueia ajuste numerico sem contexto antes do fallback nutricional", async () => {
    const result = await simulateWhatsappInbound(42, { text: "somar 30g" });

    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "router_clarification_needed",
      eventType: "whatsapp.router.clarification_needed",
    }));
    const [trace] = listWhatsappOperationalTraces({ userId: 42 });
    expect(trace.steps.find(step => step.stage === "canonical_router")).toEqual(expect.objectContaining({
      status: "warning",
      intent: "somar_quantidade",
    }));
  });

  it("interrompe processamento nutricional quando ajuste de registro exige confirmacao", async () => {
    executeWhatsappRecordAdjustmentIntentMock.mockResolvedValueOnce({
      handled: true,
      action: "record_adjustment_confirmation_needed",
      reply: "Confirme antes de eu remover: Frango de Almoço?",
      eventType: "whatsapp.records.adjustment_confirmation_needed",
      detail: "Remocao de alimento com alvo unico exige confirmacao antes de persistir.",
    });

    const result = await simulateWhatsappInbound(42, { text: "remove frango" });

    expect(executeWhatsappRecordAdjustmentIntentMock).toHaveBeenCalledWith(42, {
      text: "remove frango",
      receivedAt: expect.any(Date),
    });
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "record_adjustment_confirmation_needed",
    }));
    const [trace] = listWhatsappOperationalTraces({ userId: 42 });
    expect(trace.steps.find(step => step.stage === "record_adjustment")).toEqual(expect.objectContaining({
      status: "warning",
      intent: "record_adjustment_confirmation_needed",
    }));
  });

  it("mantem alimento valido no fallback nutricional depois do roteador canonico", async () => {
    const result = await simulateWhatsappInbound(42, { text: "100g de arroz" });

    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "100 g de arroz",
    });
    expect(result).toEqual(expect.objectContaining({ draftId: "draft-1" }));
    const [trace] = listWhatsappOperationalTraces({ userId: 42 });
    expect(trace.steps.find(step => step.stage === "canonical_router")).toEqual(expect.objectContaining({
      status: "success",
      intent: "adicionar_alimento",
    }));
  });

  it("ignora retry tecnico com o mesmo messageId antes de persistir novamente", async () => {
    await simulateWhatsappInbound(42, { text: "1 banana", messageId: "wamid.1" });
    const result = await simulateWhatsappInbound(42, { text: "1 banana", messageId: "wamid.1" });

    expect(processMealDraftMock).toHaveBeenCalledTimes(1);
    expect(executeWhatsappLlmIntentMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "duplicate_message_ignored",
      eventType: "whatsapp.idempotency.duplicate_ignored",
      data: expect.objectContaining({ duplicateKind: "technical_retry" }),
    }));
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.idempotency.duplicate_ignored",
      status: "warning",
    }));
  });

  it("trata mensagem textual repetida em janela curta como possivel duplicidade", async () => {
    await simulateWhatsappInbound(42, { text: "1 banana" });
    const result = await simulateWhatsappInbound(42, { text: "  1   banana " });

    expect(processMealDraftMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      action: "duplicate_message_ignored",
      data: expect.objectContaining({ duplicateKind: "short_window_text_duplicate" }),
    }));
  });

  it("permite repeticao textual quando usuario confirma duplicidade intencional", async () => {
    await simulateWhatsappInbound(42, { text: "1 banana" });
    await simulateWhatsappInbound(42, { text: "1 banana", allowIntentionalDuplicate: true });

    expect(processMealDraftMock).toHaveBeenCalledTimes(2);
  });
});
