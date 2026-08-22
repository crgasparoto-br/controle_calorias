import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() =>
  vi.fn(async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) =>
    callback({ execute })
  )
);

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({ execute, transaction })),
}));

import { getProfessionalCapacityWebSnapshot } from "./professionalCapacityRead";

describe("professional capacity web snapshot", () => {
  beforeEach(() => {
    execute.mockReset();
    transaction.mockClear();
  });

  it("returns the confirmed 30-day extension horizon, canonical milestones and commercial review", async () => {
    execute
      .mockResolvedValueOnce([[{ contractedLimit: 30, occupancy: 120 }]])
      .mockResolvedValueOnce([
        [
          {
            effectiveAt: new Date("2026-05-24T00:00:00.000Z"),
            payloadJson: JSON.stringify({
              windowKey: "capacity-window-1",
              temporaryLimit: 120,
              endsAt: "2026-08-22T00:00:00.000Z",
            }),
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          {
            payloadJson: JSON.stringify({
              temporaryLimit: 120,
              endsAt: "2026-09-21T00:00:00.000Z",
            }),
          },
        ],
      ])
      .mockResolvedValueOnce([[{ id: "alert-1" }]]);

    const result = await getProfessionalCapacityWebSnapshot({
      subscriptionId: "subscription-pro",
      payerUserId: 12,
      now: new Date("2026-08-22T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      contractedLimit: 30,
      occupancy: 120,
      excess: 90,
      temporaryLimit: 120,
      temporaryWindowKind: "extension",
      temporaryWindowDays: 30,
      commercialAnalysisRequired: true,
      newCoverageBlocked: true,
    });
    expect(result?.warningMilestones.map(item => item.key)).toEqual([
      "started",
      "d15",
      "d7",
      "expired",
    ]);
    expect(result?.warningMilestones[0]?.dueAt.toISOString()).toBe(
      "2026-08-22T00:00:00.000Z"
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});