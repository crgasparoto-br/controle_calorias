import {
  isProfessionalEntitlementDeniedError,
  toProfessionalEntitlementTrpcError,
} from "./entitledProcedure";
import type { ProfessionalPatientContextInput } from "./patientContextSchemas";

export function professionalPatientContextRouterError(
  resource: ProfessionalPatientContextInput["resource"],
  error: unknown
) {
  return isProfessionalEntitlementDeniedError(error)
    ? toProfessionalEntitlementTrpcError(resource, error)
    : error;
}
