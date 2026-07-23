import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../../_core/trpc";
import {
  assertProfessionalEntitlement,
  type ProfessionalEntitlementResource,
} from "./entitlementService";
import { getProfessionalProfile } from "./service";

const optionalProfessionalResources = new Set<ProfessionalEntitlementResource>([
  "professional_operational_alerts",
  "professional_ai_assistance",
]);

export function isProfessionalEntitlementDeniedError(error: unknown) {
  return (
    error instanceof Error &&
    error.constructor.name === "ProfessionalEntitlementDeniedError"
  );
}

export function professionalEntitlementErrorCode(
  resource: ProfessionalEntitlementResource,
  error: unknown
): "FORBIDDEN" | "PRECONDITION_FAILED" {
  return isProfessionalEntitlementDeniedError(error) &&
    optionalProfessionalResources.has(resource)
    ? "PRECONDITION_FAILED"
    : "FORBIDDEN";
}

export function toProfessionalEntitlementTrpcError(
  resource: ProfessionalEntitlementResource,
  error: unknown
) {
  return new TRPCError({
    code: professionalEntitlementErrorCode(resource, error),
    message:
      error instanceof Error
        ? error.message
        : "Este recurso profissional não está disponível.",
  });
}

export function professionalEntitledProcedure(
  resource: ProfessionalEntitlementResource
) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    try {
      const profile = await getProfessionalProfile(ctx.user.id);
      if (!profile?.active) {
        throw new Error(
          "A Área Profissional está inativa. Reative o perfil para continuar."
        );
      }
      await assertProfessionalEntitlement(ctx.user.id, resource);
    } catch (error) {
      throw toProfessionalEntitlementTrpcError(resource, error);
    }
    return next({ ctx });
  });
}

export const professionalDashboardProcedure = professionalEntitledProcedure(
  "professional_dashboard"
);
export const professionalPortfolioProcedure = professionalEntitledProcedure(
  "professional_portfolio"
);
export const professionalRecordProcedure = professionalEntitledProcedure(
  "professional_record"
);
export const professionalGoalsProcedure = professionalEntitledProcedure(
  "professional_goals"
);
export const professionalAlertsProcedure = professionalEntitledProcedure(
  "professional_operational_alerts"
);
export const professionalMessagesProcedure = professionalEntitledProcedure(
  "professional_messages"
);
export const professionalReportsProcedure = professionalEntitledProcedure(
  "professional_reports"
);
export const professionalAiProcedure = professionalEntitledProcedure(
  "professional_ai_assistance"
);
export const professionalSettingsProcedure = professionalEntitledProcedure(
  "professional_settings"
);
