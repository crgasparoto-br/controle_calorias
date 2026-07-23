import { TRPCError } from "@trpc/server";
import {
  registerProtectedProcedurePolicy,
  type ProtectedProcedurePolicy,
} from "../../_core/procedurePolicy";
import { assertProfessionalResourceAccess } from "./entitlementAccess";
import type { ProfessionalEntitlementResource } from "./entitlementService";
import { getProfessionalProfile } from "./service";

type LegacyProfessionalResourceRequirement =
  | ProfessionalEntitlementResource
  | readonly ProfessionalEntitlementResource[];

const LEGACY_PROFESSIONAL_RESOURCES: Readonly<
  Record<string, LegacyProfessionalResourceRequirement>
> = {
  "nutrition.professionals.requestAccess": "professional_portfolio",
  "nutrition.professionals.myAccesses": "professional_portfolio",
  "nutrition.professionals.portfolio": "professional_portfolio",
  "nutrition.professionals.transitionTracking": "professional_record",
  "nutrition.professionals.patientTimeZone": [
    "professional_portfolio",
    "professional_record",
    "professional_reports",
    "professional_messages",
  ],
  "nutrition.professionals.patientDashboard": "professional_dashboard",
  "nutrition.professionals.patientPeriodBundle": "professional_reports",
  "nutrition.professionals.addComment": "professional_record",
  "nutrition.professionals.suggestGoalAdjustment": "professional_goals",
  "nutrition.professionals.suggestMealPlan": "professional_record",
  "nutrition.professionals.askPatientQuestion": "professional_ai_assistance",
  "nutrition.professionals.history": "professional_record",
};

export function legacyProfessionalEntitlementResourcesForPath(path: string) {
  const requirement = LEGACY_PROFESSIONAL_RESOURCES[path];
  if (!requirement) return [];
  return Array.isArray(requirement) ? [...requirement] : [requirement];
}

export function legacyProfessionalEntitlementResourceForPath(path: string) {
  return legacyProfessionalEntitlementResourcesForPath(path)[0] ?? null;
}

type LegacyEntitlementPolicyDependencies = {
  getProfile: typeof getProfessionalProfile;
  assertEntitlement: typeof assertProfessionalResourceAccess;
};

export function createLegacyProfessionalEntitlementPolicy(
  dependencies: LegacyEntitlementPolicyDependencies
): ProtectedProcedurePolicy {
  return async ({ path, ctx }) => {
    const resources = legacyProfessionalEntitlementResourcesForPath(path);
    if (!resources.length) return;

    const profile = await dependencies.getProfile(ctx.user.id);
    if (!profile?.active) {
      // Os serviços legados já validam perfil ativo. Deixar que eles executem
      // primeiro preserva a precedência de autorização do paciente e evita
      // trocar um erro seguro de vínculo por detalhes do estado comercial.
      return;
    }

    let lastError: unknown;
    for (const resource of resources) {
      try {
        await dependencies.assertEntitlement(ctx.user.id, resource);
        return;
      } catch (error) {
        lastError = error;
        if (
          error instanceof Error &&
          error.constructor.name ===
            "ProfessionalEntitlementVerificationUnavailableError"
        ) {
          break;
        }
      }
    }

    throw new TRPCError({
      code:
        lastError instanceof Error &&
        lastError.constructor.name ===
          "ProfessionalEntitlementVerificationUnavailableError"
          ? "SERVICE_UNAVAILABLE"
          : "FORBIDDEN",
      message:
        lastError instanceof Error
          ? lastError.message
          : "Este recurso profissional não está disponível.",
    });
  };
}

export function registerLegacyProfessionalEntitlementPolicy() {
  return registerProtectedProcedurePolicy(
    createLegacyProfessionalEntitlementPolicy({
      getProfile: getProfessionalProfile,
      assertEntitlement: assertProfessionalResourceAccess,
    })
  );
}
