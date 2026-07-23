import { ProfessionalEntitlementDeniedError } from "./entitlementService";
import { toProfessionalEntitlementTrpcError } from "./entitledProcedure";
import type { ProfessionalPatientContextInput } from "./patientContextSchemas";

export function professionalPatientContextRouterError(
  resource: ProfessionalPatientContextInput["resource"],
  error: unknown
) {
  return error instanceof ProfessionalEntitlementDeniedError
    ? toProfessionalEntitlementTrpcError(resource, error)
    : error;
}
