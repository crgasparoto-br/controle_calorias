import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertProfessionalResourceAccess: vi.fn(),
  execute: vi.fn(),
  getDb: vi.fn(),
  getProfessionalProfile: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  logPersistenceWarning: mocks.logPersistenceWarning,
}));
vi.mock("./entitlementAccess", () => ({
  assertProfessionalResourceAccess: mocks.assertProfessionalResourceAccess,
}));
vi.mock("./service", () => ({
  getProfessionalProfile: mocks.getProfessionalProfile,
}));

import {
  _forTestOnly_clearProfessionalPatientContextMetadataCache,
  getProfessionalPatientContext,
} from "./patientContextService";

const professionalActivityAt = new Date("2026-07-24T15:30:00.000Z");
const unrelatedMealActivityAt = new Date("2026-07-20T08:00:00.000Z");
const defaultContext = {
  authorizationId: "authorization-1",
  patientUserId: 41,
  patientName: "Ana",
  patientEmail: "ana@example.com",
  trackingStatus: "paused",
  lastActivityAt: unrelatedMealActivityAt,
  nextReviewAt: new Date("2026-08-05T12:00:00.000Z"),
};
const defaultHistory = {
  lastProfessionalActivityAt: professionalActivityAt,
  lastProfessionalActivityType: "official_goal_review_requested",
};

function collectStrings(
  value: unknown,
  seen = new WeakSet<object>()
): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap(item => collectStrings(item, seen));
  }
  return Object.values(value as Record<string, unknown>).flatMap(item =>
    collectStrings(item, seen)
  );
}

function setQueryResults(
  context: Record<string, unknown>,
  history: Record<string, unknown> | null = null
) {
  mocks.execute.mockReset();
  mocks.execute.mockResolvedValueOnce([[context]]);
  mocks.execute.mockResolvedValueOnce(history ? [[history]] : [[]]);
}

