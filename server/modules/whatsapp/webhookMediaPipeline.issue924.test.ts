import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadWhatsAppMedia: vi.fn(),
  enrichInboundMessage: vi.fn(async () => undefined),
  getUserIdByWhatsappPhone: vi.fn(async () => 123),
  logInferenceEvent: vi.fn(),
  storagePut: vi.fn(),
  transcribeAudio: vi.fn(),
}));

vi.mock("../../db", () => ({
  buildSavedMedia: vi.fn((input: Record<string, unknown>) => ({ id: 1, ...input })),
  getUserIdByWhatsappPhone: mocks.getUserIdByWhatsappPhone,
  logInferenceEvent: mocks.logInferenceEvent,
}));

vi.mock("../../storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("../../_core/voiceTranscription", () => ({
  transcribeAudio: mocks.transcribeAudio,
}));
vi.mock("./messageLifecycle", () => ({
  enrichInboundMessage: mocks.enrichInboundMessage,
}));
vi.mock("./webhookUtils", async () => {
  const actual = await vi.importActual<typeof import("./webhookUtils")>("./webhookUtils");
  return { ...actual, downloadWhatsAppMedia: mocks.downloadWhatsAppMedia };
});

const { prepareMessageInput } = await import("./webhookMediaPipeline");

describe("issue #924 WhatsApp transcription compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storagePut.mockResolvedValue({
      key: "whatsapp/audio/audio-test.ogg",
      url: "https://storage.test/audio-test.ogg",
    });
    mocks.downloadWhatsAppMedia.mockResolvedValue({
      buffer: Buffer.from("synthetic-audio"),
      mimeType: "audio/ogg",
    });
  });

  it("continues the audio flow when the provider returns useful text without segments", async () => {
    mocks.transcribeAudio.mockResolvedValue({
      task: "transcribe",
      text: "banana e aveia",
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
      execution: { source: "primary", attempts: 1, usedFallback: false },
    });

    const prepared = await prepareMessageInput({
      id: "wamid.issue-924-text-only",
      from: "5511999999999",
      type: "audio",
      audio: { id: "audio-media-id", mime_type: "audio/ogg" },
    } as never, "5511999999999");

    expect(prepared.transcript).toBe("banana e aveia");
    expect(prepared.audioTranscriptionFailure).toBeUndefined();
    expect(mocks.enrichInboundMessage).toHaveBeenCalledWith(
      "wamid.issue-924-text-only",
      expect.objectContaining({ transcript: "banana e aveia" }),
    );
  });

  it("keeps the duplicate callback gate before media preparation and transcription", () => {
    const source = readFileSync(
      new URL("../../whatsappWebhook.ts", import.meta.url),
      "utf8",
    );
    const reservation = source.indexOf(
      "if (!reserveWhatsAppMessageForProcessing(message.id))",
    );
    const preparation = source.indexOf(
      "const prepared = await prepareMessageInput(message, sourcePhone)",
    );

    expect(reservation).toBeGreaterThanOrEqual(0);
    expect(preparation).toBeGreaterThan(reservation);
    expect(source.slice(reservation, preparation)).toContain("continue;");
  });
});
