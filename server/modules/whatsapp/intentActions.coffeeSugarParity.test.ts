import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleCoffeeSugarRegistrationIntent: vi.fn(),
  resolveWhatsAppPrecedenceGate: vi.fn(async () => ({ step: "continue_pipeline" })),
}));

vi.mock("./coffeeSugarIntent", () => ({
  isCoffeeSugarRegistrationText: vi.fn((text: string) => /café com açúcar/i.test(text)),
  handleCoffeeSugarRegistrationIntent: mocks.handleCoffeeSugarRegistrationIntent,
}));

vi.mock("./messageRouter", () => ({
  resolveWhatsAppPrecedenceGate: mocks.resolveWhatsAppPrecedenceGate,
}));

vi.mock("./userMeasurementReplyContext", () => ({
  getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

const { executeWhatsappTextIntent } = await import("./intentActions");

const clarificationResult = {
  handled: true,
  action: "food_clarification_requested",
  reply: "Informe somente a quantidade de açúcar.",
  eventType: "whatsapp.food_clarification.requested",
  detail: "Pendência persistente criada antes da pergunta.",
};

describe("paridade de entrypoints do café adoçado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWhatsAppPrecedenceGate.mockResolvedValue({ step: "continue_pipeline" });
    mocks.handleCoffeeSugarRegistrationIntent.mockResolvedValue(clarificationResult);
  });

  it.each([
    { label: "webhook textual", entrypoint: undefined, messageId: "wamid-text-coffee-sugar" },
    { label: "áudio transcrito", entrypoint: "audioTranscription", messageId: "wamid-audio-coffee-sugar" },
  ])("encaminha $label ao mesmo handler canônico", async ({ entrypoint, messageId }) => {
    const receivedAt = new Date("2026-07-24T12:00:00.000Z");
    const result = await executeWhatsappTextIntent(903, {
      text: "1 xícara de café com açúcar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId,
      ...(entrypoint ? { entrypoint } : {}),
    } as any);

    expect(mocks.resolveWhatsAppPrecedenceGate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 903,
      text: "1 xícara de café com açúcar",
      messageId,
      pendingOnly: true,
    }));
    expect(mocks.handleCoffeeSugarRegistrationIntent).toHaveBeenCalledWith({
      userId: 903,
      text: "1 xícara de café com açúcar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId,
    });
    expect(result).toEqual(clarificationResult);
  });
});
