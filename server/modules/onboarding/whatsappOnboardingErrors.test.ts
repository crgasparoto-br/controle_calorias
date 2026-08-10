import { describe, expect, it } from "vitest";
import {
  getPublicWhatsappAuthenticatedLinkError,
  getPublicWhatsappOnboardingCompletionError,
} from "./whatsappOnboardingErrors";

describe("WhatsApp onboarding public errors", () => {
  it("does not enumerate whether an account exists", () => {
    const existingAccount = getPublicWhatsappOnboardingCompletionError(
      new Error("EMAIL_ALREADY_REGISTERED")
    );
    const invalidCredentials = getPublicWhatsappOnboardingCompletionError(
      new Error("INVALID_CREDENTIALS")
    );
    const recoveryMismatch = getPublicWhatsappOnboardingCompletionError(
      new Error("ONBOARDING_RECOVERY_ACCOUNT_MISMATCH")
    );

    expect(existingAccount).toEqual(invalidCredentials);
    expect(existingAccount).toEqual(recoveryMismatch);
    expect(existingAccount.code).toBe("CONFLICT");
    expect(existingAccount.message).not.toContain("existe");
    expect(existingAccount.message).not.toContain("cadastrado");
  });

  it("keeps authenticated link conflicts generic", () => {
    expect(
      getPublicWhatsappAuthenticatedLinkError(
        new Error("WHATSAPP_PHONE_ALREADY_LINKED")
      )
    ).toEqual(
      getPublicWhatsappAuthenticatedLinkError(
        new Error("ONBOARDING_ACCOUNT_LINK_UNAVAILABLE")
      )
    );
  });
});
