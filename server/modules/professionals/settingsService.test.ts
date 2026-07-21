import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
  appendHistory: vi.fn(),
  upsertProfile: vi.fn(),
  deleteProfile: vi.fn(),
  listAuthorizationsByPatient: vi.fn(),
  getProfessionalProfile: vi.fn(),
  getProfessionalEntitlements: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  logPersistenceWarning: mocks.logPersistenceWarning,
}));
vi.mock("./contentPersistenceService", () => ({
  professionalContentRepository: {
    appendHistory: mocks.appendHistory,
  },
}));
vi.mock("./persistenceService", () => ({
  professionalRepository: {
    upsertProfile: mocks.upsertProfile,
    deleteProfile: mocks.deleteProfile,
    listAuthorizationsByPatient: mocks.listAuthorizationsByPatient,
  },
}));
vi.mock("./service", () => ({
  getProfessionalProfile: mocks.getProfessionalProfile,
}));
vi.mock("./entitlementService", () => ({
  getProfessionalEntitlements: mocks.getProfessionalEntitlements,
}));
vi.mock("./operationalAlertRules", () => ({
  PROFESSIONAL_OPERATIONAL_ALERT_CRITERIA: [],
}));

import {
  _forTestOnly_clearProfessionalSettings,
  _forTestOnly_hasProfessionalSettings,
  getProfessionalSettingsSnapshot,
  listPatientVisibleProfessionalProfiles,
  ProfessionalSettingsConsistencyError,
  setProfessionalProfileActive,
  updateProfessionalIdentitySettings,
  updateProfessionalPreferencesSettings,
} from "./settingsService";

function canonicalProfile(active = true) {
  return {
    userId: 10,
    displayName: "Nutricionista Ana",
    registrationNumber: "CRN 123",
    active,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-07-20T00:00:00Z"),
    sourceUpdatedAt: new Date("2026-07-20T00:00:00Z"),
  };
}

beforeEach(() => {
  _forTestOnly_clearProfessionalSettings();
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(null);
  mocks.getProfessionalProfile.mockResolvedValue({
    userId: 10,
    displayName: "Nutricionista Ana",
    registrationNumber: "CRN 123",
    active: true,
    createdAt: Date.parse("2026-01-01T00:00:00Z"),
    updatedAt: Date.parse("2026-07-20T00:00:00Z"),
  });
  mocks.upsertProfile.mockResolvedValue(canonicalProfile(true));
  mocks.deleteProfile.mockResolvedValue(undefined);
  mocks.appendHistory.mockResolvedValue(undefined);
  mocks.getProfessionalEntitlements.mockResolvedValue({ allowed: true });
  mocks.listAuthorizationsByPatient.mockResolvedValue([]);
});

