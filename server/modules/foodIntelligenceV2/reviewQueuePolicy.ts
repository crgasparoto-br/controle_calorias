import {
  addCalendarDays,
  getDateKeyInTimeZone,
  getWeekDateKeys,
  isValidIanaTimeZone,
} from "../../../shared/timeZone";

// ADR §14/§25 item 6: initial policy, not empirical calibration or activation.
export const REVIEW_QUEUE_POLICY_VERSION = "adr-2026-10-05-v1";
const WINDOW_DAYS = 90;
const WEEKLY_MINUTES = 60;
const DAY_MS = 86_400_000;

type Severity = 1 | 2 | 3 | 4 | 5;
type EffortCondition =
  | "ambiguous_identity"
  | "missing_profile"
  | "missing_canonical_portion"
  | "conflicting_sources"
  | "materiality_judgment";
type ReadyEvidence =
  | "associated_useful_label_barcode_or_package"
  | "unambiguous_useful_official_source";

// Null inputs mean not established, not zero (including lists: [] means checked none).
// This module never derives scope, evidence or severity from a description or a live request.
type EstablishedReviewFactors = Readonly<{
  affectedUsers90d: number | null;
  occurrences90d: number | null;
  severity: Severity | null;
  scope: "personal" | "global" | null;
  effort: readonly EffortCondition[] | null;
  readyEvidence: readonly ReadyEvidence[] | null;
}>;

type ReviewQueueCase = Readonly<{
  id: number;
  cycleOpenedAtMs: number;
  recordedDeadlineDate: string | null;
  factors: EstablishedReviewFactors | null;
}>;

