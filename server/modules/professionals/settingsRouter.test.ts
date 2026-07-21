import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertProfessionalEntitlement: vi.fn(),
  getProfessionalEntitlements: vi.fn(),
  getProfessionalProfile: vi.fn(),
  getProfessionalSettingsSnapshot: vi.fn(),
  listPatientVisibleProfessionalProfiles: vi.fn(),
  setProfessionalProfileActive: vi.fn(),
  updateProfessionalIdentitySettings: vi.fn(),
  updateProfessionalPreferencesSettings: vi.fn(),
}));

vi.mock("./entitlementService", () => ({
  assertProfessionalEntitlement: mocks.assertProfessionalEntitlement,
  getProfessionalEntitlements: mocks.getProfessionalEntitlements,
}));

vi.mock("./service", () => ({
  getProfessionalProfile: mocks.getProfessionalProfile,
}));

vi.mock("./settingsService", () => ({
  getProfessionalSettingsSnapshot: mocks.getProfessionalSettingsSnapshot,
  listPatientVisibleProfessionalProfiles:
    mocks.listPatientVisibleProfessionalProfiles,
  setProfessionalProfileActive: mocks.setProfessionalProfileActive,
  updateProfessionalIdentitySettings: mocks.updateProfessionalIdentitySettings,
  updateProfessionalPreferencesSettings:
    mocks.updateProfessionalPreferencesSettings,
}));

import { professionalSettingsRouter } from "./settingsRouter";

const context = {
  user: {
    id: 77,
    email: "professional@example.com",
    name: "Profissional",
    role: "user" as const,
  },
} as any;

function caller() {
  return professionalSettingsRouter.createCaller(context);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProfessionalProfile.mockResolvedValue({ active: true });
  mocks.assertProfessionalEntitlement.mockResolvedValue(undefined);
  mocks.getProfessionalEntitlements.mockResolvedValue({
    allowed: true,
    enabledResources: ["professional_settings"],
  });
  mocks.getProfessionalSettingsSnapshot.mockResolvedValue({ profile: null });
  mocks.updateProfessionalIdentitySettings.mockResolvedValue({ success: true });
  mocks.updateProfessionalPreferencesSettings.mockResolvedValue({ success: true });
  mocks.setProfessionalProfileActive.mockResolvedValue({ active: false });
  mocks.listPatientVisibleProfessionalProfiles.mockResolvedValue([]);
});

describe("professional settings router entitlement", () => {
  it("blocks settings reads and mutations when another resource is allowed", async () => {
    mocks.assertProfessionalEntitlement.mockRejectedValue(
      new Error("Configurações profissionais não liberadas.")
    );

    await expect(caller().get()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().updateIdentity({
        displayName: "Nutricionista Ana",
        registrationNumber: "CRN 123",
        contactEmail: "ana@example.com",
        contactPhone: "+55 15 99999-9999",
        patientFacingBio: "Atendimento individual.",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().updatePreferences({
        defaultReviewIntervalDays: 30,
        messageTemplates: [],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().setActive({ active: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(mocks.assertProfessionalEntitlement).toHaveBeenCalledTimes(4);
    for (const call of mocks.assertProfessionalEntitlement.mock.calls) {
      expect(call).toEqual([77, "professional_settings"]);
    }
    expect(mocks.getProfessionalSettingsSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateProfessionalIdentitySettings).not.toHaveBeenCalled();
    expect(mocks.updateProfessionalPreferencesSettings).not.toHaveBeenCalled();
    expect(mocks.setProfessionalProfileActive).not.toHaveBeenCalled();
  });

  it("keeps the isolated entitlement snapshot available to explain a denial", async () => {
    mocks.assertProfessionalEntitlement.mockRejectedValue(
      new Error("Configurações profissionais não liberadas.")
    );
    mocks.getProfessionalEntitlements.mockResolvedValue({
      allowed: true,
      enabledResources: ["professional_reports"],
      planName: "Plano relatórios",
    });

    await expect(caller().entitlements()).resolves.toMatchObject({
      enabledResources: ["professional_reports"],
      planName: "Plano relatórios",
    });

    expect(mocks.assertProfessionalEntitlement).not.toHaveBeenCalled();
    expect(mocks.getProfessionalEntitlements).toHaveBeenCalledWith(77);
  });

  it("uses the exact settings resource when access is granted", async () => {
    await caller().get();

    expect(mocks.getProfessionalProfile).toHaveBeenCalledWith(77);
    expect(mocks.assertProfessionalEntitlement).toHaveBeenCalledWith(
      77,
      "professional_settings"
    );
    expect(mocks.getProfessionalSettingsSnapshot).toHaveBeenCalledWith(77);
  });
});
