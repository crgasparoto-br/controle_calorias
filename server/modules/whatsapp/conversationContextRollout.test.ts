import { afterEach, describe, expect, it } from "vitest";
import { selectWhatsappConversationContext } from "./conversationContextRollout";

const legacy = [{ direction: "inbound" as const, text: "legado", occurredAtIso: "2026-07-11T00:00:00.000Z" }];
const persistent = [{ direction: "inbound" as const, text: "persistido", occurredAtIso: "2026-07-11T00:00:00.000Z" }];
const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("conversationContextRollout", () => {
  it("mantém shadow somente em observação", () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE_TEXT = "shadow";
    const selected = selectWhatsappConversationContext({ userId: 7, flow: "text", legacyTurns: legacy, persistentTurns: persistent });
    expect(selected.source).toBe("legacy");
    expect(selected.mode).toBe("shadow");
    expect(selected.equivalent).toBe(false);
  });

  it("ativa persistência por fluxo e permite rollback imediato", () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE_AUDIO = "persistent";
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT_AUDIO = "100";
    expect(selectWhatsappConversationContext({ userId: 7, flow: "audio", legacyTurns: legacy, persistentTurns: persistent }).source).toBe("persistent");

    process.env.WHATSAPP_CONTEXT_READ_MODE_AUDIO = "legacy";
    expect(selectWhatsappConversationContext({ userId: 7, flow: "audio", legacyTurns: legacy, persistentTurns: persistent }).source).toBe("legacy");
  });

  it("faz fallback seguro quando a persistência não fornece turnos", () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE = "persistent";
    const selected = selectWhatsappConversationContext({ userId: 7, flow: "text", legacyTurns: legacy, persistentTurns: [] });
    expect(selected.source).toBe("legacy");
    expect(selected.turns).toEqual(legacy);
  });
});
