import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertProfessionalResourceAccess: vi.fn(),
  execute: vi.fn(),
  getDb: vi.fn(),
  getProfessionalProfile: vi.fn(),
}));

vi.mock("../../db", () => ({ getDb: mocks.getDb }));
vi.mock("./entitlementAccess", () => ({
  assertProfessionalResourceAccess: mocks.assertProfessionalResourceAccess,
}));
vi.mock("./service", () => ({
  getProfessionalProfile: mocks.getProfessionalProfile,
}));

import { getProfessionalPatientContext } from "./patientContextService";

const professionalActivityAt = new Date("2026-07-24T15:30:00.000Z");
const unrelatedMealActivityAt = new Date("2026-07-20T08:00:00.000Z");

beforeEach(() => {
  mocks.assertProfessionalResourceAccess.mockReset();
  mocks.execute.mockReset();
  mocks.getDb.mockReset();
  mocks.getProfessionalProfile.mockReset();
  mocks.getProfessionalProfile.mockResolvedValue({ active: true });
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
  mocks.execute.mockResolvedValue([
    [
      {
        authorizationId: "authorization-1",
        patientUserId: 41,
        patientName: "Ana",
        patientEmail: "ana@example.com",
        trackingStatus: "paused",
        lastActivityAt: unrelatedMealActivityAt,
        lastProfessionalActivityAt: professionalActivityAt,
        nextReviewAt: new Date("2026-08-05T12:00:00.000Z"),
      },
    ],
  ]);
});

describe("getProfessionalPatientContext", () => {
  it("checks the exact entitlement and uses the canonical professional timeline for activity", async () => {
    const result = await getProfessionalPatientContext(7, {
      patientId: 41,
      resource: "professional_reports",
    });

    expect(mocks.assertProfessionalResourceAccess).toHaveBeenCalledWith(
      7,
      "professional_reports"
    );
    expect(result).toEqual({
      patientId: 41,
      authorizationId: "authorization-1",
      displayName: "Ana",
      authorizationStatus: "approved",
      lastActivityAt: professionalActivityAt.getTime(),
      nextReviewAt: Date.parse("2026-08-05T12:00:00.000Z"),
      trackingStatus: "paused",
    });
    expect(result.lastActivityAt).not.toBe(unrelatedMealActivityAt.getTime());
  });

  it("returns explicit nulls when stable header metadata is absent", async () => {
    mocks.execute.mockResolvedValueOnce([
      [
        {
          authorizationId: "authorization-1",
          patientUserId: 41,
          patientName: "Ana",
          patientEmail: "ana@example.com",
          trackingStatus: "active",
          lastProfessionalActivityAt: null,
          nextReviewAt: null,
        },
      ],
    ]);

    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_messages",
      })
    ).resolves.toMatchObject({
      authorizationStatus: "approved",
      lastActivityAt: null,
      nextReviewAt: null,
      trackingStatus: "active",
    });
  });

  it("minimizes the public context after tracking ends", async () => {
    mocks.execute.mockResolvedValueOnce([
      [
        {
          authorizationId: "authorization-sensitive",
          patientUserId: 41,
          patientName: "Ana",
          patientEmail: "ana@example.com",
          trackingStatus: "ended",
          lastProfessionalActivityAt: professionalActivityAt,
          nextReviewAt: new Date("2026-08-05T12:00:00.000Z"),
        },
      ],
    ]);

    const result = await getProfessionalPatientContext(7, {
      patientId: 41,
      resource: "professional_record",
    });

    expect(result).toEqual({
      patientId: 41,
      displayName: "Ana",
      authorizationStatus: "approved",
      trackingStatus: "ended",
    });
    expect(result).not.toHaveProperty("authorizationId");
    expect(result).not.toHaveProperty("lastActivityAt");
    expect(result).not.toHaveProperty("nextReviewAt");
  });

  it("does not query authorization when the professional profile is inactive", async () => {
    mocks.getProfessionalProfile.mockResolvedValue({ active: false });
    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_messages",
      })
    ).rejects.toThrow("O contexto profissional não está disponível.");
    expect(mocks.assertProfessionalResourceAccess).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns the same safe error for absent or revoked authorizations", async () => {
    mocks.execute.mockResolvedValue([[]]);
    await expect(
      getProfessionalPatientContext(7, {
        patientId: 999,
        resource: "professional_record",
      })
    ).rejects.toThrow("O acesso a este paciente não está mais disponível.");
  });

  it("fails closed when the canonical database is unavailable", async () => {
    mocks.getDb.mockResolvedValue(null);
    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_messages",
      })
    ).rejects.toThrow(
      "Não foi possível confirmar a autorização do paciente neste momento."
    );
  });
});
