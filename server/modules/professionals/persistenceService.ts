import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleProfessionalRepository,
  type TransitionProfessionalAuthorizationInput,
  type TransitionProfessionalTrackingInput,
  type UpsertCanonicalProfessionalAuthorizationInput,
  type UpsertCanonicalProfessionalProfileInput,
} from "../../repositories/professionalRepository";
import { deleteProfessionalProfilePersistence } from "../../repositories/professionalProfileDeletionRepository";
import { professionalCoverageService } from "../billing/professionalCoverageService";
import { withProfessionalCapacityReservation } from "./entitlementService";

const baseProfessionalRepository = createDrizzleProfessionalRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const deletedProfileUserIds = new Set<number>();

function capacityCoverageKey(authorizationId: string) {
  return `professional-authorization:${authorizationId}`;
}

async function recordCoverageConfirmation(input: {
  patientUserId: number;
  coverageKey: string;
}) {
  try {
    await professionalCoverageService.handleCoverageConfirmed(input);
  } catch (error) {
    // Coverage itself is already valid. Failure to synchronize the secondary
    // individual renewal must remain pending and cannot roll back consent or
    // clinical tracking.
    logPersistenceWarning("billing_professional_coverage_confirmation", error);
  }
}

async function recordCoverageLoss(input: {
  professionalUserId: number;
  patientUserId: number;
  coverageKey: string;
  causeKey: string;
}) {
  try {
    await professionalCoverageService.handleClinicalCoverageLoss(input);
  } catch (error) {
    // Clinical revocation/ending is authoritative. The canonical clinical state
    // plus the preserved allocation/entitlement form a durable repair source for
    // the lifecycle processor, so a transient billing outage cannot lose the
    // release or the patient's transition.
    logPersistenceWarning("billing_professional_coverage_loss", error);
  }
}

async function deleteProfessionalProfile(userId: number) {
  const result = await deleteProfessionalProfilePersistence({ getDb, userId });
  if (result.persisted) deletedProfileUserIds.delete(userId);
  else deletedProfileUserIds.add(userId);
}

export const professionalRepository = {
  ...baseProfessionalRepository,
  async getProfile(userId: number) {
    if (deletedProfileUserIds.has(userId)) return null;
    return baseProfessionalRepository.getProfile(userId);
  },
  async upsertProfile(input: UpsertCanonicalProfessionalProfileInput) {
    const profile = await baseProfessionalRepository.upsertProfile(input);
    deletedProfileUserIds.delete(input.userId);
    return profile;
  },
  deleteProfile: deleteProfessionalProfile,
  async transitionAuthorization(
    input: TransitionProfessionalAuthorizationInput
  ) {
    const current = await baseProfessionalRepository.getAuthorizationById(
      input.authorizationId
    );

    if (input.nextStatus === "approved") {
      if (!current || current.status === "approved") {
        return baseProfessionalRepository.transitionAuthorization(input);
      }

      const coverageKey = capacityCoverageKey(current.id);
      const transitioned = await withProfessionalCapacityReservation(
        {
          professionalUserId: current.professionalUserId,
          patientUserId: current.patientUserId,
          coverageKey,
        },
        () => baseProfessionalRepository.transitionAuthorization(input)
      );
      await recordCoverageConfirmation({
        patientUserId: current.patientUserId,
        coverageKey,
      });
      return transitioned;
    }

    const transitioned =
      await baseProfessionalRepository.transitionAuthorization(input);

    if (input.nextStatus === "revoked" && current) {
      await recordCoverageLoss({
        professionalUserId: current.professionalUserId,
        patientUserId: current.patientUserId,
        coverageKey: capacityCoverageKey(current.id),
        causeKey: `authorization-revoked:${current.id}`,
      });
    }

    return transitioned;
  },
  async transitionTracking(input: TransitionProfessionalTrackingInput) {
    const current = await baseProfessionalRepository.getTrackingByAuthorization(
      input.authorizationId
    );
    const transitioned = await baseProfessionalRepository.transitionTracking(input);

    // Paused tracking keeps consuming the slot. Only definitive ending releases
    // capacity. Ended tracking is terminal in the canonical state machine, so
    // its tracking id is a stable idempotency cause for the repair source.
    if (input.nextStatus === "ended" && current && current.status !== "ended") {
      await recordCoverageLoss({
        professionalUserId: current.professionalUserId,
        patientUserId: current.patientUserId,
        coverageKey: capacityCoverageKey(current.authorizationId),
        causeKey: `tracking-ended:${current.id}`,
      });
    }

    return transitioned;
  },
};

export function getCanonicalProfessionalProfile(userId: number) {
  return professionalRepository.getProfile(userId);
}

export function upsertCanonicalProfessionalProfile(
  input: UpsertCanonicalProfessionalProfileInput
) {
  return professionalRepository.upsertProfile(input);
}

export function listCanonicalProfessionalAuthorizations(
  professionalUserId: number
) {
  return professionalRepository.listAuthorizationsByProfessional(
    professionalUserId
  );
}

export function listCanonicalPatientAuthorizations(patientUserId: number) {
  return professionalRepository.listAuthorizationsByPatient(patientUserId);
}

export function getCanonicalProfessionalAuthorization(authorizationId: string) {
  return professionalRepository.getAuthorizationById(authorizationId);
}

export function getApprovedCanonicalProfessionalAuthorization(
  professionalUserId: number,
  patientUserId: number
) {
  return professionalRepository.getApprovedAuthorization(
    professionalUserId,
    patientUserId
  );
}

export function upsertCanonicalProfessionalAuthorization(
  input: UpsertCanonicalProfessionalAuthorizationInput
) {
  return professionalRepository.upsertAuthorization(input);
}

export function transitionCanonicalProfessionalAuthorization(
  input: TransitionProfessionalAuthorizationInput
) {
  return professionalRepository.transitionAuthorization(input);
}

export function getCanonicalProfessionalTracking(authorizationId: string) {
  return professionalRepository.getTrackingByAuthorization(authorizationId);
}

export function transitionCanonicalProfessionalTracking(
  input: TransitionProfessionalTrackingInput
) {
  return professionalRepository.transitionTracking(input);
}

export function migrateAllLegacyProfessionalData() {
  return professionalRepository.migrateAllLegacyData();
}
