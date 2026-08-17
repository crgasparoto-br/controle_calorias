import { describe, expect, it } from "vitest";
import {
  formatImageAnnotationTelemetry,
  getImageAnnotationTelemetryState,
} from "./imageAnnotationTelemetry";

describe("image annotation telemetry", () => {
  const cases = [
    { name: "local", result: { mode: "local", buffer: Buffer.from("local") }, expected: "local" },
    { name: "external primary", result: { mode: "external", providerSource: "primary", buffer: Buffer.from("external") }, expected: "external_primary" },
    { name: "external retry", result: { mode: "external", providerSource: "primary_retry", buffer: Buffer.from("retry") }, expected: "external_primary_retry" },
    { name: "external fallback", result: { mode: "external", providerSource: "fallback", buffer: Buffer.from("fallback") }, expected: "external_fallback" },
    { name: "external to local", result: { mode: "local", degradation: "external_to_local", buffer: Buffer.from("degraded") }, expected: "external_to_local" },
    { name: "off", result: { mode: "off", skippedReason: "disabled" }, expected: "off" },
    { name: "failed", result: { mode: "local", skippedReason: "local_failed" }, expected: "failed" },
  ] as const;

  it.each(cases)("classifies $name", ({ result, expected }) => {
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
