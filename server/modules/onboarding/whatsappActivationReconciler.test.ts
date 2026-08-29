import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
const getDbMock = vi.fn();
const logPersistenceWarningMock = vi.fn();
const activateWhatsappOnboardingUserMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: getDbMock,
  logPersistenceWarning: logPersistenceWarningMock,
}));

vi.mock("./whatsappLeadService", () => ({
  activateWhatsappOnboardingUser: activateWhatsappOnboardingUserMock,
}));

const { reconcilePendingWhatsappOnboardingActivations } = await import(
  "./whatsappActivationReconciler"
);

describe("WhatsApp onboarding activation reconciler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockResolvedValue({ execute: executeMock });
  });

  it("re-evaluates pending users through the central activation contract", async () => {
    executeMock.mockResolvedValueOnce([
      [{ user_id: 41 }, { user_id: "42" }, { user_id: 43 }],
    ]);
    activateWhatsappOnboardingUserMock
      .mockResolvedValueOnce({ status: "activated" })
      .mockResolvedValueOnce({ status: "blocked" })
      .mockResolvedValueOnce({ status: "already_active" });

    await expect(
      reconcilePendingWhatsappOnboardingActivations(100)
    ).resolves.toEqual({
      scanned: 3,
      activated: 1,
      alreadyActive: 1,
      blocked: 1,
      unchanged: 0,
      failed: 0,
    });

    expect(activateWhatsappOnboardingUserMock).toHaveBeenNthCalledWith(1, 41);
    expect(activateWhatsappOnboardingUserMock).toHaveBeenNthCalledWith(2, 42);
    expect(activateWhatsappOnboardingUserMock).toHaveBeenNthCalledWith(3, 43);
  });

  it("keeps reconciliation failures recoverable without failing other users", async () => {
    executeMock.mockResolvedValueOnce([[{ user_id: 51 }, { user_id: 52 }]]);
    activateWhatsappOnboardingUserMock
      .mockRejectedValueOnce(new Error("temporary greeting failure"))
      .mockResolvedValueOnce({ status: "activated" });

    await expect(
      reconcilePendingWhatsappOnboardingActivations(100)
    ).resolves.toEqual({
      scanned: 2,
      activated: 1,
      alreadyActive: 0,
      blocked: 0,
      unchanged: 0,
      failed: 1,
    });
    expect(logPersistenceWarningMock).toHaveBeenCalledWith(
      "whatsapp_onboarding_activation_reconciliation",
      expect.any(Error)
    );
  });

  it("fails closed when persistence is unavailable", async () => {
    getDbMock.mockResolvedValueOnce(null);

    await expect(
      reconcilePendingWhatsappOnboardingActivations(100)
    ).resolves.toEqual({
      scanned: 0,
      activated: 0,
      alreadyActive: 0,
      blocked: 0,
      unchanged: 0,
      failed: 0,
    });
    expect(activateWhatsappOnboardingUserMock).not.toHaveBeenCalled();
  });

  it("records scan failures without exposing provider or user details", async () => {
    const failure = new Error("database unavailable");
    executeMock.mockRejectedValueOnce(failure);

    await expect(
      reconcilePendingWhatsappOnboardingActivations(100)
    ).resolves.toMatchObject({ scanned: 0, failed: 1 });
    expect(logPersistenceWarningMock).toHaveBeenCalledWith(
      "whatsapp_onboarding_activation_scan",
      failure
    );
    expect(activateWhatsappOnboardingUserMock).not.toHaveBeenCalled();
  });
});
