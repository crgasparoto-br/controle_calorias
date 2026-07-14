import { describe, expect, it } from "vitest";
import {
  _forTestOnly_setAccessInMap,
  listPatientAccessRequests,
  reconcilePatientAccessRequests,
  type ProfessionalPatientAccess,
} from "./service";

function legacyAccess(
  id: string,
  professionalUserId: number,
  patientUserId: number
): ProfessionalPatientAccess {
  return {
    id,
    professionalUserId,
    patientUserId,
    status: "pending",
    reason: "Acompanhamento legado",
    requestedAt: Date.now(),
    approvedAt: null,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: null,
    responseOrigin: null,
    responseDecision: null,
    authorizationMessageStatus: null,
    authorizationMessageSentAt: null,
    authorizationMessageError: null,
  };
}

describe("professional access reconciliation", () => {
  it("keeps an asymmetric fallback access visible to the patient during rollout", async () => {
    const access = legacyAccess("legacy-access-482", 48210, 48211);
    _forTestOnly_setAccessInMap(access);

    await expect(
      listPatientAccessRequests(access.patientUserId)
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: access.id,
          professionalUserId: access.professionalUserId,
          patientUserId: access.patientUserId,
          status: "pending",
        }),
      ])
    );
  });

  it("treats explicit reconciliation as idempotent after canonical lazy reconciliation", async () => {
    const access = legacyAccess("legacy-access-483", 48310, 48311);
    _forTestOnly_setAccessInMap(access);

    await expect(
      reconcilePatientAccessRequests(access.patientUserId)
    ).resolves.toEqual({
      patientUserId: access.patientUserId,
      reconciledCount: 0,
      accessIds: [],
    });
    await expect(
      reconcilePatientAccessRequests(access.patientUserId)
    ).resolves.toEqual({
      patientUserId: access.patientUserId,
      reconciledCount: 0,
      accessIds: [],
    });
  });
});
