import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleProfessionalRepository,
  type TransitionProfessionalAuthorizationInput,
  type TransitionProfessionalTrackingInput,
  type UpsertCanonicalProfessionalAuthorizationInput,
  type UpsertCanonicalProfessionalProfileInput,
} from "../../repositories/professionalRepository";
import { assertProfessionalCapacityAvailable } from "./entitlementService";

const baseProfessionalRepository = createDrizzleProfessionalRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export const professionalRepository: typeof baseProfessionalRepository = {
  ...baseProfessionalRepository,
  async transitionAuthorization(input) {
    if (input.nextStatus === "approved") {
      const current = await baseProfessionalRepository.getAuthorizationById(
        input.authorizationId
      );
      if (current && current.status !== "approved") {
        await assertProfessionalCapacityAvailable(current.professionalUserId);
      }
    }
    return baseProfessionalRepository.transitionAuthorization(input);
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

export function migrateLegacyProfessionalDataForUser(userId: number) {
  return professionalRepository.migrateLegacyUser(userId);
}

export function migrateAllLegacyProfessionalData() {
  return professionalRepository.migrateAllLegacyData();
}
