import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entrypoints = [
  "server/whatsappWebhook.ts",
  "server/whatsappAnnotatedImageWebhook.ts",
] as const;

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("issue #925 image annotation telemetry regression", () => {
  it.each(entrypoints)("uses the structured annotation result in %s", path => {
    const text = source(path);

    expect(text).toContain("formatImageAnnotationTelemetry");
    expect(text).not.toContain("fallback_local");
    expect(text).not.toContain("ai_edit");
    expect(text).not.toMatch(/overlay local\|fallback local\|fallback de classificação\|provider de imagem/iu);
    expect(text).not.toContain("annotatedImage.detail");
  });

  it("does not classify a usable buffer-only derivative as skipped", () => {
    const text = source("server/whatsappWebhook.ts");
    const usableBranch = text.indexOf(
      "else if (hasUsableImageAnnotationPayload(annotatedImage))",
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
