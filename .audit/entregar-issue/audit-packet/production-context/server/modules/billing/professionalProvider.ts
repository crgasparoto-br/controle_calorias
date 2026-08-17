import {
  configureProfessionalEntitlementProvider,
  PROFESSIONAL_ENTITLEMENT_RESOURCES,
  type ProfessionalEntitlementProvider,
  type ProfessionalEntitlementReason,
} from "../professionals/entitlementService";
import { billingRepository, billingService } from "./service";
import type { BillingAccessReason } from "./types";

function professionalReason(reason: BillingAccessReason): ProfessionalEntitlementReason {
  if (
    reason === "active_subscription" ||
    reason === "active_trial" ||
    reason === "admin_override" ||
    reason === "read_only_access" ||
    reason === "free_access"
  ) {
    return reason;
  }
  return "no_access";
}

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

      const effectiveReason = professionalReason(access.reason);
      const personalOnlyAccess = effectiveReason === "no_access";
      const administrativeAccess =
        effectiveReason === "admin_override" || effectiveReason === "free_access";
      const entitlements = administrativeAccess
        ? [...PROFESSIONAL_ENTITLEMENT_RESOURCES]
        : access.entitlements;

      return {
        allowed: access.allowed && !personalOnlyAccess,
        reason: effectiveReason,
        validUntil: access.validUntil ?? null,
        planCode: access.planCode ?? subscription?.planCode ?? null,
        planName:
          subscription?.planName ??
          (effectiveReason === "admin_override"
            ? "Liberação administrativa"
            : effectiveReason === "free_access"
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
