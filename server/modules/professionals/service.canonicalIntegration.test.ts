import { describe, expect, it } from "vitest";
import { professionalRepository } from "./persistenceService";
import {
  approvePatientAccess,
  requestPatientAccess,
  revokePatientAccess,
  transitionPatientTracking,
  upsertProfessionalProfile,
} from "./service";

describe("service.ts writes through to the canonical professional persistence", () => {
  it("upserts the professional profile in the canonical repository", async () => {
    const professionalUserId = 80401;

    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Bianca Ferreira",
      registrationNumber: "CRN 999",
      active: true,
    });

    await expect(professionalRepository.getProfile(professionalUserId)).resolves.toMatchObject({
      userId: professionalUserId,
      displayName: "Bianca Ferreira",
      registrationNumber: "CRN 999",
      active: true,
    });
  });

  it("creates the canonical authorization when a request is sent and a canonical tracking on approval", async () => {
    const professionalUserId = 80402;
    const patientUserId = 80403;

    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Diego Santos",
      active: true,
    });

    const access = await requestPatientAccess(professionalUserId, {
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Acompanhamento canônico",
    });

    await expect(professionalRepository.getAuthorizationById(access.id)).resolves.toMatchObject({
      id: access.id,
      professionalUserId,
      patientUserId,
      status: "pending",
    });

    await approvePatientAccess(patientUserId, access.id);

    await expect(professionalRepository.getApprovedAuthorization(professionalUserId, patientUserId)).resolves.toMatchObject({
      id: access.id,
      status: "approved",
    });
    await expect(professionalRepository.getTrackingByAuthorization(access.id)).resolves.toMatchObject({
      authorizationId: access.id,
      professionalUserId,
      patientUserId,
      status: "active",
    });
  });

  it("pauses, resumes and ends tracking recording actor and reason, and stops after revocation", async () => {
    const professionalUserId = 80404;
    const patientUserId = 80405;

    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Larissa Gomes",
      active: true,
    });
    const access = await requestPatientAccess(professionalUserId, {
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Acompanhamento canônico",
    });
    await approvePatientAccess(patientUserId, access.id);

    const paused = await transitionPatientTracking(professionalUserId, {
      accessId: access.id,
      status: "paused",
      reason: "Paciente em viagem",
    });
    expect(paused).toMatchObject({
      status: "paused",
      lastTransitionByUserId: professionalUserId,
      lastTransitionReason: "Paciente em viagem",
    });

    const resumed = await transitionPatientTracking(professionalUserId, {
      accessId: access.id,
      status: "active",
    });
    expect(resumed.status).toBe("active");

    await revokePatientAccess(patientUserId, access.id);

    await expect(
      transitionPatientTracking(professionalUserId, {
        accessId: access.id,
        status: "ended",
      }),
    ).rejects.toThrow();
  });
});
