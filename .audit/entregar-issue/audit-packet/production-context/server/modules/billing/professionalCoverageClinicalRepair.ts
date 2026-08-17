import { sql } from "drizzle-orm";
import { getDb, logPersistenceWarning } from "../../db";
import { createBillingCapacityRepository } from "../../repositories/billingCapacityRepository";
import { createBillingProfessionalCoverageRepository } from "../../repositories/billingProfessionalCoverageRepository";
import {
  numberValue,
  requireDb,
  resultRows,
  type BillingRepositoryDeps,
} from "../../repositories/billingRepositorySupport";

export type ProfessionalClinicalCoverageLoss = {
  professionalUserId: number;
  patientUserId: number;
  coverageKey: string;
  causeKey: string;
};

type ClinicalRepairDeps = {
  getDb: BillingRepositoryDeps["getDb"];
  transitionRepository: Pick<
    ReturnType<typeof createBillingProfessionalCoverageRepository>,
    "grantTransitionAfterClinicalLoss"
  >;
  capacityRepository: Pick<
    ReturnType<typeof createBillingCapacityRepository>,
    "releaseProfessionalCapacity"
  >;
};

export function createProfessionalCoverageClinicalRepair(
  deps: ClinicalRepairDeps
) {
  async function listPendingClinicalCoverageLosses(limit = 100) {
    const db = await requireDb(deps.getDb);
    const rows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT c.professionalUserId, c.patientUserId, c.coverageKey,
          a.id AS authorizationId, a.status AS authorizationStatus,
          (
            SELECT t.id
            FROM professionalPatientTrackings t
            WHERE t.authorizationId = a.id AND t.status = 'ended'
            ORDER BY t.updatedAt DESC
            LIMIT 1
          ) AS endedTrackingId
        FROM billingCapacityAllocations c
        INNER JOIN professionalPatientAuthorizations a
          ON a.id = c.authorizationId
        WHERE (
          c.state IN ('reserved', 'active')
          OR EXISTS (
            SELECT 1
            FROM billingEntitlements e
            WHERE e.sourceType = 'professional_coverage'
              AND e.sourceId = c.coverageKey
              AND e.beneficiaryUserId = c.patientUserId
              AND e.state = 'active'
          )
        )
          AND (
            a.status = 'revoked'
            OR EXISTS (
              SELECT 1
              FROM professionalPatientTrackings t
              WHERE t.authorizationId = a.id AND t.status = 'ended'
            )
          )
        ORDER BY c.updatedAt ASC
        LIMIT ${Math.max(1, Math.min(limit, 500))}
      `)
    );
    return rows.map(row => {
      const authorizationId = String(row.authorizationId);
      const endedTrackingId = row.endedTrackingId
        ? String(row.endedTrackingId)
        : null;
      return {
        professionalUserId: numberValue(row.professionalUserId),
        patientUserId: numberValue(row.patientUserId),
        coverageKey: String(row.coverageKey),
        causeKey:
          String(row.authorizationStatus) === "revoked"
            ? `authorization-revoked:${authorizationId}`
            : `tracking-ended:${endedTrackingId}`,
      } satisfies ProfessionalClinicalCoverageLoss;
    });
  }

  async function repairClinicalCoverageLoss(
    input: ProfessionalClinicalCoverageLoss & { now?: Date }
  ) {
    const transition =
      await deps.transitionRepository.grantTransitionAfterClinicalLoss({
        patientUserId: input.patientUserId,
        coverageKey: input.coverageKey,
        causeKey: input.causeKey,
        now: input.now,
      });

    await deps.capacityRepository.releaseProfessionalCapacity({
      professionalUserId: input.professionalUserId,
      patientUserId: input.patientUserId,
      coverageKey: input.coverageKey,
      reason: "professional_clinical_origin_ended",
    });

    return transition;
  }

  return {
    listPendingClinicalCoverageLosses,
    repairClinicalCoverageLoss,
  };
}

const repositoryDeps: BillingRepositoryDeps = {
  getDb,
  onWarning: logPersistenceWarning,
};

export const professionalCoverageClinicalRepair =
  createProfessionalCoverageClinicalRepair({
    getDb,
    transitionRepository:
      createBillingProfessionalCoverageRepository(repositoryDeps),
    capacityRepository: createBillingCapacityRepository(repositoryDeps),
  });
