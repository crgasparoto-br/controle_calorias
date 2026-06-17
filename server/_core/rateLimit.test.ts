import { afterEach, describe, expect, it } from "vitest";
import {
  consumeRateLimit,
  getRequestRateLimitIdentity,
  resetRateLimitStoreForTests,
  type RateLimitOptions,
} from "./rateLimit";

const options: RateLimitOptions = {
  keyPrefix: "test",
  windowMs: 1_000,
  max: 2,
};

describe("rate limit helper", () => {
  afterEach(() => {
    resetRateLimitStoreForTests();
  });

  it("allows requests until the configured limit is reached", () => {
    expect(consumeRateLimit("test:client", options, 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(consumeRateLimit("test:client", options, 1_100)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(consumeRateLimit("test:client", options, 1_200)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    });
  });

  it("resets the bucket after the window expires", () => {
    consumeRateLimit("test:client", options, 1_000);
    consumeRateLimit("test:client", options, 1_100);

    expect(consumeRateLimit("test:client", options, 2_001)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("isolates counters by key", () => {
    consumeRateLimit("test:first", options, 1_000);
    consumeRateLimit("test:first", options, 1_100);

    expect(consumeRateLimit("test:second", options, 1_200)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it("uses the first forwarded IP as the request identity", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.5" },
      ip: "10.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    };

    expect(getRequestRateLimitIdentity(req as never)).toBe("203.0.113.10");
  });
});
