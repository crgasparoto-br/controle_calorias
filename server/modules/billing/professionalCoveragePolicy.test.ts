import { describe, expect, it } from "vitest";
import {
  canAddProfessionalCoverage,
  canGrantProfessionalCoverageTransition,
  dueProfessionalCapacityAlertEvents,
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

  it("does not backfill impossible warning milestones for a 30-day extension horizon", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const extensionStartsAt = professionalCapacityGrandfatherEndsAt(startedAt);
    const endsAt = professionalCapacityExtensionEndsAt(extensionStartsAt);

    expect(
      dueProfessionalCapacityWarnings({
        startedAt,
        endsAt,
        now: new Date(extensionStartsAt.getTime() - 86_400_000),
      })
    ).toEqual([]);

    const atStart = dueProfessionalCapacityWarnings({
      startedAt,
      endsAt,
      now: extensionStartsAt,
    });
    expect(atStart.map(item => [item.key, item.daysRemaining])).toEqual([
      ["started", 30],
    ]);
    expect(atStart.some(item => item.key === "d60")).toBe(false);
    expect(atStart.some(item => item.key === "d30")).toBe(false);
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

  it("reopens the persisted alert exactly once when occupancy crosses the public catalog range", () => {
    const events = dueProfessionalCapacityAlertEvents({
      occupancy: 101,
      contractedLimit: 30,
      highestPublicCapacity: 100,
      capacityState: "grandfathered_active",
      windowEndsAt: new Date("2026-12-01T00:00:00.000Z"),
      hasExistingAlert: true,
      existingEventKeys: ["initial_exceeded_capacity"],
    });

    expect(events).toEqual([
      {
        kind: "catalog_range_review_required",
        priority: "high",
        trigger: "catalog_range_crossed",
        eventKey: "catalog_range_review_required:100",
      },
    ]);

    expect(
      dueProfessionalCapacityAlertEvents({
        occupancy: 101,
        contractedLimit: 30,
        highestPublicCapacity: 100,
        capacityState: "grandfathered_active",
        windowEndsAt: new Date("2026-12-01T00:00:00.000Z"),
        hasExistingAlert: true,
        existingEventKeys: [
          "initial_exceeded_capacity",
          "catalog_range_review_required:100",
        ],
      })
    ).toEqual([]);
  });

  it("does not reopen an alert that started already above the public catalog range", () => {
    const initial = dueProfessionalCapacityAlertEvents({
      occupancy: 101,
      contractedLimit: 30,
      highestPublicCapacity: 100,
      capacityState: "grandfathered_active",
      windowEndsAt: new Date("2026-12-01T00:00:00.000Z"),
      hasExistingAlert: false,
    });
    expect(initial).toEqual([
      {
        kind: "catalog_range_review_required",
        priority: "high",
        trigger: "initial_exceeded_capacity",
        eventKey: "catalog_range_review_required:100",
      },
    ]);

    expect(
      dueProfessionalCapacityAlertEvents({
        occupancy: 101,
        contractedLimit: 30,
        highestPublicCapacity: 100,
        capacityState: "grandfathered_active",
        windowEndsAt: new Date("2026-12-01T00:00:00.000Z"),
        hasExistingAlert: true,
        existingEventKeys: ["catalog_range_review_required:100"],
      })
    ).toEqual([]);
  });

  it("reopens the persisted alert once per unresolved expiry horizon", () => {
    const firstEndsAt = new Date("2026-07-01T00:00:00.000Z");
    const firstExpiryKey = `grandfathering_expired:${firstEndsAt.toISOString()}`;

    expect(
      dueProfessionalCapacityAlertEvents({
        occupancy: 45,
        contractedLimit: 30,
        highestPublicCapacity: 100,
        capacityState: "grandfathered_expired",
        windowEndsAt: firstEndsAt,
        hasExistingAlert: true,
        existingEventKeys: ["initial_exceeded_capacity"],
      })
    ).toEqual([
      {
        kind: "capacity_exceeded",
        priority: "normal",
        trigger: "grandfathering_expired",
        eventKey: firstExpiryKey,
      },
    ]);

    expect(
      dueProfessionalCapacityAlertEvents({
        occupancy: 45,
        contractedLimit: 30,
        highestPublicCapacity: 100,
        capacityState: "grandfathered_expired",
        windowEndsAt: firstEndsAt,
        hasExistingAlert: true,
        existingEventKeys: ["initial_exceeded_capacity", firstExpiryKey],
      })
    ).toEqual([]);

    const extendedEndsAt = new Date("2026-07-31T00:00:00.000Z");
    expect(
      dueProfessionalCapacityAlertEvents({
        occupancy: 45,
        contractedLimit: 30,
        highestPublicCapacity: 100,
        capacityState: "grandfathered_expired",
        windowEndsAt: extendedEndsAt,
        hasExistingAlert: true,
        existingEventKeys: ["initial_exceeded_capacity", firstExpiryKey],
      })
    ).toEqual([
      {
        kind: "capacity_exceeded",
        priority: "normal",
        trigger: "grandfathering_expired",
        eventKey: `grandfathering_expired:${extendedEndsAt.toISOString()}`,
      },
    ]);
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
