import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadWhatsAppMedia: vi.fn(),
  enrichInboundMessageByExternalId: vi.fn(async () => true),
  getUserIdByWhatsappPhone: vi.fn(async () => 123),
  logInferenceEvent: vi.fn(),
  logRuntimeMemoryOperation: vi.fn(),
  assertImageWithinAnalysisBudget: vi.fn(),
  normalizeImageForAnalysis: vi.fn(),
  storagePut: vi.fn(),
  transcribeAudio: vi.fn(),
}));

vi.mock("../../db", () => ({
  buildSavedMedia: vi.fn((input: Record<string, unknown>) => ({ id: 1, ...input })),
  getDb: vi.fn(async () => null),
  getUserIdByWhatsappPhone: mocks.getUserIdByWhatsappPhone,
  logInferenceEvent: mocks.logInferenceEvent,
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../../repositories/whatsappConversationMessageEnrichmentRepository", () => ({
  createDrizzleWhatsAppConversationMessageEnrichmentRepository: () => ({
    enrichInboundMessageByExternalId: mocks.enrichInboundMessageByExternalId,
  }),
}));

vi.mock("../../storage", () => ({
  storagePut: mocks.storagePut,
}));

vi.mock("../../_core/voiceTranscription", () => ({
  transcribeAudio: mocks.transcribeAudio,
}));

vi.mock("../../_core/runtimeMemoryOperationTelemetry", () => ({
  logRuntimeMemoryOperation: mocks.logRuntimeMemoryOperation,
}));

vi.mock("./imageAnalysisNormalization", () => ({
  assertImageWithinAnalysisBudget: mocks.assertImageWithinAnalysisBudget,
  normalizeImageForAnalysis: mocks.normalizeImageForAnalysis,
}));

vi.mock("./webhookUtils", async () => {
  const actual = await vi.importActual<typeof import("./webhookUtils")>("./webhookUtils");
  return {
    ...actual,
    downloadWhatsAppMedia: mocks.downloadWhatsAppMedia,
  };
});

const { prepareMessageInput } = await import("./webhookMediaPipeline");

