const DAY_MS = 24 * 60 * 60 * 1000;

export const PROFESSIONAL_CAPACITY_LIMIT = 30;
export const PROFESSIONAL_PLUS_CAPACITY_LIMIT = 100;
export const PROFESSIONAL_TRIAL_CAPACITY_LIMIT = 5;
export const PROFESSIONAL_COVERAGE_TRANSITION_DAYS = 7;
export const PROFESSIONAL_COVERAGE_TRANSITION_COOLDOWN_DAYS = 365;
export const PROFESSIONAL_CAPACITY_GRANDFATHER_DAYS = 90;
export const PROFESSIONAL_CAPACITY_EXTENSION_DAYS = 30;
export const PROFESSIONAL_CAPACITY_EXPIRING_DAYS = 15;
export const PROFESSIONAL_CAPACITY_WARNING_DAYS = [60, 30, 15, 7, 0] as const;

export type ProfessionalCapacityState =
  | "within_capacity"
  | "grandfathered_active"
  | "grandfathered_expiring"
  | "grandfathered_expired"
  | "grandfathered_resolved";

export type ProfessionalCapacityAlertKind =
  | "capacity_exceeded"
  | "catalog_range_review_required";

export type ProfessionalCapacityAlertPriority = "normal" | "high";

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

export function professionalCoverageTransitionEndsAt(grantedAt: Date) {
  return addDays(grantedAt, PROFESSIONAL_COVERAGE_TRANSITION_DAYS);
}

export function professionalCoverageTransitionCooldownEndsAt(grantedAt: Date) {
  return addDays(grantedAt, PROFESSIONAL_COVERAGE_TRANSITION_COOLDOWN_DAYS);
}

export function canGrantProfessionalCoverageTransition(input: {
  now: Date;
  lastGrantedAt?: Date | null;
}) {
  if (!input.lastGrantedAt) return true;
  return (
    input.now.getTime() >=
    professionalCoverageTransitionCooldownEndsAt(input.lastGrantedAt).getTime()
  );
}

export function professionalCapacityGrandfatherEndsAt(startedAt: Date) {
  return addDays(startedAt, PROFESSIONAL_CAPACITY_GRANDFATHER_DAYS);
}

export function professionalCapacityExtensionEndsAt(startsAt: Date) {
  return addDays(startsAt, PROFESSIONAL_CAPACITY_EXTENSION_DAYS);
}

export function professionalCapacityState(input: {
  occupancy: number;
  contractedLimit: number;
  grandfatheredAt?: Date | null;
  endsAt?: Date | null;
  now: Date;
}): ProfessionalCapacityState {
  if (input.occupancy <= input.contractedLimit) {
    return input.grandfatheredAt ? "grandfathered_resolved" : "within_capacity";
  }
  if (!input.grandfatheredAt || !input.endsAt) return "grandfathered_active";
  if (input.now.getTime() >= input.endsAt.getTime()) {
    return "grandfathered_expired";
  }
  if (
    input.now.getTime() >=
    addDays(input.endsAt, -PROFESSIONAL_CAPACITY_EXPIRING_DAYS).getTime()
  ) {
    return "grandfathered_expiring";
  }
  return "grandfathered_active";
}

export type ProfessionalCapacityWarningMilestone = {
  key: "started" | "d60" | "d30" | "d15" | "d7" | "expired";
  dueAt: Date;
  daysRemaining: number;
};

export function professionalCapacityWarningMilestones(input: {
  startedAt: Date;
  endsAt: Date;
}): ProfessionalCapacityWarningMilestone[] {
  return [
    { key: "started", dueAt: input.startedAt, daysRemaining: 90 },
    ...PROFESSIONAL_CAPACITY_WARNING_DAYS.map(daysRemaining => ({
      key: (daysRemaining === 0 ? "expired" : `d${daysRemaining}`) as
        | "d60"
        | "d30"
        | "d15"
        | "d7"
        | "expired",
      dueAt: addDays(input.endsAt, -daysRemaining),
      daysRemaining,
    })),
  ];
}

export function dueProfessionalCapacityWarnings(input: {
  startedAt: Date;
  endsAt: Date;
  now: Date;
  emittedKeys?: Iterable<string>;
}) {
  const emitted = new Set(input.emittedKeys ?? []);
  return professionalCapacityWarningMilestones(input).filter(
    milestone =>
      milestone.dueAt.getTime() <= input.now.getTime() &&
      !emitted.has(milestone.key)
  );
}

export function professionalCapacityAlert(input: {
  occupancy: number;
  contractedLimit: number;
  highestPublicCapacity: number | null;
}): {
  kind: ProfessionalCapacityAlertKind;
  priority: ProfessionalCapacityAlertPriority;
} | null {
  if (input.occupancy <= input.contractedLimit) return null;
  if (
    input.highestPublicCapacity !== null &&
    input.occupancy > input.highestPublicCapacity
  ) {
    return { kind: "catalog_range_review_required", priority: "high" };
  }
  return { kind: "capacity_exceeded", priority: "normal" };
}

export function canAddProfessionalCoverage(input: {
  occupancy: number;
  contractedLimit: number;
  capacityState: ProfessionalCapacityState;
}) {
  if (input.capacityState !== "within_capacity") return false;
  return input.occupancy < input.contractedLimit;
}
