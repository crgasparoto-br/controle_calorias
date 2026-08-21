import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prepareAsaasBillingFlow, requestAsaasCancellation } from "./asaas/runtime";
import { billingCatalogService } from "./catalogRuntime";
import { billingService } from "./service";
import {
  billingSubscriptionLifecycleRepository,
  billingSubscriptionLifecycleService,
} from "./subscriptionLifecycleRuntime";

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
      "Não foi possível concluir a operação comercial com segurança. Nenhuma ativação foi presumida.",
  });
}

export async function getBillingWebOverview(userId: number) {
  const [status, catalog] = await Promise.all([
    billingService.getUserSubscriptionStatus(userId),
    billingCatalogService.listCatalog(),
  ]);
  const sponsored = status.access.reason === "sponsored_by_professional";
  const subscription = status.subscription;
  const lifecycle = subscription
    ? await billingSubscriptionLifecycleRepository.loadLifecycle(subscription.id)
    : null;
  const canCreateNewSubscription = !subscription || subscription.status === "expired";
  return {
    ...status,
    professionalSubscription: sponsored ? null : status.professionalSubscription,
    sponsoredCoverage: sponsored,
    lifecycle: lifecycle
      ? {
          state: lifecycle.state,
          currentPeriodStart: lifecycle.currentPeriodStart,
          currentPeriodEnd: lifecycle.currentPeriodEnd,
          cancelAtPeriodEnd: lifecycle.cancelAtPeriodEnd,
          trialStartedAt: lifecycle.trialStartedAt,
          trialEndsAt: lifecycle.trialEndsAt,
          firstChargeAt: lifecycle.firstChargeAt,
          graceStartedAt: lifecycle.graceStartedAt,
          graceEndsAt: lifecycle.graceEndsAt,
          suspendedAt: lifecycle.suspendedAt,
          recoveryEndsAt: lifecycle.recoveryEndsAt,
          reconciliationRequired: lifecycle.reconciliationRequired,
        }
      : null,
    catalog,
    actions: {
      canStartCheckout:
        canCreateNewSubscription &&
        catalog.some(item => item.effectivePaymentMethods.length > 0),
      canCancelRenewal:
        !!subscription &&
        subscription.status !== "expired" &&
        !subscription.cancelAtPeriodEnd,
      canReactivateRenewal: false,
      canRegularize:
        lifecycle?.state === "past_due" || lifecycle?.state === "suspended",
      canCreateNewSubscription,
    },
  };
}

export async function startBillingWebCheckout(input: {
  userId: number;
  accountName: string | null;
  accountEmail: string | null;
  payload: z.infer<typeof billingStartCheckoutSchema>;
}) {
  const [access, status] = await Promise.all([
    billingService.getUserEntitlements(input.userId),
    billingService.getUserSubscriptionStatus(input.userId),
  ]);
  if (status.subscription && status.subscription.status !== "expired") {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Já existe uma assinatura própria em andamento para esta conta. Gerencie a assinatura atual antes de iniciar uma nova contratação.",
    });
  }
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
