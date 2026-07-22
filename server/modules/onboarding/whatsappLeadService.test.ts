import { beforeEach, describe, expect, it, vi } from "vitest";

const completeOnboardingMock = vi.fn(async () => undefined);
const getUserEntitlementsMock = vi.fn();
const logInferenceEventMock = vi.fn();
const registerLocalUserMock = vi.fn();
const sendOnboardingWelcomeWhatsappMock = vi.fn(async () => ({ sent: true }));
const upsertUserWhatsappConnectionMock = vi.fn(async () => undefined);

vi.mock("../../_core/localAuth", () => ({
  registerLocalUser: registerLocalUserMock,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logInferenceEvent: logInferenceEventMock,
  normalizeWhatsAppPhoneNumber: (value: string) => value.replace(/\D/g, ""),
  upsertUserWhatsappConnection: upsertUserWhatsappConnectionMock,
}));

vi.mock("../billing/service", () => ({
  billingService: {
    getUserEntitlements: getUserEntitlementsMock,
  },
}));

vi.mock("./service", () => ({
  completeOnboarding: completeOnboardingMock,
}));

vi.mock("./webGreetingService", () => ({
  sendOnboardingWelcomeWhatsapp: sendOnboardingWelcomeWhatsappMock,
}));

const {
  __resetWhatsappOnboardingLeadsForTests,
  completeWhatsappOnboarding,
  createWhatsappOnboardingLead,
  getWhatsappOnboardingLeadByToken,
} = await import("./whatsappLeadService");

const profile = {
  name: "Ana Teste",
  birthDate: "1990-01-15",
  heightCm: 168,
  currentWeightKg: 67,
  objective: "melhorar_habitos" as const,
  activityLevel: "moderate" as const,
  trackingExperience: "beginner" as const,
  dietaryPreferences: [],
  dietaryRestrictions: [],
  eatingRoutine: "misto" as const,
  mainDifficulty: "falta_de_planejamento" as const,
};

const consents = {
  acceptedTerms: true,
  acceptedPrivacyPolicy: true,
  acceptedHealthDataProcessing: true,
  acceptedOperationalWhatsapp: true,
  acceptedMarketingWhatsapp: false,
};

function user(id: number, email: string) {
  return {
    id,
    name: "Ana Teste",
    email,
    role: "user" as const,
    passwordHash: "hash-test",
  };
}

describe("WhatsApp onboarding eligibility", () => {
  beforeEach(() => {
    __resetWhatsappOnboardingLeadsForTests();
    vi.clearAllMocks();
    getUserEntitlementsMock.mockResolvedValue({
      allowed: true,
      reason: "free_access",
      entitlements: ["system_access"],
      sourceAvailable: true,
      evaluatedAt: new Date("2026-07-22T12:00:00.000Z"),
    });
  });

  it("continues and greets only after valid eligibility", async () => {
    registerLocalUserMock.mockResolvedValue(
      user(42, "ana.allowed@example.com")
    );
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999901",
      displayName: "Ana",
    });

    const result = await completeWhatsappOnboarding({
      token: lead.token,
      email: "ana.allowed@example.com",
      password: "senha-segura",
      profile,
      consents,
    });

    expect(result.nextAction).toBe("continue");
    expect(result.eligibility.allowed).toBe(true);
    expect(sendOnboardingWelcomeWhatsappMock).toHaveBeenCalledWith(42);
    await expect(
      getWhatsappOnboardingLeadByToken(lead.token)
    ).resolves.toBeNull();
    await expect(
      completeWhatsappOnboarding({
        token: lead.token,
        email: "ana.allowed@example.com",
        password: "senha-segura",
        profile,
        consents,
      })
    ).rejects.toThrow("INVALID_OR_EXPIRED_ONBOARDING_TOKEN");
  });

  it("preserves the account but awaits activation without greeting", async () => {
    registerLocalUserMock.mockResolvedValue(
      user(43, "ana.pending@example.com")
    );
    getUserEntitlementsMock.mockResolvedValue({
      allowed: false,
      reason: "no_access",
      entitlements: [],
      sourceAvailable: true,
      evaluatedAt: new Date("2026-07-22T12:00:00.000Z"),
    });
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999902",
      displayName: "Ana",
    });

    const result = await completeWhatsappOnboarding({
      token: lead.token,
      email: "ana.pending@example.com",
      password: "senha-segura",
      profile,
      consents,
    });

    expect(result).toMatchObject({
      user: { id: 43 },
      eligibility: { allowed: false, reason: "no_access" },
      nextAction: "await_activation",
    });
    expect(sendOnboardingWelcomeWhatsappMock).not.toHaveBeenCalled();
    expect(upsertUserWhatsappConnectionMock).toHaveBeenCalledWith({
      userId: 43,
      phoneNumber: "5511999999902",
      displayName: "Ana Teste",
    });
  });
});
