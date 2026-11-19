import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfirmedMealRegistrationService } from "./confirmedMealRegistration";
import { runWithWhatsappInboundCorrelationScope,
  setCurrentWhatsappInboundContentType,
  setCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";

const originalEnabled = process.env.FOOD_V2_D1_ENABLED;
const originalEntrypoints = process.env.FOOD_V2_D1_ENTRYPOINTS;
afterEach(() => {
  if (originalEnabled === undefined) delete process.env.FOOD_V2_D1_ENABLED;
  else process.env.FOOD_V2_D1_ENABLED = originalEnabled;
  if (originalEntrypoints === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
  else process.env.FOOD_V2_D1_ENTRYPOINTS = originalEntrypoints;
});
const input = () => ({
  userId: 7, registrationText: "Adicionar ao almoço 100 g de arroz",
  originalText: "Adicionar ao almoço 100 g de arroz",
  occurredAt: new Date("2026-11-03T15:00:00Z"),
  userTimezone: "America/Sao_Paulo",
});
const migrated = {
  handled: true as const, action: "meal_item_added" as const,
  reply: "Almoço registrado.", eventType: "whatsapp.d1.registered",
  detail: "native fixture", data: { mealId: 55 },
};
const clarified = { kind: "clarification" as const,
  result: { handled: true as const, action: "clarification_needed" as const,
    reply: "Qual é o peso?", eventType: "whatsapp.food.clarification",
    detail: "fixture", data: {} } };

describe("#1308 public confirmed WhatsApp provenance and owner", () => {
  it.each([
    { contentType: "text" as const, flag: "text", modality: "text" },
    { contentType: "audio" as const, flag: "audio_transcript", modality: "audio_transcript" },
  ])("routes trusted $contentType to native D1 without V1 preflight", async ({ contentType, flag, modality }) => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = flag;
    const tryRunD1Registration = vi.fn(async () => migrated);
    const prepareCountableFoodRegistration = vi.fn();
    const processMeal = vi.fn();
    const createDraft = vi.fn();
    const service = createConfirmedMealRegistrationService({
      tryRunD1Registration, prepareCountableFoodRegistration: prepareCountableFoodRegistration as never,
      processMeal: processMeal as never, createDraft: createDraft as never,
    });
    const result = await runWithWhatsappInboundCorrelationScope(async () => {
      setCurrentWhatsappInboundExternalMessageId("wamid.trusted-message");
      setCurrentWhatsappInboundContentType(contentType);
      return service(input());
    });
    expect(result).toMatchObject({ status: "registered",
      result: { action: "meal_item_added", data: { mealId: 55 } } });
    expect(tryRunD1Registration).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, modality, externalMessageId: "wamid.trusted-message",
      originalText: input().registrationText,
    }));
    expect(prepareCountableFoodRegistration).not.toHaveBeenCalled();
    expect(processMeal).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });
  it("a persisted V1 decision stays on V1 even after enabling text V2", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const tryRunD1Registration = vi.fn(async () => migrated);
    const prepareCountableFoodRegistration = vi.fn(async () => clarified);
    const service = createConfirmedMealRegistrationService({
      tryRunD1Registration,
      prepareCountableFoodRegistration: prepareCountableFoodRegistration as never,
    });
    const result = await runWithWhatsappInboundCorrelationScope(async () => {
      setCurrentWhatsappInboundExternalMessageId("wamid.new-reply");
      setCurrentWhatsappInboundContentType("text");
      return service({ ...input(), legacyV1Pending: true, inboundMessageId: "wamid.old-message" });
    });
    expect(result.status).toBe("clarification_requested");
    expect(tryRunD1Registration).not.toHaveBeenCalled();
    expect(prepareCountableFoodRegistration).toHaveBeenCalledOnce();
  });
  it("retains a prior V1 clarification by its original persisted inbound ID", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
    const tryRunD1Registration = vi.fn(async () => migrated);
    const prepareCountableFoodRegistration = vi.fn(async () => clarified);
    const service = createConfirmedMealRegistrationService({
      tryRunD1Registration,
      prepareCountableFoodRegistration: prepareCountableFoodRegistration as never,
    });
    const result = await runWithWhatsappInboundCorrelationScope(async () => {
      setCurrentWhatsappInboundExternalMessageId("wamid-new-reply");
      setCurrentWhatsappInboundContentType("text");
      return service({ ...input(), inboundMessageId: "wamid-original-operation" });
    });
    expect(result.status).toBe("clarification_requested");
    expect(tryRunD1Registration).not.toHaveBeenCalled();
  });
  it("does not invent a modality when the lifecycle provides no type", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "audio_transcript";
    const tryRunD1Registration = vi.fn(async () => migrated);
    const prepareCountableFoodRegistration = vi.fn();
    const service = createConfirmedMealRegistrationService({
      tryRunD1Registration,
      prepareCountableFoodRegistration: prepareCountableFoodRegistration as never,
    });
    await expect(service(input())).rejects
      .toThrow("food-d1-public-entrypoint-migration-incomplete");
    expect(tryRunD1Registration).not.toHaveBeenCalled();
    expect(prepareCountableFoodRegistration).not.toHaveBeenCalled();
  });
});
