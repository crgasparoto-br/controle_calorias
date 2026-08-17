import { describe, expect, it, vi } from "vitest";
import { whatsappConversationMessages } from "../../drizzle/schema";
import { createDrizzleWhatsAppConversationMessageEnrichmentRepository } from "./whatsappConversationMessageEnrichmentRepository";

vi.mock("drizzle-orm", () => ({
  eq: (column: { name: string }, value: unknown) => ({ column, value }),
}));

function createFakeDb() {
  const row: Record<string, unknown> = {
    id: 7,
    idempotencyKey: "whatsapp:inbound:wamid.audio-context",
    occurredAt: new Date("2026-07-10T12:00:00.000Z"),
    rawTextStored: false,
    transcript: null,
    sanitizedTranscript: null,
    mediaStorageKey: null,
    mediaMimeType: null,
    privacyPolicyVersion: null,
    retentionExpiresAt: null,
  };

  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(async () => [row]),
  };
  const updateChain = {
    set: vi.fn((values: Record<string, unknown>) => {
      Object.assign(row, values);
      return updateChain;
    }),
    where: vi.fn(async () => ({ affectedRows: 1 })),
  };

  return {
    row,
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn((table: unknown) => {
        expect(table).toBe(whatsappConversationMessages);
        return updateChain;
      }),
    },
  };
}

describe("createDrizzleWhatsAppConversationMessageEnrichmentRepository", () => {
  it("enriquece a mesma mensagem inbound com transcrição sanitizada e referência opaca de mídia", async () => {
    const { db, row } = createFakeDb();
    const onWarning = vi.fn();
    const repository = createDrizzleWhatsAppConversationMessageEnrichmentRepository({
      getDb: async () => db,
      onWarning,
    });

    const enriched = await repository.enrichInboundMessageByExternalId("wamid.audio-context", {
      transcript: "corrija o arroz para 80 g",
      mediaStorageKey: "whatsapp/audio/audio-safe.ogg",
      mediaMimeType: "audio/ogg",
      allowRawContentStorage: true,
    });

    expect(enriched).toBe(true);
    expect(row.sanitizedTranscript).toBe("corrija o arroz para 80 g");
    expect(row.mediaStorageKey).toBe("whatsapp/audio/audio-safe.ogg");
    expect(row.mediaMimeType).toBe("audio/ogg");
    expect(row.privacyPolicyVersion).toBeTruthy();
    expect(row.retentionExpiresAt).toBeInstanceOf(Date);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("mantém fallback seguro quando o banco de contexto não está disponível", async () => {
    const onWarning = vi.fn();
    const repository = createDrizzleWhatsAppConversationMessageEnrichmentRepository({
      getDb: async () => null,
      onWarning,
    });

    await expect(repository.enrichInboundMessageByExternalId("wamid.missing", {
      transcript: "texto",
    })).resolves.toBe(false);
    expect(onWarning).not.toHaveBeenCalled();
  });
});
