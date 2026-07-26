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
      .mockResolvedValueOnce([
        [
          {
            id: "history-1",
            eventType: "private_note_created",
            entityType: "note",
            entityId: "note-1",
            occurredAt: new Date("2026-07-22T12:00:00Z"),
          },
        ],
      ])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const result = await getProfessionalRecord(11, {
      patientId: 22,
      page: 1,
      pageSize: 20,
    });

    expect(result.latestAssessment?.authorName).toBe("Nutricionista Autora");
    expect(result.assessmentHistory[0]?.authorName).toBe(
      "Nutricionista Autora"
    );
    expect(result.notes[0]?.authorName).toBe("Nutricionista Autora");
    expect(result.guidances[0]?.authorName).toBe("Nutricionista Autora");
    expect(result.timeline[0]).toEqual({
      id: "history-1",
      eventType: "private_note_created",
      occurredAt: new Date("2026-07-22T12:00:00Z").getTime(),
    });
    expect(result.timeline[0]).not.toHaveProperty("entityType");
    expect(result.timeline[0]).not.toHaveProperty("entityId");

    for (const callIndex of [1, 2, 3]) {
      const queryText = collectStrings(
        mocks.execute.mock.calls[callIndex]?.[0]
      ).join(" ");
      expect(queryText).toContain("professionalProfiles");
      expect(queryText).toContain("authorName");
    }
  });

  it("returns only paginated audit history after tracking is ended", async () => {
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
      .mockResolvedValueOnce([
        [{ id: "assessment-latest", objective: "Sensitive" }],
      ])
      .mockResolvedValueOnce([
        [{ id: "assessment-history", objective: "Sensitive" }],
      ])
      .mockResolvedValueOnce([[{ id: "note-sensitive", content: "Sensitive" }]])
      .mockResolvedValueOnce([
        [{ id: "guidance-sensitive", content: "Sensitive" }],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: "history-ended",
            eventType: "tracking_ended",
            entityType: "tracking",
            entityId: "internal-id",
            occurredAt: new Date("2026-07-23T12:00:00Z"),
          },
        ],
      ])
      .mockResolvedValueOnce([[{ total: 25 }]])
      .mockResolvedValueOnce([[{ total: 25 }]])
      .mockResolvedValueOnce([[{ total: 25 }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const result = await getProfessionalRecord(11, {
      patientId: 22,
      page: 1,
      pageSize: 20,
    });

    expect(result.latestAssessment).toBeNull();
    expect(result.assessmentHistory).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.guidances).toEqual([]);
    expect(result.timeline).toEqual([
      {
        id: "history-ended",
        eventType: "tracking_ended",
        occurredAt: new Date("2026-07-23T12:00:00Z").getTime(),
      },
    ]);
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 20,
      totals: { assessments: 0, notes: 0, guidances: 0, timeline: 1 },
      hasMore: false,
    });
  });
});
