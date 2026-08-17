import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSafeWhatsappOnboardingCompletionErrorCode } from "./whatsappOnboardingErrors";

const completeOnboardingMock = vi.fn(async () => undefined);
const getLocalUserByIdMock = vi.fn();
const getUserEntitlementsMock = vi.fn();
const logInferenceEventMock = vi.fn();
const registerLocalUserMock = vi.fn();
const sendOnboardingWelcomeWhatsappMock = vi.fn(async () => undefined);
const upsertUserWhatsappConnectionMock = vi.fn(async () => undefined);

vi.mock("../../_core/localAuth", () => ({
  getLocalUserById: getLocalUserByIdMock,
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
  activateWhatsappOnboardingUser,
  completeWhatsappOnboarding,
  createWhatsappOnboardingLead,
  getWhatsappOnboardingActivationState,
  getWhatsappOnboardingLeadByToken,
  linkWhatsappOnboardingToAuthenticatedUser,
} = await import("./whatsappLeadService");

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

function user(id: number, email: string) {
  return {
    id,
    name: "Ana Teste",
    email,
    role: "user" as const,
    passwordHash: "hash-test",
  };
}

function allowedEligibility() {
  return {
    allowed: true,
    reason: "free_access" as const,
    entitlements: ["system_access"],
    sourceAvailable: true,
    evaluatedAt: new Date("2026-07-22T12:00:00.000Z"),
  };
}

function deniedEligibility() {
  return {
    allowed: false,
    reason: "no_access" as const,
    entitlements: [],
    sourceAvailable: true,
    evaluatedAt: new Date("2026-07-22T12:00:00.000Z"),
  };
}

function completionInput(token: string, email: string) {
  return {
    token,
    email,
    password: "senha-segura",
    profile,
    consents,
  };
}

describe("WhatsApp onboarding eligibility", () => {
  beforeEach(() => {
    __resetWhatsappOnboardingLeadsForTests();
    vi.clearAllMocks();
    completeOnboardingMock.mockResolvedValue(undefined);
    getUserEntitlementsMock.mockResolvedValue(allowedEligibility());
    sendOnboardingWelcomeWhatsappMock.mockResolvedValue(undefined);
    upsertUserWhatsappConnectionMock.mockResolvedValue(undefined);
  });

  it("continues and greets only after valid eligibility", async () => {
    registerLocalUserMock.mockResolvedValue(
      user(42, "ana.allowed@example.com")
    );
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999901",
      displayName: "Ana",
    });

    const result = await completeWhatsappOnboarding(
      completionInput(lead.token, "ana.allowed@example.com")
    );

    expect(result.nextAction).toBe("continue");
    expect(result.eligibility.allowed).toBe(true);
    expect(result.resumed).toBe(false);
    expect(sendOnboardingWelcomeWhatsappMock).toHaveBeenCalledWith(42);
    await expect(
      getWhatsappOnboardingLeadByToken(lead.token)
    ).resolves.toBeNull();
    await expect(
      completeWhatsappOnboarding(
        completionInput(lead.token, "ana.allowed@example.com")
      )
    ).rejects.toThrow("INVALID_OR_EXPIRED_ONBOARDING_TOKEN");
  });

  it("persists pending_activation without greeting when access is denied", async () => {
    registerLocalUserMock.mockResolvedValue(
      user(43, "ana.pending@example.com")
    );
    getUserEntitlementsMock.mockResolvedValue(deniedEligibility());
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999902",
      displayName: "Ana",
    });

    const result = await completeWhatsappOnboarding(
      completionInput(lead.token, "ana.pending@example.com")
    );

    expect(result).toMatchObject({
      user: { id: 43 },
      eligibility: { allowed: false, reason: "no_access" },
      nextAction: "await_activation",
      resumed: false,
    });
    expect(sendOnboardingWelcomeWhatsappMock).not.toHaveBeenCalled();
    expect(upsertUserWhatsappConnectionMock).toHaveBeenCalledWith({
      userId: 43,
      phoneNumber: "5511999999902",
      displayName: "Ana Teste",
    });
    await expect(getWhatsappOnboardingActivationState(43)).resolves.toMatchObject({
      status: "pending_activation",
      activationSource: null,
      activatedAt: null,
    });
  });

  it("allows only one concurrent completion claim for the same token", async () => {
    let resolveRegistration!: (value: ReturnType<typeof user>) => void;
    registerLocalUserMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRegistration = resolve;
        })
    );
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999903",
      displayName: "Ana",
    });
    const input = completionInput(lead.token, "ana.concurrent@example.com");

    const first = completeWhatsappOnboarding(input);
    await Promise.resolve();

    await expect(completeWhatsappOnboarding(input)).rejects.toThrow(
      "ONBOARDING_COMPLETION_IN_PROGRESS"
    );

    resolveRegistration(user(44, "ana.concurrent@example.com"));
    await expect(first).resolves.toMatchObject({ user: { id: 44 } });
    expect(registerLocalUserMock).toHaveBeenCalledTimes(1);
  });

  it("resumes an interrupted completion without creating a second account", async () => {
    const existingUser = user(45, "ana.recovery@example.com");
    registerLocalUserMock.mockResolvedValue(existingUser);
    getLocalUserByIdMock.mockResolvedValue(existingUser);
    completeOnboardingMock
      .mockRejectedValueOnce(new Error("PROFILE_WRITE_FAILED"))
      .mockResolvedValueOnce(undefined);
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999904",
      displayName: "Ana",
    });
    const input = completionInput(lead.token, "ana.recovery@example.com");

    await expect(completeWhatsappOnboarding(input)).rejects.toThrow(
      "PROFILE_WRITE_FAILED"
    );
    await expect(completeWhatsappOnboarding(input)).resolves.toMatchObject({
      user: { id: 45 },
      resumed: true,
    });

    expect(registerLocalUserMock).toHaveBeenCalledTimes(1);
    expect(getLocalUserByIdMock).toHaveBeenCalledWith(45);
    expect(completeOnboardingMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the lead after an existing-account conflict and links only through an authenticated continuation", async () => {
    registerLocalUserMock.mockRejectedValue(
      new Error("EMAIL_ALREADY_REGISTERED")
    );
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999906",
      displayName: "Ana existente",
    });

    await expect(
      completeWhatsappOnboarding(
        completionInput(lead.token, "ana.existing@example.com")
      )
    ).rejects.toThrow("EMAIL_ALREADY_REGISTERED");
    await expect(getWhatsappOnboardingLeadByToken(lead.token)).resolves.toMatchObject({
      status: "pending_onboarding",
    });

    const linked = await linkWhatsappOnboardingToAuthenticatedUser(90, lead.token);
    expect(linked).toMatchObject({
      status: "linked",
      nextAction: "continue",
      eligibility: { allowed: true },
    });
    expect(completeOnboardingMock).not.toHaveBeenCalled();
    expect(upsertUserWhatsappConnectionMock).toHaveBeenCalledWith({
      userId: 90,
      phoneNumber: "5511999999906",
      displayName: "Ana existente",
    });
    expect(sendOnboardingWelcomeWhatsappMock).toHaveBeenCalledTimes(1);

    await expect(
      linkWhatsappOnboardingToAuthenticatedUser(90, lead.token)
    ).resolves.toMatchObject({ status: "already_active", resumed: true });
    expect(sendOnboardingWelcomeWhatsappMock).toHaveBeenCalledTimes(1);
    await expect(
      linkWhatsappOnboardingToAuthenticatedUser(91, lead.token)
    ).rejects.toThrow("ONBOARDING_ACCOUNT_LINK_UNAVAILABLE");
  });

  it("persists only a closed safe error code after a sensitive failure", async () => {
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999907",
      displayName: "Ana segura",
    });
    upsertUserWhatsappConnectionMock.mockRejectedValueOnce(
      new Error(
        "database failed for ana.secret@example.com token super-secret-token"
      )
    );

    await expect(
      linkWhatsappOnboardingToAuthenticatedUser(92, lead.token)
    ).rejects.toThrow("database failed");
    const state = await getWhatsappOnboardingActivationState(92);
    expect(state).toMatchObject({
      status: "converting",
      completionErrorCode: "ONBOARDING_COMPLETION_FAILED",
    });
    expect(state?.completionErrorCode).not.toContain("ana.secret@example.com");
    expect(state?.completionErrorCode).not.toContain("super-secret-token");
  });

  it("maps account and unknown failures to a closed persistence vocabulary", () => {
    expect(
      getSafeWhatsappOnboardingCompletionErrorCode(
        new Error("EMAIL_ALREADY_REGISTERED")
      )
    ).toBe("ACCOUNT_AUTHENTICATION_REQUIRED");
    expect(
      getSafeWhatsappOnboardingCompletionErrorCode(
        new Error("private database detail with phone 5511999999999")
      )
    ).toBe("ONBOARDING_COMPLETION_FAILED");
  });

  it("activates a pending account later through the same eligibility contract", async () => {
    const pendingUser = user(46, "ana.activation@example.com");
    registerLocalUserMock.mockResolvedValue(pendingUser);
    getUserEntitlementsMock.mockResolvedValueOnce(deniedEligibility());
    const lead = await createWhatsappOnboardingLead({
      phoneNumber: "5511999999905",
      displayName: "Ana",
    });

    await completeWhatsappOnboarding(
      completionInput(lead.token, "ana.activation@example.com")
    );
    getUserEntitlementsMock.mockResolvedValue(allowedEligibility());

    await expect(
      activateWhatsappOnboardingUser(46, "admin_override")
    ).resolves.toMatchObject({
      status: "activated",
      eligibility: { allowed: true },
    });
    await expect(getWhatsappOnboardingActivationState(46)).resolves.toMatchObject({
      status: "active",
      activationSource: "admin_override",
    });
    expect(sendOnboardingWelcomeWhatsappMock).toHaveBeenCalledWith(46);
  });
});
