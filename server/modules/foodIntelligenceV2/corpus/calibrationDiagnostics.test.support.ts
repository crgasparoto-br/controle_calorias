/** Test-only negative evidence, not part of the successful C3 artifact contract.
 * An error before this callback starts (e.g. loader, runner start) or outside
 * its control (termination, timeout) may leave no marker. Absence is never
 * measured evidence or approval. This wrapper cannot change runner exit status.
 */
import { chai } from "vitest";

export const C3_CAMPAIGN_DIAGNOSTIC = "C3_CAMPAIGN_DIAGNOSTIC";
type Phase = "calibration" | "selection" | "holdout" | "exploratory_diagnostics" | "report";

export class C3SourceUnavailable extends Error {
  constructor(readonly reasonCode: "source_profile_missing" | "source_profile_unusable", message: string) {
    super(message);
  }
}

export class C3NoCandidateCoversMeasurement extends Error {}

type Failure = { status: "FAILED"; reasonCode: "measured_result_rejected" | "no_candidate_covers_measurement" | "runner_exception" };
type Inconclusive = { status: "INCONCLUSIVE"; reasonCode: C3SourceUnavailable["reasonCode"] };
export type C3CampaignDiagnostic = (Failure | Inconclusive) & {
  schemaVersion: 1;
  campaign: "item30_rounding_v2";
  phase: Phase;
  approved: false;
  promoted: false;
};

/** Emit at most one sanitized diagnostic, then rethrow the *same* exception. */
export async function runFrozenC3Campaign<T>(
  run: (enter: (next: Phase) => void) => Promise<T>,
  emit: (diagnostic: C3CampaignDiagnostic) => void,
): Promise<T> {
  let phase: Phase = "calibration";
  try {
    return await run(next => { phase = next; });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    const outcome: Failure | Inconclusive = error instanceof C3SourceUnavailable
      ? { status: "INCONCLUSIVE", reasonCode: error.reasonCode }
      : { status: "FAILED", reasonCode:
          error instanceof C3NoCandidateCoversMeasurement ? "no_candidate_covers_measurement" :
          error instanceof chai.AssertionError ? "measured_result_rejected" : "runner_exception" };
    try {
      emit({ schemaVersion: 1, campaign: "item30_rounding_v2", phase, approved: false, promoted: false, ...outcome });
    } catch {
      // Diagnostics must not hide the original campaign failure.
    }
    throw error;
  }
}
