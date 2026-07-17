import { afterEach, describe, expect, it, vi } from "vitest";
import { createDrizzleProfessionalRepository } from "../../repositories/professionalRepository";
import {
  PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
  PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
  assertProfessionalTrackingTransition,
  getAuthorizationActivePairKey,
  parseLegacyProfessionalAccesses,
  parseLegacyProfessionalProfile,
} from "./persistence";

afterEach(() => {
  vi.unstubAllEnvs();
});

function legacyAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: "access-804",
    professionalUserId: 8041,
    patientUserId: 8042,
    status: "approved",
    reason: "Acompanhamento semanal",
    requestedAt: 1_780_000_000_000,
    approvedAt: 1_780_000_100_000,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: 1_780_000_100_000,
    responseOrigin: "web",
    responseDecision: "approved",
    authorizationMessageStatus: "sent",
    authorizationMessageSentAt: 1_780_000_050_000,
    authorizationMessageError: null,
    ...overrides,
  };
}

describe("professional legacy persistence parsing", () => {
  it("fails closed when canonical persistence is unavailable in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const repository = createDrizzleProfessionalRepository({
      getDb: async () => null,
      onWarning: vi.fn(),
    });

    await expect(repository.getProfile(8040)).rejects.toThrow(
      "persistência da Área Profissional"
    );
  });

  it("parses a valid legacy profile without exposing the raw preference", () => {
    const sourceUpdatedAt = new Date("2026-07-14T20:00:00.000Z");
    const result = parseLegacyProfessionalProfile(
      8041,
      JSON.stringify({
        userId: 8041,
        displayName: "  Nutricionista Teste  ",
        registrationNumber: " CRN 123 ",
        active: true,
        createdAt: 1_780_000_000_000,
        updatedAt: 1_780_000_100_000,
      }),
      sourceUpdatedAt
    );

    expect(result.issue).toBeNull();
    expect(result.value).toMatchObject({
      userId: 8041,
      displayName: "Nutricionista Teste",
      registrationNumber: "CRN 123",
      active: true,
      sourceUpdatedAt,
    });
  });

  it("classifies invalid JSON without returning its content", () => {
    const result = parseLegacyProfessionalProfile(
      8041,
      "{sensitive-invalid-json",
      new Date()
    );
    expect(result).toEqual({ value: null, issue: "invalid_json" });
  });

  it("keeps only accesses owned by the preference side", () => {
    const professionalResult = parseLegacyProfessionalAccesses(
      8041,
      PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
      JSON.stringify([
        legacyAccess(),
        legacyAccess({ id: "other-professional", professionalUserId: 9999 }),
      ])
    );
    const patientResult = parseLegacyProfessionalAccesses(
      8042,
      PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
      JSON.stringify([
        legacyAccess(),
        legacyAccess({ id: "other-patient", patientUserId: 9999 }),
      ])
    );

    expect(professionalResult.value?.map(item => item.id)).toEqual([
      "access-804",
    ]);
    expect(patientResult.value?.map(item => item.id)).toEqual(["access-804"]);
    expect(professionalResult.issue).toBe("invalid_shape");
    expect(patientResult.issue).toBe("invalid_shape");
  });
});

describe("professional authorization uniqueness", () => {
  it("reserves a pair key only while authorization can grant access", () => {
    expect(
      getAuthorizationActivePairKey({
        professionalUserId: 8,
        patientUserId: 4,
        status: "pending",
      })
    ).toBe("8:4");
    expect(
      getAuthorizationActivePairKey({
        professionalUserId: 8,
        patientUserId: 4,
        status: "approved",
      })
    ).toBe("8:4");
    expect(
      getAuthorizationActivePairKey({
        professionalUserId: 8,
        patientUserId: 4,
        status: "rejected",
      })
    ).toBeNull();
    expect(
      getAuthorizationActivePairKey({
        professionalUserId: 8,
        patientUserId: 4,
        status: "revoked",
      })
    ).toBeNull();
  });
});

