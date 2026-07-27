import { describe, expect, it, vi } from "vitest";
import {
  AiNonRetryableError,
  AiOperationalError,
  createJsonOutputValidator,
  executeWithPolicy,
} from "../policyExecutor";

const basePolicy = {
  state: "ready" as const,
  maxAttempts: 3,
  timeoutMs: 1000,
  fallback: { effectivelyEnabled: false },
};

describe("common AI policy executor", () => {
  it("returns the primary result on the first call", async () => {
    const primary = vi.fn(async () => "ok");
    await expect(executeWithPolicy(basePolicy, primary)).resolves.toEqual({
      value: "ok",
      source: "primary",
      attempts: 1,
      usedFallback: false,
    });
  });

  it.each(["disabled", "invalid"] as const)(
    "blocks state=%s before any primary or fallback outbound",
    async state => {
      const primary = vi.fn(async () => "must-not-run");
      const fallback = vi.fn(async () => "must-not-run");
      await expect(executeWithPolicy(
        { ...basePolicy, state, fallback: { effectivelyEnabled: true } },
        primary,
        fallback,
      )).rejects.toMatchObject({ code: "invalid_configuration" });
      expect(primary).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it.each([
    { timeoutMs: 0, maxAttempts: 1 },
    { timeoutMs: Number.NaN, maxAttempts: 1 },
    { timeoutMs: 1000, maxAttempts: 0 },
    { timeoutMs: 1000, maxAttempts: 1.5 },
  ])("rejects malformed execution limits before outbound: %o", async invalidPolicy => {
    const primary = vi.fn(async () => "must-not-run");
    await expect(executeWithPolicy(
      { ...basePolicy, ...invalidPolicy },
      primary,
    )).rejects.toMatchObject({ code: "invalid_configuration" });
    expect(primary).not.toHaveBeenCalled();
  });

  it("rejects enabled fallback without a callback before outbound", async () => {
    const primary = vi.fn(async () => "must-not-run");
    await expect(executeWithPolicy(
      { ...basePolicy, fallback: { effectivelyEnabled: true } },
      primary,
    )).rejects.toMatchObject({ code: "invalid_configuration" });
    expect(primary).not.toHaveBeenCalled();
  });

  it("allows degraded state when the primary remains runnable", async () => {
    const primary = vi.fn(async () => "ok");
    await expect(executeWithPolicy({ ...basePolicy, state: "degraded" }, primary)).resolves.toMatchObject({
      value: "ok",
      source: "primary",
    });
  });

  it("normalizes a native recoverable HTTP error and retries", async () => {
    const rateLimit = Object.assign(new Error("rate limited"), { status: 429 });
    const primary = vi.fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce("recovered");
    const result = await executeWithPolicy(basePolicy, primary);
    expect(result.source).toBe("primary_retry");
    expect(primary).toHaveBeenCalledTimes(2);
  });

  it("never exceeds MAX_ATTEMPTS primary calls", async () => {
    const primary = vi.fn(async () => {
      throw new AiOperationalError("network down");
    });
    await expect(executeWithPolicy(basePolicy, primary)).rejects.toThrow("network down");
    expect(primary).toHaveBeenCalledTimes(3);
  });

  it("executes fallback once after primary exhaustion", async () => {
    const primary = vi.fn(async () => {
      throw new AiOperationalError("down");
    });
    const fallback = vi.fn(async () => "fallback-value");
    const result = await executeWithPolicy(
      { ...basePolicy, fallback: { effectivelyEnabled: true } },
      primary,
      fallback,
    );
    expect(result).toEqual({
      value: "fallback-value",
      source: "fallback",
      attempts: 4,
      usedFallback: true,
    });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("does not retry or fallback on authentication errors from a real SDK shape", async () => {
    const authError = Object.assign(new Error("invalid API key"), { status: 401 });
    const primary = vi.fn(async () => { throw authError; });
    const fallback = vi.fn(async () => "must-not-run");
    await expect(executeWithPolicy(
      { ...basePolicy, fallback: { effectivelyEnabled: true } },
      primary,
      fallback,
    )).rejects.toMatchObject({ code: "authentication" });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("treats empty output as an operational failure", async () => {
    const primary = vi.fn()
      .mockResolvedValueOnce({ outputText: "", raw: {} })
      .mockResolvedValueOnce({ outputText: "valid", raw: {} });
    const result = await executeWithPolicy(basePolicy, primary);
    expect(result.source).toBe("primary_retry");
    expect(primary).toHaveBeenCalledTimes(2);
  });

  it("treats invalid JSON as an operational failure through the common validator", async () => {
    const primary = vi.fn()
      .mockResolvedValueOnce({ outputText: "not-json", raw: {} })
      .mockResolvedValueOnce({ outputText: "{\"ok\":true}", raw: {} });
    const result = await executeWithPolicy(basePolicy, primary, undefined, {
      validateResult: createJsonOutputValidator(),
    });
    expect(result.source).toBe("primary_retry");
  });

  it("treats schema-invalid JSON as an operational invalid payload", async () => {
    const primary = vi.fn()
      .mockResolvedValueOnce({ outputText: "{\"ok\":false}", raw: {} })
      .mockResolvedValueOnce({ outputText: "{\"ok\":true}", raw: {} });
    const isExpected = (parsed: unknown): parsed is { ok: true } =>
      typeof parsed === "object" && parsed !== null && (parsed as { ok?: unknown }).ok === true;
    const result = await executeWithPolicy(basePolicy, primary, undefined, {
      validateResult: createJsonOutputValidator(isExpected),
    });
    expect(result.source).toBe("primary_retry");
  });

  it("aborts and waits for each timed-out call before retrying or falling back", async () => {
    let activeCalls = 0;
    let maximumActiveCalls = 0;
    const order: string[] = [];

    const primary = vi.fn(({ signal }: { signal: AbortSignal }) =>
      new Promise<string>((_resolve, reject) => {
        order.push("primary:start");
        activeCalls += 1;
        maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
        signal.addEventListener("abort", () => {
          order.push("primary:abort");
          activeCalls -= 1;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }));

    const fallback = vi.fn(async () => {
      order.push("fallback:start");
      expect(activeCalls).toBe(0);
      return "fallback";
    });

    const result = await executeWithPolicy(
      {
        state: "ready",
        maxAttempts: 2,
        timeoutMs: 10,
        fallback: { effectivelyEnabled: true },
      },
      primary,
      fallback,
      { abortGraceMs: 50 },
    );

    expect(result.source).toBe("fallback");
    expect(primary).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(maximumActiveCalls).toBe(1);
    expect(order).toEqual([
      "primary:start",
      "primary:abort",
      "primary:start",
      "primary:abort",
      "fallback:start",
    ]);
  });

  it("fails closed when a timed-out provider ignores AbortSignal", async () => {
    const primary = vi.fn(async () => new Promise<string>(() => {}));
    const fallback = vi.fn(async () => "must-not-run");
    await expect(executeWithPolicy(
      {
        state: "ready",
        maxAttempts: 3,
        timeoutMs: 5,
        fallback: { effectivelyEnabled: true },
      },
      primary,
      fallback,
      { abortGraceMs: 5 },
    )).rejects.toBeInstanceOf(AiNonRetryableError);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("never retries fallback or returns to primary after fallback failure", async () => {
    const primary = vi.fn(async () => { throw new AiOperationalError("primary down"); });
    const fallback = vi.fn(async () => { throw new AiOperationalError("fallback down"); });
    await expect(executeWithPolicy(
      {
        state: "ready",
        maxAttempts: 1,
        timeoutMs: 1000,
        fallback: { effectivelyEnabled: true },
      },
      primary,
      fallback,
    )).rejects.toThrow("fallback down");
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
