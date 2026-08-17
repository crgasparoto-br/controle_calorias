import { describe, expect, it } from "vitest";
import {
  normalizeImageAnnotationInferenceEvent,
  recordImageAnnotationResult,
  runWithImageAnnotationTelemetryContext,
} from "./imageAnnotationTelemetryContext";

describe("image annotation telemetry context", () => {
  it("reclassifies a buffer-only derivative as not persisted", () => {
    const event = runWithImageAnnotationTelemetryContext(() => {
      recordImageAnnotationResult({
        mode: "local",
        degradation: "none",
        buffer: Buffer.from("derived"),
      });
      return normalizeImageAnnotationInferenceEvent({
        userId: 42,
        eventType: "whatsapp.annotated_image_skipped",
        detail: "legacy detail",
      });
    });

    expect(event.eventType).toBe("whatsapp.annotated_image_not_persisted");
    expect(event.detail).toContain("state=local");
    expect(event.detail).not.toContain("legacy detail");
  });

  it("distinguishes local degradation from external fallback", () => {
    const local = runWithImageAnnotationTelemetryContext(() => {
      recordImageAnnotationResult({
        mode: "local",
        degradation: "external_to_local",
        buffer: Buffer.from("local"),
      });
      return normalizeImageAnnotationInferenceEvent({
        eventType: "whatsapp.annotated_image_sent",
        detail: "origem=fallback_local",
      });
    });
    const external = runWithImageAnnotationTelemetryContext(() => {
      recordImageAnnotationResult({
        mode: "external",
        providerSource: "fallback",
        attempts: 2,
        buffer: Buffer.from("external"),
      });
      return normalizeImageAnnotationInferenceEvent({
        eventType: "whatsapp.annotated_image_sent",
        detail: "origem=ai_edit",
      });
    });

    expect(local.detail).toContain("state=external_to_local");
    expect(local.detail).not.toContain("fallback_local");
    expect(external.detail).toContain("state=external_fallback");
    expect(external.detail).not.toContain("ai_edit");
  });

  it("does not change unrelated inference events", () => {
    const input = {
      eventType: "whatsapp.message_processed",
      detail: "unchanged",
    };

    expect(runWithImageAnnotationTelemetryContext(
      () => normalizeImageAnnotationInferenceEvent(input),
    )).toBe(input);
  });
});
