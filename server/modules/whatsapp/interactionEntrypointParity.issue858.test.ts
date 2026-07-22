import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("paridade dos entrypoints da interação WhatsApp (#858)", () => {
  it("webhook real resolve callbacks e pendências pelo gate central", () => {
    const webhook = source("server/whatsappIntentWebhook.ts");
    expect(webhook).toContain("resolveWhatsAppPrecedenceGate");
    expect(webhook).toContain("interactiveReplyId");
    expect(webhook).toContain("messageId: message.id");
  });

  it("reapresentação no webhook preserva a mesma pendência ativa", () => {
    const webhook = source("server/whatsappIntentWebhook.ts");
    expect(webhook).toContain('precedenceGate.result.eventType === "whatsapp.interaction.pending_represented"');
    expect(webhook).toMatch(/if \(!preservePendingAfterReplay\)\s*\{\s*await clearPendingTextIntentContext\(userId\);/s);
  });

  it("simulador usa o mesmo gate persistente antes da chamada nutricional", () => {
    const simulator = source("server/modules/whatsapp/service.ts");
    const gateCall = simulator.indexOf("await resolvePendingWhatsappFoodClarification(");
    const nutritionCall = simulator.lastIndexOf("await processMealDraft(");
    expect(gateCall).toBeGreaterThanOrEqual(0);
    expect(nutritionCall).toBeGreaterThan(gateCall);
  });

  it("áudio transcrito entra no executor textual protegido pelo gate request-scoped", () => {
    const webhook = source("server/whatsappWebhook.ts");
    const executor = source("server/modules/whatsapp/intentActions.ts");
    expect(webhook).toContain("canInterpretAudioTranscriptIntent");
    expect(webhook).toMatch(/executeWhatsappTextIntent\(userId,\s*\{\s*text:\s*prepared\.transcript/s);
    expect(executor).toContain("requestScopedInbound");
    expect(executor).toContain("resolveWhatsAppPrecedenceGate");
    expect(executor).toContain("pendingOnly: true");
  });

  it("nenhum produtor principal usa buttonsReply/listReply diretamente", () => {
    const producers = [
      "server/modules/whatsapp/deleteIntentContract.ts",
      "server/modules/whatsapp/mealItemSelectionCallback.ts",
      "server/modules/whatsapp/periodReportClarification.ts",
      "server/modules/whatsapp/webhookTextCommands.ts",
      "server/modules/professionals/service.ts",
    ];
    for (const producer of producers) {
      const content = source(producer);
      expect(content, producer).not.toMatch(/\b(?:buttonsReply|listReply)\s*\(/);
      expect(content, producer).toContain("buildWhatsappClosedDecisionReply");
    }
  });
});
