import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";

type Row = Record<string, unknown>;

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function loadProfessionalCoverageIndividualRenewal(patientUserId: number) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Row>(
    await db.execute(sql`
      SELECT f.factType, f.effectiveAt, f.payloadJson, s.id AS subscriptionId,
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
  const cancelAtPeriodEnd =
    row.cancelAtPeriodEnd === true ||
    row.cancelAtPeriodEnd === 1 ||
    row.cancelAtPeriodEnd === "1";
  const payload = jsonObject(row.payloadJson);
  return {
    status,
    effectiveAt: row.effectiveAt ? new Date(String(row.effectiveAt)) : null,
    subscriptionId: String(row.subscriptionId),
    coverageKey:
      typeof payload.coverageKey === "string" && payload.coverageKey
        ? payload.coverageKey
        : null,
    cancelAtPeriodEnd,
    paymentMethod,
  };
}

export async function getProfessionalCoverageIndividualRenewalSnapshot(
  patientUserId: number
) {
  const row = await loadProfessionalCoverageIndividualRenewal(patientUserId);
  if (!row) return null;
  const visibleStatus =
    row.status === "confirmed" && !row.cancelAtPeriodEnd
      ? ("kept_by_user" as const)
      : row.status;
  return {
    status: visibleStatus,
    effectiveAt: row.effectiveAt,
    subscriptionId: row.subscriptionId,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canKeepRenewal:
      row.status === "confirmed" &&
      row.paymentMethod === "credit_card" &&
      row.cancelAtPeriodEnd,
    requiresNewPixAuthorization:
      row.status === "confirmed" &&
      row.paymentMethod === "pix_automatic" &&
      row.cancelAtPeriodEnd,
  };
}

export async function getProfessionalCoverageIndividualRenewalContext(input: {
  patientUserId: number;
  subscriptionId: string;
}) {
  const row = await loadProfessionalCoverageIndividualRenewal(input.patientUserId);
  if (
    !row ||
    row.subscriptionId !== input.subscriptionId ||
    row.status !== "confirmed" ||
    !row.coverageKey
  ) {
    return null;
  }
  return {
    coverageKey: row.coverageKey,
    subscriptionId: row.subscriptionId,
  };
}