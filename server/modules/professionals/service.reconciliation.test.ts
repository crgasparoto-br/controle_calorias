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

async function loadServiceWithLegacyRows(rows: unknown[], logPersistenceWarning = vi.fn()) {
  const canonical = new Map<string, ProfessionalPatientAccess>();
  const saveCanonicalProfessionalAccess = vi.fn(async ({ access }: { access: ProfessionalPatientAccess }) => {
    const active = [...canonical.values()].find(item =>
      (item.status === "pending" || item.status === "approved") &&
      item.professionalUserId === access.professionalUserId &&
      item.patientUserId === access.patientUserId,
    );
    if (active) return { access: active, outcome: "conflict" as const };
    canonical.set(access.id, access);
    return { access, outcome: "created" as const };
  });

  vi.resetModules();
  vi.doMock("../../db", () => ({
    getDb: vi.fn(async () => ({ select: vi.fn(() => createSelectChain(rows)) })),
    getUserWhatsappConnection: vi.fn(),
    listUserMeals: vi.fn(),
    logInferenceEvent: vi.fn(),
    logPersistenceWarning,
  }));
  vi.doMock("../../repositories/professionalRepository", () => ({
    findCanonicalAccessForPatient: vi.fn(async (patientUserId: number, accessId: string) =>
      [...canonical.values()].find(item => item.patientUserId === patientUserId && item.id === accessId) ?? null),
    findCanonicalActiveAccess: vi.fn(async () => null),
    findCanonicalProfessionalProfile: vi.fn(async (userId: number) => ({
      userId,
      displayName: "Profissional migrado",
      active: true,
      createdAt: legacyAccess.requestedAt,
      updatedAt: legacyAccess.requestedAt,
    })),
    getCanonicalFollowUp: vi.fn(),
    listCanonicalAccessesByPatient: vi.fn(async (patientUserId: number) =>
      [...canonical.values()].filter(item => item.patientUserId === patientUserId)),
    listCanonicalAccessesByProfessional: vi.fn(async (professionalUserId: number) =>
      [...canonical.values()].filter(item => item.professionalUserId === professionalUserId)),
    saveCanonicalProfessionalAccess,
    compareCanonicalProfessionalAccessVersions: (left: ProfessionalPatientAccess, right: ProfessionalPatientAccess) => {
      const version = (item: ProfessionalPatientAccess) => Math.max(
        item.requestedAt,
        item.approvedAt ?? 0,
        item.rejectedAt ?? 0,
        item.revokedAt ?? 0,
        item.respondedAt ?? 0,
      );
      const difference = version(left) - version(right);
      if (difference !== 0) return difference;
      const precedence = { pending: 1, rejected: 2, approved: 3, revoked: 4 };
      return precedence[left.status] - precedence[right.status];
    },
    transitionCanonicalFollowUp: vi.fn(),
    upsertCanonicalProfessionalProfile: vi.fn(),
  }));
  const service = await import("./service");
  return { service, canonical, saveCanonicalProfessionalAccess };
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

describe("professional legacy persistence migration", () => {
  it("migra a cópia profissional e a torna visível ao paciente sem novo convite", async () => {
    const { service, canonical } = await loadServiceWithLegacyRows([{
      userId: legacyAccess.professionalUserId,
      preferenceKey: "professional_accesses_v1",
      preferenceValue: JSON.stringify([legacyAccess]),
    }]);

    await expect(service.listPatientAccessRequests(legacyAccess.patientUserId)).resolves.toEqual([
      expect.objectContaining({ id: legacyAccess.id, status: "pending" }),
    ]);
    expect(canonical.get(legacyAccess.id)).toEqual(legacyAccess);
  });

  it("é idempotente em retry e não repete o scan global dentro do intervalo", async () => {
    const duplicateCopy = { ...legacyAccess };
    const { service, canonical, saveCanonicalProfessionalAccess } = await loadServiceWithLegacyRows([
      {
        userId: legacyAccess.professionalUserId,
        preferenceKey: "professional_accesses_v1",
        preferenceValue: JSON.stringify([legacyAccess]),
      },
      {
        userId: legacyAccess.patientUserId,
        preferenceKey: "patient_professional_access_requests_v1",
        preferenceValue: JSON.stringify([duplicateCopy]),
      },
    ]);

    await service.listPatientAccessRequests(legacyAccess.patientUserId);
    await service.listPatientAccessRequests(legacyAccess.patientUserId);

    expect(canonical.size).toBe(1);
    expect(saveCanonicalProfessionalAccess).toHaveBeenCalledTimes(1);
  });

  it("sanitiza erro técnico legado antes de gravar o vínculo canônico", async () => {
    const withUnsafeError = {
      ...legacyAccess,
      authorizationMessageStatus: "failed" as const,
      authorizationMessageError: "Falha para paciente@example.com no telefone +55 11 99999-0000",
    };
    const { service, canonical } = await loadServiceWithLegacyRows([{
      userId: legacyAccess.professionalUserId,
      preferenceKey: "professional_accesses_v1",
      preferenceValue: JSON.stringify([withUnsafeError]),
    }]);

    await service.listPatientAccessRequests(legacyAccess.patientUserId);
    expect(canonical.get(legacyAccess.id)?.authorizationMessageError).toBe(
      "Falha para [email_redacted] no telefone [phone_redacted]",
    );
  });

  it("escolhe a revogação mais recente independentemente da ordem das cópias", async () => {
    const revoked = {
      ...legacyAccess,
      status: "revoked" as const,
      revokedAt: legacyAccess.requestedAt + 1_000,
      respondedAt: legacyAccess.requestedAt + 1_000,
      responseDecision: "revoked" as const,
    };
    const { service, canonical } = await loadServiceWithLegacyRows([
      {
        userId: legacyAccess.patientUserId,
        preferenceKey: "patient_professional_access_requests_v1",
        preferenceValue: JSON.stringify([revoked]),
      },
      {
        userId: legacyAccess.professionalUserId,
        preferenceKey: "professional_accesses_v1",
        preferenceValue: JSON.stringify([legacyAccess]),
      },
    ]);

    await service.listPatientAccessRequests(legacyAccess.patientUserId);
    expect(canonical.get(legacyAccess.id)?.status).toBe("revoked");
  });

  it("registra contagem sanitizada quando apenas parte do array é inválida", async () => {
    const logPersistenceWarning = vi.fn();
    const { service, canonical } = await loadServiceWithLegacyRows([{
      userId: legacyAccess.professionalUserId,
      preferenceKey: "professional_accesses_v1",
      preferenceValue: JSON.stringify([legacyAccess, { id: "incompleto", reason: legacyAccess.reason }]),
    }], logPersistenceWarning);

    await service.listPatientAccessRequests(legacyAccess.patientUserId);
    expect(canonical.size).toBe(1);
    expect(logPersistenceWarning).toHaveBeenCalledWith(
      "Professional legacy preference ignored",
      expect.objectContaining({ message: expect.stringContaining("1 item(ns) rejeitado(s) de 2") }),
    );
    expect(JSON.stringify(logPersistenceWarning.mock.calls)).not.toContain(legacyAccess.reason);
  });

  it("ignora JSON corrompido com aviso sanitizado", async () => {
    const logPersistenceWarning = vi.fn();
    const { service, canonical } = await loadServiceWithLegacyRows([{
      userId: legacyAccess.professionalUserId,
      preferenceKey: "professional_accesses_v1",
      preferenceValue: `{\"reason\":\"${legacyAccess.reason}\"`,
    }], logPersistenceWarning);

    await expect(service.listPatientAccessRequests(legacyAccess.patientUserId)).resolves.toEqual([]);
    expect(canonical.size).toBe(0);
    expect(logPersistenceWarning).toHaveBeenCalledWith(
      "Professional legacy preference ignored",
      expect.any(Error),
    );
    expect(JSON.stringify(logPersistenceWarning.mock.calls)).not.toContain(legacyAccess.reason);
  });
});