describe("professional tracking state machine", () => {
  it("accepts pause, resume and end, but never reopens an ended tracking", () => {
    expect(() =>
      assertProfessionalTrackingTransition("active", "paused")
    ).not.toThrow();
    expect(() =>
      assertProfessionalTrackingTransition("paused", "active")
    ).not.toThrow();
    expect(() =>
      assertProfessionalTrackingTransition("active", "ended")
    ).not.toThrow();
    expect(() =>
      assertProfessionalTrackingTransition("ended", "active")
    ).toThrow("Transição de acompanhamento inválida");
  });

  it("persists actor, reason and timestamps in the fallback contract", async () => {
    const onWarning = vi.fn();
    const repository = createDrizzleProfessionalRepository({
      getDb: async () => null,
      onWarning,
    });
    const approvedAt = new Date("2026-07-14T20:00:00.000Z");
    await repository.upsertAuthorization({
      id: "tracking-804",
      professionalUserId: 8043,
      patientUserId: 8044,
      status: "approved",
      reason: "Acompanhamento",
      requestedAt: new Date("2026-07-14T19:00:00.000Z"),
      approvedAt,
      rejectedAt: null,
      revokedAt: null,
      respondedAt: approvedAt,
      responseOrigin: "web",
      responseDecision: "approved",
      authorizationMessageStatus: null,
      authorizationMessageSentAt: null,
      authorizationMessageError: null,
      sourceUpdatedAt: approvedAt,
    });

    const pausedAt = new Date("2026-07-15T10:00:00.000Z");
    const paused = await repository.transitionTracking({
      actorUserId: 8043,
      authorizationId: "tracking-804",
      nextStatus: "paused",
      reason: "Férias do paciente",
      now: pausedAt,
    });

    expect(paused).toMatchObject({
      status: "paused",
      pausedAt,
      lastTransitionAt: pausedAt,
      lastTransitionByUserId: 8043,
      lastTransitionReason: "Férias do paciente",
    });
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("lets revocation override an otherwise active tracking", async () => {
    const repository = createDrizzleProfessionalRepository({
      getDb: async () => null,
      onWarning: vi.fn(),
    });
    const approvedAt = new Date("2026-07-14T20:00:00.000Z");
    await repository.upsertAuthorization({
      id: "revoked-804",
      professionalUserId: 8045,
      patientUserId: 8046,
      status: "approved",
      reason: "Acompanhamento",
      requestedAt: approvedAt,
      approvedAt,
      rejectedAt: null,
      revokedAt: null,
      respondedAt: approvedAt,
      responseOrigin: "web",
      responseDecision: "approved",
      authorizationMessageStatus: null,
      authorizationMessageSentAt: null,
      authorizationMessageError: null,
      sourceUpdatedAt: approvedAt,
    });
    const revokedAt = new Date("2026-07-15T12:00:00.000Z");
    await repository.upsertAuthorization({
      id: "revoked-804",
      professionalUserId: 8045,
      patientUserId: 8046,
      status: "revoked",
      reason: "Acompanhamento",
      requestedAt: approvedAt,
      approvedAt,
      rejectedAt: null,
      revokedAt,
      respondedAt: revokedAt,
      responseOrigin: "web",
      responseDecision: "revoked",
      authorizationMessageStatus: null,
      authorizationMessageSentAt: null,
      authorizationMessageError: null,
      sourceUpdatedAt: revokedAt,
    });

    await expect(
      repository.transitionTracking({
        actorUserId: 8045,
        authorizationId: "revoked-804",
        nextStatus: "paused",
      })
    ).rejects.toThrow("A autorização de dados não está ativa.");
  });

  it("updates WhatsApp delivery metadata without restoring a revoked authorization", async () => {
    const repository = createDrizzleProfessionalRepository({
      getDb: async () => null,
      onWarning: vi.fn(),
    });
    const requestedAt = new Date("2026-07-14T20:00:00.000Z");
    await repository.upsertAuthorization({
      id: "late-delivery-804",
      professionalUserId: 8047,
      patientUserId: 8048,
      status: "pending",
      reason: "Acompanhamento",
      requestedAt,
      approvedAt: null,
      rejectedAt: null,
      revokedAt: null,
      respondedAt: null,
      responseOrigin: null,
      responseDecision: null,
      authorizationMessageStatus: null,
      authorizationMessageSentAt: null,
      authorizationMessageError: null,
      sourceUpdatedAt: requestedAt,
    });

    await repository.transitionAuthorization({
      authorizationId: "late-delivery-804",
      patientUserId: 8048,
      nextStatus: "revoked",
      responseOrigin: "web",
      now: new Date("2026-07-14T20:01:00.000Z"),
    });
    const updated = await repository.updateAuthorizationMessage({
      authorizationId: "late-delivery-804",
      professionalUserId: 8047,
      status: "sent",
      sentAt: new Date("2026-07-14T20:02:00.000Z"),
      error: null,
      now: new Date("2026-07-14T20:02:00.000Z"),
    });

    expect(updated).toMatchObject({
      status: "revoked",
      authorizationMessageStatus: "sent",
      responseDecision: "revoked",
    });
  });
});