describe("prepareMessageInput conversation enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storagePut.mockImplementation(async (key: string) => ({
      key,
      url: `https://storage.test/${key}`,
    }));
    mocks.downloadWhatsAppMedia.mockImplementation(async (mediaId: string) => ({
      buffer: Buffer.from(mediaId),
      mimeType: mediaId.startsWith("image") ? "image/jpeg" : "audio/ogg",
    }));
    mocks.transcribeAudio.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 1,
      text: "corrija o arroz para 80 g",
      segments: [],
    });
    mocks.assertImageWithinAnalysisBudget.mockResolvedValue(undefined);
    mocks.normalizeImageForAnalysis.mockImplementation(async (buffer: Buffer, mimeType: string) => ({
      buffer,
      mimeType,
      normalized: mimeType.startsWith("image/"),
    }));
  });

  it("anexa a referência persistida da imagem à mesma mensagem capturada pelo webhook", async () => {
    const prepared = await prepareMessageInput({
      id: "wamid.image-context",
      from: "5511999999999",
      type: "image",
      image: {
        id: "image-media-id",
        mime_type: "image/jpeg",
        caption: "foto complementar",
      },
    } as never, "5511999999999");

    expect(prepared.imageUrl).toMatch(/^https:\/\/storage\.test\/whatsapp\/image\/image-[0-9a-f-]{36}\.jpg$/);
    expect(mocks.enrichInboundMessageByExternalId).toHaveBeenCalledWith(
      "wamid.image-context",
      expect.objectContaining({
        mediaStorageKey: expect.stringMatching(/^whatsapp\/image\/image-[0-9a-f-]{36}\.jpg$/),
        mediaMimeType: "image/jpeg",
        allowRawContentStorage: true,
      }),
    );
  });

  it("anexa transcrição e referência do áudio à mesma mensagem capturada pelo webhook", async () => {
    const prepared = await prepareMessageInput({
      id: "wamid.audio-context",
      from: "5511999999999",
      type: "audio",
      audio: {
        id: "audio-media-id",
        mime_type: "audio/ogg",
      },
    } as never, "5511999999999");

    expect(prepared.transcript).toBe("corrija o arroz para 80 g");
    expect(mocks.enrichInboundMessageByExternalId).toHaveBeenCalledWith(
      "wamid.audio-context",
      expect.objectContaining({
        transcript: "corrija o arroz para 80 g",
        mediaStorageKey: expect.stringMatching(/^whatsapp\/audio\/audio-[0-9a-f-]{36}\.ogg$/),
        mediaMimeType: "audio/ogg",
        allowRawContentStorage: true,
      }),
    );
  });

  it("mantém uma correlação única entre download, storage, normalização e base64", async () => {
    const prepared = await prepareMessageInput({
      id: "wamid.correlation-context",
      from: "5511999999999",
      type: "image",
      image: {
        id: "image-correlation-media-id",
        mime_type: "image/jpeg",
      },
    } as never, "5511999999999");

    const correlationValues = mocks.logRuntimeMemoryOperation.mock.calls
      .map(([event]) => event.correlationValue)
      .filter(Boolean);
    expect(prepared.memoryCorrelationValue).toBe("wamid.correlation-context");
    expect(new Set(correlationValues)).toEqual(new Set(["wamid.correlation-context"]));
  });

  it("preserva a transcrição no contexto mesmo quando o storage da mídia falha", async () => {
    mocks.storagePut.mockRejectedValueOnce(new Error("storage unavailable"));

    const prepared = await prepareMessageInput({
      id: "wamid.audio-inline-context",
      from: "5511999999999",
      type: "audio",
      audio: {
        id: "audio-media-id",
        mime_type: "audio/ogg",
      },
    } as never, "5511999999999");

    expect(prepared.audioUrl).toBeUndefined();
    expect(prepared.transcript).toBe("corrija o arroz para 80 g");
    expect(mocks.enrichInboundMessageByExternalId).toHaveBeenCalledWith(
      "wamid.audio-inline-context",
      {
        transcript: "corrija o arroz para 80 g",
        mediaStorageKey: undefined,
        mediaMimeType: undefined,
        allowRawContentStorage: true,
      },
    );
  });
  it("fecha o checkpoint de download quando o provider de mídia falha", async () => {
    mocks.downloadWhatsAppMedia.mockRejectedValueOnce(new Error("download failed"));

    await expect(
      prepareMessageInput({
        id: "wamid.download-failure",
        from: "5511999999999",
        type: "image",
        image: {
          id: "image-download-failure",
          mime_type: "image/jpeg",
        },
      } as never, "5511999999999")
    ).rejects.toThrow("download failed");

    expect(mocks.logRuntimeMemoryOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "whatsapp.media",
        stage: "download:start",
        correlationValue: "wamid.download-failure",
      }),
    );
    expect(mocks.logRuntimeMemoryOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "whatsapp.media",
        stage: "download:end",
        correlationValue: "wamid.download-failure",
        metrics: { downloadOk: false },
      }),
    );
  });

  it("fecha o checkpoint de download quando a imagem baixada excede o orçamento", async () => {
    mocks.assertImageWithinAnalysisBudget.mockRejectedValueOnce(
      new Error("image_too_many_pixels"),
    );

    await expect(
      prepareMessageInput({
        id: "wamid.preflight-failure",
        from: "5511999999999",
        type: "image",
        image: {
          id: "image-preflight-failure",
          mime_type: "image/jpeg",
        },
      } as never, "5511999999999")
    ).rejects.toThrow("image_too_many_pixels");

    expect(mocks.logRuntimeMemoryOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "whatsapp.media",
        stage: "download:end",
        correlationValue: "wamid.preflight-failure",
        metrics: expect.objectContaining({
          downloadOk: true,
          preflightOk: false,
        }),
      }),
    );
  });

  it("fecha o checkpoint de normalização quando o Sharp falha", async () => {
    mocks.normalizeImageForAnalysis.mockRejectedValueOnce(new Error("sharp failed"));

    await expect(
      prepareMessageInput({
        id: "wamid.normalize-failure",
        from: "5511999999999",
        type: "image",
        image: {
          id: "image-normalize-failure",
          mime_type: "image/jpeg",
        },
      } as never, "5511999999999")
    ).rejects.toThrow("sharp failed");

    expect(mocks.logRuntimeMemoryOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "whatsapp.media",
        stage: "normalize:end",
        correlationValue: "wamid.normalize-failure",
        metrics: expect.objectContaining({
          normalizeOk: false,
        }),
      }),
    );
  });

});
