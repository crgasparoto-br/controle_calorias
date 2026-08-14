import { describe, expect, it, vi } from "vitest";
import { createBillingLifecycleAccessRepository } from "./billingLifecycleAccessRepository";

describe("billing lifecycle sponsored access", () => {
  it("uses the lifecycle grace horizon even when the stored coverage horizon is stale", async () => {
    const graceEndsAt = new Date("2026-08-21T12:00:00.000Z");
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          {
            sourceId: "professional-authorization:auth-1",
            validFrom: new Date("2026-07-01T00:00:00.000Z"),
            sponsorUserId: 10,
            planCode: "professional",
            entitlementsJson: JSON.stringify(["system_access"]),
            sponsorValidUntil: graceEndsAt,
          },
        ],
      ])
      .mockResolvedValueOnce([[]]);
    const db = { execute, transaction: vi.fn() } as any;
    const baseline = {
      listAccessCandidates: vi.fn().mockResolvedValue([
        {
          reason: "sponsored_by_professional",
          sourceId: "legacy-should-be-removed",
          entitlements: [],
        },
      ]),
      getOwnSubscription: vi.fn(),
      getActiveProfessionalSubscription: vi.fn(),
    } as any;
    const repository = createBillingLifecycleAccessRepository(
      { getDb: async () => db, onWarning: vi.fn() },
      baseline
    );

    const result = await repository.listAccessCandidates(
      20,
      new Date("2026-08-14T12:00:00.000Z")
    );
    const sponsored = result.find(
      candidate => candidate.reason === "sponsored_by_professional"
    );

    expect(sponsored?.sourceId).toBe("professional-authorization:auth-1");
    expect(sponsored?.validUntil).toEqual(graceEndsAt);
    expect(result.some(item => item.sourceId === "legacy-should-be-removed")).toBe(
      false
    );

    const canonicalQuery = JSON.stringify(execute.mock.calls[1]?.[0]);
    expect(canonicalQuery).not.toContain("entitlementValidUntil");
    expect(canonicalQuery).not.toContain("e.validUntil");
  });
});