function nonnegativeCount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function nonnegativeMinutes(value: number | null) {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

export function getReviewPriorityBand(score: number) {
  if (!Number.isFinite(score) || score < 0)
    throw new RangeError("Invalid review score");
  if (score >= 12) return { band: "critical", targetDays: 7 } as const;
  if (score >= 6) return { band: "high", targetDays: 14 } as const;
  if (score >= 2) return { band: "medium", targetDays: 30 } as const;
  return { band: "low", targetDays: null } as const;
}

function evaluateReviewPriority(review: ReviewQueueCase, asOfMs: number) {
  const source = review.factors;
  const base = {
    policyVersion: REVIEW_QUEUE_POLICY_VERSION,
    windowDays: WINDOW_DAYS,
    asOfMs,
  };
  if (
    source === null ||
    !nonnegativeCount(source.affectedUsers90d) ||
    !nonnegativeCount(source.occurrences90d) ||
    !source.severity ||
    ![1, 2, 3, 4, 5].includes(source.severity) ||
    (source.scope !== "personal" && source.scope !== "global") ||
    source.effort === null ||
    source.readyEvidence === null
  ) {
    return { ...base, status: "pending_assessment" } as const;
  }
  const A = source.affectedUsers90d;
  const F = source.occurrences90d;
  const G = source.severity;
  const R = source.scope === "global" ? 2 : 1;
  const E = new Set(source.effort).size;
  const Ev = source.readyEvidence.includes(
    "associated_useful_label_barcode_or_package"
  )
    ? 2
    : source.readyEvidence.includes("unambiguous_useful_official_source")
      ? 1
      : 0;
  const D = Math.min(
    1,
    Math.max(0, (asOfMs - review.cycleOpenedAtMs) / (30 * DAY_MS))
  );
  const impact = Math.log10(1 + A) * G * R * Math.log10(1 + F);
  const cost = Math.max(0.5, Math.min(5, 1 + E - Ev));
  const score = (impact / cost) * (1 + D);
  return {
    ...base,
    status: "ranked",
    factors: { A, F, G, R, E, Ev, D },
    score,
    ...getReviewPriorityBand(score),
  } as const;
}

function assertValidInstant(ms: number) {
  if (!Number.isSafeInteger(ms) || !Number.isFinite(new Date(ms).getTime())) {
    throw new RangeError("Invalid review instant");
  }
}

/**
 * Projects active case cycles from caller-supplied evidence, exclusively as data.
 * Local calendar target dates are inclusive, not promised SLAs or storage timestamps.
 * Capacity is observed/estimated minutes supplied for the current civil week,
 * never inferred from effort points; this function neither selects nor completes work.
 */
export function projectReviewQueue(
  input: Readonly<{
    cases: readonly ReviewQueueCase[];
    asOfMs: number;
    timeZone: string;
    spentMinutesThisWeek: number | null;
    outstandingDemandMinutes: number | null;
  }>
) {
  const { asOfMs, timeZone, spentMinutesThisWeek, outstandingDemandMinutes } =
    input;
  if (!isValidIanaTimeZone(timeZone))
    throw new RangeError("Missing or invalid operational time zone");
  assertValidInstant(asOfMs);
  const asOfDate = getDateKeyInTimeZone(asOfMs, timeZone);
  const weekStartDate = getWeekDateKeys(asOfMs, timeZone)[0];
  const seenIds = new Set<number>();

  const entries = input.cases.map(review => {
    if (
      !Number.isSafeInteger(review.id) ||
      review.id <= 0 ||
      seenIds.has(review.id)
    ) {
      throw new RangeError("Invalid or duplicate review case ID");
    }
    seenIds.add(review.id);
    assertValidInstant(review.cycleOpenedAtMs);
    const evaluation = evaluateReviewPriority(review, asOfMs);
    const deadline =
      review.recordedDeadlineDate === null
        ? null
        : addCalendarDays(review.recordedDeadlineDate, 0);
    const proposed =
      evaluation.status === "ranked" && evaluation.targetDays !== null
        ? addCalendarDays(
            getDateKeyInTimeZone(review.cycleOpenedAtMs, timeZone),
            evaluation.targetDays
          )
        : null;
    const deadlineDate =
      proposed !== null && (deadline === null || proposed < deadline)
        ? proposed
        : deadline;
    return {
      id: review.id,
      cycleOpenedAtMs: review.cycleOpenedAtMs,
      deadlineDate,
      overdue: deadlineDate !== null && asOfDate > deadlineDate,
      evaluation,
    };
  });
  const ranked = entries
    .flatMap(entry =>
      entry.evaluation.status === "ranked"
        ? [{ ...entry, evaluation: entry.evaluation }]
        : []
    )
    .sort(
      (a, b) =>
        b.evaluation.score - a.evaluation.score ||
        b.evaluation.factors.G - a.evaluation.factors.G ||
        a.cycleOpenedAtMs - b.cycleOpenedAtMs ||
        a.id - b.id
    );
  const pendingAssessment = entries
    .flatMap(entry =>
      entry.evaluation.status === "pending_assessment"
        ? [{ ...entry, evaluation: entry.evaluation }]
        : []
    )
    .sort((a, b) => a.id - b.id);

  const spent = nonnegativeMinutes(spentMinutesThisWeek);
  const outstanding = nonnegativeMinutes(outstandingDemandMinutes);
  const remainingMinutes =
    spent === null ? null : Math.max(0, WEEKLY_MINUTES - spent);
  // Either known component alone can establish overload; lack of evidence cannot clear it.
  const exceedsCapacity =
    (spent !== null && spent > WEEKLY_MINUTES) ||
    (outstanding !== null && outstanding > WEEKLY_MINUTES)
      ? true
      : remainingMinutes !== null && outstanding !== null
        ? outstanding > remainingMinutes
        : null;
  return {
    ranked,
    pendingAssessment,
    capacity: {
      timeZone,
      weekStartDate,
      weekEndDateExclusive: addCalendarDays(weekStartDate, 7),
      budgetMinutes: WEEKLY_MINUTES,
      remainingMinutes,
      exceedsCapacity,
    },
  };
}
