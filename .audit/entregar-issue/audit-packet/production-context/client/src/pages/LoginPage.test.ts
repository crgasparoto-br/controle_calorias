import { describe, expect, it } from "vitest";
import { resolveSafeLoginReturnTo } from "./LoginPage";

describe("resolveSafeLoginReturnTo", () => {
  it("preserves an internal WhatsApp onboarding return path", () => {
    expect(
      resolveSafeLoginReturnTo(
        "?returnTo=%2Fonboarding%2Fwhatsapp%2Ftoken-123456789012345678901234"
      )
    ).toBe("/onboarding/whatsapp/token-123456789012345678901234");
  });

  it.each([
    "",
    "?returnTo=https%3A%2F%2Fevil.example",
    "?returnTo=%2F%2Fevil.example",
    "?returnTo=%2F%5Cevil.example",
  ])("rejects an unsafe return target: %s", search => {
    expect(resolveSafeLoginReturnTo(search)).toBe("/");
  });
});
