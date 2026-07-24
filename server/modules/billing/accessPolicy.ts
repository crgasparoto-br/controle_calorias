import { TRPCError } from "@trpc/server";
import {
  registerProtectedProcedurePolicy,
  type ProtectedProcedurePolicy,
} from "../../_core/procedurePolicy";
import { billingService } from "./service";

const BILLING_ACCESS_EXEMPT_PREFIXES = ["billing."] as const;

export function isBillingAccessExemptPath(path: string) {
  return BILLING_ACCESS_EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function createBillingAccessPolicy(deps: {
  userCanUseSystem: (userId: number) => Promise<boolean>;
}): ProtectedProcedurePolicy {
  return async ({ path, ctx }) => {
    if (isBillingAccessExemptPath(path)) return;

    const allowed = await deps.userCanUseSystem(ctx.user.id);
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Seu acesso ao sistema está pendente. Consulte Plano e acesso para verificar a situação e as próximas etapas.",
      });
    }
  };
}

export function registerBillingAccessPolicy() {
  return registerProtectedProcedurePolicy(
    createBillingAccessPolicy({
      userCanUseSystem: userId => billingService.userCanUseSystem(userId),
    })
  );
}
