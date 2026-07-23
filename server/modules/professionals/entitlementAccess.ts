import {
  getProfessionalEntitlements,
  type ProfessionalEntitlementResource,
} from "./entitlementService";

export class ProfessionalResourceDeniedError extends Error {
  constructor(message = "Este recurso não está disponível para o acesso profissional atual.") {
    super(message);
    this.name = "ProfessionalResourceDeniedError";
  }
}

export class ProfessionalEntitlementVerificationUnavailableError extends Error {
  constructor(
    message = "Não foi possível verificar o acesso profissional neste momento."
  ) {
    super(message);
    this.name = "ProfessionalEntitlementVerificationUnavailableError";
  }
}

export async function assertProfessionalResourceAccess(
  professionalUserId: number,
  resource: ProfessionalEntitlementResource
) {
  const snapshot = await getProfessionalEntitlements(professionalUserId);
  if (!snapshot.allowed) {
    if (snapshot.commercialState === "unavailable") {
      throw new ProfessionalEntitlementVerificationUnavailableError();
    }
    throw new ProfessionalResourceDeniedError();
  }
  if (!snapshot.enabledResources.includes(resource)) {
    throw new ProfessionalResourceDeniedError();
  }
  return snapshot;
}
