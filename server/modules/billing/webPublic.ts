import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prepareAsaasProfessionalEarlyConversion } from "./asaas/remediationRuntime";
import { prepareAsaasRegularization } from "./asaas/regularizationRuntime";
import {
  prepareAsaasBillingFlow,
  reactivateAsaasCancellation,
  requestAsaasCancellation,
} from "./asaas/runtime";
import {
  claimBillingWebCheckoutAttempt,
  releaseBillingWebCheckoutAttempt,
} from "./billingWebCheckoutAttempt";
import { billingCatalogService } from "./catalogRuntime";
import { getProfessionalCapacityWebSnapshot } from "./professionalCapacityRead";
import { getProfessionalCoverageIndividualRenewalSnapshot } from "./professionalCoverageRenewalRead";
import { billingService } from "./service";
import { getSubscriptionWebHistory } from "./subscriptionHistoryRead";
import { getSubscriptionManagementCapabilities } from "./subscriptionManagementRead";
import { billingSubscriptionLifecycleRepository } from "./subscriptionLifecycleRuntime";
import { getKnownTrialEligibility } from "./trialEligibilityRead";

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
  // Backward-compatible input only. The server never trusts this value as the
  // canonical attempt identity; a durable payer-scoped claim supplies it.
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

export const billingSubscriptionActionSchema = z.object({
  subscriptionId: z.string().trim().min(1).max(120),
});

export const billingProfessionalEarlyActivationSchema =
  billingSubscriptionActionSchema.extend({
    confirmed: z.literal(true),
  });

function couponPublicMessage(code: string) {
  const reason = code.replace(/^billing_coupon_/, "");
  const messages: Record<string, string> = {
    inactive: "Cupom inválido ou inativo. Revise o código ou continue sem cupom.",
    outside_validity: "Este cupom está fora do período de validade.",
    product_not_eligible: "Este cupom não é válido para o produto selecionado.",
    version_not_eligible: "Este cupom não é válido para esta versão do plano.",
    cycle_not_eligible: "Este cupom não é válido para o ciclo selecionado.",
    total_limit_reached: "Este cupom esgotou o limite total de utilizações.",
    user_limit_reached: "Este cupom já atingiu o limite de uso para esta conta.",
    first_contract_required: "Este cupom está disponível somente para a primeira contratação elegível.",
    currency_mismatch: "Este cupom não pode ser aplicado à moeda desta contratação.",
    invalid_discount: "Este desconto não pode ser aplicado com segurança. Gratuidade integral depende de isenção administrativa.",
  };
  return (
    messages[reason] ??
    "O cupom não está disponível para esta contratação. Revise o código ou continue sem cupom."
  );
}

function publicBillingError(error: unknown): TRPCError {
  const code = error instanceof Error ? error.message : "";
  if (code === "asaas_operation_in_progress") {
    return new TRPCError({
      code: "CONFLICT",
      message:
        "Uma tentativa equivalente já está sendo processada. Aguarde a confirmação antes de iniciar outra.",
    });
  }
  const messages: Record<string, string> = {
    billing_plan_not_available: "Este plano não está disponível para a operação solicitada.",
    billing_payment_method_not_available: "Este meio de pagamento não está disponível para o plano selecionado.",
    billing_payment_method_not_allowed: "Este meio de pagamento não está disponível para o plano selecionado.",
    billing_subscription_not_found: "A assinatura não foi localizada para esta conta.",
    billing_professional_trial_required: "A ativação antecipada está disponível somente durante um trial profissional ativo.",
    billing_early_conversion_payer_required: "Somente o pagador desta assinatura pode antecipar a ativação.",
    billing_professional_trial_first_charge_missing: "Não foi possível confirmar a data financeira deste trial.",
    asaas_credit_card_trial_subscription_required: "A ativação antecipada exige um trial profissional iniciado por cartão.",
    pix_automatic_requires_trial_waiver: "O Pix Automático inicia uma contratação paga e exige confirmação de que o trial não será utilizado.",
    billing_trial_registered_card_required: "Para iniciar o período de avaliação, conclua primeiro o cadastro do cartão no ambiente seguro de pagamento.",
    billing_contract_trial_already_used: "O período de avaliação já foi utilizado e não está disponível para esta contratação.",
    billing_contract_trial_identity_conflict: "Não foi possível confirmar a elegibilidade para um novo período de avaliação.",
    asaas_pix_reactivation_requires_new_authorization: "Esta renovação por Pix Automático exige uma nova autorização. Inicie uma nova autorização quando essa ação estiver disponível.",
    asaas_reactivation_not_supported: "A reativação não está disponível para este meio de pagamento.",
    asaas_regularization_not_available: "Não há uma ação de regularização disponível para o estado atual desta assinatura.",
    asaas_regularization_reference_missing: "A cobrança ainda não possui referência financeira suficiente para uma regularização segura.",
    asaas_regularization_invoice_not_available: "Não foi localizada uma cobrança vencida ou pendente com fatura segura disponível. Tente novamente após a próxima atualização financeira.",
    asaas_not_configured: "A contratação está temporariamente indisponível. Tente novamente mais tarde.",
  };
  if (code.startsWith("billing_coupon_")) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: couponPublicMessage(code),
    });
  }
  return new TRPCError({
    code: code in messages ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
    message:
      messages[code] ??
      "Não foi possível concluir a operação comercial com segurança. Nenhuma ativação foi presumida.",
  });
}

function isSafePreProviderCheckoutFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return (
    code === "billing_plan_not_available" ||
    code === "billing_payment_method_not_available" ||
    code === "billing_payment_method_not_allowed" ||
    code === "billing_currency_not_supported" ||
    code === "asaas_not_configured" ||
    code.startsWith("billing_coupon_")
  );
}

export async function getBillingWebOverview(userId: number) {
  const [status, catalog, trialEligibility] = await Promise.all([
    billingService.getUserSubscriptionStatus(userId),
    billingCatalogService.listCatalog(),
    getKnownTrialEligibility(userId),
  ]);
  const sponsored = status.access.reason === "sponsored_by_professional";
  const subscription = status.subscription;
  const [lifecycle, management, history, professionalCoverageIndividualRenewal] =
    await Promise.all([
      subscription
        ? billingSubscriptionLifecycleRepository.loadLifecycle(subscription.id)
        : Promise.resolve(null),
      subscription
        ? getSubscriptionManagementCapabilities({
            subscriptionId: subscription.id,
            payerUserId: userId,
          })
        : Promise.resolve(null),
      subscription
        ? getSubscriptionWebHistory({
            subscriptionId: subscription.id,
            payerUserId: userId,
          })
        : Promise.resolve([]),
      sponsored
        ? getProfessionalCoverageIndividualRenewalSnapshot(userId)
        : Promise.resolve(null),
    ]);
  const professionalCapacity =
    !sponsored && status.professionalSubscription
      ? await getProfessionalCapacityWebSnapshot({
          subscriptionId: status.professionalSubscription.id,
          payerUserId: userId,
        })
      : null;
  const canCreateNewSubscription = !subscription || subscription.status === "expired";
  const canActivateProfessionalTrialNow =
    lifecycle?.state === "pending" &&
    lifecycle.audience === "professional" &&
    !!lifecycle.trialStartedAt &&
    !!lifecycle.trialEndsAt &&
    lifecycle.trialEndsAt.getTime() > Date.now() &&
    management?.paymentMethod === "credit_card";
  return {
    ...status,
    professionalSubscription: sponsored ? null : status.professionalSubscription,
    professionalCapacity,
    sponsoredCoverage: sponsored,
    professionalCoverageIndividualRenewal,
    history,
    lifecycle: lifecycle
      ? {
          state: lifecycle.state,
          audience: lifecycle.audience,
          productCode: lifecycle.productCode,
          versionCode: lifecycle.versionCode,
          currentPeriodStart: lifecycle.currentPeriodStart,
          currentPeriodEnd: lifecycle.currentPeriodEnd,
          cancelAtPeriodEnd: lifecycle.cancelAtPeriodEnd,
          trialStartedAt: lifecycle.trialStartedAt,
          trialEndsAt: lifecycle.trialEndsAt,
          firstChargeAt: lifecycle.firstChargeAt,
          trialCapacityLimit: lifecycle.trialCapacityLimit,
          graceStartedAt: lifecycle.graceStartedAt,
          graceEndsAt: lifecycle.graceEndsAt,
          suspendedAt: lifecycle.suspendedAt,
          recoveryEndsAt: lifecycle.recoveryEndsAt,
          reconciliationRequired: lifecycle.reconciliationRequired,
        }
      : null,
    management: management
      ? {
          paymentMethod: management.paymentMethod,
          canReactivateRenewal: management.canReactivateRenewal,
          canUpdatePaymentMethod: management.canUpdatePaymentMethod,
          requiresNewPixAuthorizationForReactivation:
            management.requiresNewPixAuthorizationForReactivation,
        }
      : null,
    catalog,
    trialEligibility,
    actions: {
      canStartCheckout:
        canCreateNewSubscription &&
        catalog.some(item => item.effectivePaymentMethods.length > 0),
      canCancelRenewal:
        !!subscription &&
        subscription.status !== "expired" &&
        !subscription.cancelAtPeriodEnd,
      canReactivateRenewal:
        !!subscription &&
        subscription.cancelAtPeriodEnd &&
        management?.canReactivateRenewal === true,
      canActivateProfessionalTrialNow,
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

  let canonicalContractKey: string | null = null;
  try {
    const attempt = await claimBillingWebCheckoutAttempt({
      userId: input.userId,
      versionCode: input.payload.versionCode,
      paymentMethod: input.payload.paymentMethod,
      trialChoice: input.payload.trialChoice,
      couponCode: input.payload.couponCode,
      replaceExisting: status.subscription?.status === "expired",
    });
    if (attempt.status === "conflict") {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Já existe outra tentativa de contratação em andamento para esta conta. Conclua ou aguarde o encerramento da tentativa atual antes de trocar plano, método ou cupom.",
      });
    }
    canonicalContractKey = attempt.contractKey;

    const result = await prepareAsaasBillingFlow({
      contractKey: canonicalContractKey,
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
    if (canonicalContractKey && isSafePreProviderCheckoutFailure(error)) {
      await releaseBillingWebCheckoutAttempt({
        userId: input.userId,
        contractKey: canonicalContractKey,
        reason: error instanceof Error ? error.message : "safe_pre_provider_failure",
      }).catch(() => undefined);
    }
    if (error instanceof TRPCError) throw error;
    throw publicBillingError(error);
  }
}

export async function regularizeBillingWebSubscription(input: {
  userId: number;
  subscriptionId: string;
}) {
  try {
    const flow = await prepareAsaasRegularization({
      subscriptionId: input.subscriptionId,
      payerUserId: input.userId,
    });
    return {
      flow,
      pendingAuthoritativeConfirmation: true as const,
      message:
        "A cobrança existente será aberta no ambiente seguro do Asaas. O acesso só muda depois da confirmação financeira autoritativa.",
    };
  } catch (error) {
    throw publicBillingError(error);
  }
}

export async function cancelBillingWebSubscription(input: {
  userId: number;
  subscriptionId: string;
}) {
  try {
    await requestAsaasCancellation({
      subscriptionId: input.subscriptionId,
      payerUserId: input.userId,
      correlationId: `billing-web-cancel:${crypto.randomUUID()}`,
    });
    return {
      status: "pending" as const,
      message:
        "O cancelamento da renovação foi solicitado. A vigência atual permanece até a data informada pelo backend.",
    };
  } catch (error) {
    throw publicBillingError(error);
  }
}

export async function reactivateBillingWebSubscription(input: {
  userId: number;
  subscriptionId: string;
}) {
  try {
    await reactivateAsaasCancellation({
      subscriptionId: input.subscriptionId,
      payerUserId: input.userId,
      correlationId: `billing-web-reactivate:${crypto.randomUUID()}`,
    });
    return {
      status: "pending" as const,
      message:
        "A reativação da renovação foi solicitada. O plano, a versão e a data vigente permanecem inalterados até a confirmação do backend.",
    };
  } catch (error) {
    throw publicBillingError(error);
  }
}

export async function activateProfessionalTrialNow(input: {
  userId: number;
  subscriptionId: string;
}) {
  const now = new Date();
  const snapshot = await billingSubscriptionLifecycleRepository.loadLifecycle(
    input.subscriptionId
  );
  if (
    !snapshot ||
    snapshot.payerUserId !== input.userId ||
    snapshot.state !== "pending" ||
    snapshot.audience !== "professional" ||
    !snapshot.trialStartedAt ||
    !snapshot.trialEndsAt ||
    snapshot.trialEndsAt.getTime() <= now.getTime()
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A ativação antecipada não está disponível para esta assinatura.",
    });
  }
  const plan = await billingSubscriptionLifecycleRepository.getPlan(
    snapshot.versionCode,
    now
  );
  if (!plan) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Não foi possível confirmar os termos atuais deste plano.",
    });
  }
  const firstChargeAt = new Date(
    Math.min(now.getTime() + 60_000, snapshot.trialEndsAt.getTime() - 1_000)
  );
  try {
    const result = await prepareAsaasProfessionalEarlyConversion({
      subscriptionId: snapshot.subscriptionId,
      actorUserId: input.userId,
      confirmationKey: `billing-web-early:${crypto.randomUUID()}`,
      productCode: plan.productCode,
      versionCode: plan.versionCode,
      billingCycle: plan.billingCycle,
      currency: plan.currency,
      unitAmount: plan.unitAmount,
      capacityLimit: plan.capacityLimit,
      firstChargeAt,
    });
    return {
      ...result,
      message:
        "A ativação antecipada foi solicitada. O limite integral de pacientes será liberado somente após confirmação financeira autoritativa.",
    };
  } catch (error) {
    throw publicBillingError(error);
  }
}
