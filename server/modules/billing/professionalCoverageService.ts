import { getDb, logPersistenceWarning } from "../../db";
import { createBillingProfessionalCoverageRepository } from "../../repositories/billingProfessionalCoverageRepository";
import { cancelIndividualRenewalForProfessionalCoverage } from "./professionalCoverageCancellationRuntime";
import {
  professionalCoverageClinicalRepair,
  type ProfessionalClinicalCoverageLoss,
} from "./professionalCoverageClinicalRepair";

export type IndividualRenewalCancellationInput = {
  subscriptionId: string;
  payerUserId: number;
  provider: string;
  correlationId: string;
};

export type IndividualRenewalCancellationResult =
  | { status: "confirmed" }
  | { status: "pending"; errorCode?: string | null };

export type IndividualRenewalCancellationPort = (
  input: IndividualRenewalCancellationInput
) => Promise<IndividualRenewalCancellationResult>;

type ProfessionalCoverageClinicalRepairPort = {
  listPendingClinicalCoverageLosses: (
    limit?: number
  ) => Promise<ProfessionalClinicalCoverageLoss[]>;
  repairClinicalCoverageLoss: (
    input: ProfessionalClinicalCoverageLoss & { now?: Date }
  ) => Promise<unknown>;
};

let cancellationPort: IndividualRenewalCancellationPort | null = null;

export function configureProfessionalCoverageCancellationPort(
  port: IndividualRenewalCancellationPort | null
) {
  cancellationPort = port;
}

export function createProfessionalCoverageService(deps: {
  repository: ReturnType<typeof createBillingProfessionalCoverageRepository>;
  cancelIndividualRenewal?: IndividualRenewalCancellationPort | null;
  clinicalRepair?: ProfessionalCoverageClinicalRepairPort;
  now?: () => Date;
  onWarning?: (scope: string, error: unknown) => void;
}) {
  const nowProvider = deps.now ?? (() => new Date());
  const warning = deps.onWarning ?? (() => undefined);
  const clinicalRepair = deps.clinicalRepair ?? professionalCoverageClinicalRepair;

  async function handleCoverageConfirmed(input: {
    patientUserId: number;
    coverageKey: string;
  }) {
    const now = nowProvider();
    const ownSubscription = await deps.repository.recordIndividualRenewalSync({
      patientUserId: input.patientUserId,
      coverageKey: input.coverageKey,
      status: "requested",
      now,
    });
    if (!ownSubscription) return { status: "not_applicable" as const };

    const cancel = deps.cancelIndividualRenewal ?? cancellationPort;
    if (!cancel) {
      await deps.repository.recordIndividualRenewalSync({
        patientUserId: input.patientUserId,
        coverageKey: input.coverageKey,
        status: "pending",
        errorCode: "cancellation_port_unavailable",
        now,
      });
      return { status: "pending" as const };
    }

    try {
      const result = await cancel({
        subscriptionId: ownSubscription.subscriptionId,
        payerUserId: ownSubscription.payerUserId,
        provider: ownSubscription.provider,
        correlationId: `professional-coverage:${input.coverageKey}`,
      });
      await deps.repository.recordIndividualRenewalSync({
        patientUserId: input.patientUserId,
        coverageKey: input.coverageKey,
        status: result.status,
        errorCode: result.status === "pending" ? result.errorCode : null,
        now,
      });
      return result;
    } catch (error) {
      warning("billing_professional_coverage_individual_renewal", error);
      await deps.repository.recordIndividualRenewalSync({
        patientUserId: input.patientUserId,
        coverageKey: input.coverageKey,
        status: "pending",
        errorCode:
          error instanceof Error ? error.name.slice(0, 120) : "unknown_error",
        now,
      });
      return { status: "pending" as const };
    }
  }

  async function handleClinicalCoverageLoss(
    input: ProfessionalClinicalCoverageLoss
  ) {
    return clinicalRepair.repairClinicalCoverageLoss({
      ...input,
      now: nowProvider(),
    });
  }

  async function processLifecycleFacts(limit = 100) {
    const facts = await deps.repository.listPendingLifecycleFacts(limit);
    const eventTimeCapacityIds = new Set(
      facts
        .filter(fact => fact.factType === "contract_confirmed")
        .map(fact => fact.subscriptionId)
    );
    let applied = 0;
    for (const fact of facts) {
      try {
        if (fact.factType === "contract_confirmed") {
          // Persist the event-time-derived capacity effect before acknowledging
          // the source fact. A crash must leave contract_confirmed pending so a
          // retry uses the same occurredAt instead of the worker clock.
          await deps.repository.reconcileProfessionalCapacity(
            fact.subscriptionId,
            fact.occurredAt
          );
        }
        const result = await deps.repository.applyLifecycleFact(fact);
        if (result === "applied") applied += 1;
        if (fact.factType === "subscription_recovered") {
          await deps.repository.reconcileProfessionalCapacity(
            fact.subscriptionId,
            nowProvider()
          );
        }
      } catch (error) {
        warning("billing_professional_coverage_lifecycle_fact", error);
      }
    }
    const capacityIds =
      await deps.repository.listProfessionalCapacityReconciliationIds(limit);
    for (const subscriptionId of capacityIds) {
      // A pending contract confirmation owns the temporal anchor for its first
      // capacity window. Do not let the generic worker-clock pass race or mask a
      // failed event-time reconciliation in the same processing cycle.
      if (eventTimeCapacityIds.has(subscriptionId)) continue;
      try {
        await deps.repository.reconcileProfessionalCapacity(
          subscriptionId,
          nowProvider()
        );
      } catch (error) {
        warning("billing_professional_capacity_reconciliation", error);
      }
    }

    const clinicalLosses =
      await clinicalRepair.listPendingClinicalCoverageLosses(limit);
    let clinicalRepaired = 0;
    for (const loss of clinicalLosses) {
      try {
        await clinicalRepair.repairClinicalCoverageLoss({
          ...loss,
          now: nowProvider(),
        });
        clinicalRepaired += 1;
      } catch (error) {
        warning("billing_professional_clinical_coverage_repair", error);
      }
    }

    return {
      scanned: facts.length,
      applied,
      capacityScanned: capacityIds.length,
      clinicalScanned: clinicalLosses.length,
      clinicalRepaired,
    };
  }

  function reconcileProfessionalCapacity(subscriptionId: string) {
    return deps.repository.reconcileProfessionalCapacity(
      subscriptionId,
      nowProvider()
    );
  }

  function grantCapacityExtension(input: {
    subscriptionId: string;
    actorUserId: number;
    decisionId: string;
    reason: string;
    analysisStatus: string;
  }) {
    return deps.repository.grantCapacityExtension({
      ...input,
      now: nowProvider(),
    });
  }

  async function keepIndividualRenewal(input: {
    patientUserId: number;
    coverageKey: string;
  }) {
    return deps.repository.recordIndividualRenewalSync({
      ...input,
      status: "kept_by_user",
      now: nowProvider(),
    });
  }

  return {
    handleCoverageConfirmed,
    handleClinicalCoverageLoss,
    processLifecycleFacts,
    reconcileProfessionalCapacity,
    grantCapacityExtension,
    keepIndividualRenewal,
  };
}

export const billingProfessionalCoverageRepository =
  createBillingProfessionalCoverageRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });

export const professionalCoverageService = createProfessionalCoverageService({
  repository: billingProfessionalCoverageRepository,
  cancelIndividualRenewal: cancelIndividualRenewalForProfessionalCoverage,
  clinicalRepair: professionalCoverageClinicalRepair,
  onWarning: logPersistenceWarning,
});
