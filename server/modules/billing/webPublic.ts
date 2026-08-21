import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prepareAsaasBillingFlow, requestAsaasCancellation } from "./asaas/runtime";
import { billingCatalogService } from "./catalogRuntime";
import { billingService } from "./service";
import { billingSubscriptionLifecycleService } from "./subscriptionLifecycleRuntime";

const contractKeySchema = z
  .string()
  .trim()
  .min(12)
  .max(160)
  .regex(/^[A-Za-z0-9:_-]+$/);

const documentSchema = z
  .string()
  .trim()
  .transform(value => value.replace(/\D/g, ""))
  .refine(value => value.length === 11 || value.length === 14, {
    message: "Informe um CPF ou CNPJ válido para continuar.",
  });

export const billingStartCheckoutSchema = z.object({
  contractKey: contractKeySchema,
  versionCode: z.string().trim().min(1).max(120),
  paymentMethod: z.enum(["credit_card", "pix_automatic"]),
  trialChoice: z.enum(["request", "waive"]),
  couponCode: z.string().trim().min(1).max(80).optional().nullable(),
  customer: z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(255).optional().nullable(),
    mobilePhone: z
      .string()
      .trim()
      .transform(value => value.replace(/\D/g, ""))
      .refine(value => value.length >= 10 && value.length <= 13, {
        message: "Informe um telefone válido com DDD.",
      }),
    cpfCnpj: documentSchema,
  }),
});

export const billingCancelSubscriptionSchema = z.object({
  subscriptionId: z.string().trim().min(1).max(120),
});

function publicBillingError(error: unknown): TRPCError {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    billing_plan_not_available: "Este plano não está disponível para contratação agora.",
    billing_payment_method_not_available: "Este meio de pagamento não está disponível para o plano selecionado.",
    billing_payment_method_not_allowed: "Este meio de pagamento não está disponível para o plano selecionado.",
    pix_automatic_requires_trial_waiver: "O Pix Automático inicia uma contratação paga e exige confirmação de que o trial não será utilizado.",
    billing_trial_registered_card_required: "Para iniciar o período de avaliação, conclua primeiro o cadastro do cartão no ambiente seguro de pagamento.",
    billing_contract_trial_already_used: "O período de avaliação já foi utilizado e não está disponível para esta contratação.",
    billing_contract_trial_identity_conflict: "Não foi possível confirmar a elegibilidade para um novo período de avaliação.",
    asaas_not_configured: "A contratação está temporariamente indisponível. Tente novamente mais tarde.",
  };
  if (code.startsWith("billing_coupon_")) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "O cupom não está disponível para esta contratação. Revise o código ou continue sem cupom.",
    });
  }
  return new TRPCError({
    code: code in messages ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
    message:
      messages[code] ??
      "Não foi possível iniciar a operação comercial com segurança. Nenhuma ativação foi confirmada.",
  });
}

export async function getBillingWebOverview(userId: number) {
  const [status, catalog] = await Promise.all([
    billingService.getUserSubscriptionStatus(userId),
    billingCatalogService.listCatalog(),
  ]);
  const sponsored = status.access.reason === "sponsored_by_professional";
  const subscription = status.subscription;
  return {
    ...status,
    // A beneficiary may know that coverage exists, but never receives the
    // sponsor's financial/capacity object through this public read model.
    professionalSubscription: sponsored ? null : status.professionalSubscription,
    sponsoredCoverage: sponsored,
    catalog,
    actions: {
      canStartCheckout: catalog.some(item => item.effectivePaymentMethods.length > 0),
      canCancelRenewal:
        !!subscription &&
        subscription.status !== "expired" &&
        !subscription.cancelAtPeriodEnd,
      canReactivateRenewal:
        !!subscription &&
        subscription.status !== "expired" &&
        subscription.cancelAtPeriodEnd,
      canRegularize:
        subscription?.status === "past_due" || subscription?.status === "suspended",
      canCreateNewSubscription: !subscription || subscription.status === "expired",
    },
  };
}

export async function startBillingWebCheckout(input: {
  userId: number;
  accountName: string | null;
  accountEmail: string | null;
  payload: z.infer<typeof billingStartCheckoutSchema>;
}) {
  const access = await billingService.getUserEntitlements(input.userId);
  if (
    input.payload.paymentMethod === "pix_automatic" &&
    input.payload.trialChoice !== "waive"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Confirme a contratação paga sem trial para usar Pix Automático.",
    });
  }
  try {
    const result = await prepareAsaasBillingFlow({
      contractKey: input.payload.contractKey,
      payerUserId: input.userId,
      versionCode: input.payload.versionCode,
      paymentMethod: input.payload.paymentMethod,
      trialChoice: input.payload.trialChoice,
      customer: {
        payerUserId: input.userId,
        name: input.payload.customer.name || input.accountName || "Usuário",
        email: input.accountEmail ?? input.payload.customer.email ?? null,
        mobilePhone: input.payload.customer.mobilePhone,
        cpfCnpj: input.payload.customer.cpfCnpj,
      },
      couponCode: input.payload.couponCode?.trim() || null,
      correlationId: `billing-web:${crypto.randomUUID()}`,
      transitionAccessUntil:
        access.reason === "transition_access" ? access.validUntil ?? null : null,
    });
    return {
      ...result,
      // The browser return is navigation only. This flag remains true until a
      // provider-authoritative financial fact changes the lifecycle state.
      pendingAuthoritativeConfirmation: true as const,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw publicBillingError(error);
  }
}

export async function cancelBillingWebSubscription(input: {
  userId: number;
  subscriptionId: string;
}) {
  const correlationId = `billing-web-cancel:${crypto.randomUUID()}`;
  try {
    await requestAsaasCancellation({
      subscriptionId: input.subscriptionId,
      payerUserId: input.userId,
      correlationId,
    });
    await billingSubscriptionLifecycleService.requestCancellation(
      input.subscriptionId,
      correlationId
    );
    return {
      status: "pending" as const,
      message:
        "O cancelamento da renovação foi solicitado. A vigência atual permanece até a data informada pelo backend.",
    };
  } catch (error) {
    throw publicBillingError(error);
  }
}