describe("professional settings service", () => {
  it("records intent and completion without sensitive content", async () => {
    const result = await updateProfessionalIdentitySettings(10, {
      displayName: " Nutricionista Ana ",
      registrationNumber: " CRN 123 ",
      contactEmail: "ana@example.com",
      contactPhone: "+55 15 99999-9999",
      patientFacingBio: "Atendimento individual.",
    });

    expect(result.profile).toMatchObject({
      displayName: "Nutricionista Ana",
      registrationNumber: "CRN 123",
      active: true,
    });
    expect(result.settings).toMatchObject({
      contactEmail: "ana@example.com",
      patientFacingBio: "Atendimento individual.",
    });
    expect(mocks.appendHistory).toHaveBeenCalledTimes(2);
    expect(mocks.appendHistory.mock.calls[0]?.[0]).toMatchObject({
      id: expect.stringMatching(/^settings-/),
      actorUserId: 10,
      eventType: "settings_identity_change_requested",
      entityType: "professional_settings",
    });
    expect(mocks.appendHistory.mock.calls[1]?.[0]).toMatchObject({
      id: expect.stringMatching(/^settings-/),
      actorUserId: 10,
      eventType: "settings_identity_updated",
      entityType: "professional_settings",
    });
    for (const [event] of mocks.appendHistory.mock.calls) {
      expect(event).not.toHaveProperty("content");
    }
  });

  it("does not mutate preferences when the intent audit cannot be persisted", async () => {
    mocks.appendHistory.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      updateProfessionalPreferencesSettings(10, {
        defaultReviewIntervalDays: 30,
        messageTemplates: [],
      })
    ).rejects.toThrow("audit unavailable");

    const snapshot = await getProfessionalSettingsSnapshot(10);
    expect(snapshot.preferences).toEqual({
      defaultReviewIntervalDays: null,
      messageTemplates: [],
    });
  });

  it("restores preferences when the completion audit cannot be persisted", async () => {
    mocks.appendHistory
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      updateProfessionalPreferencesSettings(10, {
        defaultReviewIntervalDays: 30,
        messageTemplates: [
          {
            title: "Lembrete",
            messageType: "reminder",
            content: "Registrar refeições",
          },
        ],
      })
    ).rejects.toThrow("audit unavailable");

    const snapshot = await getProfessionalSettingsSnapshot(10);
    expect(snapshot.preferences).toEqual({
      defaultReviewIntervalDays: null,
      messageTemplates: [],
    });
  });

  it("removes a newly created profile and preference when completion auditing fails", async () => {
    mocks.getProfessionalProfile.mockResolvedValue(null);
    mocks.upsertProfile.mockResolvedValue(canonicalProfile(true));
    mocks.appendHistory
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      updateProfessionalIdentitySettings(10, {
        displayName: "Nutricionista Ana",
        registrationNumber: "CRN 123",
        contactEmail: "ana@example.com",
        contactPhone: "+55 15 99999-9999",
        patientFacingBio: "Atendimento individual.",
      })
    ).rejects.toThrow("audit unavailable");

    expect(mocks.upsertProfile).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProfile).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProfile).toHaveBeenCalledWith(10);
    expect(_forTestOnly_hasProfessionalSettings(10)).toBe(false);

    const snapshot = await getProfessionalSettingsSnapshot(10);
    expect(snapshot.profile).toBeNull();
    expect(snapshot.preferences).toEqual({
      defaultReviewIntervalDays: null,
      messageTemplates: [],
    });
  });

  it("restores the active profile when completion auditing fails", async () => {
    mocks.upsertProfile
      .mockResolvedValueOnce(canonicalProfile(false))
      .mockResolvedValueOnce(canonicalProfile(true));
    mocks.appendHistory
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(setProfessionalProfileActive(10, false)).rejects.toThrow(
      "audit unavailable"
    );

    expect(mocks.upsertProfile).toHaveBeenCalledTimes(2);
    expect(mocks.upsertProfile.mock.calls[0]?.[0]).toMatchObject({
      userId: 10,
      active: false,
    });
    expect(mocks.upsertProfile.mock.calls[1]?.[0]).toMatchObject({
      userId: 10,
      active: true,
    });
  });

  it("keeps an audit trail and surfaces consistency error when rollback fails", async () => {
    mocks.upsertProfile
      .mockResolvedValueOnce(canonicalProfile(false))
      .mockRejectedValueOnce(new Error("rollback unavailable"));
    mocks.appendHistory
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("completion audit unavailable"));

    await expect(
      setProfessionalProfileActive(10, false)
    ).rejects.toBeInstanceOf(ProfessionalSettingsConsistencyError);

    expect(mocks.appendHistory.mock.calls[0]?.[0]).toMatchObject({
      eventType: "settings_profile_deactivation_requested",
    });
    expect(mocks.logPersistenceWarning).toHaveBeenCalledWith(
      "professional_settings_profile_compensation",
      expect.any(Error)
    );
  });

  it("returns only public fields for active approved professional links", async () => {
    await updateProfessionalIdentitySettings(10, {
      displayName: "Nutricionista Ana",
      registrationNumber: "CRN 123",
      contactEmail: "ana@example.com",
      contactPhone: "+55 15 99999-9999",
      patientFacingBio: "Atendimento individual.",
    });
    await updateProfessionalPreferencesSettings(10, {
      defaultReviewIntervalDays: 30,
      messageTemplates: [
        {
          title: "Privado",
          messageType: "reminder",
          content: "Conteúdo privado",
        },
      ],
    });
    mocks.listAuthorizationsByPatient.mockResolvedValue([
      { professionalUserId: 10, status: "approved" },
      { professionalUserId: 11, status: "revoked" },
    ]);

    const result = await listPatientVisibleProfessionalProfiles(20);

    expect(result).toEqual([
      {
        professionalUserId: 10,
        displayName: "Nutricionista Ana",
        registrationNumber: "CRN 123",
        contactEmail: "ana@example.com",
        contactPhone: "+55 15 99999-9999",
        patientFacingBio: "Atendimento individual.",
      },
    ]);
    expect(result[0]).not.toHaveProperty("messageTemplates");
    expect(result[0]).not.toHaveProperty("summaryFrequency");
  });
});
