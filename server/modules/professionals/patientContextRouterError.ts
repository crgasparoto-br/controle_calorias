import {
  isProfessionalEntitlementVerificationUnavailableError,
  isProfessionalResourceDeniedError,
} from "./entitlementAccess";
import { toProfessionalEntitlementTrpcError } from "./entitledProcedure";
import type { ProfessionalPatientContextInput } from "./patientContextSchemas";

export function professionalPatientContextRouterError(
  resource: ProfessionalPatientContextInput["resource"],
  error: unknown
) {
  return isProfessionalResourceDeniedError(error) ||
    isProfessionalEntitlementVerificationUnavailableError(error)
    ? toProfessionalEntitlementTrpcError(resource, error)
    : error;
}
