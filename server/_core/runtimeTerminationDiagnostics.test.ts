import { describe, expect, it, vi } from "vitest";
import {
  installRuntimeTerminationDiagnostics,
  type RuntimeTerminationProcess,
} from "./runtimeTerminationDiagnostics";

describe("runtime termination diagnostics", () => {
  it("observa exceção fatal sem instalar handler que a consuma", () => {
    const onHandlers = new Map<string, (...args: any[]) => void>();
    const onceHandlers = new Map<string, () => void>();
    const runtime: RuntimeTerminationProcess = {
      pid: 92,
      on: vi.fn((event, listener) => {
        onHandlers.set(event, listener);
        return runtime;
      }),
      once: vi.fn((event, listener) => {
        onceHandlers.set(event, listener);
        return runtime;
      }),
      kill: vi.fn(() => true),
    };
    const logInfo = vi.fn();
    const logError = vi.fn();

    installRuntimeTerminationDiagnostics({
      bootId: "boot-1061",
      bootStartedAt: 1000,
      commit: "abc123",
      runtime,
      now: () => 2500,
      logInfo,
      logError,
    });

    expect(onHandlers.has("uncaughtExceptionMonitor")).toBe(true);
    expect(onHandlers.has("exit")).toBe(true);
    expect(onceHandlers.has("SIGTERM")).toBe(true);
    expect(onceHandlers.has("SIGINT")).toBe(true);

    onHandlers.get("uncaughtExceptionMonitor")?.(new Error("boom"), "unhandledRejection");

    expect(logError).toHaveBeenCalledWith(
      "[Runtime] uncaught_exception_monitor",
      expect.objectContaining({
        bootId: "boot-1061",
        pid: 92,
        commit: "abc123",
        uptimeMs: 1500,
        origin: "unhandledRejection",
      })
    );
    expect(runtime.kill).not.toHaveBeenCalled();
  });

  it("registra SIGTERM e reenfileira o mesmo sinal para preservar o término padrão", () => {
    const onHandlers = new Map<string, (...args: any[]) => void>();
    const onceHandlers = new Map<string, () => void>();
    const runtime: RuntimeTerminationProcess = {
      pid: 92,
      on: vi.fn((event, listener) => {
        onHandlers.set(event, listener);
        return runtime;
      }),
      once: vi.fn((event, listener) => {
        onceHandlers.set(event, listener);
        return runtime;
      }),
      kill: vi.fn(() => true),
    };
    const logInfo = vi.fn();

    installRuntimeTerminationDiagnostics({
      bootId: "boot-1061",
      bootStartedAt: 1000,
      commit: null,
      runtime,
      now: () => 3000,
      logInfo,
      logError: vi.fn(),
    });

    onceHandlers.get("SIGTERM")?.();

    expect(logInfo).toHaveBeenCalledWith(
      "[Runtime] termination_signal",
      expect.objectContaining({
        bootId: "boot-1061",
        signal: "SIGTERM",
        uptimeMs: 2000,
      })
    );
    expect(runtime.kill).toHaveBeenCalledWith(92, "SIGTERM");
  });

  it("registra saída observável com o mesmo bootId", () => {
    const onHandlers = new Map<string, (...args: any[]) => void>();
    const runtime: RuntimeTerminationProcess = {
      pid: 92,
      on: vi.fn((event, listener) => {
        onHandlers.set(event, listener);
        return runtime;
      }),
      once: vi.fn(() => runtime),
      kill: vi.fn(() => true),
    };
    const logInfo = vi.fn();

    installRuntimeTerminationDiagnostics({
      bootId: "boot-1061",
      bootStartedAt: 1000,
      commit: "abc123",
      runtime,
      now: () => 4000,
      logInfo,
      logError: vi.fn(),
    });

    onHandlers.get("exit")?.(143);

    expect(logInfo).toHaveBeenCalledWith(
      "[Runtime] process_exit",
      expect.objectContaining({
        bootId: "boot-1061",
        code: 143,
        uptimeMs: 3000,
      })
    );
  });
});
