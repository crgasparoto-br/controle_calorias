import { describe, expect, it, vi } from "vitest";

const handle = vi.fn();
vi.mock("./coffeeSugarIntent", () => ({
  isCoffeeSugarRegistrationText: (text: string) => text.includes("3 xicaras de cafe"),
  handleCoffeeSugarRegistrationIntent: handle,
}));
vi.mock("./userMeasurementReplyContext", () => ({ getWhatsAppUserTimeZone: async () => "America/Sao_Paulo" }));
vi.mock("./messageRouter", () => ({ resolveWhatsAppPrecedenceGate: async () => ({ step: "continue_pipeline" }) }));

const { executeWhatsappTextIntent } = await import("./intentActions");

describe("generic coffee entrypoint parity", () => {
  it.each([undefined, "audioTranscription", "simulateWhatsappInbound"])("routes %s through the same early handler", async entrypoint => {
    handle.mockResolvedValue({ handled: true, action: "clarification_needed", reply: "clarify", eventType: "coffee.clarify", detail: "persisted" });
    const result = await executeWhatsappTextIntent(1, {
      text: "3 xicaras de cafe",
      receivedAt: new Date("2026-08-13T13:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      messageId: "msg-1",
      ...(entrypoint ? { entrypoint } : {}),
    });
    expect(result?.action).toBe("clarification_needed");
    expect(handle).toHaveBeenCalled();
  });
});
