import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("sdk session payload", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    vi.resetModules();
  });

  it("signs and verifies session with only local auth fields", async () => {
    const { sdk } = await import("./sdk");

    const token = await sdk.signSession({
      userId: 42,
      email: "ana@example.com",
      name: "Ana",
      role: "user",
    });

    const payload = decodeJwt(token);
    expect(payload).toMatchObject({
      userId: 42,
      email: "ana@example.com",
      name: "Ana",
      role: "user",
    });
    expect(payload.openId).toBeUndefined();
    expect(payload.appId).toBeUndefined();

    const payloadKeys = Object.keys(payload).sort();
    expect(payloadKeys).toEqual(["email", "exp", "iat", "name", "role", "userId"].sort());

    const verified = await sdk.verifySession(token);
    expect(verified).toEqual({
      userId: 42,
      email: "ana@example.com",
      name: "Ana",
      role: "user",
    });
  });
});