beforeEach(() => {
  vi.useRealTimers();
  _forTestOnly_clearProfessionalPatientContextMetadataCache();
  mocks.assertProfessionalResourceAccess.mockReset();
  mocks.execute.mockReset();
  mocks.getDb.mockReset();
  mocks.getProfessionalProfile.mockReset();
  mocks.logPersistenceWarning.mockReset();
  mocks.getProfessionalProfile.mockResolvedValue({ active: true });
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
  setQueryResults(defaultContext, defaultHistory);
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
      lastActivityLabel: "Revisão da meta oficial solicitada",
      nextReviewAt: Date.parse("2026-08-05T12:00:00.000Z"),
      trackingStatus: "paused",
    });
    expect(result.lastActivityAt).not.toBe(unrelatedMealActivityAt.getTime());
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const contextQueryText = collectStrings(
      mocks.execute.mock.calls[0]?.[0]
    ).join(" ");
    const historyQueryText = collectStrings(
      mocks.execute.mock.calls[1]?.[0]
    ).join(" ");
    expect(contextQueryText).not.toContain("professionalHistoryEvents");
    expect(historyQueryText).toContain(
      "ORDER BY h.occurredAt DESC, h.id DESC"
    );
    expect(historyQueryText).toContain("h.eventType");
  });

  it("reuses optional history metadata during the immediate navigation validation", async () => {
    mocks.execute.mockReset();
    mocks.execute
      .mockResolvedValueOnce([[defaultContext]])
      .mockResolvedValueOnce([[defaultHistory]])
      .mockResolvedValueOnce([[defaultContext]]);

    const first = await getProfessionalPatientContext(7, {
      patientId: 41,
      resource: "professional_record",
    });
    const second = await getProfessionalPatientContext(7, {
      patientId: 41,
      resource: "professional_record",
    });

    expect(first.lastActivityAt).toBe(professionalActivityAt.getTime());
    expect(second.lastActivityAt).toBe(professionalActivityAt.getTime());
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });

  it("does not let slow optional history metadata block the authorized context", async () => {
    vi.useFakeTimers();
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([[defaultContext]]);
    mocks.execute.mockReturnValueOnce(new Promise(() => undefined));

    const resultPromise = getProfessionalPatientContext(7, {
      patientId: 41,
      resource: "professional_record",
    });
    await vi.advanceTimersByTimeAsync(250);

    await expect(resultPromise).resolves.toMatchObject({
      patientId: 41,
      authorizationId: "authorization-1",
      lastActivityAt: null,
      lastActivityLabel: "Temporariamente indisponível",
      trackingStatus: "paused",
    });
  });

  it("retries optional history after a timed-out lookup expires", async () => {
    vi.useFakeTimers();
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([[defaultContext]]);
    mocks.execute.mockReturnValueOnce(new Promise(() => undefined));

    const firstResult = getProfessionalPatientContext(7, {
      patientId: 41,
      resource: "professional_record",
    });
    await vi.advanceTimersByTimeAsync(250);
    await expect(firstResult).resolves.toMatchObject({
      lastActivityLabel: "Temporariamente indisponível",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    mocks.execute.mockResolvedValueOnce([[defaultContext]]);
    mocks.execute.mockResolvedValueOnce([[defaultHistory]]);

    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_record",
      })
    ).resolves.toMatchObject({
      lastActivityAt: professionalActivityAt.getTime(),
      lastActivityLabel: "Revisão da meta oficial solicitada",
    });
    expect(mocks.execute).toHaveBeenCalledTimes(4);
  });

  it("does not let a stale timed-out lookup overwrite a successful retry", async () => {
    vi.useFakeTimers();
    mocks.execute.mockReset();
    let resolveStaleHistory: ((value: unknown) => void) | undefined;
    const staleHistory = new Promise(resolve => {
      resolveStaleHistory = resolve;
    });
    const freshActivityAt = new Date("2026-07-25T10:00:00.000Z");

    mocks.execute.mockResolvedValueOnce([[defaultContext]]);
    mocks.execute.mockReturnValueOnce(staleHistory);
    const firstResult = getProfessionalPatientContext(7, {
      patientId: 41,
      resource: "professional_record",
    });
    await vi.advanceTimersByTimeAsync(250);
    await expect(firstResult).resolves.toMatchObject({
      lastActivityLabel: "Temporariamente indisponível",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    mocks.execute.mockResolvedValueOnce([[defaultContext]]);
    mocks.execute.mockResolvedValueOnce([
      [
        {
          lastProfessionalActivityAt: freshActivityAt,
          lastProfessionalActivityType: "official_goal_activated",
        },
      ],
    ]);
    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_record",
      })
    ).resolves.toMatchObject({
      lastActivityAt: freshActivityAt.getTime(),
    });

    resolveStaleHistory?.([[defaultHistory]]);
    await Promise.resolve();
    await Promise.resolve();
    mocks.execute.mockResolvedValueOnce([[defaultContext]]);

    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_record",
      })
    ).resolves.toMatchObject({
      lastActivityAt: freshActivityAt.getTime(),
    });
    expect(mocks.execute).toHaveBeenCalledTimes(5);
  });

  it("returns explicit nulls when stable header metadata is absent", async () => {
    setQueryResults(
      {
        authorizationId: "authorization-1",
        patientUserId: 41,
        patientName: "Ana",
        patientEmail: "ana@example.com",
        trackingStatus: "active",
        nextReviewAt: null,
      },
      null
    );

    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_messages",
      })
    ).resolves.toMatchObject({
      authorizationStatus: "approved",
      lastActivityAt: null,
      lastActivityLabel: null,
      nextReviewAt: null,
      trackingStatus: "active",
    });
  });

  it("opens the authorized context when optional history metadata is unavailable", async () => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([[defaultContext]]);
    mocks.execute.mockRejectedValueOnce(new Error("history unavailable"));

    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_record",
      })
    ).resolves.toMatchObject({
      patientId: 41,
      authorizationId: "authorization-1",
      lastActivityAt: null,
      lastActivityLabel: "Temporariamente indisponível",
      trackingStatus: "paused",
    });
    expect(mocks.logPersistenceWarning).toHaveBeenCalledWith(
      "professional_patient_context_history",
      expect.any(Error)
    );
  });

  it("uses a safe generic label instead of exposing the patient ID", async () => {
    setQueryResults({
      authorizationId: "authorization-1",
      patientUserId: 41,
      patientName: null,
      patientEmail: null,
      trackingStatus: "active",
      nextReviewAt: null,
    });

    await expect(
      getProfessionalPatientContext(7, {
        patientId: 41,
        resource: "professional_messages",
      })
    ).resolves.toMatchObject({ displayName: "Paciente" });
  });

  it("minimizes the public context after tracking ends", async () => {
    setQueryResults({
      authorizationId: "authorization-sensitive",
      patientUserId: 41,
      patientName: "Ana",
      patientEmail: "ana@example.com",
      trackingStatus: "ended",
      nextReviewAt: new Date("2026-08-05T12:00:00.000Z"),
    });

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
    expect(result).not.toHaveProperty("lastActivityLabel");
    expect(result).not.toHaveProperty("nextReviewAt");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
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
    mocks.execute.mockReset();
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
