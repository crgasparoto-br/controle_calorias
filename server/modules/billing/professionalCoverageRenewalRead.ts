import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";

type Row = Record<string, unknown>;

export async function getProfessionalCoverageIndividualRenewalSnapshot(
  patientUserId: number
) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Row>(
    await db.execute(sql`
      SELECT f.factType, f.effectiveAt, s.id AS subscriptionId,
        s.cancelAtPeriodEnd, i.paymentMethod
      FROM billingSubscriptionFacts f
      INNER JOIN billingSubscriptions s ON s.id = f.subscriptionId
      LEFT JOIN billingContractIntents i ON i.id = (
        SELECT latestIntent.id
        FROM billingContractIntents latestIntent
        WHERE latestIntent.subscriptionId = s.id
        ORDER BY latestIntent.createdAt DESC
        LIMIT 1
      )
      WHERE f.payerUserId = ${patientUserId}
        AND f.factType IN (
          'professional_coverage_individual_renewal_requested',
          'professional_coverage_individual_renewal_pending',
          'professional_coverage_individual_renewal_confirmed',
          'professional_coverage_individual_renewal_kept_by_user'
        )
      ORDER BY f.effectiveAt DESC, f.createdAt DESC
      LIMIT 1
    `)
  );
  if (!row) return null;
  const factType = String(row.factType);
  const status = factType.endsWith("_requested")
    ? ("requested" as const)
    : factType.endsWith("_pending")
      ? ("pending" as const)
      : factType.endsWith("_confirmed")
        ? ("confirmed" as const)
        : ("kept_by_user" as const);
  const paymentMethod = row.paymentMethod ? String(row.paymentMethod) : null;
  return {
    status,
    effectiveAt: row.effectiveAt ? new Date(String(row.effectiveAt)) : null,
    subscriptionId: String(row.subscriptionId),
    cancelAtPeriodEnd:
      row.cancelAtPeriodEnd === true ||
      row.cancelAtPeriodEnd === 1 ||
      row.cancelAtPeriodEnd === "1",
    canKeepRenewal:
      status === "confirmed" &&
      paymentMethod === "credit_card" &&
      (row.cancelAtPeriodEnd === true ||
        row.cancelAtPeriodEnd === 1 ||
        row.cancelAtPeriodEnd === "1"),
    requiresNewPixAuthorization:
      status === "confirmed" && paymentMethod === "pix_automatic",
  };
}