import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_STARTUP_DELAYS_MS,
  scheduleRuntimeStartupSteps,
} from "./runtimeStartupScheduling";

describe("runtime startup scheduling (#1061)", () => {
  it("agenda manutenção em janelas distintas sem executá-la no http_ready", async () => {
    const callbacks: Array<{ delayMs: number; run: () => void }> = [];
    const starts: string[] = [];
    const logInfo = vi.fn();

    scheduleRuntimeStartupSteps({
      steps: [
        {
          name: "food-catalog-sync",
          delayMs: RUNTIME_STARTUP_DELAYS_MS.foodCatalogSync,
          start: () => starts.push("catalog"),
        },
        {
          name: "usage-governance",
          delayMs: RUNTIME_STARTUP_DELAYS_MS.usageGovernance,
          start: () => starts.push("usage"),
        },
        {
          name: "asaas-reconciliation",
          delayMs: RUNTIME_STARTUP_DELAYS_MS.asaasBilling,
          start: () => starts.push("billing"),
        },
      ],
      setTimeoutFn: (run, delayMs) => {
        callbacks.push({ delayMs, run });
        return { unref: vi.fn() };
      },
      clearTimeoutFn: vi.fn(),
      logInfo,
      logWarn: vi.fn(),
    });

    expect(starts).toEqual([]);
    expect(callbacks.map(item => item.delayMs)).toEqual([
      15_000,
      45_000,
      60_000,
    ]);

    callbacks[0]?.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toEqual(["catalog"]);

    callbacks[1]?.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toEqual(["catalog", "usage"]);
  });

  it("isola falha de uma tarefa atrasada sem impedir as demais", async () => {
    const callbacks: Array<() => void> = [];
    const logWarn = vi.fn();
    const second = vi.fn();

    scheduleRuntimeStartupSteps({
      steps: [
        {
          name: "broken",
          delayMs: 1,
          start: async () => {
            throw new Error("boom");
          },
        },
        {
          name: "second",
          delayMs: 2,
          start: second,
        },
      ],
      setTimeoutFn: run => {
        callbacks.push(run);
        return {};
      },
      clearTimeoutFn: vi.fn(),
      logInfo: vi.fn(),
      logWarn,
    });

    callbacks[0]?.();
    callbacks[1]?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(second).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith(
      "[Runtime] startup_task_failed",
      expect.objectContaining({ name: "broken" }),
    );
  });
});
