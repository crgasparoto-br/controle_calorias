import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("issue #925 image annotation telemetry regression", () => {
  it("wraps both image entrypoints in the structured telemetry context", () => {
    for (const path of [
      "server/whatsappWebhook.ts",
      "server/whatsappAnnotatedImageWebhook.ts",
    ]) {
      const text = source(path);
      expect(text).toContain("runWithImageAnnotationTelemetryContext");
    }
  });

  it("records the complete annotation response before telemetry is emitted", () => {
    const text = source("server/modules/whatsapp/annotatedImage.ts");

    expect(text).toContain("recordImageAnnotationResult");
    expect(text).toContain("generateAnnotatedMealImageImplementation");
  });

  it("normalizes annotation events before the canonical inference logger", () => {
    const text = source("server/db.ts");

    expect(text).toContain("normalizeImageAnnotationInferenceEvent");
    expect(text).toContain("logInferenceEventImplementation");
  });

  it("keeps local degradation distinct from provider fallback without legacy labels", () => {
    const text = source(
      "server/modules/whatsapp/imageAnnotationTelemetry.ts",
    );
    const context = source(
      "server/modules/whatsapp/imageAnnotationTelemetryContext.ts",
    );

    expect(text).toContain('result.degradation === "external_to_local"');
    expect(text).toContain('return "external_to_local"');
    expect(text).toContain('return "external_fallback"');
    expect(context).not.toContain("fallback_local");
    expect(context).not.toContain("ai_edit");
    expect(context).not.toContain("result.detail");
  });

  it("reclassifies a usable buffer-only result as not persisted, never skipped", () => {
    const context = source(
      "server/modules/whatsapp/imageAnnotationTelemetryContext.ts",
    );

    expect(context).toContain('input.eventType === "whatsapp.annotated_image_skipped"');
    expect(context).toContain("hasUsableImageAnnotationPayload(result)");
    expect(context).toContain('eventType: "whatsapp.annotated_image_not_persisted"');
  });
});
