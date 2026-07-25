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

function collectStrings(value: unknown, seen = new WeakSet<object>()): string[] {
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

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.getDb.mockReset();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
});

describe("getProfessionalRecord authorship", () => {
  it("joins and returns the author of assessments, notes and guidances", async () => {
    mocks.execute
      .mockResolvedValueOnce([
        [
          {
            authorizationId: "authorization-1",
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
            assessedAt: new Date("2026-07-20T12:00:00Z"),
            nextReviewAt: null,
            createdAt: new Date("2026-07-20T12:00:00Z"),
            authorName: "Nutricionista Autora",
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: "assessment-history",
            version: 1,
            objective: "Objetivo anterior",
            assessedAt: new Date("2026-06-20T12:00:00Z"),
            nextReviewAt: null,
            createdAt: new Date("2026-06-20T12:00:00Z"),
            authorName: "Nutricionista Autora",
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: "note-1",
            content: "Nota privada",
            createdAt: new Date("2026-07-21T12:00:00Z"),
            updatedAt: new Date("2026-07-21T12:00:00Z"),
            authorName: "Nutricionista Autora",
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: "guidance-1",
            version: 1,
            title: "Orientação",
            content: "Conteúdo",
            visibility: "patient",
            deliveryStatus: "sent",
            supersedesGuidanceId: null,
            createdAt: new Date("2026-07-22T12:00:00Z"),
            authorName: "Nutricionista Autora",
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const result = await getProfessionalRecord(11, {
      patientId: 22,
      page: 1,
      pageSize: 20,
    });

    expect(result.latestAssessment?.authorName).toBe("Nutricionista Autora");
    expect(result.assessmentHistory[0]?.authorName).toBe("Nutricionista Autora");
    expect(result.notes[0]?.authorName).toBe("Nutricionista Autora");
    expect(result.guidances[0]?.authorName).toBe("Nutricionista Autora");

    for (const callIndex of [1, 2, 3]) {
      const queryText = collectStrings(
        mocks.execute.mock.calls[callIndex]?.[0]
      ).join(" ");
      expect(queryText).toContain("professionalProfiles");
      expect(queryText).toContain("authorName");
    }
  });
});
