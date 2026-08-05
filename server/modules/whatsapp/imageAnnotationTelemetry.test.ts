import { describe, expect, it } from "vitest";
import {
  formatImageAnnotationTelemetry,
  getImageAnnotationTelemetryState,
} from "./imageAnnotationTelemetry";

describe("image annotation telemetry", () => {
  it.each([
    [{ mode: "local", buffer: Buffer.from("local") }, "local"],
    [{ mode: "external", providerSource: "primary", buffer: Buffer.from("external") }, "external_primary"],
    [{ mode: "external", providerSource: "primary_retry", buffer: Buffer.from("retry") }, "external_primary_retry"],
    [{ mode: "external", providerSource: "fallback", buffer: Buffer.from("fallback") }, "external_fallback"],
    [{ mode: "local", degradation: "external_to_local", buffer: Buffer.from("degraded") }, "external_to_local"],
    [{ mode: "off", skippedReason: "disabled" }, "off"],
    [{ mode: "local", skippedReason: "local_failed" }, "failed"],
  ] as const)("classifies structured result %j as %s", (result, expected) => {
    expect(getImageAnnotationTelemetryState(result)).toBe(expected);
  });

  it("never emits legacy provider-fallback labels or free-form detail", () => {
    const formatted = formatImageAnnotationTelemetry({
      mode: "local",
      degradation: "none",
      buffer: Buffer.from("local"),
      detail: "overlay local com payload sensível que não deve ir para telemetria",
    });

    expect(formatted).toContain("state=local");
    expect(formatted).not.toContain("fallback_local");
    expect(formatted).not.toContain("ai_edit");
    expect(formatted).not.toContain("payload sensível");
  });
});
