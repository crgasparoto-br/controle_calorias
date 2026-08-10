import { TRPCError } from "@trpc/server";
import {
  registerProtectedProcedurePolicy,
  type ProtectedProcedurePolicy,
} from "../../_core/procedurePolicy";
import { billingService } from "./service";
import { canUseBillingWriteAccess, type UserEntitlementsResult } from "./types";

const BILLING_ACCESS_EXEMPT_PREFIXES = ["billing."] as const;
const BILLING_ACCESS_EXEMPT_PATHS = [
  "auth.whatsappOnboarding.linkExistingAccount",
  "nutrition.privacy.requestAccountDeletion",
] as const;

export function isBillingAccessExemptPath(path: string) {
  return (
    BILLING_ACCESS_EXEMPT_PATHS.some(exemptPath => path === exemptPath) ||
    BILLING_ACCESS_EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix))
  );
}

export function createBillingAccessPolicy(deps: {
  getUserEntitlements: (userId: number) => Promise<UserEntitlementsResult>;
}): ProtectedProcedurePolicy {
  return async ({ path, type, ctx }) => {
    if (isBillingAccessExemptPath(path)) return;

    const access = await deps.getUserEntitlements(ctx.user.id);
    if (!access.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Seu acesso ao sistema está pendente. Consulte Plano e acesso para verificar a situação e as próximas etapas.",
      });
    }

    if (type !== "query" && !canUseBillingWriteAccess(access)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Sua assinatura está suspensa. Você ainda pode consultar e exportar seus dados e gerenciar Plano e acesso, mas novos registros e recursos pagos ficam indisponíveis até a regularização.",
      });
    }
  };
}

export function registerBillingAccessPolicy() {
  return registerProtectedProcedurePolicy(
    createBillingAccessPolicy({
      getUserEntitlements: userId => billingService.getUserEntitlements(userId),
    })
  );
}
