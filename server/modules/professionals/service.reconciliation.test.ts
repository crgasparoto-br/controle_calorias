import { describe, expect, it, vi } from "vitest";
import type { ProfessionalPatientAccess } from "./service";

function createSelectChain(result: unknown) {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function createFakeDb(selectResults: unknown[]) {
  const inserts: unknown[] = [];
  const db = {
    inserts,
    select: vi.fn(() => createSelectChain(selectResults.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((payload: unknown) => {
        inserts.push(payload);
        return {
          onDuplicateKeyUpdate: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
  };
  return db;
}

async function loadServiceWithDb(db: unknown, logInferenceEvent = vi.fn()) {
  vi.resetModules();
  vi.doMock("../../db", () => ({
    getDb: vi.fn(async () => db),
    getUserWhatsappConnection: vi.fn(),
    listUserMeals: vi.fn(),
    logInferenceEvent,
  }));
  return import("./service");
}

const legacyAccess: ProfessionalPatientAccess = {
  id: "legacy-access-482",
  professionalUserId: 48210,
  patientUserId: 48211,
  status: "pending",
  reason: "Acompanhamento legado com dado sensível omitido dos logs",
  requestedAt: 1_781_710_000_000,
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

function accessPreferenceRow(userId: number, access: ProfessionalPatientAccess) {
  return {
    userId,
    preferenceValue: JSON.stringify([access]),
  };
}

describe("professional access reconciliation", () => {
  it("keeps patient access listing read-only when a legacy professional-side copy exists", async () => {
    const db = createFakeDb([
      [],
      [accessPreferenceRow(legacyAccess.professionalUserId, legacyAccess)],
      [],
    ]);
    const logInferenceEvent = vi.fn();
    const { listPatientAccessRequests } = await loadServiceWithDb(db, logInferenceEvent);

    await expect(listPatientAccessRequests(legacyAccess.patientUserId)).resolves.toEqual([
      expect.objectContaining({
        id: legacyAccess.id,
        professionalUserId: legacyAccess.professionalUserId,
        patientUserId: legacyAccess.patientUserId,
        status: "pending",
      }),
    ]);
    expect(db.inserts).toEqual([]);
    expect(logInferenceEvent).not.toHaveBeenCalled();
  });

  it("reconciles a legacy professional-side copy once and remains idempotent", async () => {
    const professionalRow = accessPreferenceRow(legacyAccess.professionalUserId, legacyAccess);
    const patientRow = accessPreferenceRow(legacyAccess.patientUserId, legacyAccess);
    const db = createFakeDb([
      [],
      [professionalRow],
      [professionalRow],
      [],
      [patientRow],
      [professionalRow],
    ]);
    const logInferenceEvent = vi.fn();
    const { reconcilePatientAccessRequests } = await loadServiceWithDb(db, logInferenceEvent);

    await expect(reconcilePatientAccessRequests(legacyAccess.patientUserId)).resolves.toEqual({
      patientUserId: legacyAccess.patientUserId,
      reconciledCount: 1,
      accessIds: [legacyAccess.id],
    });
    await expect(reconcilePatientAccessRequests(legacyAccess.patientUserId)).resolves.toEqual({
      patientUserId: legacyAccess.patientUserId,
      reconciledCount: 0,
      accessIds: [],
    });

    expect(db.inserts).toHaveLength(2);
    expect(logInferenceEvent).toHaveBeenCalledTimes(1);
    expect(logInferenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: legacyAccess.patientUserId,
      origin: "admin",
      status: "warning",
      eventType: "professional.access.reconciled",
    }));
    expect(JSON.stringify(logInferenceEvent.mock.calls)).not.toContain(legacyAccess.reason);
  });
});
