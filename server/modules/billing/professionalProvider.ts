import {
  configureProfessionalEntitlementProvider,
  PROFESSIONAL_ENTITLEMENT_RESOURCES,
  type ProfessionalEntitlementProvider,
} from "../professionals/entitlementService";
import { billingRepository, billingService } from "./service";

export function createBillingProfessionalEntitlementProvider(
  deps: {
    service: typeof billingService;
    repository: typeof billingRepository;
  } = { service: billingService, repository: billingRepository }
): ProfessionalEntitlementProvider {
  return {
    async getEntitlements(professionalUserId) {
      const [access, subscription] = await Promise.all([
        deps.service.getUserEntitlements(professionalUserId),
        deps.repository.getActiveProfessionalSubscription(
          professionalUserId,
          new Date()
        ),
      ]);

      const sponsoredOnly = access.reason === "sponsored_by_professional";
      const administrativeAccess =
        access.reason === "admin_override" || access.reason === "free_access";
      const entitlements = administrativeAccess
        ? [...PROFESSIONAL_ENTITLEMENT_RESOURCES]
        : access.entitlements;

      return {
        allowed: access.allowed && !sponsoredOnly,
        reason: access.reason === "sponsored_by_professional"
          ? "no_access"
          : access.reason,
        validUntil: access.validUntil ?? null,
        planCode: access.planCode ?? subscription?.planCode ?? null,
        planName:
          subscription?.planName ??
          (access.reason === "admin_override"
            ? "Liberação administrativa"
            : access.reason === "free_access"
              ? "Acesso aberto"
              : "Plano profissional"),
        entitlements,
        capacity: subscription
          ? {
              limit: subscription.capacityLimit,
              used: subscription.capacityUsed,
            }
          : { limit: null, used: null },
      };
    },
    reserveCapacity(input) {
      return deps.repository.reserveProfessionalCapacity(input);
    },
    releaseCapacity(input) {
      return deps.repository.releaseProfessionalCapacity(input);
    },
  };
}

export function configureBillingProfessionalEntitlementProvider() {
  configureProfessionalEntitlementProvider(
    createBillingProfessionalEntitlementProvider()
  );
}
