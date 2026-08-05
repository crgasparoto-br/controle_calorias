import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("issue #925 image annotation telemetry regression", () => {
  it("uses structured annotation telemetry in the canonical image router", () => {
    const text = source("server/whatsappAnnotatedImageWebhook.ts");

    expect(text).toContain("formatImageAnnotationTelemetry");
    expect(text).not.toContain("fallback_local");
    expect(text).not.toContain("ai_edit");
    expect(text).not.toMatch(/overlay local\|fallback local\|fallback de classificação\|provider de imagem/iu);
    expect(text).not.toContain("annotatedImage.detail");
  });

  it("routes every image-bearing payload through the structured router", () => {
    const facade = source("server/whatsappWebhook.ts");
    const router = source("server/whatsappAnnotatedImageWebhook.ts");

    expect(facade).toContain("extractWhatsAppWebhookMessages");
    expect(facade).toContain("message.image?.id");
    expect(facade).toContain("handleWhatsAppWebhookWithAnnotatedImages");
    expect(facade).toContain("handleLegacyWhatsAppWebhook");
    expect(router).toContain("return Boolean(message.image?.id)");
    expect(router).toContain("prepareMessageInput(message, sourcePhone)");
  });

  it("does not classify a usable buffer-only derivative as skipped", () => {
    const text = source("server/whatsappAnnotatedImageWebhook.ts");
    const usableBranch = text.indexOf(
      "else if (hasUsableAnnotatedImagePayload(annotatedImage))",
    );
    const notPersistedEvent = text.indexOf(
      'eventType: "whatsapp.annotated_image_not_persisted"',
      usableBranch,
    );
    const skippedEvent = text.indexOf(
      'eventType: "whatsapp.annotated_image_skipped"',
      usableBranch,
    );

    expect(usableBranch).toBeGreaterThan(-1);
    expect(notPersistedEvent).toBeGreaterThan(usableBranch);
    expect(skippedEvent).toBeGreaterThan(notPersistedEvent);
  });

  it("keeps local degradation distinct from provider fallback", () => {
    const text = source(
      "server/modules/whatsapp/imageAnnotationTelemetry.ts",
    );

    expect(text).toContain('result.degradation === "external_to_local"');
    expect(text).toContain('return "external_to_local"');
    expect(text).toContain('return "external_fallback"');
  });
});
