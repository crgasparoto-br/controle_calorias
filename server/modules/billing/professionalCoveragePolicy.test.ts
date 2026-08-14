import { describe, expect, it } from "vitest";
import {
  canAddProfessionalCoverage,
  canGrantProfessionalCoverageTransition,
  dueProfessionalCapacityWarnings,
  professionalCapacityAlert,
  professionalCapacityExtensionEndsAt,
  professionalCapacityGrandfatherEndsAt,
  professionalCapacityState,
  professionalCoverageTransitionEndsAt,
} from "./professionalCoveragePolicy";

describe("professional coverage policy", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 0, day, 12));

  it("keeps canonical capacity boundaries deterministic", () => {
    expect(
      professionalCapacityState({
        occupancy: 30,
        contractedLimit: 30,
        now: at(1),
      })
    ).toBe("within_capacity");

    const startedAt = at(1);
    const endsAt = professionalCapacityGrandfatherEndsAt(startedAt);
    expect(
      professionalCapacityState({
        occupancy: 31,
        contractedLimit: 30,
        grandfatheredAt: startedAt,
        endsAt,
        now: at(2),
      })
    ).toBe("grandfathered_active");
    expect(
      professionalCapacityState({
        occupancy: 31,
        contractedLimit: 30,
        grandfatheredAt: startedAt,
        endsAt,
        now: new Date(endsAt.getTime() - 7 * 86_400_000),
      })
    ).toBe("grandfathered_expiring");
    expect(
      professionalCapacityState({
        occupancy: 31,
        contractedLimit: 30,
        grandfatheredAt: startedAt,
        endsAt,
        now: endsAt,
      })
    ).toBe("grandfathered_expired");
    expect(
      professionalCapacityState({
        occupancy: 30,
        contractedLimit: 30,
        grandfatheredAt: startedAt,
        endsAt,
        now: at(2),
      })
    ).toBe("grandfathered_resolved");
  });

  it("never lets grandfathering increase the new-admission limit", () => {
    expect(
      canAddProfessionalCoverage({
        occupancy: 31,
        contractedLimit: 30,
        capacityState: "grandfathered_active",
      })
    ).toBe(false);
    expect(
      canAddProfessionalCoverage({
        occupancy: 29,
        contractedLimit: 30,
        capacityState: "within_capacity",
      })
    ).toBe(true);
  });

  it("emits the required 90-day warning milestones once they are due", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const endsAt = professionalCapacityGrandfatherEndsAt(startedAt);
    const due = dueProfessionalCapacityWarnings({
      startedAt,
      endsAt,
      now: new Date(endsAt.getTime() - 7 * 86_400_000),
      emittedKeys: ["started", "d60", "d30", "d15"],
    });
    expect(due.map(item => item.key)).toEqual(["d7"]);
  });

  it("grants one seven-day transition per rolling twelve-month window", () => {
    const first = new Date("2026-01-01T00:00:00.000Z");
    expect(professionalCoverageTransitionEndsAt(first).toISOString()).toBe(
      "2026-01-08T00:00:00.000Z"
    );
    expect(
      canGrantProfessionalCoverageTransition({
        now: new Date("2026-12-31T23:59:59.999Z"),
        lastGrantedAt: first,
      })
    ).toBe(false);
    expect(
      canGrantProfessionalCoverageTransition({
        now: new Date("2027-01-01T00:00:00.000Z"),
        lastGrantedAt: first,
      })
    ).toBe(true);
  });

  it("uses high priority when occupancy is outside the public catalog range", () => {
    expect(
      professionalCapacityAlert({
        occupancy: 101,
        contractedLimit: 30,
        highestPublicCapacity: 100,
      })
    ).toEqual({
      kind: "catalog_range_review_required",
      priority: "high",
    });
    expect(
      professionalCapacityAlert({
        occupancy: 45,
        contractedLimit: 30,
        highestPublicCapacity: 100,
      })
    ).toEqual({ kind: "capacity_exceeded", priority: "normal" });
  });

  it("creates finite 90-day and 30-day calendar windows", () => {
    const start = new Date("2026-04-01T10:00:00.000Z");
    expect(professionalCapacityGrandfatherEndsAt(start).toISOString()).toBe(
      "2026-06-30T10:00:00.000Z"
    );
    expect(professionalCapacityExtensionEndsAt(start).toISOString()).toBe(
      "2026-05-01T10:00:00.000Z"
    );
  });
});
