import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const completeWhatsappOnboardingMock = vi.hoisted(() => vi.fn());
const getBillingWebOverviewMock = vi.hoisted(() => vi.fn());
const getWhatsappOnboardingLeadByTokenMock = vi.hoisted(() => vi.fn());
const linkWhatsappOnboardingToAuthenticatedUserMock = vi.hoisted(() => vi.fn());

vi.mock("./modules/onboarding/whatsappLeadService", () => ({
  completeWhatsappOnboarding: completeWhatsappOnboardingMock,
  getWhatsappOnboardingLeadByToken: getWhatsappOnboardingLeadByTokenMock,
  linkWhatsappOnboardingToAuthenticatedUser:
    linkWhatsappOnboardingToAuthenticatedUserMock,
}));

vi.mock("./modules/billing/webPublic", async importOriginal => {
  const actual = await importOriginal<typeof import("./modules/billing/webPublic")>();
  return {
    ...actual,
    getBillingWebOverview: getBillingWebOverviewMock,
  };
});

const { appRouter } = await import("./routers");

const profile = {
  name: "Ana Teste",
  birthDate: "1990-01-15",
  heightCm: 168,
  currentWeightKg: 67,
  sex: "prefer_not_to_say" as const,
  objective: "melhorar_habitos" as const,
  activityLevel: "moderate" as const,
  trackingExperience: "beginner" as const,
  dietaryPreferences: [],
  dietaryRestrictions: [],
  eatingRoutine: "misto" as const,
  mainDifficulty: "falta_de_planejamento" as const,
  timezone: "America/Sao_Paulo",
  ageYears: 36,
};

const consents = {
  acceptedTerms: true,
  acceptedPrivacyPolicy: true,
  acceptedHealthDataProcessing: true,
  acceptedOperationalWhatsapp: true,
  acceptedMarketingWhatsapp: false,
};

function createContext(user: TrpcContext["user"] = null): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function completionInput() {
  return {
    token: "valid-token-with-enough-characters-1234567890",
    email: "ana@example.com",
    password: "SenhaForte123",
    profile,
    consents,
  };
}

describe("auth.whatsappOnboarding public boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBillingWebOverviewMock.mockResolvedValue({
      access: { allowed: true, reason: "active_trial" },
      lifecycle: { state: "active", reconciliationRequired: false },
      catalog: [],
      trialEligibility: {},
      actions: { canStartCheckout: false },
    });
  });

  it("returns the same public error for existing-account and credential conflicts", async () => {
    const caller = appRouter.createCaller(createContext());

    completeWhatsappOnboardingMock.mockRejectedValueOnce(
      new Error("EMAIL_ALREADY_REGISTERED")
    );
    const existingAccountError = await caller.auth.whatsappOnboarding
      .complete(completionInput())
      .catch(error => error);

    completeWhatsappOnboardingMock.mockRejectedValueOnce(
      new Error("INVALID_CREDENTIALS")
    );
    const credentialError = await caller.auth.whatsappOnboarding
      .complete(completionInput())
      .catch(error => error);

    expect(existingAccountError).toMatchObject({
      code: "CONFLICT",
      message:
        "Não foi possível concluir o cadastro com estes dados. Se você já possui uma conta, entre nela e retome o vínculo usando o mesmo link do WhatsApp.",
    });
    expect(credentialError).toMatchObject({
      code: existingAccountError.code,
      message: existingAccountError.message,
    });
    expect(existingAccountError.message).not.toContain("e-mail já");
    expect(existingAccountError.message).not.toContain("cadastrado");
  });

  it("requires an authenticated session before linking the proven WhatsApp token", async () => {
    const publicCaller = appRouter.createCaller(createContext());

    await expect(
      publicCaller.auth.whatsappOnboarding.linkExistingAccount({
        token: "valid-token-with-enough-characters-1234567890",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(linkWhatsappOnboardingToAuthenticatedUserMock).not.toHaveBeenCalled();
  });

  it("uses only the authenticated user as the account-link actor and returns backend commercial state", async () => {
    const user = {
      id: 77,
      openId: "local:77",
      email: "ana@example.com",
      name: "Ana",
      loginMethod: "password",
      role: "user" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    linkWhatsappOnboardingToAuthenticatedUserMock.mockResolvedValue({
      status: "linked",
      nextAction: "continue",
      resumed: false,
    });
    const caller = appRouter.createCaller(createContext(user));

    await expect(
      caller.auth.whatsappOnboarding.linkExistingAccount({
        token: "valid-token-with-enough-characters-1234567890",
      })
    ).resolves.toMatchObject({
      status: "linked",
      commercial: {
        access: { allowed: true, reason: "active_trial" },
        lifecycle: { state: "active", reconciliationRequired: false },
      },
    });
    expect(linkWhatsappOnboardingToAuthenticatedUserMock).toHaveBeenCalledWith(
      77,
      "valid-token-with-enough-characters-1234567890"
    );
    expect(getBillingWebOverviewMock).toHaveBeenCalledWith(77);
  });

  it("does not roll back a successful account link when the commercial read model is temporarily unavailable", async () => {
    const user = {
      id: 78,
      openId: "local:78",
      email: "bia@example.com",
      name: "Bia",
      loginMethod: "password",
      role: "user" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    linkWhatsappOnboardingToAuthenticatedUserMock.mockResolvedValue({
      status: "pending_activation",
      nextAction: "await_activation",
      resumed: true,
    });
    getBillingWebOverviewMock.mockRejectedValueOnce(new Error("temporary read failure"));
    const caller = appRouter.createCaller(createContext(user));

    await expect(
      caller.auth.whatsappOnboarding.linkExistingAccount({
        token: "valid-token-with-enough-characters-1234567890",
      })
    ).resolves.toMatchObject({
      status: "pending_activation",
      nextAction: "await_activation",
      commercial: null,
    });
  });
});