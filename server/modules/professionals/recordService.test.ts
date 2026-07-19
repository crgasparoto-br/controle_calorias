import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
const logPersistenceWarning = vi.fn();
vi.mock("../../db", () => ({ getDb, logPersistenceWarning }));

import {
  createProfessionalGuidance,
  createProfessionalNote,
  getProfessionalRecord,
  saveProfessionalAssessment,
} from "./recordService";

function scopeRow(overrides: Record<string, unknown> = {}) {
  return {
    authorizationId: "access-1",
    authorizationStatus: "approved",
    trackingStatus: "active",
    patientName: "Ana",
    patientEmail: "ana@example.com",
    ...overrides,
  };
}

describe("professional record service", () => {
  beforeEach(() => {
    getDb.mockReset();
    logPersistenceWarning.mockReset();
  });

  it("rejects access when the patient is not authorized for the professional", async () => {
    getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue([]) });
    await expect(
      getProfessionalRecord(10, { patientId: 20, page: 1, pageSize: 20 })
    ).rejects.toThrow("O acesso a este paciente não está mais disponível.");
  });

  it("returns only the explicitly selected patient scope with limited lists", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([scopeRow()])
      .mockResolvedValueOnce([[{ id: "assessment-2", version: 2, objective: "Reduzir gordura", assessedAt: new Date() }]])
      .mockResolvedValueOnce([[{ id: "assessment-2", version: 2, objective: "Reduzir gordura", assessedAt: new Date() }]])
      .mockResolvedValueOnce([[{ id: "note-1", content: "Privada", createdAt: new Date(), updatedAt: new Date() }]])
      .mockResolvedValueOnce([[{ id: "guidance-1", version: 1, title: "Rotina", content: "Orientação", visibility: "patient", deliveryStatus: "pending", createdAt: new Date() }]])
      .mockResolvedValueOnce([[{ id: "event-1", eventType: "guidance_created", occurredAt: new Date() }]]);
    getDb.mockResolvedValue({ execute });

    const result = await getProfessionalRecord(10, { patientId: 20, page: 1, pageSize: 20 });

    expect(result.patient.id).toBe(20);
    expect(result.patient.trackingStatus).toBe("active");
    expect(result.latestAssessment?.version).toBe(2);
    expect(result.notes[0]?.content).toBe("Privada");
    expect(result.guidances[0]?.visibility).toBe("patient");
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it("blocks interventions while the tracking is paused", async () => {
    getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue([scopeRow({ trackingStatus: "paused" })]) });

    await expect(createProfessionalNote(10, { patientId: 20, content: "nota" })).rejects.toThrow(
      "Esta ação está disponível somente durante acompanhamento ativo."
    );
    await expect(
      createProfessionalGuidance(10, {
        patientId: 20,
        title: "Orientação",
        content: "Conteúdo",
        deliveryStatus: "draft",
      })
    ).rejects.toThrow("Esta ação está disponível somente durante acompanhamento ativo.");
  });

  it("creates a new immutable assessment version and audit event", async () => {
    const scopeExecute = vi.fn().mockResolvedValue([scopeRow()]);
    const txExecute = vi
      .fn()
      .mockResolvedValueOnce([[{ nextVersion: 3 }]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    getDb.mockResolvedValue({
      execute: scopeExecute,
      transaction: (callback: (tx: { execute: typeof txExecute }) => unknown) => callback({ execute: txExecute }),
    });

    await expect(
      saveProfessionalAssessment(10, {
        patientId: 20,
        objective: "Melhorar composição corporal",
        assessedAt: Date.now(),
      })
    ).resolves.toEqual({ id: expect.any(String) });
    expect(txExecute).toHaveBeenCalledTimes(4);
  });
});
