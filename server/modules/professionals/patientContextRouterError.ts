import {
  isProfessionalEntitlementDeniedError,
  isProfessionalEntitlementVerificationUnavailableError,
  toProfessionalEntitlementTrpcError,
} from "./entitledProcedure";
import type { ProfessionalPatientContextInput } from "./patientContextSchemas";

export function professionalPatientContextRouterError(
  resource: ProfessionalPatientContextInput["resource"],
  error: unknown
) {
  return isProfessionalEntitlementDeniedError(error) ||
    isProfessionalEntitlementVerificationUnavailableError(error)
    ? toProfessionalEntitlementTrpcError(resource, error)
    : error;
}
