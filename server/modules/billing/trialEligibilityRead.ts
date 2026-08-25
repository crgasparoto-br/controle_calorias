import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";

export type BillingKnownTrialEligibilityReason =
  | "eligible"
  | "trial_already_used"
  | "transition_history";

export type BillingKnownTrialEligibility = {
  eligible: boolean;
  reason: BillingKnownTrialEligibilityReason;
};

export type BillingKnownTrialEligibilityByAudience = {
  individual: BillingKnownTrialEligibility;
  professional: BillingKnownTrialEligibility;
};

function availability(
  audience: "individual" | "professional",
  transitionHistory: boolean,
  usedAudiences: ReadonlySet<string>
): BillingKnownTrialEligibility {
  if (transitionHistory) {
    return { eligible: false, reason: "transition_history" };
  }
  if (usedAudiences.has(audience)) {
    return { eligible: false, reason: "trial_already_used" };
  }
  return { eligible: true, reason: "eligible" };
}

/**
 * Returns only eligibility that can be established from authoritative local history.
 * Provider-verified phone/document/card identity remains the final authority when a
 * new card checkout is prepared.
 */
export async function getKnownTrialEligibility(
  userId: number
): Promise<BillingKnownTrialEligibilityByAudience> {
  const db = await requireDb(getDb);
  const [transition] = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT id
      FROM billingEntitlements
      WHERE beneficiaryUserId = ${userId}
        AND sourceType = 'transition'
      LIMIT 1
    `)
  );
  const trialRows = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT DISTINCT audience
      FROM billingTrialEligibilityAuditEvents
      WHERE payerUserId = ${userId}
        AND decision = 'allowed'
    `)
  );
  const usedAudiences = new Set(
    trialRows
      .map(row => String(row.audience))
      .filter(value => value === "individual" || value === "professional")
  );
  const transitionHistory = !!transition;
  return {
    individual: availability("individual", transitionHistory, usedAudiences),
    professional: availability("professional", transitionHistory, usedAudiences),
  };
}
