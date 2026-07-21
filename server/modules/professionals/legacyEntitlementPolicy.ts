import { TRPCError } from "@trpc/server";
import {
  registerProtectedProcedurePolicy,
  type ProtectedProcedurePolicy,
} from "../../_core/procedurePolicy";
import {
  assertProfessionalEntitlement,
  type ProfessionalEntitlementResource,
} from "./entitlementService";
import { getProfessionalProfile } from "./service";

const LEGACY_PROFESSIONAL_RESOURCES: Readonly<
  Record<string, ProfessionalEntitlementResource>
> = {
  "nutrition.professionals.requestAccess": "professional_portfolio",
  "nutrition.professionals.myAccesses": "professional_portfolio",
  "nutrition.professionals.portfolio": "professional_portfolio",
  "nutrition.professionals.transitionTracking": "professional_record",
  "nutrition.professionals.patientTimeZone": "professional_portfolio",
  "nutrition.professionals.patientDashboard": "professional_dashboard",
  "nutrition.professionals.patientPeriodBundle": "professional_reports",
  "nutrition.professionals.addComment": "professional_record",
  "nutrition.professionals.suggestGoalAdjustment": "professional_goals",
  "nutrition.professionals.suggestMealPlan": "professional_record",
  "nutrition.professionals.askPatientQuestion": "professional_ai_assistance",
  "nutrition.professionals.history": "professional_record",
};

export function legacyProfessionalEntitlementResourceForPath(path: string) {
  return LEGACY_PROFESSIONAL_RESOURCES[path] ?? null;
}

type LegacyEntitlementPolicyDependencies = {
  getProfile: typeof getProfessionalProfile;
  assertEntitlement: typeof assertProfessionalEntitlement;
};

export function createLegacyProfessionalEntitlementPolicy(
  dependencies: LegacyEntitlementPolicyDependencies
): ProtectedProcedurePolicy {
  return async ({ path, ctx }) => {
    const resource = legacyProfessionalEntitlementResourceForPath(path);
    if (!resource) return;

    const profile = await dependencies.getProfile(ctx.user.id);
    if (!profile?.active) {
      // Os serviços legados já validam perfil ativo. Deixar que eles executem
      // primeiro preserva a precedência de autorização do paciente e evita
      // trocar um erro seguro de vínculo por detalhes do estado comercial.
      return;
    }

    try {
      await dependencies.assertEntitlement(ctx.user.id, resource);
    } catch (error) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          error instanceof Error
            ? error.message
            : "Este recurso profissional não está disponível.",
      });
    }
  };
}

export function registerLegacyProfessionalEntitlementPolicy() {
  return registerProtectedProcedurePolicy(
    createLegacyProfessionalEntitlementPolicy({
      getProfile: getProfessionalProfile,
      assertEntitlement: assertProfessionalEntitlement,
    })
  );
}
