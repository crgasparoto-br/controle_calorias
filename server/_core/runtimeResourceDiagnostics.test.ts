import { describe, expect, it, vi } from "vitest";
import {
  classifyRuntimeMemoryPressure,
  createRuntimeResourceTracker,
  detectCgroupMemoryLimitBytes,
  type RuntimeMemorySample,
} from "./runtimeResourceDiagnostics";

function sample(input: Partial<RuntimeMemorySample> = {}): RuntimeMemorySample {
  return {
    rssBytes: 200,
    heapUsedBytes: 100,
    heapTotalBytes: 150,
    externalBytes: 10,
    arrayBuffersBytes: 5,
    containerBytes: null,
    ...input,
  };
}

describe("runtime resource diagnostics (#1061)", () => {
  it("detecta o limite real do cgroup sem aceitar o sentinel ilimitado", () => {
    const values = new Map<string, string>([
      ["/sys/fs/cgroup/memory.max", "536870912\n"],
    ]);
    expect(
      detectCgroupMemoryLimitBytes(path => {
        const value = values.get(path);
        if (!value) throw new Error("missing");
        return value;
      }),
    ).toBe(536870912);

    expect(
      detectCgroupMemoryLimitBytes(path => {
        if (path.endsWith("memory.max")) return "max";
        return "9223372036854771712";
      }),
    ).toBeNull();
  });

  it("classifica pressão usando container quando disponível e RSS como fallback", () => {
    expect(
      classifyRuntimeMemoryPressure(
        sample({ rssBytes: 100, containerBytes: 820 }),
        1_000,
      ),
    ).toMatchObject({ band: "elevated", ratio: 0.82, usedBytes: 820 });

    expect(
      classifyRuntimeMemoryPressure(
        sample({ rssBytes: 910, containerBytes: null }),
        1_000,
      ),
    ).toMatchObject({ band: "critical", ratio: 0.91, usedBytes: 910 });
  });

  it("preserva high-water mark e alerta somente em escalada material", () => {
    const logInfo = vi.fn();
    const logWarn = vi.fn();
    const tracker = createRuntimeResourceTracker({
      bootId: "boot-1061",
      bootStartedAt: 1_000,
      commit: "abc123",
      memoryLimitBytes: 1_000,
      now: () => 2_000,
      logInfo,
      logWarn,
    });

    tracker.observe(sample({ containerBytes: 810, rssBytes: 700 }), "first");
    tracker.observe(sample({ containerBytes: 850, rssBytes: 720 }), "second");
    tracker.observe(sample({ containerBytes: 930, rssBytes: 900 }), "third");
    tracker.reportWindow(
      sample({ containerBytes: 700, rssBytes: 650, heapUsedBytes: 80 }),
    );

    expect(logWarn).toHaveBeenCalledTimes(2);
    expect(logWarn.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        pressureBand: "elevated",
        reason: "first",
      }),
    );
    expect(logWarn.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        pressureBand: "critical",
        reason: "third",
      }),
    );
    expect(logInfo).toHaveBeenCalledWith(
      "[Runtime] memory_window",
      expect.objectContaining({
        highWaterContainerMiB: expect.any(Number),
        highWaterRssMiB: expect.any(Number),
      }),
    );
  });
});
