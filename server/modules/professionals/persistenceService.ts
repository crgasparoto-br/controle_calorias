import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleProfessionalRepository,
  type TransitionProfessionalAuthorizationInput,
  type TransitionProfessionalTrackingInput,
  type UpsertCanonicalProfessionalAuthorizationInput,
  type UpsertCanonicalProfessionalProfileInput,
} from "../../repositories/professionalRepository";
import { deleteProfessionalProfilePersistence } from "../../repositories/professionalProfileDeletionRepository";
import {
  releaseProfessionalCapacityReservation,
  withProfessionalCapacityReservation,
} from "./entitlementService";

const baseProfessionalRepository = createDrizzleProfessionalRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const deletedProfileUserIds = new Set<number>();

function capacityCoverageKey(authorizationId: string) {
  return `professional-authorization:${authorizationId}`;
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

      return withProfessionalCapacityReservation(
        {
          professionalUserId: current.professionalUserId,
          patientUserId: current.patientUserId,
          coverageKey: capacityCoverageKey(current.id),
        },
        () => baseProfessionalRepository.transitionAuthorization(input)
      );
    }

    const transitioned =
      await baseProfessionalRepository.transitionAuthorization(input);

    if (input.nextStatus === "revoked" && current) {
      // A revogação pertence ao paciente e nunca pode ser bloqueada por uma
      // indisponibilidade comercial. A liberação é idempotente pela coverageKey
      // e pode ser repetida com segurança pelo provider central.
      await releaseProfessionalCapacityReservation({
        professionalUserId: current.professionalUserId,
        patientUserId: current.patientUserId,
        coverageKey: capacityCoverageKey(current.id),
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
