import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleProfessionalRepository,
  type TransitionProfessionalTrackingInput,
  type UpsertCanonicalProfessionalAuthorizationInput,
  type UpsertCanonicalProfessionalProfileInput,
} from "../../repositories/professionalRepository";

export const professionalRepository = createDrizzleProfessionalRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export function getCanonicalProfessionalProfile(userId: number) {
  return professionalRepository.getProfile(userId);
}

export function upsertCanonicalProfessionalProfile(input: UpsertCanonicalProfessionalProfileInput) {
  return professionalRepository.upsertProfile(input);
}

export function listCanonicalProfessionalAuthorizations(professionalUserId: number) {
  return professionalRepository.listAuthorizationsByProfessional(professionalUserId);
}

export function listCanonicalPatientAuthorizations(patientUserId: number) {
  return professionalRepository.listAuthorizationsByPatient(patientUserId);
}

export function getCanonicalProfessionalAuthorization(authorizationId: string) {
  return professionalRepository.getAuthorizationById(authorizationId);
}

export function getApprovedCanonicalProfessionalAuthorization(
  professionalUserId: number,
  patientUserId: number,
) {
  return professionalRepository.getApprovedAuthorization(professionalUserId, patientUserId);
}

export function upsertCanonicalProfessionalAuthorization(
  input: UpsertCanonicalProfessionalAuthorizationInput,
) {
  return professionalRepository.upsertAuthorization(input);
}

export function getCanonicalProfessionalTracking(authorizationId: string) {
  return professionalRepository.getTrackingByAuthorization(authorizationId);
}

export function transitionCanonicalProfessionalTracking(input: TransitionProfessionalTrackingInput) {
  return professionalRepository.transitionTracking(input);
}

export function migrateLegacyProfessionalDataForUser(userId: number) {
  return professionalRepository.migrateLegacyUser(userId);
}

export function migrateAllLegacyProfessionalData() {
  return professionalRepository.migrateAllLegacyData();
}
