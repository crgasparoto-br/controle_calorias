import { describe, expect, it, vi } from "vitest";
import { AiNonRetryableError, AiOperationalError, executeWithPolicy } from "../policyExecutor";

const basePolicy = { maxAttempts: 3, timeoutMs: 1000, fallback: { effectivelyEnabled: false } };

describe("common AI policy executor", () => {
  it("returns the primary result on first try without retrying", async () => {
    const primary = vi.fn().mockResolvedValue("ok");
    const result = await executeWithPolicy(basePolicy, primary);
    expect(result).toEqual({ value: "ok", source: "primary", attempts: 1, usedFallback: false });
    expect(primary).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts total calls (including the first) on operational errors", async () => {
    const primary = vi
      .fn()
      .mockRejectedValueOnce(new AiOperationalError("timeout"))
      .mockResolvedValueOnce("recovered");
    const result = await executeWithPolicy(basePolicy, primary);
    expect(result.source).toBe("primary_retry");
    expect(result.attempts).toBe(2);
    expect(primary).toHaveBeenCalledTimes(2);
  });

  it("never exceeds maxAttempts primary calls", async () => {
    const primary = vi.fn().mockRejectedValue(new AiOperationalError("always fails"));
    await expect(executeWithPolicy(basePolicy, primary)).rejects.toThrow("always fails");
    expect(primary).toHaveBeenCalledTimes(3);
  });

  it("calls fallback at most once after primary attempts are exhausted, when eligible", async () => {
    const primary = vi.fn().mockRejectedValue(new AiOperationalError("down"));
    const fallback = vi.fn().mockResolvedValue("fallback-value");
    const policy = { ...basePolicy, fallback: { effectivelyEnabled: true } };
    const result = await executeWithPolicy(policy, primary, fallback);
    expect(result).toEqual({ value: "fallback-value", source: "fallback", attempts: 4, usedFallback: true });
    expect(primary).toHaveBeenCalledTimes(3);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("does not call fallback when not eligible, and rethrows the last primary error", async () => {
    const primary = vi.fn().mockRejectedValue(new AiOperationalError("down"));
    const fallback = vi.fn().mockResolvedValue("should-not-run");
    const result = executeWithPolicy(basePolicy, primary, fallback);
    await expect(result).rejects.toThrow("down");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("never runs primary and fallback in parallel, and never chains a third call", async () => {
    const callOrder: string[] = [];
    const primary = vi.fn().mockImplementation(async () => {
      callOrder.push("primary");
      throw new AiOperationalError("down");
    });
    const fallback = vi.fn().mockImplementation(async () => {
      callOrder.push("fallback");
      return "fallback-value";
    });
    const policy = { maxAttempts: 1, timeoutMs: 1000, fallback: { effectivelyEnabled: true } };
    await executeWithPolicy(policy, primary, fallback);
    expect(callOrder).toEqual(["primary", "fallback"]);
  });

  it("never retries a fallback failure and never returns to the primary", async () => {
    const primary = vi.fn().mockRejectedValue(new AiOperationalError("down"));
    const fallback = vi.fn().mockRejectedValue(new AiOperationalError("fallback down too"));
    const policy = { maxAttempts: 1, timeoutMs: 1000, fallback: { effectivelyEnabled: true } };
    await expect(executeWithPolicy(policy, primary, fallback)).rejects.toThrow("fallback down too");
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("does not retry or fall back on a non-retryable error", async () => {
    const primary = vi.fn().mockRejectedValue(new AiNonRetryableError("missing secret"));
    const fallback = vi.fn().mockResolvedValue("should-not-run");
    const policy = { ...basePolicy, fallback: { effectivelyEnabled: true } };
    await expect(executeWithPolicy(policy, primary, fallback)).rejects.toThrow("missing secret");
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("times out a hanging primary call and treats it as an operational failure", async () => {
    const primary = vi.fn().mockImplementation(() => new Promise(() => {}));
    const policy = { maxAttempts: 1, timeoutMs: 20, fallback: { effectivelyEnabled: false } };
    await expect(executeWithPolicy(policy, primary)).rejects.toThrow(/timed out/);
  });
});
