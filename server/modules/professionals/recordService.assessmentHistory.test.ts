import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  logPersistenceWarning: vi.fn(),
}));

import { getProfessionalRecord } from "./recordService";
import { professionalRecordOutputSchema } from "./schemas";

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.getDb.mockReset();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
});

describe("getProfessionalRecord assessment history", () => {
  it("returns the complete fields from each persisted historical version without borrowing from latestAssessment", async () => {
    mocks.execute
      .mockResolvedValueOnce([
        [
          {
            authorizationId: "authorization-1039",
            authorizationStatus: "approved",
            trackingStatus: "active",
            patientName: "Paciente",
            patientEmail: "paciente@example.com",
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: "assessment-latest",
            version: 2,
            objective: "Objetivo atual",
            weightKg: 82,
            heightCm: 181,
            routineAndSchedule: "Rotina atual",
            physicalActivity: "Corrida atual",
            foodPreferences: "Preferência atual",
            restrictionsAndAllergies: "Restrição atual",
            reportedDifficulties: "Dificuldade atual",
            relevantHabits: "Hábito atual",
            professionalObservations: "Observação atual",
            assessedAt: new Date("2026-08-20T12:00:00Z"),
            nextReviewAt: new Date("2026-09-20T12:00:00Z"),
            createdAt: new Date("2026-08-20T12:00:00Z"),
            authorName: "Nutricionista Atual",
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: "assessment-history",
            version: 1,
            objective: "Objetivo histórico",
            weightKg: 74,
            heightCm: 179,
            routineAndSchedule: "Rotina histórica",
            physicalActivity: null,
            foodPreferences: "Preferência histórica",
            restrictionsAndAllergies: null,
            reportedDifficulties: "Dificuldade histórica",
            relevantHabits: null,
            professionalObservations: "Observação histórica",
            assessedAt: new Date("2026-07-20T12:00:00Z"),
            nextReviewAt: null,
            createdAt: new Date("2026-07-20T12:00:00Z"),
            authorName: "Nutricionista Histórica",
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const result = await getProfessionalRecord(11, {
      patientId: 22,
      page: 1,
      pageSize: 20,
    });

    expect(result.latestAssessment?.physicalActivity).toBe("Corrida atual");
    expect(result.assessmentHistory[0]).toEqual({
      id: "assessment-history",
      version: 1,
      objective: "Objetivo histórico",
      weightKg: 74,
      heightCm: 179,
      routineAndSchedule: "Rotina histórica",
      physicalActivity: null,
      foodPreferences: "Preferência histórica",
      restrictionsAndAllergies: null,
      reportedDifficulties: "Dificuldade histórica",
      relevantHabits: null,
      professionalObservations: "Observação histórica",
      assessedAt: new Date("2026-07-20T12:00:00Z").getTime(),
      nextReviewAt: null,
      createdAt: new Date("2026-07-20T12:00:00Z").getTime(),
      authorName: "Nutricionista Histórica",
    });
    expect(result.assessmentHistory[0]?.physicalActivity).not.toBe(
      result.latestAssessment?.physicalActivity
    );
    expect(() => professionalRecordOutputSchema.parse(result)).not.toThrow();
  });

  it("does not query assessment versions after tracking has ended", async () => {
    mocks.execute
      .mockResolvedValueOnce([
        [
          {
            authorizationId: "authorization-ended",
            trackingStatus: "ended",
            patientName: "Paciente",
            patientEmail: "paciente@example.com",
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const result = await getProfessionalRecord(11, {
      patientId: 22,
      page: 1,
      pageSize: 20,
    });

    expect(mocks.execute).toHaveBeenCalledTimes(3);
    expect(result.latestAssessment).toBeNull();
    expect(result.assessmentHistory).toEqual([]);
    expect(() => professionalRecordOutputSchema.parse(result)).not.toThrow();
  });
});
