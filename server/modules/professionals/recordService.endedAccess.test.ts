import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), execute: vi.fn() }));
vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  logPersistenceWarning: vi.fn(),
}));

import { getProfessionalRecord } from "./recordService";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
});

describe("professional record ended tracking boundary", () => {
  it("queries only the audit timeline and returns a minimal public patient contract", async () => {
    mocks.execute
      .mockResolvedValueOnce([
        {
          authorizationId: "authorization-sensitive",
          authorizationStatus: "approved",
          trackingStatus: "ended",
          patientName: "Ana Sensível",
          patientEmail: "ana@example.com",
        },
      ])
      .mockResolvedValueOnce([
        [
          {
            id: "event-1",
            eventType: "tracking_ended",
            occurredAt: new Date("2026-07-24T15:30:00.000Z"),
          },
        ],
      ])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const result = await getProfessionalRecord(7, {
      patientId: 41,
      page: 1,
      pageSize: 20,
    });

    expect(mocks.execute).toHaveBeenCalledTimes(3);
    expect(result.patient).toEqual({
      id: 41,
      authorizationStatus: "approved",
      trackingStatus: "ended",
    });
    expect(result.patient).not.toHaveProperty("authorizationId");
    expect(result.patient).not.toHaveProperty("name");
    expect(result.patient).not.toHaveProperty("email");
    expect(result.latestAssessment).toBeNull();
    expect(result.assessmentHistory).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.guidances).toEqual([]);
    expect(result.timeline).toEqual([
      {
        id: "event-1",
        eventType: "tracking_ended",
        label: "Acompanhamento encerrado",
        occurredAt: Date.parse("2026-07-24T15:30:00.000Z"),
      },
    ]);
    expect(result.pagination.totals).toEqual({
      assessments: 0,
      notes: 0,
      guidances: 0,
      timeline: 1,
    });
  });
});
