import { describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryOperationSnapshot,
  hashRuntimeOperationCorrelation,
} from "./runtimeMemoryOperationTelemetry";

describe("runtime memory operation telemetry (#1257)", () => {
  it("hashes correlation values instead of exposing raw identifiers", () => {
    const raw = "wamid.secret-message-id";
    const hashed = hashRuntimeOperationCorrelation(raw);
    expect(hashed).toMatch(/^[0-9a-f]{20}$/u);
    expect(hashed).not.toContain("secret");
    expect(hashRuntimeOperationCorrelation(raw)).toBe(hashed);
  });
  it("emits only safe scalar metrics with cgroup pressure", () => {
    const snapshot = buildRuntimeMemoryOperationSnapshot(
      {
        operation: "whatsapp.media",
        stage: "download:end",
        correlationValue: "media-123",
        metrics: { byteLength: 2048, normalized: true },
      },
      {
        memoryLimitBytes: 1_000,
        memoryUsage: () => ({
          rss: 700,
          heapTotal: 300,
          heapUsed: 200,
          external: 50,
          arrayBuffers: 25,
        }),
        readContainerUsageBytes: () => 920,
      },
    );
    expect(snapshot).toMatchObject({
      operation: "whatsapp.media",
      stage: "download:end",
      pressureBand: "critical",
      pressureRatio: 0.92,
      byteLength: 2048,
      normalized: true,
    });
    expect(snapshot.correlationId).toMatch(/^[0-9a-f]{20}$/u);
  });
});
