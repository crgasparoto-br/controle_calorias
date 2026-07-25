import { describe, expect, it } from "vitest";
import { sanitizeBillingProviderEventMetadata } from "./providerEvents";

describe("billing provider event metadata", () => {
  it("persists only normalized allowlisted metadata", () => {
    expect(
      sanitizeBillingProviderEventMetadata({
        objectId: "evt_123",
        status: "active",
        amountMinor: 12990,
        cardNumber: "4111111111111111",
        cvv: "123",
        token: "secret-token",
        nested: { email: "patient@example.com" },
      })
    ).toEqual({
      objectId: "evt_123",
      status: "active",
      amountMinor: 12990,
    });
  });

  it("drops unsupported values and truncates diagnostic strings", () => {
    const sanitized = sanitizeBillingProviderEventMetadata({
      reason: "x".repeat(700),
      providerCreatedAt: new Date(),
      amountMinor: Number.NaN,
    });
    expect(sanitized?.reason).toHaveLength(500);
    expect(sanitized).not.toHaveProperty("providerCreatedAt");
    expect(sanitized).not.toHaveProperty("amountMinor");
  });
});
